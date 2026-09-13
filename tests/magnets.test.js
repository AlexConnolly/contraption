import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { sanitiseLevel } from '../src/challenges/format.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * What "magnetic" means on a load.
 *
 * It means the Magnet Grabber can pick it up. That is what the part is called
 * and it is the only thing the word can sensibly mean here.
 *
 * It got read as "these stick to each other", and loads were welded together
 * where they touched to keep a ten-high tower from falling over. Two things
 * were wrong with that. The word, and the premise: measured, a ten-high pile
 * of these with fifteen centimetres of slop in every placement stands five
 * times out of five on its own and leans twelve centimetres. Welded, it also
 * stands — and leans between a quarter of a metre and two and a half, because
 * welding sets whatever crooked angle two loads happened to meet at. The
 * mechanism was solving a problem that was not there and causing one that was.
 *
 * So the flag is a label now, not a force, and these check both halves: that a
 * pile of them stands up by itself, and that a grabber takes hold of one.
 */

const SIDE = 0.9;
const RISE = SIDE + 0.02;

const level = (props, extra = {}) => ({
  id: 'pad',
  name: 'Pad',
  spawn: [0, 1.2, -6],
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

const load = (id, pos, magnetic = true) => ({
  id,
  pos,
  size: [SIDE, SIDE, SIDE],
  mass: 3,
  friction: 1.1,
  colour: 0xc98b4b,
  magnetic,
});

/** A pile of loads, dropped roughly into place and left to settle. */
function pile({
  n = 10, slop = 0, magnetic = true, seed = 1, seconds = 8,
} = {}) {
  let state = (seed * 2654435761) % 2147483647;
  const wobble = () => {
    state = (state * 48271) % 2147483647;
    return (state / 2147483647 - 0.5) * 2 * slop;
  };
  const props = Array.from({ length: n }, (_, i) => load(
    `l${i}`,
    [wobble(), SIDE / 2 + 0.05 + i * RISE, wobble()],
    magnetic,
  ));

  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const arena = new Arena({
    RAPIER, world, scene: new THREE.Scene(), level: level(props), seed: 2,
  });
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    world.step();
  }
  const top = arena.propPosition(`l${n - 1}`);
  const bottom = arena.propPosition('l0');
  arena.dispose();
  return {
    standing: top.y > (n - 1) * SIDE * 0.8,
    lean: Math.hypot(top.x - bottom.x, top.z - bottom.z),
  };
}

describe('a pile of loads', () => {
  it('stands ten high on its own', () => {
    const out = pile({ n: 10 });
    expect(out.standing).toBe(true);
    expect(out.lean).toBeLessThan(0.2);
  }, 60000);

  it('stands ten high with a hand\'s width of slop in every placement', () => {
    // The reason the welding was added, and it turns out not to be a reason.
    for (let seed = 1; seed <= 3; seed += 1) {
      const out = pile({ n: 10, slop: 0.15, seed });
      expect(out.standing, `seed ${seed} fell over`).toBe(true);
      expect(out.lean, `seed ${seed} leaned`).toBeLessThan(0.4);
    }
  }, 120000);

  it('does not stick together, however long it stands there', () => {
    // A pile is a pile. Shove the bottom one out and the rest stay where they
    // are rather than the whole tower sliding off with it.
    const props = Array.from({ length: 4 }, (_, i) => load(
      `l${i}`, [0, SIDE / 2 + 0.05 + i * RISE, 0],
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
    arena.props.get('l0').body.applyImpulse({ x: 26, y: 0, z: 0 }, true);
    run(2);
    const moved = Math.abs(arena.propPosition('l0').x);
    const stayed = Math.abs(arena.propPosition('l3').x);
    arena.dispose();
    expect(moved, 'the bottom load did not move at all').toBeGreaterThan(0.4);
    expect(stayed).toBeLessThan(moved * 0.8);
  }, 60000);
});

describe('the amber edge', () => {
  it('goes on a load a level means you to lift', () => {
    const scene = new THREE.Scene();
    const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
    const arena = new Arena({
      RAPIER,
      world,
      scene,
      seed: 2,
      level: level([
        load('lift', [0, 0.5, 0], true),
        load('scenery', [3, 0.5, 0], false),
      ]),
    });
    const edged = (id) => arena.props.get(id).mesh.children
      .some((child) => child.isLineSegments);
    expect(edged('lift')).toBe(true);
    expect(edged('scenery')).toBe(false);
    arena.dispose();
  }, 30000);

  it('survives the format, because it is what a level says about a load', () => {
    const kept = sanitiseLevel(level([load('a', [0, 0.5, 0], true)]));
    expect(kept.props[0].magnetic).toBe(true);
    const plain = sanitiseLevel(level([load('b', [0, 0.5, 0], false)]));
    expect(plain.props[0].magnetic).toBeUndefined();
  });
});

describe('the magnet grabber, which is what the word is about', () => {
  /**
   * A grabber held still with a load in front of its face, and the grab key
   * tapped until it takes. No driving: the question is whether the flag stops
   * a grabber taking hold, not whether a rover can find a crate.
   */
  function offered(magnetic) {
    const bp = new Blueprint({ name: 'lifter' });
    bp.place('core', [0, 0, 0]);
    bp.place('block', [0, 0, 1]);
    // The rotation whose up axis points along +Z: a grabber reaches along its
    // own +Y, so this is the one that makes it face forward.
    const grab = bp.place('grabber', [0, 0, 2], 2);

    const world = createWorld(RAPIER, { x: 0, y: 0, z: 0 });
    const scene = new THREE.Scene();
    const machine = new Machine({
      RAPIER,
      world,
      scene,
      blueprint: bp,
      level: level([]),
      spawn: new THREE.Vector3(0, 2, 0),
    });
    const nose = machine.partWorldPoint(bp.get(grab.id));
    const arena = new Arena({
      RAPIER,
      world,
      scene,
      seed: 2,
      level: level([{
        ...load('crate', [nose.x, nose.y, nose.z + 0.7], magnetic),
        size: [0.8, 0.8, 0.8],
      }]),
    });

    const pressed = new Set(['KeyG']);
    const bus = new SignalBus({
      isDown: () => false,
      wasPressed: (code) => pressed.delete(code),
    });
    for (let i = 0; i < Math.round(1.2 / STEP); i += 1) {
      arena.step(STEP);
      machine.update(STEP, bus);
      world.step();
      if (!machine.grabs.has(grab.id) && i % 12 === 0) pressed.add('KeyG');
    }
    const held = machine.grabs.has(grab.id);
    machine.dispose();
    arena.dispose();
    return held;
  }

  it('takes hold of a load marked for lifting', () => {
    expect(offered(true)).toBe(true);
  }, 30000);

  it('takes hold of one that is not marked, too', () => {
    // The mark is a label, not a permission: every prop in the game can be
    // picked up and the amber edge only says which ones a level means you to.
    expect(offered(false)).toBe(true);
  }, 30000);
});
