import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Fleet } from '../src/sim/fleet.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * Which way a machine faces when it is put down.
 *
 * A challenge has one spawn, and everything starts on it pointing the same
 * way, so until now a machine could only ever face +Z. An open world is the
 * other case: a delivery drone is parked facing down a street, and streets do
 * not all run north.
 *
 * The turn goes on the bodies rather than on the colliders inside them.
 * Everything a machine knows about itself is in body-local space and is
 * carried into the world by the body's rotation, so turning the bodies turns
 * all of it at once — which is what these check. Not just that it moved the
 * right way, but that the parts still hold together, the wheels still drive
 * and the core still reports where it is looking.
 */

const FLAT = {
  id: 'flat',
  name: 'Flat',
  spawn: [0, 1.2, 0],
  groundSize: 400,
  budget: { cost: 9999 },
  pieces: [],
  props: [],
  zones: [],
  objectives: [],
  demands: { steps: 1, flies: false },
  bans: [],
  par: 60,
};

function rover(name = 'Rover') {
  const bp = new Blueprint({ name });
  const other = yawStep(yawStep(IDENTITY_ORIENTATION));
  bp.place('panel', [0, 0, 0]);
  bp.place('core', [0, 1, 0]);
  for (const z of [-1, 1]) {
    bp.place('wheel', [2, 0, z], IDENTITY_ORIENTATION);
    bp.place('wheel', [-2, 0, z], other);
  }
  return bp;
}

const keys = (...codes) => ({
  isDown: (c) => codes.includes(c),
  wasPressed: () => false,
});

/** Drives one machine, parked facing `yaw`, for a few seconds. */
function drive({ yaw = 0, at = [0, 1.2, 0], seconds = 5 } = {}) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const arena = new Arena({
    RAPIER, world, scene, level: FLAT, seed: 1,
  });
  const fleet = new Fleet({ RAPIER, world, scene });
  const member = fleet.deploy({
    blueprint: rover(),
    spawn: new THREE.Vector3(...at),
    yaw,
    level: FLAT,
  });
  const start = member.machine.corePosition().clone();
  fleet.control(member.id, keys('KeyW'));
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    fleet.update(STEP);
    fleet.step();
  }
  const end = member.machine.corePosition().clone();
  return {
    member, start, end, travel: end.clone().sub(start), fleet, world,
  };
}

const QUARTER = Math.PI / 2;

describe('a machine parked facing a chosen way', () => {
  it('drives down +Z when it is not turned at all', () => {
    const { travel } = drive({ yaw: 0 });
    expect(travel.z).toBeGreaterThan(3);
    expect(Math.abs(travel.x)).toBeLessThan(1);
  }, 60000);

  it('drives down +X when it is turned a quarter turn', () => {
    const { travel } = drive({ yaw: QUARTER });
    expect(travel.x).toBeGreaterThan(3);
    expect(Math.abs(travel.z)).toBeLessThan(1);
  }, 60000);

  it('drives back down -Z when it is turned round', () => {
    const { travel } = drive({ yaw: Math.PI });
    expect(travel.z).toBeLessThan(-3);
    expect(Math.abs(travel.x)).toBeLessThan(1);
  }, 60000);

  it('goes just as far whichever way it is pointing', () => {
    const straight = drive({ yaw: 0 }).travel.length();
    const turned = drive({ yaw: QUARTER * 0.5 }).travel.length();
    expect(Math.abs(turned - straight)).toBeLessThan(straight * 0.2);
  }, 90000);
});

describe('a turned machine still knows itself', () => {
  it('reports the core looking the way it was parked', () => {
    const { member } = drive({ yaw: QUARTER, seconds: 0.2 });
    const forward = member.machine.coreForward();
    expect(forward.x).toBeGreaterThan(0.9);
    expect(Math.abs(forward.z)).toBeLessThan(0.2);
  }, 30000);

  it('lands on its wheels rather than coming apart', () => {
    const turned = drive({ yaw: 0.9, seconds: 3 });
    const straight = drive({ yaw: 0, seconds: 3 });
    expect(turned.member.machine.isUpsideDown()).toBe(false);
    // Both are dropped from 1.2 m and settle onto their wheels. What matters
    // is that the turn changes nothing about the landing: a machine thrown by
    // its own turn would come to rest at a different height.
    expect(turned.end.y).toBeCloseTo(straight.end.y, 1);
  }, 90000);

  it('stays where it was put down, not somewhere the turn moved it to', () => {
    const { start } = drive({ yaw: QUARTER, at: [12, 1.2, -7], seconds: 0.05 });
    expect(start.x).toBeCloseTo(12, 1);
    expect(start.z).toBeCloseTo(-7, 1);
  }, 30000);
});
