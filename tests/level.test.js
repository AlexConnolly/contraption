import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Machine } from '../src/sim/machine.js';
import { Arena } from '../src/sim/arena.js';
import { SignalBus } from '../src/sim/signals.js';
import { ObjectiveTracker, withinBudget } from '../src/challenges/objectives.js';
import { getLevel } from '../src/challenges/levels.js';
import { starterRover } from '../src/studio/presets.js';

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
    const turn = forward.z * heading.x - forward.x * heading.z;

    input.down.add('KeyW');
    if (turn > 0.04) input.down.add('KeyD');
    else if (turn < -0.04) input.down.add('KeyA');
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
