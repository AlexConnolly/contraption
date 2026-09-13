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
 *
 * What they must not do is latch onto anything they merely touch. The first
 * version welded on any contact from any direction, so a load carried past the
 * tower and brushing its side stuck to it, and so did one nudged into the pile
 * edge-on. A magnet here means "stacked on", and stacked on has a direction.
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

/**
 * Two loads placed by hand, held still, and asked whether they take hold.
 *
 * Nothing is dropped and nothing settles: the point is the geometry of the
 * moment they touch, so the pair is put exactly where the case being asked
 * about puts them and the world is stepped just long enough to notice.
 */
function pair({ apart = [0, SIDE + 0.01, 0], drift = null, seconds = 0.6 } = {}) {
  const props = [
    load('low', SIDE / 2 + 0.05),
    {
      ...load('high', SIDE / 2 + 0.05 + apart[1]),
      pos: [apart[0], SIDE / 2 + 0.05 + apart[1], apart[2]],
    },
  ];
  const world = createWorld(RAPIER, { x: 0, y: 0, z: 0 });
  const arena = new Arena({
    RAPIER, world, scene: new THREE.Scene(), level: level(props), seed: 2,
  });
  // No gravity, so the pair stays exactly where it was put and the answer is
  // about where they are rather than about how they fell.
  for (const id of ['low', 'high']) arena.props.get(id).body.setGravityScale(0, true);
  const high = arena.props.get('high').body;
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    if (drift) high.setLinvel({ x: drift[0], y: drift[1], z: drift[2] }, true);
    arena.step(STEP);
    world.step();
  }
  const welds = arena.welds;
  arena.dispose();
  return welds;
}

describe('what counts as stacked', () => {
  it('takes hold of a load set down on top of it', () => {
    expect(pair()).toBe(1);
  });

  it("forgives one set down a hand's width off centre", () => {
    expect(pair({ apart: [0.15, SIDE + 0.01, 0] })).toBe(1);
  });

  it('does not take hold of one merely beside it', () => {
    // Touching, still, and not on top of anything: two loads side by side on
    // the floor must stay two loads.
    expect(pair({ apart: [SIDE + 0.01, 0, 0] })).toBe(0);
  });

  it('does not take hold of one brushing it corner to corner', () => {
    expect(pair({ apart: [SIDE - 0.02, SIDE - 0.02, 0] })).toBe(0);
  });

  it('does not take hold of one perched off the edge', () => {
    // Up there, but with its middle past the edge of what it is standing on.
    // That is not a stack, it is a load about to fall off one.
    expect(pair({ apart: [SIDE * 0.75, SIDE + 0.01, 0] })).toBe(0);
  });

  it('does not take hold of one being carried past overhead', () => {
    // Directly above and touching, but travelling sideways at walking pace:
    // it is going somewhere, not being put down.
    expect(pair({ drift: [1.6, 0, 0], seconds: 0.3 })).toBe(0);
  });

  it('does take hold of one being lowered onto it', () => {
    // Coming down rather than going past, which is the whole difference.
    expect(pair({ drift: [0, -0.4, 0], seconds: 0.3 })).toBe(1);
  });
});

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
