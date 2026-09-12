import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld } from '../src/sim/world.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';
import { groupBlueprint } from '../src/sim/grouping.js';
import { starterRover } from '../src/studio/presets.js';
import { GROUND } from '../src/challenges/packs/ground.js';

const STEP = 1 / 60;
beforeAll(async () => { await RAPIER.init(); }, 30000);

const level = GROUND.find((l) => l.id === 'deadweight');
const goalEdge = () => level.zones[0].pos[2] - level.zones[0].size[2] / 2;

/**
 * The machine the hint describes: ballast sat over the driven axles, wheels
 * down both sides. Every placement is checked, because a wheel that did not
 * attach is a wheel that does not drive, and a rig with one of those would
 * quietly test nothing.
 */
function hauler(ballast) {
  const bp = new Blueprint({ name: 'hauler' });
  const left = yawStep(yawStep(IDENTITY_ORIENTATION));
  const put = (type, cell, rot) => {
    const out = bp.place(type, cell, rot);
    if (!out.ok) throw new Error(`${type} at ${cell}: ${out.reason}`);
  };
  put('panel', [0, 0, 0]);
  put('core', [0, 1, 0]);
  for (const z of [-1, 1]) {
    put('wheel', [2, 0, z]);
    put('wheel', [-2, 0, z], left);
  }
  // Kept symmetric about the centreline: a lopsided load steers the machine
  // off the crate and turns a power problem into an aiming one.
  const pairs = [
    [[0, 1, -1], [0, 1, 1]],
    [[1, 1, 0], [-1, 1, 0]],
    [[1, 1, -1], [-1, 1, -1]],
    [[1, 1, 1], [-1, 1, 1]],
  ];
  for (let i = 0; i < ballast / 2; i += 1) for (const cell of pairs[i]) put('ballast', cell);

  const grouping = groupBlueprint(bp);
  expect(grouping.disconnected, 'the test rig is not all joined up').toEqual([]);
  return bp;
}

function haul(blueprint, seconds = 22) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const arena = new Arena({ RAPIER, world, scene, level, seed: 4 });
  const machine = new Machine({
    RAPIER, world, scene, blueprint, level,
    spawn: new THREE.Vector3(...level.spawn),
  });
  const down = new Set(['KeyW']);
  const bus = new SignalBus({ down, isDown: (c) => down.has(c), wasPressed: () => false });
  let best = -99;
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    best = Math.max(best, arena.propPosition('crate').z);
  }
  return best;
}

/**
 * A level nobody can beat is worse than one that is too easy, and a pushing
 * puzzle is the easiest kind to get wrong: the crate either slides or it does
 * not, so the difference between "hard" and "impossible" is invisible from
 * the level file. These are the numbers that say which side of it this is.
 */
describe('Deadweight can be won', () => {
  it('gives way to a machine built the way the hint says', () => {
    expect(haul(hauler(8))).toBeGreaterThan(goalEdge());
  });

  it('leaves room in the budget for the machine that does it', () => {
    expect(hauler(8).cost()).toBeLessThanOrEqual(level.budget.cost);
  });

  // Otherwise it is not a puzzle, it is a drive.
  it('does not give way to the machine you start with', () => {
    expect(haul(starterRover())).toBeLessThan(goalEdge());
  });

  it('takes real weight rather than a token amount', () => {
    expect(haul(hauler(2))).toBeLessThan(goalEdge());
  });

  /**
   * The hint names a number because the threshold is sharp: seven ballast
   * moves the crate a metre and stops, eight takes it the whole way. Without
   * being told, the honest conclusion from seven is that the level is broken.
   */
  it('says in the hint what it actually takes', () => {
    expect(level.hint).toMatch(/eight ballast/i);
    expect(level.hint).toMatch(/axle/i);
  });
});
