import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import {
  deriveGains, defaultSpin, frameFromAxes, FlightController, readFlightKeys, attitudeOf,
} from '../src/sim/flight.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, pitchStep } from '../src/core/orientation.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { quadcopter } from '../src/studio/presets.js';
import { getPart } from '../src/parts/registry.js';
import { createWorld } from '../src/sim/world.js';

const STEP = 1 / 60;
const FRAME = frameFromAxes([0, 0, 1], [0, 1, 0]);
const TUNING = getPart('controller').flight;

function rotor(id, offset, extra = {}) {
  return { id, offset, dir: [0, 1, 0], maxThrust: 95, reaction: 9, spin: 1, ...extra };
}

// Rear is -Z, and the machine's right is forward x up = -X.
const QUAD = [
  rotor('rearRight', [-1, 0, -1], { spin: defaultSpin([-1, 0, -1], FRAME) }),
  rotor('rearLeft', [1, 0, -1], { spin: defaultSpin([1, 0, -1], FRAME) }),
  rotor('frontRight', [-1, 0, 1], { spin: defaultSpin([-1, 0, 1], FRAME) }),
  rotor('frontLeft', [1, 0, 1], { spin: defaultSpin([1, 0, 1], FRAME) }),
];

describe('mixer gains', () => {
  const gains = deriveGains(QUAD, FRAME);

  it('gives every upward rotor full lift authority', () => {
    for (const g of gains.values()) expect(g.climb).toBe(1);
  });

  it('pitches by opposing the front and rear rotors', () => {
    expect(gains.get('rearLeft').pitch).toBeGreaterThan(0.5);
    expect(gains.get('rearRight').pitch).toBeGreaterThan(0.5);
    expect(gains.get('frontLeft').pitch).toBeLessThan(-0.5);
    expect(gains.get('frontRight').pitch).toBeLessThan(-0.5);
  });

  it('rolls by opposing the left and right rotors', () => {
    expect(Math.sign(gains.get('rearLeft').roll))
      .toBe(Math.sign(gains.get('frontLeft').roll));
    expect(Math.sign(gains.get('rearLeft').roll))
      .toBe(-Math.sign(gains.get('rearRight').roll));
  });

  it('yaws from rotor reaction torque, opposing the diagonal pairs', () => {
    expect(Math.sign(gains.get('rearLeft').yaw))
      .toBe(Math.sign(gains.get('frontRight').yaw));
    expect(Math.sign(gains.get('rearLeft').yaw))
      .toBe(-Math.sign(gains.get('rearRight').yaw));
  });

  it('alternates rotor handedness across the diagonals', () => {
    expect(defaultSpin([-1, 0, -1], FRAME)).toBe(defaultSpin([1, 0, 1], FRAME));
    expect(defaultSpin([-1, 0, -1], FRAME)).toBe(-defaultSpin([1, 0, -1], FRAME));
  });

  it('gives a lone centred rotor lift but no attitude authority at all', () => {
    const lone = deriveGains([rotor('only', [0, 0, 0], { reaction: 0 })], FRAME);
    expect(lone.get('only')).toEqual({ climb: 1, pitch: 0, yaw: 0, roll: 0 });
  });

  it('counts a forward-facing jet as pitch authority, not lift', () => {
    const jet = deriveGains(
      [{ id: 'jet', offset: [0, 0, -1], dir: [0, 0, 1], maxThrust: 55 }],
      FRAME,
    );
    expect(jet.get('jet').climb).toBe(0);
    expect(jet.get('jet').pitch).toBe(1);
  });

  it('counts a rotor tilted off vertical as partial lift', () => {
    const s = Math.SQRT1_2;
    const tilted = deriveGains([rotor('t', [0, 0, 0], { dir: [0, s, s] })], FRAME);
    expect(tilted.get('t').climb).toBeCloseTo(s, 3);
  });
});

