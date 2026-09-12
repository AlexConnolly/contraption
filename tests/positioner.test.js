import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { groupBlueprint } from '../src/sim/grouping.js';
import {
  getPart, servoAngleA, servoAngleB, servoSpeed, shortestTurn,
} from '../src/parts/registry.js';

function keyboard() {
  const down = new Set();
  const pressed = new Set();
  return {
    down,
    isDown: (c) => down.has(c),
    wasPressed: (c) => pressed.delete(c),
    press: (c) => pressed.add(c),
  };
}

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * A servo on a post with an arm on it. Where the arm ends up, and how long it
 * takes to get there, is the whole part.
 */
function rig(config = {}) {
  const world = createWorld(RAPIER);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(120, 1, 120).setTranslation(0, -1, 0)
      .setFriction(1).setCollisionGroups(GROUP_WORLD),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
  const bp = new Blueprint({ name: 'servo' });
  const put = (type, cell, rot, cfg) => {
    const out = bp.place(type, cell, rot, cfg);
    if (!out.ok) throw new Error(`${type} at ${cell}: ${out.reason}`);
  };
  put('panel', [0, 0, 0]);
  put('core', [0, 1, 0]);
  for (const y of [2, 3]) put('block', [0, y, 0]);
  put('positioner', [0, 4, 0], undefined, {
    binding: { mode: 'toggle', pos: 'KeyC' },
    ...config,
  });
  put('block', [0, 5, 0]);
  put('block', [0, 6, 0]);

  const machine = new Machine({
    RAPIER, world, scene: new THREE.Scene(), blueprint: bp,
    spawn: new THREE.Vector3(0, 0.6, 0),
  });
  const input = keyboard();
  return { world, machine, bp, bus: new SignalBus(input), input };
}

const servoOf = (bp) => bp.list().find((p) => p.type === 'positioner');

// A servo holding a load settles a fraction of a degree off its mark, which is
// the price of commanding it by speed. Two degrees is the promise.
const NEAR = 2;
const isNear = (got, want) => expect(Math.abs(shortestTurn(got, want))).toBeLessThan(NEAR);

function settle(r, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    r.machine.update(STEP, r.bus);
    r.world.step();
  }
  return r.machine.jointAngle(servoOf(r.bp));
}

describe('the position servo', () => {
  it('is a part you can build with', () => {
    const part = getPart('positioner');
    expect(part.articulated).toBe(true);
    expect(part.joint).toBe('revolute');
    expect(part.cost).toBeGreaterThan(0);
  });

  it('has no limits, so the whole circle is reachable', () => {
    expect(getPart('positioner').limits).toBeUndefined();
  });

  it('joints onto the machine without seizing', () => {
    const g = groupBlueprint(rig().bp);
    expect(g.joints).toHaveLength(1);
    expect(g.disconnected).toEqual([]);
    expect(g.seized).toEqual([]);
  });

  it('takes both angles and a speed, and refuses nonsense', () => {
    const part = getPart('positioner');
    expect(servoAngleA({ config: {} })).toBe(part.angleA);
    expect(servoAngleB({ config: {} })).toBe(part.angleB);
    expect(servoSpeed({ config: {} })).toBe(part.speed);
    expect(servoAngleA({ config: { angleA: 9999 } })).toBe(part.angleRange[1]);
    expect(servoSpeed({ config: { speed: -5 } })).toBe(part.speedRange[0]);
    expect(servoSpeed({ config: { speed: 'fast' } })).toBe(part.speed);
  });
});

/**
 * The thing the part is for: it goes to a place and stops there, rather than
 * being held at an angle for as long as a key is down.
 */
describe('going to a set angle', () => {
  it('sits at A with nothing pressed', () => {
    isNear(settle(rig({ angleA: -50, angleB: 50 }), 2.5), -50);
  });

  it('goes to B when it is switched, and stays', () => {
    const r = rig({ angleA: -50, angleB: 50 });
    settle(r, 1.5);
    r.input.press('KeyC');
    isNear(settle(r, 2.5), 50);
    // And is still there a good while later, without the key held.
    isNear(settle(r, 3), 50);
  });

  it('comes back to A when it is switched again', () => {
    const r = rig({ angleA: -50, angleB: 50 });
    settle(r, 1.5);
    r.input.press('KeyC');
    settle(r, 2.5);
    r.input.press('KeyC');
    isNear(settle(r, 2.5), -50);
  });

  it('holds its mark rather than drifting off it', () => {
    const r = rig({ angleA: 30, angleB: -30 });
    const first = settle(r, 3);
    const later = settle(r, 6);
    expect(Math.abs(later - first)).toBeLessThan(2);
  });
});

