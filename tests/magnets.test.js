import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { sanitiseLevel } from '../src/challenges/format.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * Magnetic loads.
 *
 * Stacking ten of anything on top of each other is a test of placement
 * accuracy long before it is a test of the machine, and a tower that comes
 * down because the sixth load went on four centimetres out is not the puzzle
 * anybody wanted. Magnetic loads take hold of each other where they touch, so
 * the question goes back to being how you get a load up there rather than how
 * steady your hand was.
 *
 * They latch when they meet and are not moving much relative to one another,
 * which is what stops a load being welded in mid-air as it is flung past.
 */

const SIDE = 0.8;

const level = (props, extra = {}) => ({
  id: 'pad',
  name: 'Pad',
  spawn: [0, 1.2, -10],
  groundSize: 120,
  budget: { cost: 999 },
  pieces: [],
  props,
  zones: [],
  objectives: [],
  demands: { steps: 1, flies: false },
  bans: [],
  par: 60,
  ...extra,
});

const load = (id, y, x = 0, magnetic = true) => ({
  id,
  pos: [x, y, 0],
  size: [SIDE, SIDE, SIDE],
  mass: 3,
  friction: 1.1,
  colour: 0xc98b4b,
  magnetic,
});

/** Drops a pile, lets it settle, then shoves the bottom one sideways. */
function pile({ n = 3, magnetic = true, jitter = 0, shove = 0 } = {}) {
  const props = Array.from({ length: n }, (_, i) => load(
    `l${i}`,
    SIDE / 2 + 0.05 + i * (SIDE + 0.02),
    i % 2 ? jitter : -jitter,
    magnetic,
  ));
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const arena = new Arena({
    RAPIER, world, scene: new THREE.Scene(), level: level(props), seed: 2,
  });
  const run = (seconds) => {
    for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
      arena.step(STEP);
      world.step();
    }
  };
  run(4);
  if (shove) {
    const bottom = arena.props.get('l0').body;
    bottom.applyImpulse({ x: shove, y: 0, z: 0 }, true);
    run(2);
  }
  const top = arena.propPosition(`l${n - 1}`);
  const bottom = arena.propPosition('l0');
  return {
    arena,
    standing: top.y > (n - 1) * SIDE * 0.75,
    lean: Math.hypot(top.x - bottom.x, top.z - bottom.z),
    topX: top.x,
    bottomX: bottom.x,
  };
}

describe('loads that take hold of each other', () => {
  it('stand as a tower once they have settled', () => {
    const out = pile({ n: 4 });
    expect(out.standing).toBe(true);
  }, 60000);

  /**
   * The point of them: shove the bottom of the pile and the whole thing goes
   * with it instead of the top sliding off.
   */
  it('move together when the bottom one is shoved', () => {
    const out = pile({ n: 4, shove: 14 });
    expect(out.standing, 'the tower came down').toBe(true);
    expect(Math.abs(out.topX - out.bottomX), 'the top slid off the bottom')
      .toBeLessThan(0.3);
    expect(Math.abs(out.bottomX), 'nothing moved at all').toBeGreaterThan(0.1);
  }, 60000);

  it('do not do that when they are ordinary loads', () => {
    const loose = pile({ n: 4, magnetic: false, shove: 14 });
    const stuck = pile({ n: 4, magnetic: true, shove: 14 });
    expect(Math.abs(loose.topX - loose.bottomX))
      .toBeGreaterThan(Math.abs(stuck.topX - stuck.bottomX));
  }, 60000);

  // The reason to have them at all: a load that goes down a little off centre
  // should not cost you the tower.
  it('forgive a load put down off centre', () => {
    const out = pile({ n: 6, jitter: 0.18 });
    expect(out.standing, 'six loads with 18 cm of slop fell over').toBe(true);
  }, 60000);
});

describe('what a magnet will not do', () => {
  it('catch a load that is flying past', () => {
    // Dropped from well above, the top one arrives fast; it should land and
    // settle rather than weld itself on at whatever angle it arrived.
    const props = [load('l0', 0.45), { ...load('l1', 6), mass: 3 }];
    const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
    const arena = new Arena({
      RAPIER, world, scene: new THREE.Scene(), level: level(props), seed: 2,
    });
    for (let i = 0; i < Math.round(0.2 / STEP); i += 1) { arena.step(STEP); world.step(); }
    expect(arena.welds ?? 0, 'welded something in mid-air').toBe(0);
    for (let i = 0; i < Math.round(4 / STEP); i += 1) { arena.step(STEP); world.step(); }
    expect(arena.welds).toBeGreaterThan(0);
  }, 60000);
});

describe('a level that asks for magnetic loads', () => {
  it('keeps the flag through the sanitiser', () => {
    const clean = sanitiseLevel({
      name: 'x',
      props: [
        { id: 'a', pos: [0, 1, 0], size: [1, 1, 1], magnetic: true },
        { id: 'b', pos: [2, 1, 0], size: [1, 1, 1] },
      ],
    });
    expect(clean.props[0].magnetic).toBe(true);
    expect(clean.props[1].magnetic).toBeUndefined();
  });
});
