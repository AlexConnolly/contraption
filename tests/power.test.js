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
import {
  getPart, partCost, motorSpeed, motorTorque, thrustPower,
} from '../src/parts/registry.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * Speed, torque, and what they cost.
 *
 * A motor had one slider called Power that scaled speed, and only ever
 * downwards. A wheel shoved a sixty-kilo crate thirteen centimetres in ten
 * seconds, and a nozzle made 55 N against a ballast block that weighs 80 — so
 * a rocket carrying anything at all did not leave the ground.
 *
 * Both wind a long way up now. What keeps that from being free is the budget:
 * power is torque times speed, so that is exactly what it costs. It is a rule
 * anybody can explain, and no campaign budget will carry the top of the range.
 */

const FLAT = {
  id: 'flat',
  name: 'Flat',
  spawn: [0, 1.4, 0],
  groundSize: 900,
  budget: { cost: 99999 },
  pieces: [],
  props: [],
  zones: [],
  objectives: [],
  bans: [],
  demands: { steps: 1, flies: false },
  par: 60,
};

const keys = (...codes) => ({
  enabled: true,
  down: new Set(codes),
  pressed: new Set(),
  isDown: (c) => codes.includes(c),
  wasPressed: () => false,
});

/** A long six-wheeler, so it cannot wheelie its way out of the question. */
function rover({ power = 1, torque = 1, ballast = 0 } = {}) {
  const bp = new Blueprint({ name: 'rover' });
  for (let z = -2; z <= 2; z += 1) {
    for (let x = -1; x <= 1; x += 1) bp.place('block', [x, 0, z]);
  }
  bp.place('core', [0, 1, 0]);
  for (let i = 0; i < ballast; i += 1) {
    bp.place('ballast', [(i % 3) - 1, 1, Math.floor(i / 3) - 1]);
  }
  const mirrored = yawStep(yawStep(IDENTITY_ORIENTATION));
  for (const z of [-2, 0, 2]) {
    for (const [x, rot] of [[2, IDENTITY_ORIENTATION], [-2, mirrored]]) {
      const wheel = bp.place('wheel', [x, 0, z], rot);
      bp.setConfig(wheel.id, { power, torque });
    }
  }
  return bp;
}

function drive(bp, { seconds = 14, held = ['KeyW'], crate = 0 } = {}) {
  const level = crate
    ? {
      ...FLAT,
      props: [{
        id: 'crate',
        pos: [0, 0.8, 6],
        size: [1.5, 1.5, 1.5],
        mass: crate,
        friction: 0.95,
        colour: 0xc98b4b,
      }],
    }
    : FLAT;
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const arena = new Arena({
    RAPIER, world, scene, level, seed: 1,
  });
  const machine = new Machine({
    RAPIER, world, scene, blueprint: bp, spawn: new THREE.Vector3(0, 1.4, 0), level,
  });
  const bus = new SignalBus(keys(...held));
  let top = 0;
  let peak = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    const v = machine.bodies[0].linvel();
    top = Math.max(top, Math.hypot(v.x, v.y, v.z));
    peak = Math.max(peak, machine.corePosition().y);
  }
  const shoved = crate ? arena.propPosition('crate').z - 6 : 0;
  machine.dispose();
  arena.dispose();
  return { top, peak, shoved };
}

describe('a part as it comes off the shelf', () => {
  it('is exactly the part it has always been', () => {
    // Every setting defaults to one, so nothing already built behaves
    // differently for any of this.
    const wheel = getPart('wheel');
    expect(motorSpeed({ config: {} }, wheel)).toBe(1);
    expect(motorTorque({ config: {} }, wheel)).toBe(1);
    expect(thrustPower({ config: {} }, getPart('thruster'))).toBe(1);
  });

  it('costs what it says on the part', () => {
    const wheel = getPart('wheel');
    expect(partCost({ type: 'wheel', config: {} }, wheel)).toBe(wheel.cost);
  });

  it('is never cheaper for being wound down, because a wheel is still a wheel', () => {
    const wheel = getPart('wheel');
    expect(partCost({ type: 'wheel', config: { power: 0.1, torque: 0.1 } }, wheel))
      .toBe(wheel.cost);
  });
});

