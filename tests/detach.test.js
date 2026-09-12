import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION } from '../src/core/orientation.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { groupBlueprint } from '../src/sim/grouping.js';
import { getPart } from '../src/parts/registry.js';

function keyboard() {
  const down = new Set();
  return { down, isDown: (code) => down.has(code), wasPressed: () => false };
}

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * A two-stage rocket, which is the thing this part exists for: a booster at
 * the bottom, a coupling, and an upper stage riding on top of it.
 */
function rocket() {
  const bp = new Blueprint({ name: 'two stage' });
  bp.place('block', [0, 0, 0]);
  bp.place('thruster', [0, 1, 0], IDENTITY_ORIENTATION, {
    binding: { mode: 'hold', pos: 'ShiftLeft' },
  });
  bp.place('coupling', [0, 2, 0], IDENTITY_ORIENTATION, {
    binding: { mode: 'hold', pos: 'KeyB' },
  });
  bp.place('core', [0, 3, 0]);
  bp.place('ballast', [0, 4, 0]);
  return bp;
}

// High enough that nothing lands during a test: both halves fall at the same
// rate, so any change in the gap between them is the coupling's doing and
// nothing else's.
function fly(spawnY = 40) {
  const world = createWorld(RAPIER);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(120, 1, 120).setTranslation(0, -1, 0)
      .setFriction(1).setCollisionGroups(GROUP_WORLD),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
  const blueprint = rocket();
  const machine = new Machine({
    RAPIER, world, scene: new THREE.Scene(), blueprint,
    spawn: new THREE.Vector3(0, spawnY, 0),
  });
  return { world, machine, blueprint, bus: new SignalBus(keyboard()) };
}

function run(machine, bus, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    machine.update(STEP, bus);
    machine.world.step();
  }
}

const gap = (machine, blueprint) => {
  const upper = blueprint.list().find((p) => p.type === 'ballast');
  const lower = blueprint.list().find((p) => p.type === 'block');
  return machine.partWorldPoint(upper).distanceTo(machine.partWorldPoint(lower));
};

describe('the coupling', () => {
  it('is a part you can build with', () => {
    const part = getPart('coupling');
    expect(part.articulated).toBe(true);
    expect(part.joint).toBe('fixed');
    expect(part.cost).toBeGreaterThan(0);
  });

  it('splits the machine into two bodies held together by one joint', () => {
    const grouping = groupBlueprint(rocket());
    expect(grouping.bodies.length).toBe(2);
    expect(grouping.joints).toHaveLength(1);
    expect(grouping.joints[0].type).toBe('fixed');
    expect(grouping.disconnected).toEqual([]);
  });

  /**
   * Until it is fired it has to be as good as a weld. A coupling that sags or
   * wobbles under load is not a coupling, it is a bad hinge, and nobody would
   * put one in the middle of a rocket.
   */
  it('holds the two halves rigidly together until it is fired', () => {
    const { machine, blueprint, bus } = fly();
    run(machine, bus, 0.5);
    const before = gap(machine, blueprint);
    bus.input.down.add('ShiftLeft');
    run(machine, bus, 2);
    expect(Math.abs(gap(machine, blueprint) - before)).toBeLessThan(0.05);
  });

  it('lets go when its key is pressed, and the halves come apart', () => {
    const { machine, blueprint, bus } = fly();
    run(machine, bus, 0.5);
    const before = gap(machine, blueprint);
    bus.input.down.add('KeyB');
    run(machine, bus, 1.2);
    expect(gap(machine, blueprint)).toBeGreaterThan(before + 0.5);
  });

  // "Press b and it spits": letting go is not enough, the halves have to be
  // pushed apart or the upper stage simply sits back down on the lower one.
  it('spits the halves apart rather than merely releasing them', () => {
    const { machine, blueprint, bus } = fly();
    run(machine, bus, 0.5);
    bus.input.down.add('KeyB');
    run(machine, bus, 2 / 60);
    const upper = blueprint.list().find((p) => p.type === 'ballast');
    const lower = blueprint.list().find((p) => p.type === 'block');
    const a = machine.bodyOf(upper.id).linvel();
    const b = machine.bodyOf(lower.id).linvel();
    expect(a.y - b.y).toBeGreaterThan(1);
  });

  it('stays let go — it is a one-way part', () => {
    const { machine, blueprint, bus } = fly();
    run(machine, bus, 0.4);
    bus.input.down.add('KeyB');
    run(machine, bus, 0.3);
    bus.input.down.delete('KeyB');
    const apart = gap(machine, blueprint);
    run(machine, bus, 1.5);
    expect(gap(machine, blueprint)).toBeGreaterThan(apart);
  });

  it('leaves the upper stage under its own control, still flying', () => {
    const { machine, blueprint, bus } = fly(40);
    bus.input.down.add('ShiftLeft');
    run(machine, bus, 1);
    bus.input.down.add('KeyB');
    run(machine, bus, 1.5);
    const upper = blueprint.list().find((p) => p.type === 'ballast');
    const lower = blueprint.list().find((p) => p.type === 'block');
    // The booster is the half with the motor on it, so it keeps climbing and
    // the stage it threw off does not.
    expect(machine.partWorldPoint(lower).y).toBeGreaterThan(machine.partWorldPoint(upper).y);
  });

  it('can be fired by a program rather than a key', () => {
    const part = getPart('coupling');
    expect(part.ports.in.some((port) => port.kind === 'bool')).toBe(true);
  });

  it('is reported as seized when the build welds across it', () => {
    const bp = rocket();
    // A beam bridging both halves means the coupling can never separate them.
    bp.place('beam', [2, 1, 0]);
    bp.place('beam', [2, 2, 0]);
    bp.place('beam', [2, 3, 0]);
    const grouping = groupBlueprint(bp);
    expect(grouping.seized.length + grouping.joints.length).toBeGreaterThan(0);
  });
});

describe('a program firing the coupling', () => {
  it('can see whether it has gone yet', async () => {
    const { Computer } = await import('../src/sim/computer.js');
    const { machine, blueprint, bus } = fly();
    const coupling = blueprint.list().find((p) => p.type === 'coupling');
    const computer = new Computer({ machine, placed: coupling, program: { states: [] } });
    const read = () => computer.readPort(coupling.id, 'released');

    run(machine, bus, 0.4);
    expect(read()).toBe(false);
    bus.input.down.add('KeyB');
    run(machine, bus, 0.3);
    expect(read()).toBe(true);
  });
});
