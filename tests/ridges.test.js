import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { createWorld, gravityOf } from '../src/sim/world.js';
import { LEVELS } from '../src/challenges/levels.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * Where a slope meets the thing it climbs to.
 *
 * Uphill Struggle's ramp used to finish half a metre past the shelf's edge and
 * stand 39 cm proud of it. That put a ridge across the full width of the course
 * exactly where you arrive: a machine cresting it sat down on its belly with
 * the wheels clear of the ground at both ends, and because the ridge is the
 * same brown as the ramp seen from above there was nothing on screen to say
 * why. The level had already been fixed once for the same fault at the other
 * end, which is what makes it worth a test rather than another look.
 *
 * A ridge is specifically a place the ground goes up and straight back down. A
 * step that goes up and stays up is a wall, a kerb or a goal frame, and those
 * are somebody's decision — this says nothing about them.
 */

/** The height of whatever is underneath a point, or null for open air. */
function surface(world, x, z) {
  const hit = world.castRay(
    new RAPIER.Ray({ x, y: 60, z }, { x: 0, y: -1, z: 0 }), 120, true,
  );
  return hit ? 60 - hit.timeOfImpact : null;
}

/** Walks a level's ground and reports anything standing proud of both sides. */
function ridgesOn(level, { from, to, xs = [-2, 0, 2], tallerThan = 0.12 } = {}) {
  const world = createWorld(RAPIER, gravityOf(level));
  const scene = new THREE.Scene();
  const arena = new Arena({
    RAPIER, world, scene, level, seed: 1,
  });
  // Scene queries read a pipeline that only exists once the world has stepped.
  world.step();

  const found = [];
  for (const x of xs) {
    const profile = [];
    for (let z = from; z <= to; z += 0.1) profile.push({ z, y: surface(world, x, z) });
    for (let i = 2; i < profile.length - 2; i += 1) {
      const before = profile[i - 2].y;
      const here = profile[i].y;
      const after = profile[i + 2].y;
      if (before === null || here === null || after === null) continue;
      const proud = Math.min(here - before, here - after);
      if (proud > tallerThan) found.push({ x, z: Number(profile[i].z.toFixed(1)), proud });
    }
  }
  arena.dispose();
  return found;
}

describe('the climb in Uphill Struggle', () => {
  const level = LEVELS.find((l) => l.id === 'uphill');

  it('is a level worth checking, with a belt ramp and a shelf', () => {
    expect(level).toBeTruthy();
    expect(level.pieces.some((p) => p.belt)).toBe(true);
  });

  it('has nothing standing proud of the route from the foot to the shelf', () => {
    // The ramp climbs from about z = -8 and the shelf runs to its back lip at
    // z = 11.5, which is a wall and deliberately not included.
    const found = ridgesOn(level, { from: -8, to: 11 });
    expect(found.map((r) => `x=${r.x} z=${r.z} +${r.proud.toFixed(2)}m`)).toEqual([]);
  }, 60000);

  it('rises the whole way rather than cresting and dropping', () => {
    const world = createWorld(RAPIER, gravityOf(level));
    const scene = new THREE.Scene();
    const arena = new Arena({
      RAPIER, world, scene, level, seed: 1,
    });
    world.step();

    let highest = -Infinity;
    let dropped = 0;
    for (let z = -8; z <= 11; z += 0.1) {
      const y = surface(world, 0, z);
      if (y === null) continue;
      if (y < highest - 0.05) dropped = Math.max(dropped, highest - y);
      highest = Math.max(highest, y);
    }
    arena.dispose();
    // Measured at 0.39 m before the ramp was moved to meet the shelf.
    expect(dropped).toBeLessThan(0.05);
  }, 60000);

  it('ends flush: the top of the ramp is the top of the shelf', () => {
    const world = createWorld(RAPIER, gravityOf(level));
    const scene = new THREE.Scene();
    const arena = new Arena({
      RAPIER, world, scene, level, seed: 1,
    });
    world.step();
    const onRamp = surface(world, 0, 3.5);
    const onShelf = surface(world, 0, 6);
    arena.dispose();
    expect(Math.abs(onShelf - onRamp)).toBeLessThan(0.35);
  }, 60000);
});