describe('controller loops', () => {
  function state(extra = {}) {
    return {
      mass: 10,
      gravity: 9.81,
      liftAuthority: 152,
      altitude: 5,
      verticalSpeed: 0,
      forwardSpeed: 0,
      rightSpeed: 0,
      bodyUp: new THREE.Vector3(0, 1, 0),
      pitchDown: 0,
      rollRight: 0,
      pitchRateDown: 0,
      rollRateRight: 0,
      yawRateRight: 0,
      ...extra,
    };
  }

  const idle = { climb: 0, pitch: 0, yaw: 0 };

  it('settles on the throttle that exactly carries the machine', () => {
    const c = new FlightController(TUNING);
    const out = c.update(STEP, idle, state());
    expect(out.climb).toBeCloseTo((10 * 9.81) / 152, 2);
  });

  it('adds throttle when it has sunk below the held altitude', () => {
    const c = new FlightController(TUNING);
    c.update(STEP, idle, state());
    const hover = c.channels.climb;
    const sunk = c.update(STEP, idle, state({ altitude: 3 }));
    expect(sunk.climb).toBeGreaterThan(hover);
  });

  it('backs off when it has risen above the held altitude', () => {
    const c = new FlightController(TUNING);
    c.update(STEP, idle, state());
    const hover = c.channels.climb;
    const high = c.update(STEP, idle, state({ altitude: 7 }));
    expect(high.climb).toBeLessThan(hover);
  });

  it('follows the machine up while the climb key is held', () => {
    const c = new FlightController(TUNING);
    c.update(STEP, idle, state());
    c.update(STEP, { climb: 1, pitch: 0, yaw: 0 }, state({ altitude: 9 }));
    expect(c.targetAltitude).toBe(9);
  });

  it('needs more throttle when the machine is banked over', () => {
    const c = new FlightController(TUNING);
    const level = c.update(STEP, idle, state()).climb;
    const banked = c.update(STEP, idle, state({
      bodyUp: new THREE.Vector3(0, Math.SQRT1_2, Math.SQRT1_2),
    })).climb;
    expect(banked).toBeGreaterThan(level);
  });

  it('leans against drift when the pilot is not asking for anything', () => {
    const c = new FlightController(TUNING);
    const drifting = c.update(STEP, idle, state({ forwardSpeed: 4 }));
    expect(drifting.pitch).toBeLessThan(0);
  });

  it('leans away from sideways drift, not into it', () => {
    const c = new FlightController(TUNING);
    // Rolling right accelerates the machine right, so braking rightward drift
    // has to command a roll to the left. Getting this backwards feeds the
    // drift instead of killing it.
    expect(c.update(STEP, idle, state({ rightSpeed: 4 })).roll).toBeLessThan(0);
    expect(c.update(STEP, idle, state({ rightSpeed: -4 })).roll).toBeGreaterThan(0);
  });

  it('leans forward when the pilot asks, even while drifting forward', () => {
    const c = new FlightController(TUNING);
    const driven = c.update(STEP, { climb: 0, pitch: 1, yaw: 0 }, state({ forwardSpeed: 4 }));
    expect(driven.pitch).toBeGreaterThan(0);
  });

  it('asks for no lift at all when nothing can provide it', () => {
    const c = new FlightController(TUNING);
    expect(c.update(STEP, idle, state({ liftAuthority: 0 })).climb).toBe(0);
  });

  it('keeps every mixed throttle inside the motor range', () => {
    const c = new FlightController(TUNING);
    c.update(STEP, { climb: 1, pitch: 1, yaw: 1 }, state({ altitude: 0, verticalSpeed: -9 }));
    for (const throttle of c.mix(deriveGains(QUAD, FRAME)).values()) {
      expect(throttle).toBeGreaterThanOrEqual(0);
      expect(throttle).toBeLessThanOrEqual(1);
    }
  });

  it('reads the six flight keys into pilot intent', () => {
    const held = new Set(['KeyW', 'KeyD', 'Space']);
    const command = readFlightKeys(
      { isDown: (c) => held.has(c) },
      getPart('controller').flight.defaultKeys,
    );
    expect(command).toEqual({ pitch: 1, yaw: 1, climb: 1 });
  });

  it('reports a nose-down attitude as positive pitch', () => {
    const noseDown = frameFromAxes([0, -0.5, 0.866], [0, 0.866, 0.5]);
    const attitude = attitudeOf(noseDown, { x: 0, y: 0, z: 0 });
    expect(attitude.pitchDown).toBeGreaterThan(0.4);
  });
});

// ----------------------------------------------------------------- in a world

