import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { starterRover } from '../src/studio/presets.js';
import { getLevel } from '../src/challenges/levels.js';
import { getPart } from '../src/parts/registry.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * A ramp that does not meet the ground is an invisible wall.
 *
 * Uphill Struggle's ramp was twelve metres long on a slope that needed nearly
 * fourteen, so its foot stood on a sheer sixty-centimetre lip. That is taller
 * than a wheel, so nothing could climb it, and a crate pushed at it stopped
 * dead with nothing on screen to explain why — which is exactly what it looks
 * like to drive into an invisible block.
 */

/** The height of the first solid thing under each point along a line. */
function surface(level, from, to, step = 0.25) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  // Scenery only. A crate standing on the route is a thing to push, not a
  // step in the ground.
  const arena = new Arena({
    RAPIER, world, scene: new THREE.Scene(), level: { ...level, props: [] }, seed: 1,
  });
  // The query pipeline is built during a step; before one, every ray misses.
  world.step();
  const out = [];
  for (let z = from; z <= to; z += step) {
    const ray = new RAPIER.Ray({ x: 0, y: 40, z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 80, true);
    out.push([z, hit ? 40 - hit.timeOfImpact : null]);
  }
  arena.dispose();
  return out;
}

describe('the route up Uphill Struggle', () => {
  const LEVEL = getLevel('uphill');

  it('has no step in it a wheel could not climb', () => {
    const wheel = getPart('wheel').radius;
    const line = surface(LEVEL, -14, 6);
    let worst = 0;
    let where = 0;
    for (let i = 1; i < line.length; i += 1) {
      const [z, y] = line[i];
      const last = line[i - 1][1];
      if (y === null || last === null) continue;
      const rise = y - last;
      if (rise > worst) { worst = rise; where = z; }
    }
    expect(worst, `a ${worst.toFixed(2)} m step at z ${where.toFixed(1)}`)
      .toBeLessThan(wheel);
  }, 60000);

  /**
   * And the thing that matters: the stock rover gets up it. It is the machine
   * every player starts with, and the level is about the belt fighting you,
   * not about a lip at the bottom nobody can see.
   */
  it('can be driven up by the machine everybody starts with', () => {
    const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const arena = new Arena({
      RAPIER, world, scene, level: LEVEL, seed: 1,
    });
    const machine = new Machine({
      RAPIER, world, scene, blueprint: starterRover(), level: LEVEL,
      spawn: new THREE.Vector3(...LEVEL.spawn),
    });
    const held = new Set(['KeyW']);
    const bus = new SignalBus({ isDown: (c) => held.has(c), wasPressed: () => false });
    let highest = -99;
    for (let i = 0; i < Math.round(30 / STEP); i += 1) {
      arena.step(STEP);
      machine.update(STEP, bus);
      world.step();
      highest = Math.max(highest, machine.corePosition().y);
    }
    // Not all the way up — the belt is meant to fight it — but onto the ramp
    // and climbing, rather than stopped at the bottom of it.
    expect(highest, `never got above ${highest.toFixed(2)} m`).toBeGreaterThan(1.6);
  }, 120000);
});
