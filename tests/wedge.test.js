import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { getPart, CELL } from '../src/parts/registry.js';
import { createWorld } from '../src/sim/world.js';

const STEP = 1 / 60;

function keyboard(...codes) {
  const down = new Set(codes);
  return { down, isDown: (c) => down.has(c), wasPressed: () => false };
}

beforeAll(async () => { await RAPIER.init(); }, 30000);

function world() {
  const w = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  w.createCollider(
    RAPIER.ColliderDesc.cuboid(60, 1, 60).setTranslation(0, -1, 0)
      .setFriction(1.0).setCollisionGroups(GROUP_WORLD),
    w.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
  return w;
}

function ball(w, at, radius = 0.3) {
  const body = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z),
  );
  w.createCollider(
    RAPIER.ColliderDesc.ball(radius).setDensity(2).setFriction(0.6)
      .setCollisionGroups(GROUP_WORLD),
    body,
  );
  return body;
}

function run(machine, bus, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    machine.update(STEP, bus);
    machine.world.step();
  }
}

describe('the wedge', () => {
  it('is a part you can build with', () => {
    const part = getPart('wedge');
    expect(part.category).toBe('structure');
    expect(part.shape).toBe('wedge');
    expect(part.cost).toBeGreaterThan(0);
  });

  // A single cell would be a 45 degree face, which measurably bulldozes a ball
  // along the floor instead of lifting it. Three cells is about 18 degrees.
  it('is shallow enough to get under something', () => {
    const [, height, length] = getPart('wedge').size;
    expect(length).toBeGreaterThanOrEqual(3);
    expect(Math.atan2(height, length) * 180 / Math.PI).toBeLessThan(25);
  });

  /**
   * The one that matters. A wedge with a box collider looks exactly right and
   * behaves exactly wrong: everything rests on top of it as though the slope
   * were not there. Dropping a ball on the high end and watching it run down
   * is the only way to know the collider is the shape the mesh claims.
   */
  it('actually has a slope on it, not a box collider', () => {
    const w = world();
    const bp = new Blueprint();
    bp.place('core', [0, 0, 0]);
    bp.place('wedge', [0, 0, 2]);
    const machine = new Machine({
      RAPIER, world: w, scene: new THREE.Scene(), blueprint: bp,
      spawn: new THREE.Vector3(0, 0.25, 0),
    });
    // Dropped on the high end of the slope, which sits a little under half a
    // metre up.
    const dropped = ball(w, new THREE.Vector3(0, 0.78, 0.82), 0.1);
    const bus = new SignalBus(keyboard());
    run(machine, bus, 1.6);

    const at = dropped.translation();
    // A box would hold it up at its top face. A slope runs it down to the
    // floor and out of the low end.
    expect(at.y).toBeLessThan(0.3);
    expect(at.z).toBeLessThan(0.4);
  });

  it('lets a ball ride up it when the machine drives at one', () => {
    const w = world();
    const bp = new Blueprint();
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    // Turned about, so the thin end faces forward and the ball meets the
    // slope rather than the vertical back of it.
    bp.place('wedge', [0, 0, 3], yawStep(yawStep(IDENTITY_ORIENTATION)));
    for (const cell of [[-2, 0, -1], [2, 0, -1]]) {
      bp.place('wheel', cell, cell[0] < 0 ? yawStep(yawStep(IDENTITY_ORIENTATION)) : IDENTITY_ORIENTATION, {
        binding: { mode: 'drive', pos: 'KeyW', neg: 'KeyS', left: 'KeyA', right: 'KeyD' },
      });
    }
    const machine = new Machine({
      RAPIER, world: w, scene: new THREE.Scene(), blueprint: bp,
      spawn: new THREE.Vector3(0, 0.6, 0),
    });
    const target = ball(w, new THREE.Vector3(0, 0.3, 3.2), 0.28);
    const bus = new SignalBus(keyboard());
    run(machine, bus, 0.8);
    const before = target.translation().y;

    bus.input.down.add('KeyW');
    let highest = before;
    for (let i = 0; i < Math.round(2.2 / STEP); i += 1) {
      machine.update(STEP, bus);
      w.step();
      highest = Math.max(highest, target.translation().y);
    }

    // Driven into, the ball climbs the slope instead of being shoved along
    // the floor. It runs off the back again afterwards, which is the point of
    // the next test.
    expect(highest).toBeGreaterThan(before + 0.25);
  });

  /**
   * Measured, so nobody has to guess how much ramp is enough: driven at a ball
   * a little over half its own width, a three-cell wedge lifts it about
   * 0.3 m and then loses it again as the machine drives on. Lifting is the
   * part's job; keeping hold of what comes up is the player's, and wants a
   * tray deeper than a single row of blocks.
   */
  it('weighs less than a full block, because there is less of it', () => {
    expect(getPart('wedge').mass).toBeLessThan(getPart('block').mass);
  });

  it('can be turned to face any way, like any other part', () => {
    const bp = new Blueprint();
    bp.place('core', [0, 0, 0]);
    expect(bp.place('wedge', [0, 0, 2], yawStep(IDENTITY_ORIENTATION)).ok).toBe(true);
    expect(bp.place('wedge', [0, 0, 4], yawStep(yawStep(IDENTITY_ORIENTATION))).ok).toBe(true);
  });
});
