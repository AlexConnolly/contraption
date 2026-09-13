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
import { getPart } from '../src/parts/registry.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * Picking things up off the floor.
 *
 * A grabber used to reach with a ray: an infinitely thin line straight out of
 * its face. That meant the load had to be very nearly dead ahead of the middle
 * of the part, and a load a hand's breadth off the centre line was invisible
 * to it — which is exactly what it feels like to keep driving at a crate and
 * have nothing happen.
 *
 * It reaches with a ball now. Anything the ball would touch on its way out is
 * grabbed, so being roughly lined up is enough.
 */

const FLOOR = {
  id: 'floor',
  name: 'Floor',
  spawn: [0, 1.2, 0],
  groundSize: 80,
  budget: { cost: 999 },
  pieces: [],
  props: [],
  zones: [],
  objectives: [],
  demands: { steps: 1, flies: false },
  bans: [],
  par: 60,
};

// The rotation whose up axis points along +Z, so the grabber faces forward.
const FORWARD = 2;

/**
 * A block with a forward-facing grabber on its nose, and a load sitting in
 * front of it, pushed `off` metres to one side.
 */
function reach({ off = 0, load = true, seconds = 1.2 }) {
  const bp = new Blueprint();
  bp.place('core', [0, 0, 0]);
  bp.place('block', [0, 0, 1]);
  const grab = bp.place('grabber', [0, 0, 2], FORWARD);

  const world = createWorld(RAPIER, { x: 0, y: 0, z: 0 });
  const scene = new THREE.Scene();
  const machine = new Machine({
    RAPIER, world, scene, blueprint: bp, level: FLOOR, spawn: new THREE.Vector3(0, 2, 0),
  });
  const nose = machine.partWorldPoint(bp.get(grab.id));
  const props = load ? [{
    id: 'load',
    pos: [nose.x + off, nose.y, nose.z + 0.75],
    size: [0.8, 0.8, 0.8],
    mass: 3,
    colour: 0x8d96a3,
  }] : [];
  const arena = new Arena({
    RAPIER, world, scene, level: { ...FLOOR, props }, seed: 1,
  });

  const pressed = new Set(['KeyG']);
  const bus = new SignalBus({
    isDown: () => false,
    wasPressed: (c) => pressed.delete(c),
  });
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    if (!machine.grabs.has(grab.id) && i % 12 === 0) pressed.add('KeyG');
  }
  return machine.grabs.has(grab.id);
}

/** A grabber up on a deck, with the load on the floor below its centre line. */
function reachDown(tall, seconds = 1.2) {
  const bp = new Blueprint();
  bp.place('core', [0, 0, 0]);
  bp.place('block', [0, 0, 1]);
  bp.place('block', [0, 1, 1]);
  const grab = bp.place('grabber', [0, 1, 2], FORWARD);

  const world = createWorld(RAPIER, { x: 0, y: 0, z: 0 });
  const scene = new THREE.Scene();
  const machine = new Machine({
    RAPIER, world, scene, blueprint: bp, level: FLOOR, spawn: new THREE.Vector3(0, 2, 0),
  });
  const nose = machine.partWorldPoint(bp.get(grab.id));
  const props = [{
    id: 'load',
    // Sitting on a floor 95 cm below the grabber's line, which is the real
    // gap between a grabber on a deck and a load on the ground.
    pos: [nose.x, nose.y - 0.95 + tall / 2, nose.z + 0.7],
    size: [0.8, tall, 0.8],
    mass: 3,
    colour: 0x8d96a3,
  }];
  const arena = new Arena({
    RAPIER, world, scene, level: { ...FLOOR, props }, seed: 1,
  });
  const pressed = new Set(['KeyG']);
  const bus = new SignalBus({ isDown: () => false, wasPressed: (c) => pressed.delete(c) });
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    if (!machine.grabs.has(grab.id) && i % 12 === 0) pressed.add('KeyG');
  }
  return machine.grabs.has(grab.id);
}

describe('a grabber reaching for a load', () => {
  it('takes one that is dead ahead', () => {
    expect(reach({ off: 0 })).toBe(true);
  }, 60000);

  /**
   * The reported problem. A quarter of a metre off the centre line is nothing
   * when you are driving at a crate, and a ray saw none of it.
   */
  it('takes one that is a little off to the side', () => {
    expect(reach({ off: 0.3 }), 'a load 30 cm off centre was invisible').toBe(true);
  }, 60000);

  it('takes one that is off the other way too', () => {
    expect(reach({ off: -0.3 })).toBe(true);
  }, 60000);

  it('still takes hold of nothing when there is nothing there', () => {
    expect(reach({ load: false })).toBe(false);
  }, 60000);

  it('does not reach halfway across the yard', () => {
    expect(reach({ off: 3 }), 'grabbed something three metres to the side').toBe(false);
  }, 60000);

  /**
   * The case that was actually reported: driving at a load and nothing
   * happening. A grabber reaches with a ray straight out of the middle of its
   * face, so what it can pick up is what its own height lines up with. A load
   * shorter than every height anybody mounts a grabber at is a load the ray
   * passes over, and driving at it just pushes it round the yard.
   *
   * The answer is the load, not the ray: anything meant to be picked up off
   * the floor has to be tall enough to meet a grabber on a deck.
   */
  it('takes a load tall enough to meet it, and misses a short one', () => {
    expect(reachDown(1.1), 'a tall load was still missed').toBe(true);
    expect(reachDown(0.8), 'a short load was somehow seen').toBe(false);
  }, 60000);

  it('has a reach worth having', () => {
    expect(getPart('grabber').grabber.reach).toBeGreaterThanOrEqual(0.85);
  });
});
