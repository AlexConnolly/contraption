import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { buildProblem } from '../src/challenges/objectives.js';
import { getLevel } from '../src/challenges/levels.js';
import { mast } from '../src/studio/mast.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

const LEVEL = getLevel('stacked-loop');

/** Holds the piston key down and reports how high the top of the mast gets. */
function raise(seconds = 14) {
  const { blueprint, rams } = mast();
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const machine = new Machine({
    RAPIER,
    world,
    scene: new THREE.Scene(),
    blueprint,
    level: LEVEL,
    spawn: new THREE.Vector3(...LEVEL.spawn),
  });
  const arena = new Arena({
    RAPIER, world, scene: new THREE.Scene(), level: LEVEL, seed: 5,
  });
  const held = new Set(['KeyE']);
  const bus = new SignalBus({ isDown: (c) => held.has(c), wasPressed: () => false });

  const tip = blueprint.get(rams[rams.length - 1]);
  let highest = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    highest = Math.max(highest, machine.partWorldPoint(tip).y);
  }
  return { highest, blueprint };
}

describe('four blocks tall, nine metres of reach', () => {
  it('is inside the cap the level sets', () => {
    expect(mast().blueprint.height()).toBe(LEVEL.heightCap);
    expect(buildProblem(mast().blueprint, LEVEL)).toBe(null);
  });

  /**
   * The claim the level rests on. The tenth load's centre sits at about 7.8 m,
   * so its underside is near 7.4 m — whatever places it has to get there, and
   * a machine capped at four blocks has to grow to do it.
   */
  it('reaches past the top of a ten-high tower', () => {
    const { highest } = raise();
    console.log(`mast top reached ${highest.toFixed(2)}m`);
    expect(highest, `only reached ${highest.toFixed(2)}m`).toBeGreaterThan(7.4);
  }, 120000);

  it('is far taller extended than it is allowed to be built', () => {
    const built = mast().blueprint.height() * 0.5;
    const { highest } = raise();
    expect(highest).toBeGreaterThan(built * 3);
  }, 120000);
});
