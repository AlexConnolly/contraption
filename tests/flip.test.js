import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { getPart, jointFlip } from '../src/parts/registry.js';

function keyboard() {
  const down = new Set();
  return { down, isDown: (code) => down.has(code), wasPressed: () => false };
}

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * An arm on a hinge, driven by one key. Where the end of it ends up is the
 * only thing that matters: mirroring has to send it the other way.
 */
function arm(flip, key = 'KeyR', seconds = 2) {
  const world = createWorld(RAPIER);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(120, 1, 120).setTranslation(0, -1, 0)
      .setFriction(1).setCollisionGroups(GROUP_WORLD),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );

  const bp = new Blueprint({ name: 'arm' });
  const put = (type, cell, rot, config) => {
    const out = bp.place(type, cell, rot, config);
    if (!out.ok) throw new Error(`${type} at ${cell} did not fit: ${out.reason}`);
  };
  put('panel', [0, 0, -1]);
  put('panel', [0, 0, -4]);
  put('core', [0, 1, -1]);
  for (const z of [-3, -4, -5]) put('ballast', [0, 1, z]);
  for (const y of [2, 3, 4]) put('block', [0, y, -1]);
  // Bolted to the side of the tower so the arm reaches out level, where a
  // turn either way is plain to see.
  put('hinge', [0, 4, 0], 6, {
    binding: { mode: 'axis', pos: 'KeyR', neg: 'KeyF' },
    ...(flip === undefined ? {} : { flip }),
  });
  for (const z of [1, 2]) put('block', [0, 4, z]);

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
  const tip = bp.list().filter((p) => p.type === 'block').pop();
  const pin = bp.list().find((p) => p.type === 'hinge');
  // Height of the far end relative to the pin: up is one way round, down is
  // the other.
  return machine.partWorldPoint(tip).y - machine.partWorldPoint(pin).y;
}

describe('mirroring a joint', () => {
  it('is a setting on the parts that turn', () => {
    expect(getPart('hinge').flippable).toBe(true);
    expect(getPart('turntable').flippable).toBe(true);
  });

  it('is off unless it is asked for', () => {
    expect(jointFlip({ config: {} })).toBe(1);
    expect(jointFlip(undefined)).toBe(1);
    expect(jointFlip({ config: { flip: true } })).toBe(-1);
  });

  it('sends the arm the other way on the same key', () => {
    const normal = arm(false);
    const mirrored = arm(true);
    expect(Math.sign(normal)).not.toBe(Math.sign(mirrored));
    expect(Math.abs(normal)).toBeGreaterThan(0.5);
    expect(Math.abs(mirrored)).toBeGreaterThan(0.5);
  });

  /**
   * The point of the thing: a mirrored part on one key does what an
   * unmirrored part does on the other. That is what lets a facing pair close
   * together instead of both swinging the same way.
   */
  it('matches an unmirrored one driven the opposite way', () => {
    expect(arm(true, 'KeyR')).toBeCloseTo(arm(false, 'KeyF'), 1);
  });

  it('changes nothing when it is left alone', () => {
    expect(arm(undefined)).toBeCloseTo(arm(false), 5);
  });
});