describe('the short way round', () => {
  it('knows which way is shorter', () => {
    expect(shortestTurn(170, -170)).toBeCloseTo(20, 6);
    expect(shortestTurn(-170, 170)).toBeCloseTo(-20, 6);
    expect(shortestTurn(0, 90)).toBeCloseTo(90, 6);
    expect(shortestTurn(0, -90)).toBeCloseTo(-90, 6);
    expect(Math.abs(shortestTurn(0, 180))).toBeCloseTo(180, 6);
  });

  it('never proposes a journey longer than half a turn', () => {
    for (let from = -180; from <= 180; from += 7) {
      for (let to = -180; to <= 180; to += 11) {
        expect(Math.abs(shortestTurn(from, to))).toBeLessThanOrEqual(180.000001);
      }
    }
  });

  /**
   * Two angles either side of the back of the circle are twenty degrees apart
   * the short way and three hundred and forty the long way. Timing it is how
   * you tell which one it took.
   */
  it('crosses the back of the circle rather than going all the way round', () => {
    const r = rig({ angleA: 170, angleB: -170, speed: 90 });
    settle(r, 3);
    r.input.press('KeyC');
    // Twenty degrees at ninety a second is a quarter of a second. Even allowing
    // for winding up and settling, the long way round would take nearly four.
    isNear(settle(r, 1.2), -170);
  });

  it('gets there quicker the faster it is set to move', () => {
    const timeTo = (speed) => {
      const r = rig({ angleA: -80, angleB: 80, speed });
      settle(r, 2);
      r.input.press('KeyC');
      for (let i = 0; i < Math.round(6 / STEP); i += 1) {
        r.machine.update(STEP, r.bus);
        r.world.step();
        if (Math.abs(shortestTurn(r.machine.jointAngle(servoOf(r.bp)), 80)) < 4) return i * STEP;
      }
      return Infinity;
    };
    const slow = timeTo(45);
    const quick = timeTo(360);
    expect(quick).toBeLessThan(slow);
    expect(Number.isFinite(slow)).toBe(true);
  });

  it('does not overshoot its mark and come back round', () => {
    const r = rig({ angleA: 0, angleB: 120, speed: 720 });
    settle(r, 2);
    r.input.press('KeyC');
    let worst = 0;
    for (let i = 0; i < Math.round(3 / STEP); i += 1) {
      r.machine.update(STEP, r.bus);
      r.world.step();
      if (i > 60) worst = Math.max(worst, Math.abs(shortestTurn(r.machine.jointAngle(servoOf(r.bp)), 120)));
    }
    expect(worst).toBeLessThan(25);
  });
});

describe('a mirrored servo', () => {
  it('goes to the mirror of the angle, not the wrong way round', () => {
    const plain = settle(rig({ angleA: 60, angleB: -60 }), 3);
    const mirrored = settle(rig({ angleA: 60, angleB: -60, flip: true }), 3);
    isNear(plain, 60);
    isNear(mirrored, -60);
  });
});

/**
 * Whether this part makes the servo hinge redundant. It does not, and the
 * reason is worth pinning down rather than arguing about: a hinge with the
 * tension taken off is a free pivot — a swing, a trailing arm, anything that
 * is supposed to hang and move with the world. A position servo has no such
 * setting, because having one would make it a hinge. It is always going
 * somewhere.
 */
describe('why the hinge is still a different part', () => {
  it('always drives to its angle, however hard it is shoved', () => {
    const r = rig({ angleA: 0, angleB: 0, speed: 360 });
    settle(r, 2);
    const arm = r.bp.list().filter((p) => p.type === 'block').pop();
    r.machine.bodyOf(arm.id).applyImpulse({ x: 40, y: 0, z: 0 }, true);
    // Knocked off its mark, it comes straight back. A free pivot would swing.
    isNear(settle(r, 2.5), 0);
  });

  it('has no setting that lets it hang free', () => {
    const part = getPart('positioner');
    expect(part.tensionRange, 'a free-pivot setting would make it a hinge').toBeUndefined();
    expect(getPart('hinge').tensionRange[0], 'the hinge still has one').toBe(0);
  });

  it('reaches angles the hinge cannot', () => {
    const hinge = getPart('hinge');
    const beyond = (hinge.limits[1] * 180) / Math.PI + 20;
    expect(beyond).toBeLessThanOrEqual(getPart('positioner').angleRange[1]);
    isNear(settle(rig({ angleA: beyond, angleB: 0, speed: 360 }), 3), beyond);
  });
});
