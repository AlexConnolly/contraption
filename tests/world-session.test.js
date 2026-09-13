import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { WorldSession, rayHitsBox, MODES } from '../src/world/session.js';
import { WORLD_LIMITS } from '../src/world/format.js';
import { STEP } from '../src/sim/world.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * An open world running.
 *
 * The campaign has one machine, one level and a way to win. This has as many
 * machines as you put down, a world you build yourself, and nothing to win —
 * so what there is to check is not "did it finish the course" but the things
 * a sandbox quietly gets wrong: machines that do not stay where you put them,
 * a world that stops running the moment you look away, and a save that comes
 * back as something other than what you left.
 */

/** A four-wheel rover that drives on W. */
function rover(name = 'Rover') {
  const bp = new Blueprint({ name });
  const other = yawStep(yawStep(IDENTITY_ORIENTATION));
  bp.place('panel', [0, 0, 0]);
  bp.place('core', [0, 1, 0]);
  for (const z of [-1, 1]) {
    bp.place('wheel', [2, 0, z], IDENTITY_ORIENTATION);
    bp.place('wheel', [-2, 0, z], other);
  }
  return bp;
}

const keys = (...codes) => ({
  isDown: (c) => codes.includes(c),
  wasPressed: () => false,
});

/** Looking straight down at a point on the ground, as a click would. */
const downAt = (x, z, from = 20) => ({
  origin: { x: x + 0.5, y: from, z: z + 0.5 },
  dir: { x: 0, y: -1, z: 0 },
});

const run = (session, seconds) => {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) session.step();
};

const open = (world = null) => new WorldSession({ RAPIER, world, headless: true });

describe('a new world', () => {
  it('opens empty, on a floor, with nothing standing in it', () => {
    const session = open();
    expect(session.counts()).toEqual({ blocks: 0, chunks: 0, vehicles: 0 });
    expect(session.ground).toBeTruthy();
    expect(session.mode).toBe('world');
    session.dispose();
  });

  it('starts in world-building, which is the only thing there is to do yet', () => {
    const session = open();
    expect(MODES).toContain(session.mode);
    expect(session.controlled()).toBe(null);
    session.dispose();
  });
});

describe('putting blocks down', () => {
  it('places one where the player is looking', () => {
    const session = open();
    expect(session.place(downAt(3, 4)).ok).toBe(true);
    expect(session.world.blocks.get(3, 0, 4)).toBe(1);
    expect(session.counts().chunks).toBe(1);
    session.dispose();
  });

  it('stacks the next one on top of the first', () => {
    const session = open();
    session.place(downAt(0, 0));
    session.place(downAt(0, 0));
    session.place(downAt(0, 0));
    expect(session.world.blocks.get(0, 2, 0)).toBe(1);
    expect(session.counts().blocks).toBe(3);
    session.dispose();
  });

  it('makes it solid without anybody asking the renderer to look', () => {
    const session = open();
    for (let y = 0; y < 4; y += 1) {
      for (let x = -3; x <= 3; x += 1) session.world.blocks.set(x, y, 8, 2);
    }
    const { member } = session.deploy({ blueprint: rover(), at: [0, 1.2, 0] });
    session.setMode('play');
    session.control(member.id, keys('KeyW'));
    run(session, 8);
    // Terrain carries the colliders as well as the meshes. Building it only
    // when something is drawn would give a headless host a world of scenery
    // you drive straight through.
    expect(member.machine.corePosition().z).toBeLessThan(8);
    session.dispose();
  }, 60000);

  it('takes one away again', () => {
    const session = open();
    session.place(downAt(2, 2));
    expect(session.erase(downAt(2, 2)).ok).toBe(true);
    expect(session.counts()).toMatchObject({ blocks: 0, chunks: 0 });
    session.dispose();
  });

  it('puts down whichever material is in hand', () => {
    const session = open();
    session.setMaterial(6);
    session.place(downAt(1, 1));
    expect(session.world.blocks.get(1, 0, 1)).toBe(6);
    session.dispose();
  });

  it('refuses a material that is not one, rather than making a hole', () => {
    const session = open();
    expect(session.setMaterial(0)).toBe(1);
    expect(session.setMaterial(99)).toBe(WORLD_LIMITS.materials);
    session.dispose();
  });

  it('says so when the world is full instead of silently doing nothing', () => {
    const session = open();
    // Straight into the store: a thousand ray casts to prove a cap is a
    // thousand ray casts nobody needs.
    let n = 0;
    for (let x = 0; n < WORLD_LIMITS.blocks; x += 1) {
      for (let z = 0; z < 100 && n < WORLD_LIMITS.blocks; z += 1) {
        session.world.blocks.set(x, 0, z, 1);
        n += 1;
      }
    }
    const refused = session.place(downAt(400, 400));
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/full/);
    session.dispose();
  });
});

