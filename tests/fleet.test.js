import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { Fleet } from '../src/sim/fleet.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * More than one machine in the same world.
 *
 * The campaign only ever has one, and the whole of `main.js` is written that
 * way — one blueprint, one machine, one bus, one camera. An open world is a
 * fleet, and three things that were harmless with one machine are wrong with
 * two: they pass through each other, they all answer the same key, and they
 * never stop costing solver time.
 */

const FLAT = {
  id: 'flat',
  name: 'Flat',
  spawn: [0, 1.2, 0],
  groundSize: 200,
  budget: { cost: 9999 },
  pieces: [],
  props: [],
  zones: [],
  objectives: [],
  demands: { steps: 1, flies: false },
  bans: [],
  par: 60,
};

/** A four-wheel rover that drives on W. */
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

/** A keyboard that reports exactly what it is told to. */
const keys = (...codes) => {
  const down = new Set(codes);
  return { isDown: (c) => down.has(c), wasPressed: () => false, down };
};

function rig({
  machines = 2, gap = 6, seconds = 4, canSleep, along = 'x',
} = {}) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const arena = new Arena({
    RAPIER, world, scene, level: FLAT, seed: 1,
  });
  const fleet = new Fleet({ RAPIER, world, scene });
  const built = [];
  for (let i = 0; i < machines; i += 1) {
    built.push(fleet.deploy({
      blueprint: rover(`Rover ${i}`),
      spawn: along === 'z'
        ? new THREE.Vector3(0, 1.2, i * gap)
        : new THREE.Vector3(i * gap, 1.2, 0),
      level: FLAT,
      canSleep,
    }));
  }
  const step = (n = Math.round(seconds / STEP)) => {
    for (let i = 0; i < n; i += 1) {
      arena.step(STEP);
      fleet.update(STEP);
      fleet.step();
    }
  };
  return {
    world, arena, fleet, built, step,
  };
}

describe('a fleet in one world', () => {
  it('deploys each machine where it was put down, not at one shared spawn', () => {
    const { built, step } = rig({ machines: 3, gap: 8 });
    step(60);
    const xs = built.map((m) => m.machine.corePosition().x);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect(xs[2] - xs[0]).toBeGreaterThan(12);
  }, 60000);

  it('gives every machine its own id', () => {
    const { built } = rig({ machines: 3 });
    expect(new Set(built.map((m) => m.id)).size).toBe(3);
  });

  it('takes one away without disturbing the rest', () => {
    const { fleet, built, step } = rig({ machines: 3 });
    step(30);
    fleet.remove(built[1].id);
    expect(fleet.list()).toHaveLength(2);
    expect(() => step(60)).not.toThrow();
    expect(fleet.list().map((m) => m.id)).toEqual([built[0].id, built[2].id]);
  }, 60000);
});

/**
 * The one that would be found within a minute of playing. Machine colliders
 * are in a group that collides with the world and not with itself, which is
 * right for the parts of one machine and wrong for two machines.
 */
describe('two machines in the same world', () => {
  it('collide with each other', () => {
    // Nose to tail and a clear ten metres apart, because a machine drives
    // along +Z and two of them parked three metres apart start off inside one
    // another, which the solver answers by throwing them both across the map.
    const { built, fleet, step } = rig({ machines: 2, gap: 10, along: 'z' });
    const parked = built[1].machine.corePosition().clone();
    fleet.control(built[0].id, keys('KeyW'));
    step(Math.round(8 / STEP));
    const shoved = built[1].machine.corePosition();
    // Displacement rather than a direction: a rover meeting another rover
    // rides up over it as much as it shunts it, so which way the parked one
    // ends up going is not the point. Being moved at all is.
    const moved = Math.hypot(shoved.x - parked.x, shoved.y - parked.y, shoved.z - parked.z);
    expect(moved, 'the second machine was driven straight through').toBeGreaterThan(0.3);
  }, 120000);

  it('do not make the parts of one machine collide with each other', () => {
    // If a machine's own parts started colliding, a wheel inside its own arch
    // would blow the machine apart on the first step.
    const { built, step } = rig({ machines: 1 });
    const before = built[0].machine.corePosition().clone();
    step(Math.round(3 / STEP));
    const after = built[0].machine.corePosition();
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.5);
    expect(after.y).toBeGreaterThan(0);
  }, 60000);
});

/**
 * One key used to drive every bound actuator on every machine, because there
 * was one `SignalBus` for the whole app keyed on bare part ids — and two
 * machines loaded from the same saved design even share those ids.
 */
describe('who answers the controls', () => {
  it('drives only the machine you are controlling', () => {
    const { built, fleet, step } = rig({ machines: 2, gap: 10 });
    fleet.control(built[0].id, keys('KeyW'));
    const started = built[1].machine.corePosition().clone();
    step(Math.round(4 / STEP));
    expect(built[0].machine.corePosition().z, 'the driven one stayed put')
      .toBeGreaterThan(1.5);
    expect(Math.abs(built[1].machine.corePosition().z - started.z), 'the other one drove off')
      .toBeLessThan(0.5);
  }, 120000);

  it('hands control over without the old one carrying on', () => {
    const { built, fleet, step } = rig({ machines: 2, gap: 10 });
    fleet.control(built[0].id, keys('KeyW'));
    step(Math.round(3 / STEP));
    const handover = built[0].machine.corePosition().z;
    fleet.control(built[1].id, keys('KeyW'));
    step(Math.round(3 / STEP));
    expect(built[1].machine.corePosition().z).toBeGreaterThan(1);
    // The first one coasts to a stop rather than driving on under its own key.
    expect(built[0].machine.corePosition().z - handover).toBeLessThan(2.5);
  }, 120000);

  it('leaves every machine driverless when nothing is being controlled', () => {
    const { built, step } = rig({ machines: 2 });
    const before = built.map((m) => m.machine.corePosition().clone());
    step(Math.round(3 / STEP));
    for (const [i, m] of built.entries()) {
      expect(Math.abs(m.machine.corePosition().z - before[i].z)).toBeLessThan(0.5);
    }
  }, 60000);

  it('gives each machine its own bus rather than one for the app', () => {
    const { built } = rig({ machines: 2 });
    expect(built[0].bus).toBeInstanceOf(SignalBus);
    expect(built[0].bus).not.toBe(built[1].bus);
  });
});

/**
 * Every machine body is built `setCanSleep(false)` today, which is right for
 * the one machine in a challenge and ruinous for a city of parked ones.
 */
describe('a machine nobody is driving', () => {
  it('falls asleep once it has settled', () => {
    const { built, step } = rig({ machines: 1, canSleep: true });
    step(Math.round(12 / STEP));
    const asleep = built[0].machine.bodies.filter((b) => b.isSleeping()).length;
    expect(asleep, 'nothing went to sleep').toBeGreaterThan(0);
  }, 120000);

  it('wakes up when it is driven again', () => {
    const { built, fleet, step } = rig({ machines: 1, canSleep: true });
    step(Math.round(12 / STEP));
    fleet.control(built[0].id, keys('KeyW'));
    step(Math.round(2 / STEP));
    expect(built[0].machine.bodies.some((b) => b.isSleeping())).toBe(false);
    expect(built[0].machine.corePosition().z).toBeGreaterThan(0.4);
  }, 120000);

  it('is kept awake when the level wants it awake', () => {
    const { built, step } = rig({ machines: 1, canSleep: false });
    step(Math.round(12 / STEP));
    expect(built[0].machine.bodies.every((b) => !b.isSleeping())).toBe(true);
  }, 120000);
});
