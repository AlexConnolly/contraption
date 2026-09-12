import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { CELL } from '../src/parts/registry.js';
import { LEVELS } from '../src/challenges/levels.js';
import { Arena } from '../src/sim/arena.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

// How far the machine's own extremes sit either side of the point it was put
// down on. A machine centred on its spawn reaches the same distance each way.
function reachAroundSpawn(blueprint, spawn = new THREE.Vector3(0, 2, 0)) {
  const world = createWorld(RAPIER);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(200, 1, 200).setTranslation(0, -1, 0)
      .setCollisionGroups(GROUP_WORLD),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
  const machine = new Machine({
    RAPIER, world, scene: new THREE.Scene(), blueprint, spawn,
  });
  const box = new THREE.Box3();
  for (const placed of blueprint.list()) box.expandByPoint(machine.partWorldPoint(placed));
  return {
    left: spawn.x - box.min.x,
    right: box.max.x - spawn.x,
    back: spawn.z - box.min.z,
    front: box.max.z - spawn.z,
  };
}

/**
 * A heavy body at one end and a thin arm off the other — a crane, in other
 * words. Most of its parts are in the blob, so the average of where the parts
 * are sits nowhere near the middle of what it actually occupies.
 */
function lopsided(arm = 12) {
  const bp = new Blueprint({ name: 'lopsided', bounds: { min: [-40, 0, -40], max: [40, 40, 40] } });
  bp.place('core', [0, 0, 0]);
  for (let x = -4; x <= 0; x += 1) {
    for (let z = -2; z <= 2; z += 1) {
      if (x === 0 && z === 0) continue;
      bp.place('block', [x, 0, z]);
    }
  }
  for (let x = 1; x <= arm; x += 1) bp.place('block', [x, 0, 0]);
  return bp;
}

/**
 * A machine is put down centred on the spawn point. It used to be centred on
 * the average of where its parts were, which is not the same thing at all: a
 * body with one long arm has most of its parts at one end, so the average sits
 * out near the arm and the machine lands well off the mark. Build something
 * big and one side of it is in a wall before you have touched the controls.
 */
describe('where a machine lands', () => {
  it('reaches the same distance either side of its spawn', () => {
    const reach = reachAroundSpawn(lopsided(12));
    expect(Math.abs(reach.left - reach.right)).toBeLessThan(CELL);
  });

  it('is not thrown off by an arm on one side', () => {
    for (const arm of [4, 12, 24]) {
      const reach = reachAroundSpawn(lopsided(arm));
      expect(Math.abs(reach.left - reach.right), `arm ${arm}`).toBeLessThan(CELL);
    }
  });

  it('still lands on the spawn for something symmetrical', () => {
    const bp = new Blueprint({ name: 'even' });
    bp.place('core', [0, 0, 0]);
    for (const x of [-2, -1, 1, 2]) bp.place('block', [x, 0, 0]);
    const reach = reachAroundSpawn(bp);
    expect(Math.abs(reach.left - reach.right)).toBeLessThan(CELL);
  });

  it('sits on top of the spawn rather than sunk into it', () => {
    const bp = new Blueprint({ name: 'tall' });
    bp.place('core', [0, 0, 0]);
    for (const y of [1, 2, 3]) bp.place('block', [0, y, 0]);
    const spawn = new THREE.Vector3(0, 2, 0);
    const world = createWorld(RAPIER);
    const machine = new Machine({
      RAPIER, world, scene: new THREE.Scene(), blueprint: bp, spawn,
    });
    const low = bp.list().reduce(
      (least, p) => Math.min(least, machine.partWorldPoint(p).y), Infinity,
    );
    expect(low).toBeGreaterThanOrEqual(spawn.y - CELL);
  });
});

/**
 * The build plate is thirty metres across, so anything you can build can be
 * thirty metres across, and every course has to be able to take it. A machine
 * that is in a wall the moment it is put down is not a puzzle.
 */
describe('every level has room to put a machine down', () => {
  const NEEDED = 15;

  function clearance(level) {
    const [sx, , sz] = level.spawn;
    let worst = Infinity;
    for (const piece of level.pieces ?? []) {
      // The machine stands on the spawn plane and rises from it, so anything
      // entirely below that plane is floor to drive on rather than wall to hit,
      // and anything high above it is a gantry to pass under.
      const top = piece.pos[1] + piece.size[1] / 2;
      const bottom = piece.pos[1] - piece.size[1] / 2;
      if (top <= level.spawn[1] + 0.01 || bottom >= level.spawn[1] + 6) continue;
      const dx = Math.max(0, Math.abs(sx - piece.pos[0]) - piece.size[0] / 2);
      const dz = Math.max(0, Math.abs(sz - piece.pos[2]) - piece.size[2] / 2);
      worst = Math.min(worst, Math.max(dx, dz));
    }
    return worst;
  }

  for (const level of LEVELS) {
    it(`${level.id} has 30 m of open ground at the spawn`, () => {
      expect(clearance(level), `${level.id} is boxed in`).toBeGreaterThanOrEqual(NEEDED);
    });
  }
});

/**
 * Anything riding on something that moves has to be on it when the level
 * loads. Movers used to be given a free starting phase, so a tray could be
 * anywhere along its run at the instant the course appeared while its load was
 * placed where the level drew it. The tray is 4.6 m wide and the load has to
 * start within 1.8 m of its centre; the tray could start 4.5 m from where it
 * was drawn. Most runs therefore began with the load already off the tray.
 */
describe('a load that rides on a mover', () => {
  function lowestPayload(level, seed, seconds = 12) {
    const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
    const arena = new Arena({ RAPIER, world, scene: new THREE.Scene(), level, seed });
    let low = Infinity;
    for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
      arena.step(STEP);
      world.step();
      low = Math.min(low, arena.propPosition(level.props[0].id).y);
    }
    return low;
  }

  const carriers = LEVELS.filter((l) => (l.movers ?? []).some((m) => m.group) && l.props?.length);

  it('has levels where something is carried', () => {
    expect(carriers.length).toBeGreaterThan(0);
  });

  for (const level of carriers) {
    it(`${level.id} starts its load on the tray, whatever the run`, () => {
      for (let seed = 1; seed <= 12; seed += 1) {
        const start = level.props[0].pos[1];
        expect(lowestPayload(level, seed), `${level.id} seed ${seed} dropped it`)
          .toBeGreaterThan(start - 1);
      }
    }, 120000);
  }
});

describe('movers set off from where they are drawn', () => {
  it('never starts one displaced along its run', () => {
    const level = LEVELS.find((l) => l.id === 'roundabout');
    for (let seed = 1; seed <= 12; seed += 1) {
      const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
      const arena = new Arena({ RAPIER, world, scene: new THREE.Scene(), level, seed });
      arena.step(0);
      const at = arena.movers[0].body.translation();
      expect(Math.abs(at.x - level.movers[0].pos[0]), `seed ${seed}`).toBeLessThan(0.01);
    }
  }, 120000);
});