describe('blocks you have placed are solid', () => {
  it('stops a machine that drives into them', () => {
    const session = open();
    // A wall four blocks high across the rover's path.
    for (let x = -3; x <= 3; x += 1) {
      for (let y = 0; y < 4; y += 1) session.world.blocks.set(x, y, 8, 2);
    }
    const { member } = session.deploy({ blueprint: rover(), at: [0, 1.2, 0] });
    session.setMode('play');
    session.control(member.id, keys('KeyW'));
    run(session, 8);
    const z = member.machine.corePosition().z;
    expect(z).toBeGreaterThan(2);
    expect(z).toBeLessThan(8);
    session.dispose();
  }, 60000);

  it('lets it drive on past once the wall is taken away', () => {
    const session = open();
    for (let x = -3; x <= 3; x += 1) {
      for (let y = 0; y < 4; y += 1) session.world.blocks.set(x, y, 8, 2);
    }
    const { member } = session.deploy({ blueprint: rover(), at: [0, 1.2, 0] });
    session.setMode('play');
    session.control(member.id, keys('KeyW'));
    run(session, 4);
    for (let x = -3; x <= 3; x += 1) {
      for (let y = 0; y < 4; y += 1) session.world.blocks.set(x, y, 8, 0);
    }
    run(session, 6);
    expect(member.machine.corePosition().z).toBeGreaterThan(10);
    session.dispose();
  }, 90000);
});

describe('putting machines down', () => {
  it('leaves each one where it was put, not on a shared spawn', () => {
    const session = open();
    const a = session.deploy({ blueprint: rover('A'), at: [-10, 1.2, 0] }).member;
    const b = session.deploy({ blueprint: rover('B'), at: [10, 1.2, 0] }).member;
    run(session, 1);
    expect(a.machine.corePosition().x).toBeLessThan(-8);
    expect(b.machine.corePosition().x).toBeGreaterThan(8);
    expect(session.counts().vehicles).toBe(2);
    session.dispose();
  }, 60000);

  it('puts it down facing the way it was asked to', () => {
    const session = open();
    const { member } = session.deploy({
      blueprint: rover(), at: [0, 1.2, 0], yaw: Math.PI / 2,
    });
    run(session, 0.2);
    expect(member.machine.coreForward().x).toBeGreaterThan(0.9);
    session.dispose();
  }, 30000);

  it('takes a copy, so editing in the garage does not reshape what is parked', () => {
    const session = open();
    const design = rover();
    const { member } = session.deploy({ blueprint: design, at: [0, 1.2, 0] });
    const before = member.machine.blueprint.size;
    design.place('block', [0, 2, 0]);
    expect(member.machine.blueprint.size).toBe(before);
    expect(design.size).toBe(before + 1);
    session.dispose();
  });

  it('refuses an empty build plate with a reason', () => {
    const session = open();
    const refused = session.deploy({ blueprint: new Blueprint(), at: [0, 1, 0] });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/nothing on the build plate/);
    session.dispose();
  });

  it('stops at the vehicle limit rather than filling the world', () => {
    const session = open();
    for (let i = 0; i < WORLD_LIMITS.vehicles; i += 1) {
      session.deploy({ blueprint: rover(), at: [i * 6, 1.2, 0] });
    }
    const refused = session.deploy({ blueprint: rover(), at: [0, 1.2, 40] });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/machines fit/);
    session.dispose();
  }, 60000);

  it('takes one away again without disturbing the rest', () => {
    const session = open();
    const a = session.deploy({ blueprint: rover('A'), at: [-10, 1.2, 0] }).member;
    const b = session.deploy({ blueprint: rover('B'), at: [10, 1.2, 0] }).member;
    run(session, 1);
    expect(session.remove(a.id)).toBe(true);
    expect(() => run(session, 1)).not.toThrow();
    expect(session.fleet.list().map((m) => m.id)).toEqual([b.id]);
    session.dispose();
  }, 60000);
});