function fly(blueprint, spawnY = 1.2) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(400, 1, 400).setFriction(1).setCollisionGroups(GROUP_WORLD),
    ground,
  );
  const machine = new Machine({
    RAPIER, world, scene: new THREE.Scene(), blueprint,
    spawn: new THREE.Vector3(0, spawnY, 0),
  });
  const down = new Set();
  const bus = new SignalBus({ isDown: (c) => down.has(c), wasPressed: () => false });
  const run = (seconds) => {
    const steps = Math.round(seconds / STEP);
    for (let i = 0; i < steps; i += 1) {
      machine.update(STEP, bus);
      world.step();
    }
  };
  return { world, machine, bus, keys: down, run };
}

beforeAll(async () => {
  await RAPIER.init();
}, 30000);

describe('a quadcopter under its controller', () => {
  it('lifts off by itself and holds a steady altitude', () => {
    const { machine, run } = fly(quadcopter());
    run(4);
    const settled = machine.corePosition().y;
    run(6);
    expect(settled).toBeGreaterThan(0.9);
    expect(Math.abs(machine.corePosition().y - settled)).toBeLessThan(0.35);
    expect(machine.isUpsideDown()).toBe(false);
  });

  it('climbs on the up key and holds the new altitude after release', () => {
    const { machine, keys, run } = fly(quadcopter());
    run(4);
    const low = machine.corePosition().y;
    keys.add('Space');
    run(2.5);
    keys.delete('Space');
    run(1);
    const high = machine.corePosition().y;
    expect(high - low).toBeGreaterThan(3);
    run(5);
    expect(Math.abs(machine.corePosition().y - high)).toBeLessThan(1);
  });

  it('descends on the down key', () => {
    const { machine, keys, run } = fly(quadcopter());
    run(3);
    keys.add('Space');
    run(3);
    keys.delete('Space');
    run(2);
    const high = machine.corePosition().y;
    keys.add('ShiftLeft');
    run(2);
    expect(machine.corePosition().y).toBeLessThan(high - 1.5);
  });

  it('flies forward on the pitch key and brakes itself to a stop', () => {
    const { machine, keys, run } = fly(quadcopter());
    run(4);
    const start = machine.corePosition().z;
    keys.add('KeyW');
    run(2.5);
    keys.delete('KeyW');
    expect(machine.corePosition().z - start).toBeGreaterThan(3);
    run(6);
    const drifting = machine.bodies[machine.grouping.rootBody].linvel();
    expect(Math.hypot(drifting.x, drifting.z)).toBeLessThan(0.6);
    expect(machine.isUpsideDown()).toBe(false);
  });

  it('holds its station instead of sliding away when left alone', () => {
    const { machine, run } = fly(quadcopter());
    run(4);
    const settled = machine.corePosition().clone();
    run(8);
    const moved = machine.corePosition();
    expect(Math.hypot(moved.x - settled.x, moved.z - settled.z)).toBeLessThan(1.5);
  });

  it('kills a sideways shove instead of running away with it', () => {
    const { machine, run } = fly(quadcopter());
    run(4);
    const body = machine.bodies[machine.grouping.rootBody];
    body.applyImpulse({ x: 40, y: 0, z: 0 }, true);
    run(0.4);
    expect(Math.abs(body.linvel().x)).toBeGreaterThan(1.5);
    run(8);
    const settled = body.linvel();
    expect(Math.hypot(settled.x, settled.z)).toBeLessThan(0.6);
    expect(machine.isUpsideDown()).toBe(false);
  });

  it('comes back to a standstill after a long turning run', () => {
    const { machine, keys, run } = fly(quadcopter());
    run(4);
    keys.add('KeyW');
    keys.add('KeyD');
    run(8);
    keys.clear();
    run(8);
    const drifting = machine.bodies[machine.grouping.rootBody].linvel();
    expect(Math.hypot(drifting.x, drifting.z)).toBeLessThan(0.8);
    expect(machine.isUpsideDown()).toBe(false);
  });

  it('recovers from a hard knock and levels out again', () => {
    const { machine, run } = fly(quadcopter());
    run(4);
    const body = machine.bodies[machine.grouping.rootBody];
    body.applyImpulse({ x: 0, y: 0, z: 45 }, true);
    body.applyTorqueImpulse({ x: 9, y: 0, z: 0 }, true);
    run(8);
    const up = machine.partWorldAxis(machine.core(), [0, 1, 0]);
    expect(up.y).toBeGreaterThan(0.95);
    const drifting = body.linvel();
    expect(Math.hypot(drifting.x, drifting.z)).toBeLessThan(0.6);
  });

  it('yaws on the steer key and stops turning when released', () => {
    const { machine, keys, run } = fly(quadcopter());
    run(4);
    const before = machine.coreForward().clone();
    keys.add('KeyD');
    run(0.8);
    const after = machine.coreForward().clone();
    const right = before.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    expect(after.dot(right)).toBeGreaterThan(0.2);

    // Rate, not angle, so a fast turn cannot wrap past half a revolution and
    // read as a turn the other way.
    run(1);
    expect(machine.bodies[machine.grouping.rootBody].angvel().y).toBeLessThan(-0.5);
    keys.delete('KeyD');
    run(2);
    expect(Math.abs(machine.bodies[machine.grouping.rootBody].angvel().y)).toBeLessThan(0.4);
  });

  it('yaws the other way on the opposite steer key', () => {
    const { machine, keys, run } = fly(quadcopter());
    run(4);
    keys.add('KeyA');
    run(1.5);
    expect(machine.bodies[machine.grouping.rootBody].angvel().y).toBeGreaterThan(0.5);
  });
});