describe('what winding a part up costs', () => {
  it('is what the power costs, which is torque times speed', () => {
    const wheel = getPart('wheel');
    expect(partCost({ type: 'wheel', config: { power: 2, torque: 3 } }, wheel))
      .toBe(wheel.cost * 6);
    expect(partCost({ type: 'wheel', config: { power: 5, torque: 10 } }, wheel))
      .toBe(wheel.cost * 50);
  });

  it('puts the top of the range past every campaign budget', () => {
    // Measured at 609 for a six-wheeler. The biggest budget in the game is 240,
    // which is what keeps this out of the campaign and in fun mode.
    expect(rover({ power: 5, torque: 10 }).cost()).toBeGreaterThan(240);
  });

  it('shows on the machine, not only on the part', () => {
    expect(rover({ power: 3, torque: 3 }).cost()).toBeGreaterThan(rover().cost() * 3);
  });
});

describe('speed', () => {
  it('goes about five times as fast at the top of the range', () => {
    // Measured: 4.5 m/s rated, 19.5 wound right up — 16 km/h to 70.
    const rated = drive(rover(), { seconds: 20 }).top;
    const wound = drive(rover({ power: 5 }), { seconds: 20 }).top;
    expect(rated).toBeGreaterThan(4);
    expect(wound).toBeGreaterThan(rated * 3.8);
  }, 120000);
});

describe('torque', () => {
  it('shoves a crate that a rated wheel cannot move at all', () => {
    const rated = drive(rover({ ballast: 4 }), { seconds: 12, crate: 60 }).shoved;
    const wound = drive(rover({ ballast: 4, torque: 10 }), { seconds: 12, crate: 60 }).shoved;
    expect(rated).toBeLessThan(1);
    expect(wound).toBeGreaterThan(5);
  }, 120000);

  it('runs into grip in the end, which is what weight is for', () => {
    // Past what the tyres will hold, more torque only spins them. That is the
    // honest answer to "why will it not push", and the answer is ballast.
    const light = drive(rover({ torque: 10 }), { seconds: 12, crate: 60 }).shoved;
    const heavy = drive(rover({ torque: 10, ballast: 4 }), { seconds: 12, crate: 60 }).shoved;
    expect(heavy).toBeGreaterThan(light);
  }, 120000);
});

describe('a rocket that carries something', () => {
  const rocket = ({ nozzles = 1, ballast = 1, power = 1 }) => {
    const bp = new Blueprint({ name: 'rocket' });
    bp.place('core', [0, 0, 0]);
    for (let i = 0; i < ballast; i += 1) bp.place('ballast', [0, 1 + i, 0]);
    for (let i = 0; i < nozzles; i += 1) {
      const nozzle = bp.place('thruster', [0, -1 - i, 0]);
      bp.setConfig(nozzle.id, { power });
    }
    return bp;
  };

  it('does not get off the ground at the rated thrust', () => {
    // One nozzle makes 55 N. One ballast block weighs 80. That was the whole
    // of why nobody could build a rocket that carried anything.
    const out = drive(rocket({ ballast: 1 }), { seconds: 5, held: ['ShiftLeft'] });
    expect(out.peak).toBeLessThan(4);
  }, 60000);

  it('flies once the nozzle is wound up', () => {
    // Measured: 520 m at 164 m/s with a ballast block aboard.
    const out = drive(rocket({ ballast: 1, power: 8 }), { seconds: 5, held: ['ShiftLeft'] });
    expect(out.peak).toBeGreaterThan(100);
  }, 60000);

  it('carries forty kilos of payload on two nozzles', () => {
    const out = drive(rocket({ nozzles: 2, ballast: 5, power: 8 }), {
      seconds: 5, held: ['ShiftLeft'],
    });
    expect(out.peak).toBeGreaterThan(60);
  }, 60000);
});
