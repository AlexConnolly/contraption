import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { createWorld, STEP } from '../src/sim/world.js';
import { World } from '../src/world/world.js';
import { Terrain } from '../src/world/terrain.js';
import { CHUNK, chunkKey } from '../src/world/format.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * Turning blocks into something you can see and drive on.
 *
 * A level makes one rigid body, one collider, one geometry and one material
 * per piece of scenery, which is why it is capped at 250 of them. A town is
 * thousands, so a chunk gets one instanced mesh per material and one body
 * carrying a collider per block — and none of it is touched again until that
 * chunk is edited.
 */

function rig({ cap } = {}) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const blocks = new World(cap ? { cap } : {});
  const terrain = new Terrain({
    RAPIER, world, scene, blocks,
  });
  return {
    world, scene, blocks, terrain,
  };
}

describe('building the world', () => {
  it('draws nothing until there is something to draw', () => {
    const { terrain } = rig();
    terrain.refresh();
    expect(terrain.chunkCount()).toBe(0);
  });

  it('builds a chunk once a block goes in it', () => {
    const { blocks, terrain } = rig();
    blocks.set(0, 0, 0, 1);
    terrain.refresh();
    expect(terrain.chunkCount()).toBe(1);
  });

  /**
   * The point of chunking: editing one block must not cost the world. Only
   * the chunk that changed is torn down and rebuilt.
   */
  it('rebuilds only the chunk that changed', () => {
    const { blocks, terrain } = rig();
    blocks.set(0, 0, 0, 1);
    blocks.set(CHUNK * 3, 0, 0, 1);
    terrain.refresh();
    const built = terrain.builds;
    blocks.set(1, 0, 0, 1);
    terrain.refresh();
    expect(terrain.builds - built, 'more than one chunk was rebuilt').toBe(1);
  });

  it('does no work at all when nothing has changed', () => {
    const { blocks, terrain } = rig();
    blocks.set(0, 0, 0, 1);
    terrain.refresh();
    const built = terrain.builds;
    terrain.refresh();
    terrain.refresh();
    expect(terrain.builds).toBe(built);
  });

  it('drops a chunk when its last block goes', () => {
    const { blocks, terrain } = rig();
    blocks.set(2, 3, 4, 1);
    terrain.refresh();
    expect(terrain.chunkCount()).toBe(1);
    blocks.set(2, 3, 4, 0);
    terrain.refresh();
    expect(terrain.chunkCount()).toBe(0);
  });

  /**
   * One mesh per material per chunk rather than one per block, which is the
   * difference between a town and a slideshow.
   */
  it('draws a chunk with one mesh per material, not one per block', () => {
    const { blocks, terrain } = rig();
    for (let x = 0; x < 10; x += 1) {
      for (let z = 0; z < 10; z += 1) blocks.set(x, 0, z, 1);
    }
    blocks.set(0, 1, 0, 2);
    terrain.refresh();
    expect(blocks.count()).toBe(101);
    expect(terrain.meshCount(), 'a mesh per block').toBe(2);
  });
});

describe('driving on it', () => {
  it('holds something up', () => {
    const { world, blocks, terrain } = rig();
    for (let x = -3; x <= 3; x += 1) {
      for (let z = -3; z <= 3; z += 1) blocks.set(x, 0, z, 1);
    }
    terrain.refresh();

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 6, 0),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.3, 0.3), body);
    for (let i = 0; i < Math.round(4 / STEP); i += 1) world.step();
    const rest = body.translation().y;
    expect(rest, `fell through to ${rest.toFixed(2)}`).toBeGreaterThan(0);
  }, 60000);

  it('stops holding it up once the ground is dug out', () => {
    const { world, blocks, terrain } = rig();
    for (let x = -3; x <= 3; x += 1) {
      for (let z = -3; z <= 3; z += 1) blocks.set(x, 0, z, 1);
    }
    terrain.refresh();
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.3, 0.3), body);
    for (let i = 0; i < Math.round(2 / STEP); i += 1) world.step();

    for (let x = -3; x <= 3; x += 1) {
      for (let z = -3; z <= 3; z += 1) blocks.set(x, 0, z, 0);
    }
    terrain.refresh();
    body.wakeUp();
    for (let i = 0; i < Math.round(3 / STEP); i += 1) world.step();
    expect(body.translation().y, 'the floor was removed and it stayed up').toBeLessThan(-2);
  }, 60000);
});

describe('clearing up', () => {
  it('leaves nothing behind', () => {
    const { world, scene, blocks, terrain } = rig();
    for (let x = 0; x < 20; x += 1) blocks.set(x, 0, 0, 1);
    terrain.refresh();
    expect(scene.children.length).toBeGreaterThan(0);
    const bodies = world.bodies.len();
    terrain.dispose();
    expect(terrain.chunkCount()).toBe(0);
    expect(scene.children.length).toBe(0);
    expect(world.bodies.len()).toBeLessThan(bodies);
  });

  it('knows which chunk a key belongs to', () => {
    expect(chunkKey(0, 0, 0)).toBe('0,0,0');
    expect(chunkKey(-1, 2, -3)).toBe('-1,2,-3');
  });
});