describe('a machine with no left or right', () => {
  // A single rotor slung above a heavy base: it can hold height, and it has no
  // pitch, roll or yaw authority whatsoever. The controller has to cope.
  function rocket() {
    const bp = new Blueprint({ name: 'rocket' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('controller', [0, 2, 0]);
    bp.place('propeller', [0, 3, 0], IDENTITY_ORIENTATION, { binding: { mode: 'flight' } });
    return bp;
  }

  it('has lift and yaw authority, but nothing to pitch or roll with', () => {
    const { machine } = fly(rocket());
    const controller = machine.controllers[0];
    expect(controller.members).toHaveLength(1);
    expect(controller.liftAuthority).toBeGreaterThan(0);
    const gains = [...controller.gains.values()][0];
    expect(gains.climb).toBe(1);
    expect(gains.pitch).toBe(0);
    expect(gains.roll).toBe(0);
    // Its own reaction torque still twists the airframe, which is exactly why
    // a real single-rotor helicopter needs a tail rotor.
    expect(Math.abs(gains.yaw)).toBe(1);
  });

  it('gets itself off the ground and holds altitude on one rotor', () => {
    const { machine, run } = fly(rocket());
    run(5);
    const settled = machine.corePosition().y;
    expect(settled).toBeGreaterThan(1.5);
    run(6);
    expect(Math.abs(machine.corePosition().y - settled)).toBeLessThan(0.6);
  });

  it('climbs and settles again on the up key', () => {
    const { machine, keys, run } = fly(rocket());
    run(5);
    const low = machine.corePosition().y;
    keys.add('Space');
    run(2);
    keys.delete('Space');
    run(3);
    expect(machine.corePosition().y).toBeGreaterThan(low + 1.5);
  });
});

describe('a machine flown on plain jets', () => {
  // No rotors at all: four jets pointing down do the lifting, so the mixer has
  // to work from thrust direction rather than anything rotor-specific.
  function jetPlatform() {
    const bp = new Blueprint({ name: 'jets' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('controller', [0, 1, -1]);
    for (const cell of [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1]]) {
      bp.place('thruster', cell, IDENTITY_ORIENTATION, { binding: { mode: 'flight' } });
    }
    return bp;
  }

  it('hovers on thrust alone, with pitch authority from geometry', () => {
    const { machine, run } = fly(jetPlatform());
    const controller = machine.controllers[0];
    expect(controller.members).toHaveLength(4);
    const pitches = [...controller.gains.values()].map((g) => g.pitch);
    expect(Math.max(...pitches)).toBeGreaterThan(0.5);
    expect(Math.min(...pitches)).toBeLessThan(-0.5);

    run(5);
    expect(machine.corePosition().y).toBeGreaterThan(0.8);
    expect(machine.isUpsideDown()).toBe(false);
  });
});

describe('thrusters not linked to a controller', () => {
  it('still answer to their own key binding', () => {
    const bp = new Blueprint({ name: 'manual' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('controller', [0, 1, -1]);
    bp.place('thruster', [0, 2, 0], pitchStep(IDENTITY_ORIENTATION), {
      binding: { mode: 'hold', pos: 'KeyE' },
    });
    const { machine, keys, run } = fly(bp);
    expect(machine.controllers[0].members).toHaveLength(0);
    run(1.5);
    const start = machine.corePosition().z;
    keys.add('KeyE');
    run(2);
    expect(machine.corePosition().z - start).toBeGreaterThan(0.5);
  });
});
