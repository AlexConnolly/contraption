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
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';
import { getPart } from '../src/parts/registry.js';
import { createPartMesh } from '../src/parts/geometry.js';
import { partMass } from '../src/ui/hud.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * Getting up things.
 *
 * A powered wheel stops at a step about half its own radius, and there was
 * nothing in the game that did better: more weight buys grip and grip is not
 * the problem, because a step taller than the axle is a wall to push at rather
 * than a rise to roll up. The answer is a bigger wheel, and a bigger wheel
 * needs the torque to lift the machine's own weight over the edge.
 *
 * So this measures the thing the part exists for. Not that it has the right
 * numbers on it -- that a machine built on it gets up a step that a machine
 * built on the other one does not.
 */

const keys = (...codes) => ({
  enabled: true,
  down: new Set(codes),
  pressed: new Set(),
  isDown: (c) => codes.includes(c),
  wasPressed: () => false,
});

/** A flat yard with one square step across it, or none. */
const yard = (height) => ({
  id: 'rig',
  name: 'Rig',
  spawn: [0, 1.4, 0],
  groundSize: 200,
  budget: { cost: 9999 },
  pieces: height > 0
    ? [{ pos: [0, height / 2, 20], size: [40, height, 24], colour: 0x808080 }]
    : [],
  props: [],
  zones: [],
  objectives: [],
  bans: [],
  demands: { steps: 1, flies: false },
  par: 60,
});

/**
 * A four-wheel rover on whichever wheel is being asked about, with the
 * wheelbase the wheel needs: an all-terrain wheel is three cells across its
 * face, so two of them on one side cannot sit closer than four cells apart.
 */
function rover(type, spacing = null) {
  const bp = new Blueprint({ name: type });
  const mirrored = yawStep(yawStep(IDENTITY_ORIENTATION));
  const reach = spacing ?? (getPart(type).size[2] === 3 ? 2 : 1);
  for (let z = -reach; z <= reach; z += 1) {
    for (let x = -1; x <= 1; x += 1) bp.place('block', [x, 0, z]);
  }
  bp.place('core', [0, 1, 0]);
  for (const z of [-reach, reach]) {
    bp.place(type, [2, 0, z], IDENTITY_ORIENTATION);
    bp.place(type, [-2, 0, z], mirrored);
  }
  return bp;
}

function drive(type, {
  height = 0, seconds = 12, held = ['KeyW'], spacing = null,
} = {}) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const level = yard(height);
  const arena = new Arena({
    RAPIER, world, scene, level, seed: 1,
  });
  const blueprint = rover(type, spacing);
  const machine = new Machine({
    RAPIER, world, scene, blueprint, spawn: new THREE.Vector3(0, 1.4, 0), level,
  });
  const bus = new SignalBus(keys(...held));
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
  }
  const at = machine.corePosition().clone();
  const forward = machine.coreForward().clone();
  machine.dispose();
  arena.dispose();
  // The step runs from z = 8 to z = 32. Past its front edge and still going is
  // the only thing that counts as up it.
  return { z: at.z, forward, climbed: at.z > 8.5 };
}

const pivotRate = (type, spacing = null) => {
  const { forward } = drive(type, { seconds: 6, held: ['KeyA'], spacing });
  return Math.abs((Math.atan2(forward.x, forward.z) * 180) / Math.PI) / 6;
};

describe('what a powered wheel cannot do', () => {
  it('gets up a low kerb', () => {
    expect(drive('wheel', { height: 0.3 }).climbed).toBe(true);
  }, 60000);

  it('stops dead at a step half a block high', () => {
    // Measured: it manages 0.4 m and no more. Its radius is 0.42.
    expect(drive('wheel', { height: 0.5 }).climbed).toBe(false);
  }, 60000);
});

describe('what an all-terrain wheel can', () => {
  it('gets up a whole block', () => {
    expect(drive('atv', { height: 0.5 }).climbed).toBe(true);
  }, 60000);

  it('gets up two of them', () => {
    // Measured ceiling: about a metre, which is a wheel and a half of step.
    expect(drive('atv', { height: 1.0 }).climbed).toBe(true);
  }, 90000);

  it('still gets along flat ground at about the same pace', () => {
    // It is geared for pull, not for pace: the gain is all in what it will go
    // over, and a machine that crawled everywhere to get it would not be worth
    // building. Measured 4.2 m/s against a powered wheel's 4.1.
    const far = drive('atv', { seconds: 8 }).z;
    expect(far / 8).toBeGreaterThan(3.4);
  }, 60000);
});

describe('what it costs to fit them', () => {
  it('is three times the price and twice the weight, per wheel', () => {
    const plain = getPart('wheel');
    const big = getPart('atv');
    expect(big.cost).toBeGreaterThan(plain.cost * 2.5);
    expect(partMass(big)).toBeGreaterThan(partMass(plain) * 2);
  });

  it('is nine cells a wheel instead of one', () => {
    const cells = (p) => p.size.reduce((a, n) => a * n, 1);
    expect(cells(getPart('atv'))).toBe(9);
    expect(cells(getPart('wheel'))).toBe(1);
  });

  it('is a wheelbase long enough that steering suffers', () => {
    // Two of them on one side cannot sit closer than four cells apart, and a
    // long wheelbase is what makes skid steering hard. The wheel is not the
    // problem, though: a powered wheel on the same chassis barely turns at
    // all, and this one turns eight times faster than that.
    const stuck = pivotRate('wheel', 2);
    const big = pivotRate('atv');
    expect(stuck).toBeLessThan(6);
    expect(big).toBeGreaterThan(stuck * 2);
  }, 60000);
});

describe('the teeth', () => {
  const teeth = () => createPartMesh(getPart('atv')).children
    .filter((child) => child.name === 'lug');

  it('are there, all the way round', () => {
    expect(teeth()).toHaveLength(getPart('atv').lugs);
  });

  it('all point outwards', () => {
    // Turning a box about X takes its +Y to (0, cos t, sin t). Getting the
    // sign of that wrong mirrors every tooth except the two at the very top
    // and bottom, and the ones at the sides end up pointing inwards -- which
    // is exactly what it did: twelve of the fourteen were wrong, the worst of
    // them facing nine tenths of the way back into the wheel.
    const out = new THREE.Vector3();
    for (const lug of teeth()) {
      out.set(0, 1, 0).applyQuaternion(lug.quaternion);
      const radial = lug.position.clone().normalize();
      expect(out.dot(radial), `a tooth at ${lug.position.toArray()}`).toBeCloseTo(1, 5);
    }
  });

  it('stand on the carcass and reach out to the collider', () => {
    const part = getPart('atv');
    for (const lug of teeth()) {
      const from = Math.hypot(lug.position.y, lug.position.z);
      // What bites a step edge on screen has to be the radius that bites it
      // in the solver, so the tips land on the collider and not short of it.
      expect(from).toBeLessThan(part.radius);
      expect(from + lug.geometry.parameters.height / 2).toBeCloseTo(part.radius, 5);
    }
  });
});