describe('choosing which machine to drive', () => {
  it('picks the one being pointed at', () => {
    const session = open();
    const a = session.deploy({ blueprint: rover('A'), at: [-12, 1.2, 0] }).member;
    const b = session.deploy({ blueprint: rover('B'), at: [12, 1.2, 0] }).member;
    run(session, 0.5);
    expect(session.pick({
      origin: { x: -12, y: 18, z: 0 }, dir: { x: 0, y: -1, z: 0 },
    }).id).toBe(a.id);
    expect(session.pick({
      origin: { x: 12, y: 18, z: 0 }, dir: { x: 0, y: -1, z: 0 },
    }).id).toBe(b.id);
    session.dispose();
  }, 30000);

  it('picks the nearer of two in a line', () => {
    const session = open();
    const near = session.deploy({ blueprint: rover('Near'), at: [0, 1.2, -10] }).member;
    session.deploy({ blueprint: rover('Far'), at: [0, 1.2, 20] });
    run(session, 0.5);
    const hit = session.pick({
      origin: { x: 0, y: 1.2, z: -40 }, dir: { x: 0, y: 0, z: 1 },
    });
    expect(hit.id).toBe(near.id);
    session.dispose();
  }, 30000);

  it('picks nothing out of empty sky', () => {
    const session = open();
    session.deploy({ blueprint: rover(), at: [0, 1.2, 0] });
    run(session, 0.5);
    expect(session.pick({
      origin: { x: 0, y: 30, z: 0 }, dir: { x: 0, y: 1, z: 0 },
    })).toBe(null);
    session.dispose();
  }, 30000);

  it('hands the keys over, and only to one at a time', () => {
    const session = open();
    const a = session.deploy({ blueprint: rover('A'), at: [0, 1.2, -20] }).member;
    const b = session.deploy({ blueprint: rover('B'), at: [20, 1.2, -20] }).member;
    session.setMode('play');
    session.control(a.id, keys('KeyW'));
    run(session, 3);
    const parked = b.machine.corePosition().clone();
    expect(a.machine.corePosition().z).toBeGreaterThan(-18);
    expect(b.machine.corePosition().distanceTo(parked)).toBeLessThan(0.2);
    session.dispose();
  }, 60000);

  it('gives the keys back when you leave play, so nothing drives off alone', () => {
    const session = open();
    const { member } = session.deploy({ blueprint: rover(), at: [0, 1.2, -20] });
    session.setMode('play');
    session.control(member.id, keys('KeyW'));
    run(session, 2);
    session.setMode('world');
    expect(session.controlled()).toBe(null);
    const at = member.machine.corePosition().clone();
    run(session, 4);
    // It coasts to a stop rather than carrying on under a held key.
    expect(member.machine.corePosition().distanceTo(at)).toBeLessThan(6);
    session.dispose();
  }, 60000);
});

describe('the world keeps running whatever you are doing', () => {
  it('drops a machine onto the floor while the garage is open', () => {
    const session = open();
    session.setMode('garage');
    const { member } = session.deploy({ blueprint: rover(), at: [0, 9, 0] });
    const dropped = member.machine.corePosition().y;
    run(session, 3);
    expect(member.machine.corePosition().y).toBeLessThan(dropped - 5);
    expect(session.mode).toBe('garage');
    session.dispose();
  }, 60000);
});

