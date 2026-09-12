import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { groupBlueprint } from '../src/sim/grouping.js';
import {
  getPart, springTravel, springStiffness, springDamping,
} from '../src/parts/registry.js';

function keyboard() {
  const down = new Set();
  return { down, isDown: (code) => down.has(code), wasPressed: () => false };
}

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * A weighted chassis sitting on two struts, dropped onto the ground. What the
 * springs do with that drop — how far the body sinks, how long it keeps
 * moving — is the whole part.
 */
function rig(config = {}, { drop = 1.2, load = 4 } = {}) {
  const world = createWorld(RAPIER);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(120, 1, 120).setTranslation(0, -1, 0)
      .setFriction(1).setCollisionGroups(GROUP_WORLD),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );

  const bp = new Blueprint({ name: 'sprung' });
  const put = (type, cell, rot, cfg) => {
    const out = bp.place(type, cell, rot, cfg);
    if (!out.ok) throw new Error(`${type} at ${cell} did not fit: ${out.reason}`);
  };
  // Chassis, with weight on it so the springs have something to carry.
  put('core', [0, 2, 0]);
  for (const x of [-1, 1]) put('block', [x, 2, 0]);
  for (let i = 0; i < load; i += 1) put('ballast', [i - 1, 3, 0]);
  // A strut under each end, each carrying a foot.
  for (const x of [-1, 1]) {
    put('suspension', [x, 1, 0], undefined, config);
    put('block', [x, 0, 0]);
  }

  const machine = new Machine({
    RAPIER, world, scene: new THREE.Scene(), blueprint: bp,
    spawn: new THREE.Vector3(0, drop, 0),
  });
  return { world, machine, bp, bus: new SignalBus(keyboard()) };
}

// How far the chassis sits above the foot, which is the strut's own length.
function ride({ machine, bp }) {
  const body = bp.list().find((p) => p.type === 'core');
  const foot = bp.list().filter((p) => p.type === 'block').find((p) => p.cell[1] === 0);
  return machine.partWorldPoint(body).y - machine.partWorldPoint(foot).y;
}

function settle(rigged, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    rigged.machine.update(STEP, rigged.bus);
    rigged.world.step();
  }
}

// Total up-and-down travel of the body after it has landed: a spring that is
// still working shows here, one that has gone solid does not.
function bounce(rigged, seconds = 2.5) {
  settle(rigged, 0.6);
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    rigged.machine.update(STEP, rigged.bus);
    rigged.world.step();
    const h = ride(rigged);
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  return high - low;
}

describe('the suspension strut', () => {
  it('is a part you can build with', () => {
    const part = getPart('suspension');
    expect(part.articulated).toBe(true);
    expect(part.joint).toBe('prismatic');
    expect(part.spring).toBe(true);
    expect(part.cost).toBeGreaterThan(0);
  });

  it('splits the machine at each strut and joints it back', () => {
    const grouping = groupBlueprint(rig().bp);
    expect(grouping.joints).toHaveLength(2);
    expect(grouping.joints.every((j) => j.type === 'prismatic')).toBe(true);
    expect(grouping.disconnected).toEqual([]);
    expect(grouping.seized).toEqual([]);
  });

  it('has settings for how stiff, how damped and how far', () => {
    const part = getPart('suspension');
    for (const range of [part.stiffnessRange, part.dampingRange, part.travelRange]) {
      expect(Array.isArray(range)).toBe(true);
      expect(range[0]).toBeLessThan(range[1]);
    }
  });

  it('falls back to the part default and refuses nonsense', () => {
    const part = getPart('suspension');
    expect(springStiffness({ config: {} })).toBe(part.stiffness);
    expect(springDamping({ config: {} })).toBe(part.damping);
    expect(springTravel({ config: {} })).toBe(part.travel);
    expect(springStiffness({ config: { stiffness: 1e9 } })).toBe(part.stiffnessRange[1]);
    expect(springTravel({ config: { travel: -4 } })).toBe(part.travelRange[0]);
    expect(springDamping({ config: { damping: 'soft' } })).toBe(part.damping);
  });
});

describe('what the spring actually does', () => {
  /**
   * The point of the thing. A soft spring lets the body down onto its load; a
   * stiff one holds it up. If these two come out the same, the setting is
   * decoration.
   */
  it('sits lower when it is softer', () => {
    const soft = rig({ stiffness: 300 });
    const stiff = rig({ stiffness: 6000 });
    settle(soft, 3);
    settle(stiff, 3);
    expect(ride(soft)).toBeLessThan(ride(stiff) - 0.05);
  });

  it('gives under a landing rather than taking it through the chassis', () => {
    const sprung = rig({ stiffness: 700, damping: 40 }, { drop: 3 });
    expect(bounce(sprung)).toBeGreaterThan(0.02);
  });

  /**
   * Damping is the difference between a spring and a pogo stick, and it is the
   * setting people reach for second.
   */
  it('keeps moving longer with less damping on it', () => {
    const loose = bounce(rig({ stiffness: 900, damping: 0 }, { drop: 3 }));
    const damped = bounce(rig({ stiffness: 900, damping: 500 }, { drop: 3 }));
    expect(loose).toBeGreaterThan(damped);
  });

  /**
   * Measured at the joint rather than between two points on the machine: a
   * chassis that is leaning would otherwise read as travel it never had.
   */
  it('never moves further than the travel it was given', () => {
    for (const travel of [0.12, 0.9]) {
      const sprung = rig({ travel, stiffness: 300 }, { drop: 3 });
      const strut = sprung.bp.list().find((p) => p.type === 'suspension');
      let worst = 0;
      for (let i = 0; i < Math.round(4 / STEP); i += 1) {
        sprung.machine.update(STEP, sprung.bus);
        sprung.world.step();
        worst = Math.max(worst, Math.abs(sprung.machine.strutTravel(strut.id)));
      }
      // Half the travel either way from where it was built, plus a little for
      // the solver overshooting a hard stop.
      expect(worst, `travel ${travel}`).toBeLessThan(travel / 2 + 0.05);
    }
  });

  it('reports how far it has moved, so a program can read it', () => {
    const sprung = rig({ stiffness: 500 }, { drop: 2.5 });
    const strut = sprung.bp.list().find((p) => p.type === 'suspension');
    settle(sprung, 0.05);
    let moved = 0;
    for (let i = 0; i < Math.round(2 / STEP); i += 1) {
      sprung.machine.update(STEP, sprung.bus);
      sprung.world.step();
      moved = Math.max(moved, Math.abs(sprung.machine.strutTravel(strut.id)));
    }
    expect(moved).toBeGreaterThan(0.01);
  });

  it('holds the machine up rather than letting it sink to the floor', () => {
    const sprung = rig({ stiffness: 2000 });
    settle(sprung, 3);
    expect(ride(sprung)).toBeGreaterThan(0.3);
  });
});
