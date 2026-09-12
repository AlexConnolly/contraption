import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { getPart, jointTension } from '../src/parts/registry.js';

function keyboard() {
  const down = new Set();
  return { down, isDown: (code) => down.has(code), wasPressed: () => false };
}

beforeAll(async () => { await RAPIER.init(); }, 30000);

function ground(world) {
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(120, 1, 120).setTranslation(0, -1, 0)
      .setFriction(1).setCollisionGroups(GROUP_WORLD),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
}

// A placement that does not fit is refused quietly, which would leave a rig
// missing the very part it was built to measure.
function placer(bp) {
  return (type, cell, rot, config) => {
    const out = bp.place(type, cell, rot, config);
    if (!out.ok) throw new Error(`${type} at ${cell} did not fit: ${out.reason}`);
  };
}

/**
 * An arm reaching out level from the side of a tower, with weight on the end
 * of it. How far the end drops is what tension is for: a slack joint gives
 * under the load, a tight one holds its line. The tower has a wide, weighted
 * foot so what is measured is the joint and not the machine falling over.
 */
function crane(tension, load = 3, key = null, seconds = 3) {
  const world = createWorld(RAPIER);
  ground(world);

  const bp = new Blueprint({ name: 'arm' });
  const put = placer(bp);
  put('panel', [0, 0, -1]);
  put('panel', [0, 0, -4]);
  put('core', [0, 1, -1]);
  for (const z of [-3, -4, -5]) put('ballast', [0, 1, z]);
  for (const y of [2, 3, 4]) put('block', [0, y, -1]);
  // Rotation 6 bolts the hinge to the side of the tower, so the arm reaches
  // out level and gravity turns it about the pin.
  put('hinge', [0, 4, 0], 6, {
    binding: { mode: 'axis', pos: 'KeyR', neg: 'KeyF' },
    ...(tension === undefined ? {} : { tension }),
  });
  for (const z of [1, 2]) put('block', [0, 4, z]);
  for (let i = 0; i < load; i += 1) put('ballast', [i - Math.floor(load / 2), 4, 3]);

  const machine = new Machine({
    RAPIER, world, scene: new THREE.Scene(), blueprint: bp,
    spawn: new THREE.Vector3(0, 0.6, 0),
  });
  const bus = new SignalBus(keyboard());
  if (key) bus.input.down.add(key);
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    machine.update(STEP, bus);
    world.step();
  }
  const tip = bp.list().filter((p) => p.type === 'ballast').pop();
  const pin = bp.list().find((p) => p.type === 'hinge');
  return machine.partWorldPoint(pin).y - machine.partWorldPoint(tip).y;
}

describe('joint tension', () => {
  it('is a setting on every part with a powered joint', () => {
    for (const id of ['hinge', 'piston']) {
      const part = getPart(id);
      expect(Array.isArray(part.tensionRange), id).toBe(true);
      expect(part.tensionRange[0]).toBeLessThan(part.tensionRange[1]);
    }
  });

  it('defaults to what the part always used to do', () => {
    expect(jointTension({ config: {} }, getPart('hinge'))).toBe(getPart('hinge').tension);
  });

  it('is pulled back when asked for something outside the range', () => {
    const part = getPart('hinge');
    const [min, max] = part.tensionRange;
    expect(jointTension({ config: { tension: 500 } }, part)).toBe(max);
    expect(jointTension({ config: { tension: -3 } }, part)).toBe(min);
  });

  // The whole point: same arm, same load, different setting.
  it('sags less the tighter it is set', () => {
    expect(crane(6)).toBeLessThan(crane(0.25) - 0.5);
  });

  it('lets a joint be deliberately floppy', () => {
    expect(crane(0.15)).toBeGreaterThan(crane(1) + 0.3);
  });

  it('holds a load at full tension that sinks a slack one', () => {
    expect(crane(8)).toBeLessThan(crane(0.2) - 0.5);
  });

  it('still answers its controls however hard it is held', () => {
    for (const tension of [0.25, 1, 8]) {
      const idle = crane(tension, 1);
      expect(crane(tension, 1, 'KeyR'), `raise at ${tension}`).toBeLessThan(idle - 0.5);
      expect(crane(tension, 1, 'KeyF'), `lower at ${tension}`).toBeGreaterThan(idle);
    }
  });

  /**
   * Taking the tension off does not make a weak motor, it takes the motor
   * away. That is the trade the setting offers and it has to be plain.
   */
  it('stops being a motor at all once the tension is off', () => {
    const idle = crane(0, 1);
    expect(crane(0, 1, 'KeyR')).toBeCloseTo(idle, 2);
    expect(crane(0, 1, 'KeyF')).toBeCloseTo(idle, 2);
  });
});

/**
 * A swing is not a new part. It is a hinge with the tension taken all the way
 * off: bolted to something above, free to turn. Until tension existed there
 * was no way to build one, because a hinge always drove itself to an angle and
 * so held whatever hung on it rather than letting it hang.
 */
describe('a swing', () => {
  function pendulum(tension, push = 25, seconds = 3) {
    const world = createWorld(RAPIER);
    ground(world);

    const bp = new Blueprint({ name: 'swing' });
    const put = placer(bp);
    for (const x of [-3, 0, 3]) put('panel', [x, 0, 0]);
    put('core', [0, 1, 0]);
    for (const x of [-4, -3, -2, -1]) put('ballast', [x, 1, 0]);
    for (const y of [2, 3, 4, 5, 6]) put('block', [0, y, 0]);
    // Two cells of overhang: with one, the arm below would touch the tower and
    // weld the joint shut.
    put('block', [1, 6, 0]);
    put('block', [2, 6, 0]);
    // Rotation 19 turns the hinge over, so it bolts to the overhang above and
    // carries the seat below, on an axis that swings it through x.
    put('hinge', [2, 5, 0], 19, { tension });
    put('block', [2, 4, 0]);
    put('ballast', [2, 3, 0]);

    const machine = new Machine({
      RAPIER, world, scene: new THREE.Scene(), blueprint: bp,
      spawn: new THREE.Vector3(0, 0.6, 0),
    });
    const bus = new SignalBus(keyboard());
    const weight = bp.list().filter((p) => p.type === 'ballast').pop();
    // The hinge belongs to the half it carries, so the gantry is the only
    // honest thing to measure the swing against.
    const frame = bp.list().filter((p) => p.type === 'block')
      .find((p) => p.cell[0] === 2 && p.cell[1] === 6);

    for (let i = 0; i < 60; i += 1) { machine.update(STEP, bus); world.step(); }
    machine.bodyOf(weight.id).applyImpulse({ x: push, y: 0, z: 0 }, true);

    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
      machine.update(STEP, bus);
      world.step();
      const x = machine.partWorldPoint(weight).x - machine.partWorldPoint(frame).x;
      low = Math.min(low, x);
      high = Math.max(high, x);
    }
    return high - low;
  }

  it('lets the tension go all the way to nothing', () => {
    expect(getPart('hinge').tensionRange[0]).toBe(0);
    expect(jointTension({ config: { tension: 0 } }, getPart('hinge'))).toBe(0);
  });

  it('hangs still until something pushes it', () => {
    expect(pendulum(0, 0)).toBeLessThan(0.05);
  });

  it('swings freely with no tension on it', () => {
    expect(pendulum(0)).toBeGreaterThan(0.8);
  });

  it('is held still when the tension is up', () => {
    expect(pendulum(8)).toBeLessThan(0.2);
  });

  it('swings further loose than tight', () => {
    expect(pendulum(0)).toBeGreaterThan(pendulum(8) + 0.6);
  });
});
