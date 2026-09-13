import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { Blueprint } from '../src/core/blueprint.js';
import { padMode, padDamping, getPart } from '../src/parts/registry.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * A pressure pad knows when something is resting on it.
 *
 * Two things make it worth having over a distance sensor pointed downwards.
 * It reads contact rather than range, so a load sitting in a basket trips it
 * and the basket floor does not. And it has a mode: a level you can hold a
 * gate open with, or an edge you can toggle something with — because a toggle
 * fed a level flips back and forth every frame the load stays put.
 */

const level = (props = []) => ({
  id: 'pad-rig',
  name: 'Pad rig',
  spawn: [0, 0.6, 0],
  groundSize: 60,
  budget: { cost: 999 },
  pieces: [],
  props,
  zones: [],
  objectives: [],
  demands: { steps: 1, flies: false },
  bans: [],
  par: 60,
});

/**
 * A flat machine with a pad on its deck. The ball is aimed at where the pad
 * actually ends up rather than at where the cell grid suggests it will, so the
 * rig tests the pad rather than my arithmetic.
 */
function rig({ mode = 'while', damping = 0.2, drop = null, seconds = 3 } = {}) {
  const bp = new Blueprint({ name: 'Pad rig' });
  bp.place('panel', [0, 0, 0]);
  bp.place('core', [0, 1, 0]);
  // Up on the deck. A pad low enough to touch the ground is pressed by the
  // ground, which is correct of it and useless as a rig.
  bp.place('block', [0, 1, 1]);
  const pad = bp.place('pressure', [0, 2, 1]);
  bp.setConfig(pad.id, { mode, damping });

  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const bare = level();
  const machine = new Machine({
    RAPIER, world, scene, blueprint: bp, level: bare, spawn: new THREE.Vector3(...bare.spawn),
  });
  const seat = machine.partWorldPoint(bp.get(pad.id));
  const lvl = level(drop === null ? [] : [{
    id: 'ball', pos: [seat.x, seat.y + drop, seat.z], radius: 0.3, mass: 3, colour: 0xd6544a,
  }]);
  const arena = new Arena({
    RAPIER, world, scene, level: lvl, seed: 1,
  });
  const bus = new SignalBus({ isDown: () => false, wasPressed: () => false });

  const trace = [];
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    trace.push(machine.padTriggered(pad.id));
  }
  const edges = trace.filter((on, i) => on && !trace[i - 1]).length;
  return {
    trace,
    edges,
    everOn: trace.some(Boolean),
    onFor: trace.filter(Boolean).length * STEP,
  };
}

describe('a pressure pad', () => {
  it('is a part you can place and wire up', () => {
    const part = getPart('pressure');
    expect(part.ports.out.map((p) => p.id)).toContain('triggered');
    expect(part.category).toBe('logic');
  });

  it('says nothing while nothing is on it', () => {
    expect(rig({ drop: null }).everOn).toBe(false);
  });

  /**
   * It reads contact, not cargo, so the ground counts. Worth knowing rather
   * than worth fixing: a pad is a thing you mount where only the load can
   * reach, and one dragging along the floor should say it is being pressed.
   */
  it('is pressed by the ground when the ground is what it is resting on', () => {
    // The pad is the bottom of this machine, so the floor is on it.
    const bp = new Blueprint();
    const pad = bp.place('pressure', [0, 0, 0]);
    bp.place('panel', [0, 1, 0]);
    bp.place('core', [0, 2, 0]);
    const lvl = level();
    const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const arena = new Arena({ RAPIER, world, scene, level: lvl, seed: 1 });
    const machine = new Machine({
      RAPIER, world, scene, blueprint: bp, level: lvl, spawn: new THREE.Vector3(0, 1, 0),
    });
    const bus = new SignalBus({ isDown: () => false, wasPressed: () => false });
    let on = false;
    for (let i = 0; i < 180; i += 1) {
      arena.step(STEP);
      machine.update(STEP, bus);
      world.step();
      on = on || machine.padTriggered(pad.id);
    }
    expect(on, 'a pad sitting on the floor did not notice the floor').toBe(true);
  }, 60000);

  it('goes off when something lands on it', () => {
    const out = rig({ drop: 1.5 });
    expect(out.everOn, 'the ball landed and the pad said nothing').toBe(true);
  }, 60000);

  /**
   * The reason damping is a setting rather than a constant. A ball landing
   * bounces, and an undamped pad reports each bounce as a separate catch —
   * which is a fault, not a catch, to anything counting them.
   */
  it('reports one catch rather than one per bounce', () => {
    const out = rig({ drop: 1.5, mode: 'once', damping: 0.4 });
    expect(out.everOn).toBe(true);
    expect(out.edges, `fired ${out.edges} times for one ball`).toBe(1);
  }, 60000);

  it('chatters without it, which is what the setting is for', () => {
    const damped = rig({ drop: 1.5, mode: 'once', damping: 0.4 });
    const raw = rig({ drop: 1.5, mode: 'once', damping: 0 });
    expect(raw.edges).toBeGreaterThanOrEqual(damped.edges);
  }, 60000);
});

describe('the two fire types', () => {
  it('holds on for as long as the load is there, set to while pressed', () => {
    const out = rig({ drop: 1.5, mode: 'while', damping: 0.2, seconds: 4 });
    expect(out.onFor, `only on for ${out.onFor.toFixed(2)}s`).toBeGreaterThan(1.5);
  }, 60000);

  // A toggle fed a level flips every frame; it wants an edge.
  it('gives one short pulse, set to one shot', () => {
    const out = rig({ drop: 1.5, mode: 'once', damping: 0.3, seconds: 4 });
    expect(out.everOn).toBe(true);
    expect(out.onFor, `pulse lasted ${out.onFor.toFixed(2)}s`).toBeLessThan(0.6);
    expect(out.edges).toBe(1);
  }, 60000);
});

describe('the settings', () => {
  const placed = (config) => ({ config });

  it('default to a level with a little damping on it', () => {
    expect(padMode(placed(undefined))).toBe('while');
    expect(padDamping(placed(undefined))).toBeGreaterThan(0);
  });

  it('take the two fire types and nothing else', () => {
    expect(padMode(placed({ mode: 'once' }))).toBe('once');
    expect(padMode(placed({ mode: 'nonsense' }))).toBe('while');
  });

  it('keep damping inside what the part allows', () => {
    const range = getPart('pressure').dampingRange;
    expect(padDamping(placed({ damping: 999 }))).toBe(range[1]);
    expect(padDamping(placed({ damping: -5 }))).toBe(range[0]);
  });
});
