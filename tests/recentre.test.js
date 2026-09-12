import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { getPart, turntableRecentres, shortestTurn } from '../src/parts/registry.js';

function keyboard() {
  const down = new Set();
  return { down, isDown: (c) => down.has(c), wasPressed: () => false };
}

beforeAll(async () => { await RAPIER.init(); }, 30000);

/** A turntable on a post with an arm on it, turned by Z and X. */
function rig(config = {}) {
  const world = createWorld(RAPIER);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(120, 1, 120).setTranslation(0, -1, 0)
      .setFriction(1).setCollisionGroups(GROUP_WORLD),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
  const bp = new Blueprint({ name: 'turret' });
  const put = (type, cell, rot, cfg) => {
    const out = bp.place(type, cell, rot, cfg);
    if (!out.ok) throw new Error(`${type} at ${cell}: ${out.reason}`);
  };
  put('panel', [0, 0, 0]);
  put('core', [0, 1, 0]);
  put('block', [0, 2, 0]);
  put('turntable', [0, 3, 0], undefined, {
    binding: { mode: 'axis', pos: 'KeyZ', neg: 'KeyX' },
    ...config,
  });
  put('beam', [0, 4, 0]);

  const machine = new Machine({
    RAPIER, world, scene: new THREE.Scene(), blueprint: bp,
    spawn: new THREE.Vector3(0, 0.6, 0),
  });
  return { world, machine, bp, bus: new SignalBus(keyboard()) };
}

const headOf = (bp) => bp.list().find((p) => p.type === 'turntable');

function run(r, seconds, key = null) {
  if (key) r.bus.input.down.add(key); else r.bus.input.down.clear();
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    r.machine.update(STEP, r.bus);
    r.world.step();
  }
  return r.machine.jointAngle(headOf(r.bp));
}

describe('a turntable that finds its own centre', () => {
  it('is a setting, and off unless it is asked for', () => {
    expect(getPart('turntable').recentre).toBe(false);
    expect(turntableRecentres({ config: {} })).toBe(false);
    expect(turntableRecentres({ config: { recentre: true } })).toBe(true);
  });

  /**
   * The old behaviour, and still the default: a velocity motor told to stop
   * simply stops, which is what a crane slew wants.
   */
  it('stays where it was left when it is off', () => {
    const r = rig();
    const turned = run(r, 1.2, 'KeyZ');
    expect(Math.abs(turned)).toBeGreaterThan(20);
    expect(Math.abs(run(r, 2))).toBeGreaterThan(Math.abs(turned) - 5);
  });

  it('winds back to centre when it is on', () => {
    const r = rig({ recentre: true });
    expect(Math.abs(run(r, 1.2, 'KeyZ'))).toBeGreaterThan(20);
    expect(Math.abs(run(r, 3))).toBeLessThan(3);
  });

  it('comes back from either way round', () => {
    for (const key of ['KeyZ', 'KeyX']) {
      const r = rig({ recentre: true });
      run(r, 1.2, key);
      expect(Math.abs(run(r, 3)), key).toBeLessThan(3);
    }
  });

  it('still turns where it is told while the key is held', () => {
    const r = rig({ recentre: true });
    expect(Math.abs(run(r, 1.5, 'KeyZ'))).toBeGreaterThan(20);
  });

  /**
   * Past half a turn the short way home is onwards, not back. A turntable has
   * no limits, so this is a real case rather than a theoretical one.
   */
  it('takes the short way home from beyond half a turn', () => {
    const r = rig({ recentre: true, spin: 14 });
    const far = run(r, 1.1, 'KeyZ');
    expect(Math.abs(far), 'did not get past half a turn').toBeGreaterThan(100);
    expect(Math.abs(run(r, 4))).toBeLessThan(5);
  });

  it('holds centre once it is there rather than drifting past', () => {
    const r = rig({ recentre: true });
    run(r, 1.2, 'KeyZ');
    run(r, 3);
    let worst = 0;
    for (let i = 0; i < Math.round(3 / STEP); i += 1) {
      r.machine.update(STEP, r.bus);
      r.world.step();
      worst = Math.max(worst, Math.abs(shortestTurn(r.machine.jointAngle(headOf(r.bp)), 0)));
    }
    expect(worst).toBeLessThan(4);
  });
});
