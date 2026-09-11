import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { createWorld, gravityOf } from '../src/sim/world.js';

const STEP = 1 / 60;

beforeAll(async () => { await RAPIER.init(); }, 30000);

function arenaFor(level, seed = 5) {
  const world = createWorld(RAPIER, gravityOf(level));
  const scene = new THREE.Scene();
  return { world, scene, arena: new Arena({ RAPIER, world, scene, level, seed }) };
}

function run(arena, world, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    world.step();
  }
}

const FLOOR = { spawn: [0, 1, 0], groundSize: 200, objectives: [] };
const crate = (over = {}) => ({
  id: 'crate', pos: [0, 6, 0], size: [1, 1, 1], mass: 4, colour: 0xc98b4b, ...over,
});

/**
 * Three numbers that re-ask every question the player has already answered. A
 * rover that works perfectly is useless on ice, and a drone that hovers
 * beautifully is a liability in a crosswind. No new parts, no new objectives.
 */
describe('gravity', () => {
  it('is ordinary when the level says nothing', () => {
    expect(gravityOf({})).toEqual({ x: 0, y: -9.81, z: 0 });
  });

  it('is whatever the level asks for', () => {
    expect(gravityOf({ gravity: -1.62 })).toEqual({ x: 0, y: -1.62, z: 0 });
    expect(gravityOf({ gravity: -19.6 })).toEqual({ x: 0, y: -19.6, z: 0 });
  });

  it('drops things slowly on a light world', () => {
    const light = arenaFor({ ...FLOOR, gravity: -1.62, props: [crate()] });
    const normal = arenaFor({ ...FLOOR, props: [crate()] });
    run(light.arena, light.world, 0.9);
    run(normal.arena, normal.world, 0.9);
    expect(light.arena.propPosition('crate').y)
      .toBeGreaterThan(normal.arena.propPosition('crate').y + 1);
  });

  it('drops things hard on a heavy one', () => {
    const heavy = arenaFor({ ...FLOOR, gravity: -19.6, props: [crate()] });
    const normal = arenaFor({ ...FLOOR, props: [crate()] });
    run(heavy.arena, heavy.world, 0.6);
    run(normal.arena, normal.world, 0.6);
    expect(heavy.arena.propPosition('crate').y)
      .toBeLessThan(normal.arena.propPosition('crate').y - 0.5);
  });
});

describe('friction', () => {
  it('lets a crate slide a long way on ice', () => {
    const icy = arenaFor({ ...FLOOR, friction: 0.02, props: [crate({ pos: [0, 0.6, 0], friction: 0.02 })] });
    const grippy = arenaFor({ ...FLOOR, props: [crate({ pos: [0, 0.6, 0] })] });
    for (const rig of [icy, grippy]) {
      run(rig.arena, rig.world, 0.5);
      rig.arena.props.get('crate').body.setLinvel({ x: 0, y: 0, z: 8 }, true);
      run(rig.arena, rig.world, 2.5);
    }
    expect(icy.arena.propPosition('crate').z)
      .toBeGreaterThan(grippy.arena.propPosition('crate').z + 3);
  });

  it('can be set on one surface rather than the whole world', () => {
    const level = {
      ...FLOOR,
      pieces: [{ pos: [0, 0.25, 6], size: [8, 0.5, 8], colour: 0x8899aa, friction: 0.02 }],
    };
    const { arena } = arenaFor(level);
    expect(arena.objects.some((o) => o.collider?.friction() < 0.1)).toBe(true);
  });
});

/**
 * Wind is an impulse rather than a force, because a machine clears its own
 * forces every step and a force applied here would be wiped before it did
 * anything. Impulses scale with mass, which is the whole point: a light drone
 * gets blown about and a heavy rover barely notices.
 */
describe('wind', () => {
  const gusty = {
    ...FLOOR,
    wind: [{ pos: [0, 8, 0], size: [40, 16, 40], dir: [1, 0, 0], force: 60 }],
    props: [crate({ pos: [0, 6, 0] })],
  };

  it('blows a thing sideways', () => {
    const { world, arena } = arenaFor(gusty);
    run(arena, world, 1.2);
    expect(arena.propPosition('crate').x).toBeGreaterThan(0.3);
  });

  it('leaves things outside the volume alone', () => {
    const { world, arena } = arenaFor({
      ...gusty,
      wind: [{ pos: [40, 8, 0], size: [10, 16, 10], dir: [1, 0, 0], force: 60 }],
    });
    run(arena, world, 1.2);
    expect(Math.abs(arena.propPosition('crate').x)).toBeLessThan(0.3);
  });

  it('pushes something light further than something heavy', () => {
    const light = arenaFor({ ...gusty, props: [crate({ pos: [0, 6, 0], mass: 2 })] });
    const heavy = arenaFor({ ...gusty, props: [crate({ pos: [0, 6, 0], mass: 60 })] });
    run(light.arena, light.world, 1.2);
    run(heavy.arena, heavy.world, 1.2);
    expect(light.arena.propPosition('crate').x)
      .toBeGreaterThan(heavy.arena.propPosition('crate').x * 2);
  });

  it('gusts rather than blowing at one steady strength', () => {
    const { world, arena } = arenaFor({
      ...gusty,
      wind: [{ pos: [0, 8, 0], size: [40, 16, 40], dir: [1, 0, 0], force: 60, gust: 0.8 }],
    });
    const seen = new Set();
    for (let i = 0; i < 240; i += 1) {
      seen.add(arena.windAt(arena.elapsed, arena.level.wind[0]).toFixed(3));
      run(arena, world, STEP);
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it('does nothing at all on a level with no wind', () => {
    const { world, arena } = arenaFor({ ...FLOOR, props: [crate({ pos: [0, 6, 0] })] });
    run(arena, world, 1.2);
    expect(Math.abs(arena.propPosition('crate').x)).toBeLessThan(0.05);
  });
});

describe('fog', () => {
  it('leaves the scene alone when the level says nothing', () => {
    const { scene } = arenaFor(FLOOR);
    expect(scene.fog).toBe(null);
  });

  it('closes the view down to what the level asks for', () => {
    const { scene } = arenaFor({ ...FLOOR, fog: { near: 1, far: 12, colour: 0x0b0f14 } });
    expect(scene.fog).not.toBe(null);
    expect(scene.fog.far).toBe(12);
    expect(scene.fog.near).toBe(1);
  });

  it('puts the view back when the course is torn down', () => {
    const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const before = new THREE.Fog(0x151a20, 32, 88);
    scene.fog = before;
    const arena = new Arena({
      RAPIER, world, scene, level: { ...FLOOR, fog: { near: 1, far: 12 } }, seed: 1,
    });
    expect(scene.fog.far).toBe(12);
    arena.dispose();
    expect(scene.fog).toBe(before);
  });
});
