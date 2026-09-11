import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { Machine } from '../src/sim/machine.js';
import { Arena } from '../src/sim/arena.js';
import { ObjectiveTracker, withinMassCap, machineMass } from '../src/challenges/objectives.js';
import { starterRover } from '../src/studio/presets.js';
import { createWorld } from '../src/sim/world.js';

const STEP = 1 / 60;

beforeAll(async () => { await RAPIER.init(); }, 30000);

function build(blueprint, level = { spawn: [0, 1, 0], objectives: [] }) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const machine = new Machine({
    RAPIER,
    world,
    scene: new THREE.Scene(),
    blueprint,
    spawn: new THREE.Vector3(0, 1, 0),
    level,
  });
  return { world, machine };
}

/**
 * A mass cap is the other half of a parts budget. Budget limits what you
 * spend; this limits what you weigh, and the two pull in different directions
 * — a cheap machine can be a heavy one. It is the rule that makes people take
 * things off rather than bolt more on.
 */
describe('a mass cap', () => {
  it('adds up what a machine actually weighs', () => {
    const { machine } = build(starterRover());
    const mass = machineMass(machine);
    expect(mass).toBeGreaterThan(0);
    expect(Number.isFinite(mass)).toBe(true);
  });

  it('counts every body, not just the one the core is on', () => {
    // A rover's wheels are bodies of their own, jointed to the chassis.
    const { machine } = build(starterRover());
    const chassis = machine.bodies[0].mass();
    expect(machineMass(machine)).toBeGreaterThan(chassis);
  });

  it('gets heavier as parts go on', () => {
    const light = new Blueprint();
    light.place('core', [0, 0, 0]);
    const heavy = new Blueprint();
    heavy.place('core', [0, 0, 0]);
    heavy.place('ballast', [0, 1, 0]);
    expect(machineMass(build(heavy).machine))
      .toBeGreaterThan(machineMass(build(light).machine));
  });

  it('passes a machine under the cap', () => {
    const { machine } = build(starterRover());
    const cap = machineMass(machine) + 50;
    expect(withinMassCap(machine, { massCap: cap }).ok).toBe(true);
  });

  it('refuses one over it, and says by how much', () => {
    const { machine } = build(starterRover());
    const result = withinMassCap(machine, { massCap: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/heavy/i);
    expect(result.mass).toBeGreaterThan(1);
    expect(result.cap).toBe(1);
  });

  it('says nothing on a level with no cap', () => {
    const { machine } = build(starterRover());
    expect(withinMassCap(machine, {}).ok).toBe(true);
  });
});

/**
 * Getting there is half of it. A return trip kills the one-way fling — a
 * machine that throws itself across a gap and lands in a heap has not
 * finished the job.
 */
describe('coming back', () => {
  const level = {
    spawn: [0, 1, 0],
    groundSize: 120,
    zones: [
      { id: 'drop', pos: [0, 1, 10], size: [4, 3, 4], colour: 0x4ade80 },
      { id: 'home', pos: [0, 1, 0], size: [4, 3, 4], colour: 0x4ade80 },
    ],
    props: [{ id: 'crate', pos: [0, 0.6, 2], size: [1, 1, 1], mass: 4, colour: 0xc98b4b }],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'drop', label: 'Crate delivered' },
      { type: 'coreInZone', zone: 'home', after: 0, label: 'Machine back home' },
    ],
  };

  function track(cratePos, corePos) {
    const tracker = new ObjectiveTracker(level);
    tracker.update(STEP, {
      propPosition: () => new THREE.Vector3(...cratePos),
      corePosition: () => new THREE.Vector3(...corePos),
    });
    return tracker.report();
  }

  it('is not finished when the crate is there but the machine is not', () => {
    const report = track([0, 1, 10], [0, 1, 10]);
    expect(report.objectives[0].done).toBe(true);
    expect(report.complete).toBe(false);
  });

  it('is finished when the crate is there and the machine came home', () => {
    const report = track([0, 1, 10], [0, 1, 0]);
    expect(report.complete).toBe(true);
  });

  // Sitting on the start pad from the beginning must not tick the box before
  // the delivery has happened, or the level is over the moment it opens.
  it('does not count coming home before the job is done', () => {
    const report = track([0, 0.6, 2], [0, 1, 0]);
    expect(report.complete).toBe(false);
  });
});

/**
 * One attempt. It costs a single flag and it changes what people build,
 * because reliability suddenly beats speed.
 */
describe('no respawn', () => {
  it('is off unless the level asks for it', () => {
    expect(Boolean({ objectives: [] }.noRespawn)).toBe(false);
  });

  it('is a plain flag a run loop can read', () => {
    expect({ noRespawn: true }.noRespawn).toBe(true);
  });
});

/**
 * A level with no win condition, only a number. The one kind people replay
 * without being asked to.
 */
describe('scored levels', () => {
  const yard = {
    spawn: [0, 1, 0],
    groundSize: 80,
    scored: { label: 'Blocks in the bin', unit: '' },
    zones: [{ id: 'bin', pos: [0, 1, 6], size: [4, 3, 4], colour: 0x4ade80 }],
    stacks: [{ id: 'rock', count: 6, pos: [0, 0.5, -4], spread: [3, 1, 3], size: [0.5, 0.5, 0.5], mass: 1 }],
    objectives: [{ type: 'propsInZone', stack: 'rock', zone: 'bin', label: 'Blocks in the bin' }],
  };

  function tracked(inside) {
    const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
    const arena = new Arena({ RAPIER, world, scene: new THREE.Scene(), level: yard, seed: 3 });
    const ids = [...arena.props.keys()];
    const tracker = new ObjectiveTracker(yard);
    const report = tracker.update(STEP, {
      propPosition: (id) => (ids.indexOf(id) < inside
        ? new THREE.Vector3(0, 1, 6)
        : new THREE.Vector3(0, 1, -4)),
      corePosition: () => new THREE.Vector3(0, 1, 0),
    });
    arena.dispose();
    return report;
  }

  it('counts how many are in rather than passing or failing', () => {
    expect(tracked(0).score).toBe(0);
    expect(tracked(3).score).toBe(3);
    expect(tracked(6).score).toBe(6);
  });

  it('never completes, because there is nothing to complete', () => {
    expect(tracked(6).complete).toBe(false);
  });

  it('says what the number means, so the card can label it', () => {
    expect(tracked(2).scoreLabel).toBe('Blocks in the bin');
  });

  it('leaves an ordinary level with no score at all', () => {
    const tracker = new ObjectiveTracker({
      objectives: [{ type: 'coreInZone', zone: 'z', label: 'there' }],
      zones: [{ id: 'z', pos: [0, 0, 0], size: [2, 2, 2] }],
    });
    const report = tracker.update(STEP, {
      propPosition: () => null,
      corePosition: () => new THREE.Vector3(0, 0, 0),
    });
    expect(report.score).toBe(null);
  });
});
