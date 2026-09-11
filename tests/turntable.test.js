import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION } from '../src/core/orientation.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { getPart, workingAxis, turntableSpin, turntableTorque } from '../src/parts/registry.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld } from '../src/sim/world.js';

const STEP = 1 / 60;

function keyboard(...codes) {
  const down = new Set(codes);
  return { down, isDown: (code) => down.has(code), wasPressed: () => false };
}

function makeWorld() {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(200, 1, 200).setFriction(1).setCollisionGroups(GROUP_WORLD),
    ground,
  );
  return world;
}

function run(machine, bus, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    machine.update(STEP, bus);
    machine.world.step();
  }
}

/**
 * A turntable on a heavy base with a boom of `arm` blocks reaching out from
 * it. `load` extra ballast is hung on the tip, which is what decides whether
 * the given torque can turn the thing at all.
 */
function rig({ spin, torque, arm = 3, load = 0 } = {}) {
  const bp = new Blueprint({ name: 'rig' });
  for (const z of [-3, 0, 3]) bp.place('panel', [0, 0, z]);
  bp.place('core', [0, 1, -1]);
  // Ballast spread wide, because what resists a boom is the base's spread
  // rather than its weight: inertia goes as radius squared. A compact base
  // simply counter-rotates and the boom never goes anywhere.
  for (const cell of [
    [-1, 1, -4], [1, 1, -4], [-1, 1, 4], [1, 1, 4],
    [-1, 1, -3], [1, 1, -3], [-1, 1, 3], [1, 1, 3],
  ]) bp.place('ballast', cell);

  const config = { binding: { mode: 'hold', pos: 'KeyZ' } };
  if (spin !== undefined) config.spin = spin;
  if (torque !== undefined) config.torque = torque;
  const table = bp.place('turntable', [0, 1, 0], IDENTITY_ORIENTATION, config);

  // Beams are three cells along x, so they tile at 0, 3, 6 ...
  for (let i = 0; i < arm; i += 1) bp.place('beam', [i * 3, 2, 0]);
  const tipX = arm * 3 - 2;
  for (let i = 0; i < load; i += 1) bp.place('ballast', [tipX, 3 + i, 0]);

  const world = makeWorld();
  const machine = new Machine({
    RAPIER,
    world,
    scene: new THREE.Scene(),
    blueprint: bp,
    spawn: new THREE.Vector3(0, 1.4, 0),
  });
  return { bp, machine, bus: new SignalBus(keyboard()), tableId: table.id, arm };
}

/**
 * How fast the table is turning against the thing it is bolted to. The motor
 * drives one against the other, so the difference is what it controls;
 * measuring the table alone would also pick up the whole machine slewing.
 */
function spinRate(machine, tableId) {
  const placed = machine.blueprint.get(tableId);
  const spec = machine.grouping.joints.find((j) => j.partId === tableId);
  const axis = machine.partWorldAxis(placed, [0, 1, 0]);
  const a = machine.bodies[spec.childBody].angvel();
  const b = machine.bodies[spec.hostBody].angvel();
  return new THREE.Vector3(a.x - b.x, a.y - b.y, a.z - b.z).dot(axis);
}

// Seconds to come up to nine tenths of the commanded speed, or null if it
// never gets there. Torque governs this rather than the top speed: a level
// boom on an upright axis has no gravity pulling back against it.
function spinUp(machine, bus, target, limit = 5) {
  bus.input.down.add('KeyZ');
  for (let i = 0; i < Math.round(limit / STEP); i += 1) {
    machine.update(STEP, bus);
    machine.world.step();
    if (Math.abs(spinRate(machine, machine.blueprint.list()
      .find((p) => p.type === 'turntable').id)) >= target * 0.9) {
      return i * STEP;
    }
  }
  return null;
}

beforeAll(async () => {
  await RAPIER.init();
}, 30000);