describe('the clock', () => {
  it('turns wall-clock time into whole fixed steps', () => {
    const session = open();
    expect(session.advance(STEP * 3)).toBe(3);
    expect(session.tick).toBe(3);
    expect(session.elapsed).toBeCloseTo(STEP * 3, 6);
    session.dispose();
  });

  it('keeps the remainder for next time rather than rounding it away', () => {
    const session = open();
    session.advance(STEP * 1.5);
    session.advance(STEP * 0.6);
    expect(session.tick).toBe(2);
    session.dispose();
  });

  it('counts the time it could not keep up with instead of dropping it quietly', () => {
    const session = open();
    session.advance(1);
    expect(session.tick).toBe(5);
    expect(session.behind).toBeGreaterThan(0.8);
    session.dispose();
  });
});

describe('saving a world and opening it again', () => {
  it('brings back every block and every machine where it was left', () => {
    const session = open();
    for (let x = 0; x < 6; x += 1) session.place(downAt(x, 0));
    const { member } = session.deploy({
      blueprint: rover('Digger'), at: [4, 1.2, -6], yaw: Math.PI / 2,
    });
    session.setMode('play');
    session.control(member.id, keys('KeyW'));
    run(session, 3);
    const left = member.machine.corePosition().clone();

    const saved = session.snapshot();
    expect(saved.vehicles).toHaveLength(1);
    session.dispose();

    const reopened = new WorldSession({ RAPIER, world: saved, headless: true });
    expect(reopened.counts().blocks).toBe(6);
    expect(reopened.world.blocks.get(3, 0, 0)).toBe(1);
    expect(reopened.counts().vehicles).toBe(1);
    const back = reopened.fleet.list()[0];
    expect(back.name).toBe('Digger');
    run(reopened, 0.2);
    expect(back.machine.corePosition().distanceTo(left)).toBeLessThan(1.5);
    // It came back still facing the way it was driving.
    expect(back.machine.coreForward().x).toBeGreaterThan(0.8);
    reopened.dispose();
  }, 90000);

  it('keeps the name it was given', () => {
    const session = open();
    session.rename('Harbour');
    const saved = session.snapshot();
    expect(saved.name).toBe('Harbour');
    session.dispose();
    const reopened = new WorldSession({ RAPIER, world: saved, headless: true });
    expect(reopened.world.name).toBe('Harbour');
    reopened.dispose();
  });

  it('ignores a rename to nothing rather than losing the name', () => {
    const session = open();
    session.rename('Harbour');
    expect(session.rename('   ')).toBe('Harbour');
    expect(session.rename(null)).toBe('Harbour');
    session.dispose();
  });

  it('opens a world that arrived damaged instead of refusing to start', () => {
    const hostile = {
      name: 42,
      ground: 'huge',
      chunks: { 'bad key': [[3, 9]] },
      vehicles: [{ name: 'Ghost', blueprint: 'not a machine' }],
    };
    const session = new WorldSession({ RAPIER, world: hostile, headless: true });
    expect(session.counts().blocks).toBe(0);
    expect(session.counts().vehicles).toBe(0);
    expect(() => run(session, 0.5)).not.toThrow();
    session.dispose();
  }, 30000);
});

describe('the ray that decides what was clicked', () => {
  const box = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  );

  it('reports how far along the ray the box starts', () => {
    const t = rayHitsBox({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, box);
    expect(t).toBeCloseTo(9, 6);
  });

  it('misses a box the ray goes past', () => {
    expect(rayHitsBox({ x: 5, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, box)).toBe(null);
  });

  it('misses a box behind the ray', () => {
    expect(rayHitsBox({ x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 }, box)).toBe(null);
  });

  it('hits a box the ray starts inside, at no distance at all', () => {
    expect(rayHitsBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, box)).toBe(0);
  });
});
