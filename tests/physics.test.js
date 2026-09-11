import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { starterRover } from '../src/studio/presets.js';

const STEP = 1 / 60;

function keyboard(...codes) {
  const down = new Set(codes);
  return {
    down,
    isDown: (code) => down.has(code),
    wasPressed: () => false,
  };
}

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(200, 1, 200)
      .setFriction(1)
      .setCollisionGroups(GROUP_WORLD),
    ground,
  );
  return world;
}

function run(machine, bus, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    machine.update(STEP, bus);
    machine.world.step();
  }
  machine.syncMeshes();
}

function build(blueprint, input, spawnY = 1.2) {
  const world = makeWorld();
  const machine = new Machine({
    RAPIER,
    world,
    scene: new THREE.Scene(),
    blueprint,
    spawn: new THREE.Vector3(0, spawnY, 0),
  });
  return { world, machine, bus: new SignalBus(input) };
}

beforeAll(async () => {
  await RAPIER.init();
}, 30000);

describe('machine assembly', () => {
  it('splits the starter rover into a chassis and four wheels', () => {
    const { machine } = build(starterRover(), keyboard());
    expect(machine.bodies).toHaveLength(5);
    expect(machine.joints).toHaveLength(4);
    expect(machine.grouping.disconnected).toEqual([]);
  });

  it('settles on the ground instead of sinking or exploding', () => {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 2);
    const core = machine.corePosition();
    expect(Number.isFinite(core.x)).toBe(true);
    expect(core.y).toBeGreaterThan(0.4);
    expect(core.y).toBeLessThan(1.4);
    expect(Math.abs(core.x)).toBeLessThan(0.3);
    expect(Math.abs(core.z)).toBeLessThan(0.3);
    expect(machine.isUpsideDown()).toBe(false);
  });
});

describe('driving', () => {
  it('drives forward on the throttle key', () => {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 1);
    const before = machine.corePosition().clone();
    bus.input.down.add('KeyW');
    run(machine, bus, 2);
    const after = machine.corePosition();
    expect(after.z - before.z).toBeGreaterThan(2);
    expect(machine.isUpsideDown()).toBe(false);
  });

  it('reverses on the opposite key', () => {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 1);
    const before = machine.corePosition().clone();
    bus.input.down.add('KeyS');
    run(machine, bus, 2);
    expect(machine.corePosition().z - before.z).toBeLessThan(-2);
  });

  it('turns when only the steer key is held', () => {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 1);
    const before = machine.coreForward().clone();
    bus.input.down.add('KeyD');
    run(machine, bus, 2);
    const after = machine.coreForward();
    const turned = Math.acos(Math.min(1, Math.max(-1, before.dot(after))));
    expect(turned).toBeGreaterThan(0.5);
  });

  it('stays put with no keys held', () => {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 1);
    const before = machine.corePosition().clone();
    run(machine, bus, 2);
    expect(machine.corePosition().distanceTo(before)).toBeLessThan(0.25);
  });
});

describe('manipulators', () => {
  function armBlueprint() {
    const bp = new Blueprint({ name: 'arm' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('hinge', [0, 1, -1], IDENTITY_ORIENTATION, {
      binding: { mode: 'hold', pos: 'KeyR' },
    });
    bp.place('beam', [0, 2, -2], yawStep(IDENTITY_ORIENTATION));
    return bp;
  }

  it('raises a hinged arm when its key is held, and lowers it when released', () => {
    const bp = armBlueprint();
    const { machine, bus } = build(bp, keyboard());
    run(machine, bus, 1.5);
    const armPart = bp.list().find((p) => p.type === 'beam');
    const resting = machine.partWorldPoint(armPart).clone();

    bus.input.down.add('KeyR');
    run(machine, bus, 2);
    const raised = machine.partWorldPoint(armPart).clone();
    expect(Math.abs(raised.z - resting.z)).toBeGreaterThan(0.3);

    bus.input.down.delete('KeyR');
    run(machine, bus, 2);
    const returned = machine.partWorldPoint(armPart);
    expect(Math.abs(returned.z - resting.z)).toBeLessThan(Math.abs(raised.z - resting.z));
  });

  it('extends a piston under its key and retracts it after', () => {
    const bp = new Blueprint({ name: 'lifter' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('piston', [0, 1, 1], IDENTITY_ORIENTATION, {
      binding: { mode: 'hold', pos: 'KeyE' },
    });
    bp.place('block', [0, 2, 1]);
    const { machine, bus } = build(bp, keyboard());
    run(machine, bus, 1.5);
    const cap = bp.list().find((p) => p.type === 'block');
    const low = machine.partWorldPoint(cap).y;

    bus.input.down.add('KeyE');
    run(machine, bus, 1.5);
    const high = machine.partWorldPoint(cap).y;
    expect(high - low).toBeGreaterThan(0.6);

    bus.input.down.delete('KeyE');
    run(machine, bus, 1.5);
    expect(machine.partWorldPoint(cap).y).toBeLessThan(high - 0.4);
  });
});

describe('flight', () => {
  it('lifts off under rotor thrust and comes back down when cut', () => {
    const bp = new Blueprint({ name: 'copter' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    for (const cell of [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1]]) {
      bp.place('propeller', cell, IDENTITY_ORIENTATION, {
        binding: { mode: 'hold', pos: 'Space' },
      });
    }
    const { machine, bus } = build(bp, keyboard());
    run(machine, bus, 1);
    const grounded = machine.corePosition().y;

    bus.input.down.add('Space');
    run(machine, bus, 1.5);
    const flying = machine.corePosition().y;
    expect(flying - grounded).toBeGreaterThan(1);

    bus.input.down.delete('Space');
    run(machine, bus, 2);
    expect(machine.corePosition().y).toBeLessThan(flying);
  });
});

describe('sensors', () => {
  it('trips when a wall comes inside its range, and reads clear otherwise', () => {
    const bp = new Blueprint({ name: 'scout' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    const sensor = bp.place('sensor', [0, 1, 1], IDENTITY_ORIENTATION, { threshold: 0.5 });
    const { world, machine, bus } = build(bp, keyboard());
    run(machine, bus, 1);
    expect(bus.sensor(sensor.id)).toBe(0);

    const wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1, 3));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(4, 2, 0.3).setCollisionGroups(GROUP_WORLD),
      wall,
    );
    run(machine, bus, 0.2);
    expect(bus.sensor(sensor.id)).toBe(1);
  });
});

describe('grabber', () => {
  it('latches a loose crate and carries it, then drops it on release', () => {
    const bp = new Blueprint({ name: 'claw' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('grabber', [0, 2, 0], IDENTITY_ORIENTATION, {
      binding: { mode: 'always' },
    });
    const { world, machine, bus } = build(bp, keyboard());

    const crateBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2.6, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.3, 0.3, 0.3)
        .setDensity(0.4)
        .setCollisionGroups(GROUP_WORLD),
      crateBody,
    );

    run(machine, bus, 1.5);
    const grabber = bp.list().find((p) => p.type === 'grabber');
    expect(machine.grabs.has(grabber.id)).toBe(true);

    const gap = crateBody.translation().y - machine.partWorldPoint(grabber).y;
    run(machine, bus, 1.5);
    const gapLater = crateBody.translation().y - machine.partWorldPoint(grabber).y;
    expect(Math.abs(gapLater - gap)).toBeLessThan(0.15);
  });
});