describe('the turntable', () => {
  it('spins about its own axis, and is not handed like a wheel', () => {
    const part = getPart('turntable');
    expect(part.axis).toEqual([0, 1, 0]);
    expect(part.joint).toBe('revolute');
    // No `radius`, so it must not pick up the wheel's drive handedness: a
    // turntable has no side of the machine to be on.
    expect(part.radius).toBeUndefined();
    expect(workingAxis(part)).toBe(null);
  });

  it('joins on its bottom and carries on its top, like a hinge', () => {
    const part = getPart('turntable');
    expect(part.attach).toEqual([[0, -1, 0]]);
    expect(part.carry).toEqual([[0, 1, 0]]);
  });

  it('reaches the speed it is set to with nothing much on it', () => {
    const { machine, bus, tableId } = rig({ spin: 6, torque: 600, arm: 1 });
    run(machine, bus, 0.8);
    bus.input.down.add('KeyZ');
    run(machine, bus, 2.5);
    expect(Math.abs(spinRate(machine, tableId))).toBeGreaterThan(5.4);
  });

  it('takes its time on a weak setting and is instant on a strong one', () => {
    const weak = rig({ spin: 5, torque: 40, arm: 3 });
    run(weak.machine, weak.bus, 0.8);
    const slow = spinUp(weak.machine, weak.bus, 5);

    const strong = rig({ spin: 5, torque: 600, arm: 3 });
    run(strong.machine, strong.bus, 0.8);
    const quick = spinUp(strong.machine, strong.bus, 5);

    expect(slow).not.toBe(null);
    expect(quick).not.toBe(null);
    expect(quick).toBeLessThan(slow);
  });

  it('never gets a loaded boom going at the weakest setting', () => {
    const { machine, bus } = rig({ spin: 5, torque: 12, arm: 3, load: 2 });
    run(machine, bus, 0.8);
    expect(spinUp(machine, bus, 5)).toBe(null);
  });

  it('turns that same loaded boom once the torque is raised', () => {
    const { machine, bus } = rig({ spin: 5, torque: 600, arm: 3, load: 2 });
    run(machine, bus, 0.8);
    expect(spinUp(machine, bus, 5)).not.toBe(null);
  });

  // The whole point of the part: a boom on a fast table carries its tip at a
  // speed worth launching something with.
  it('carries the end of a boom at a real speed', () => {
    const { machine, bus } = rig({ spin: 9, torque: 1800, arm: 3 });
    run(machine, bus, 0.8);
    bus.input.down.add('KeyZ');
    run(machine, bus, 2.5);
    const tip = machine.blueprint.list().filter((p) => p.type === 'beam').pop();
    const v = machine.bodies[machine.grouping.bodyOfPart.get(tip.id)].linvel();
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(8);
  });

  it('throws harder the faster it is set to turn', () => {
    const tip = (spin) => {
      const { machine, bus } = rig({ spin, torque: 1800, arm: 3 });
      run(machine, bus, 0.8);
      bus.input.down.add('KeyZ');
      run(machine, bus, 2.5);
      const beam = machine.blueprint.list().filter((p) => p.type === 'beam').pop();
      const v = machine.bodies[machine.grouping.bodyOfPart.get(beam.id)].linvel();
      return Math.hypot(v.x, v.z);
    };
    expect(tip(14)).toBeGreaterThan(tip(5) * 1.5);
  });

  it('runs backwards on a negative signal', () => {
    const forward = rig({ spin: 6, torque: 900, arm: 2 });
    run(forward.machine, forward.bus, 0.8);
    forward.bus.input.down.add('KeyZ');
    run(forward.machine, forward.bus, 1.5);
    const a = spinRate(forward.machine, forward.tableId);

    const back = rig({ spin: 6, torque: 900, arm: 2 });
    back.bp.setConfig(back.tableId, { binding: { mode: 'axis', pos: 'KeyZ', neg: 'KeyX' } });
    run(back.machine, back.bus, 0.8);
    back.bus.input.down.add('KeyX');
    run(back.machine, back.bus, 1.5);
    const b = spinRate(back.machine, back.tableId);

    expect(Math.sign(a)).toBe(-Math.sign(b));
  });
});

describe('how a turntable is set up', () => {
  it('falls back to its own defaults', () => {
    const part = getPart('turntable');
    expect(turntableSpin({ config: {} })).toBe(part.spin);
    expect(turntableTorque({ config: {} })).toBe(part.torque);
  });

  it('takes the numbers it is given', () => {
    expect(turntableSpin({ config: { spin: 3 } })).toBe(3);
    expect(turntableTorque({ config: { torque: 500 } })).toBe(500);
  });

  it('pulls anything outside its range back to the nearest end', () => {
    const part = getPart('turntable');
    const [slow, fast] = part.spinRange;
    const [weak, strong] = part.torqueRange;
    expect(turntableSpin({ config: { spin: 999 } })).toBe(fast);
    expect(turntableSpin({ config: { spin: -999 } })).toBe(slow);
    expect(turntableTorque({ config: { torque: 1e9 } })).toBe(strong);
    expect(turntableTorque({ config: { torque: -5 } })).toBe(weak);
  });

  // Menial to heavy was the requirement, and a narrow band is the failure
  // mode: a table that can only ever do one size of job is not adjustable.
  it('spans menial to heavy', () => {
    const [weak, strong] = getPart('turntable').torqueRange;
    expect(strong / weak).toBeGreaterThan(50);
  });
});
