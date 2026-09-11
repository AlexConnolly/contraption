import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Machine } from '../src/sim/machine.js';
import { Arena } from '../src/sim/arena.js';
import { SignalBus } from '../src/sim/signals.js';
import { ObjectiveTracker, withinBudget } from '../src/challenges/objectives.js';
import { getLevel } from '../src/challenges/levels.js';
import { starterRover, quadcopter } from '../src/studio/presets.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, pitchStep } from '../src/core/orientation.js';

const STEP = 1 / 60;

function keyboard() {
  const down = new Set();
  return { down, isDown: (c) => down.has(c), wasPressed: () => false };
}

function playLevel(levelId, blueprint, drive, seconds) {
  const level = getLevel(levelId);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const scene = new THREE.Scene();
  const arena = new Arena({ RAPIER, world, scene, level });
  const machine = new Machine({
    RAPIER, world, scene, blueprint, spawn: new THREE.Vector3(...level.spawn),
  });
  const input = keyboard();
  const bus = new SignalBus(input);
  const tracker = new ObjectiveTracker(level);

  let report = tracker.report();
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    drive(input, arena, machine);
    machine.update(STEP, bus);
    world.step();
    report = tracker.update(STEP, {
      propPosition: (id) => arena.propPosition(id),
      corePosition: () => machine.corePosition(),
    });
    if (report.complete) break;
  }
  return { level, report, arena, machine };
}

beforeAll(async () => {
  await RAPIER.init();
}, 30000);

/**
 * Plays like a person would: aim at a point just beyond the crate, steer to
 * hold that heading, and ease off once the crate is on the mark.
 */
function pushToward(targetZ) {
  return (input, arena, machine) => {
    input.down.clear();
    const crate = arena.propPosition('crate');
    if (crate.z >= targetZ) return;

    const aim = new THREE.Vector3(0, 0, crate.z + 1);
    const heading = aim.sub(machine.corePosition()).setY(0).normalize();
    const forward = machine.coreForward();
    // The machine's right is forward x up, so a heading with a positive
    // component along it needs a right turn.
    const right = forward.clone().cross(new THREE.Vector3(0, 1, 0));
    const offRight = heading.dot(right);

    input.down.add('KeyW');
    if (offRight > 0.04) input.down.add('KeyD');
    else if (offRight < -0.04) input.down.add('KeyA');
  };
}

describe('first haul, played end to end', () => {
  it('is solvable by driving the starter rover and stopping on the mark', () => {
    const { level, report } = playLevel(
      'first-haul',
      starterRover(),
      pushToward(10.8),
      45,
    );
    expect(report.complete).toBe(true);
    expect(report.elapsed).toBeLessThan(level.par);
  });

  it('does not complete if the machine never moves', () => {
    const { report } = playLevel('first-haul', starterRover(), () => {}, 12);
    expect(report.complete).toBe(false);
  });

  it('keeps the starter rover inside the level budget', () => {
    const level = getLevel('first-haul');
    const check = withinBudget(starterRover(), level);
    expect(check.ok).toBe(true);
    expect(check.cost).toBeLessThanOrEqual(level.budget.cost);
  });
});

/**
 * The quadcopter with a grabber slung underneath. The deck sits a cell higher
 * so the claw has somewhere to hang.
 */
function liftDrone() {
  const bp = new Blueprint({ name: 'Lift drone' });
  const facingDown = pitchStep(pitchStep(IDENTITY_ORIENTATION));
  bp.place('grabber', [0, 0, 0], facingDown, { binding: { mode: 'hold', pos: 'KeyG' } });
  bp.place('panel', [0, 1, 0]);
  bp.place('core', [0, 2, 0]);
  bp.place('controller', [0, 2, -1]);
  for (const cell of [[-1, 2, -1], [1, 2, -1], [-1, 2, 1], [1, 2, 1]]) {
    bp.place('propeller', cell, IDENTITY_ORIENTATION, { binding: { mode: 'flight' } });
  }
  return bp;
}

/**
 * Flies to a point by holding the keys a person would hold. It lets go of the
 * stick early and leaves the rest to the controller's own braking: holding on
 * until arrival just sails past the mark and back again, harder each time.
 */
function flyTo(input, machine, target, grabbing) {
  const at = machine.corePosition();
  const velocity = machine.bodies[machine.grouping.rootBody].linvel();
  input.down.clear();
  if (grabbing) input.down.add('KeyG');

  const dz = target.z - at.z;
  if (dz > Math.max(0.4, velocity.z * 1.6)) input.down.add('KeyW');
  else if (dz < Math.min(-0.4, velocity.z * 1.6)) input.down.add('KeyS');

  const dy = target.y - at.y;
  if (dy > Math.max(0.25, velocity.y * 0.8)) input.down.add('Space');
  else if (dy < Math.min(-0.25, velocity.y * 0.8)) input.down.add('ShiftLeft');

  return Math.abs(dz) < 0.6 && Math.abs(dy) < 0.4;
}

function speedOf(machine) {
  const v = machine.bodies[machine.grouping.rootBody].linvel();
  return Math.hypot(v.x, v.y, v.z);
}

describe('airlift, flown end to end', () => {
  it('is solvable by a drone under its flight controller', () => {
    const level = getLevel('airlift');
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = STEP;
    const scene = new THREE.Scene();
    const arena = new Arena({ RAPIER, world, scene, level });
    const blueprint = liftDrone();
    const machine = new Machine({
      RAPIER, world, scene, blueprint, spawn: new THREE.Vector3(...level.spawn),
    });
    const input = keyboard();
    const bus = new SignalBus(input);
    const tracker = new ObjectiveTracker(level);
    const grabber = blueprint.list().find((p) => p.type === 'grabber');

    // Fly high, stop over the payload, settle, then drop onto it. Bolting a
    // grabber to something stationary at speed throws the machine over, which
    // is exactly what a person would find out the hard way too.
    let phase = 'travel';
    let report = tracker.report();
    for (let i = 0; i < Math.round(120 / STEP) && !report.complete; i += 1) {
      const payload = arena.propPosition('payload');
      const holding = machine.grabs.has(grabber.id);
      const slow = speedOf(machine) < 0.6;

      if (phase === 'travel') {
        if (flyTo(input, machine, { z: payload.z, y: 5 }, false) && slow) phase = 'descend';
      } else if (phase === 'descend') {
        flyTo(input, machine, { z: payload.z, y: payload.y + 1.5 }, true);
        if (holding) phase = 'lift';
      } else if (phase === 'lift') {
        flyTo(input, machine, { z: payload.z, y: 7 }, true);
        if (machine.corePosition().y > 6.5) phase = 'carry';
      } else if (phase === 'carry') {
        if (flyTo(input, machine, { z: 8, y: 7 }, true) && slow) phase = 'drop';
      } else {
        flyTo(input, machine, { z: 8, y: 5.4 }, false);
      }
      if (!holding && (phase === 'lift' || phase === 'carry')) phase = 'descend';

      machine.update(STEP, bus);
      world.step();
      report = tracker.update(STEP, {
        propPosition: (id) => arena.propPosition(id),
        corePosition: () => machine.corePosition(),
      });
    }

    expect(machine.isUpsideDown()).toBe(false);
    expect(report.complete).toBe(true);
  });

  it('keeps the lift drone inside the airlift budget', () => {
    const level = getLevel('airlift');
    expect(withinBudget(liftDrone(), level).ok).toBe(true);
    expect(withinBudget(quadcopter(), level).ok).toBe(true);
  });
});
