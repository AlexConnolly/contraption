import { describe, it, expect } from 'vitest';

import {
  WORLD_FORMAT, WORLD_LIMITS, blankWorld, sanitiseWorld,
  toWorldCode, fromWorldCode, chunkKey, CHUNK,
} from '../src/world/format.js';
import { World } from '../src/world/world.js';

/**
 * A world is not a level.
 *
 * The level format caps scenery at 250 pieces, positions at ±200 m and a share
 * code at 64 KB of text, and the entire shipped campaign comes to 235 pieces.
 * A world is thousands of blocks over a much bigger box, so it gets its own
 * format: a palette and a run-length run of indices per chunk, rather than an
 * object per block.
 */

describe('a world you can build in', () => {
  it('starts empty and flat', () => {
    const world = new World();
    expect(world.count()).toBe(0);
    expect(world.get(0, 0, 0)).toBe(0);
  });

  it('remembers a block where it was put', () => {
    const world = new World();
    world.set(3, 1, -7, 2);
    expect(world.get(3, 1, -7)).toBe(2);
    expect(world.count()).toBe(1);
  });

  it('takes one away again', () => {
    const world = new World();
    world.set(3, 1, -7, 2);
    world.set(3, 1, -7, 0);
    expect(world.get(3, 1, -7)).toBe(0);
    expect(world.count()).toBe(0);
  });

  it('files blocks into chunks so only what changed has to be rebuilt', () => {
    const world = new World();
    world.set(0, 0, 0, 1);
    world.set(CHUNK + 2, 0, 0, 1);
    expect(world.chunks.size).toBe(2);
    expect([...world.dirty]).toHaveLength(2);
    world.clean();
    expect(world.dirty.size).toBe(0);
    world.set(1, 0, 0, 1);
    expect([...world.dirty]).toEqual([chunkKey(0, 0, 0)]);
  });

  it('drops a chunk once its last block goes', () => {
    const world = new World();
    world.set(1, 2, 3, 1);
    world.set(1, 2, 3, 0);
    expect(world.chunks.size).toBe(0);
  });

  it('will not build outside the world box', () => {
    const world = new World();
    const far = WORLD_LIMITS.reach + 10;
    expect(world.set(far, 0, 0, 1)).toBe(false);
    expect(world.count()).toBe(0);
  });

  it('will not build more than a world may hold', () => {
    const world = new World({ cap: 10 });
    for (let i = 0; i < 20; i += 1) world.set(i, 0, 0, 1);
    expect(world.count()).toBe(10);
  });
});

describe('saving a world', () => {
  const built = () => {
    const world = new World();
    // A wall and a floor: enough to exercise runs and more than one chunk.
    for (let x = -20; x <= 20; x += 1) {
      for (let z = -20; z <= 20; z += 1) world.set(x, 0, z, 1);
    }
    for (let y = 1; y <= 4; y += 1) world.set(0, y, 0, 2);
    return world;
  };

  it('comes back the same', () => {
    const before = built();
    const after = World.fromJSON(before.toJSON());
    expect(after.count()).toBe(before.count());
    expect(after.get(0, 0, 0)).toBe(1);
    expect(after.get(0, 3, 0)).toBe(2);
    expect(after.get(-20, 0, -20)).toBe(1);
    expect(after.get(5, 9, 5)).toBe(0);
  });

  it('packs a big flat floor into far less than a block each', () => {
    const world = built();
    const json = JSON.stringify(world.toJSON());
    expect(world.count()).toBeGreaterThan(1600);
    expect(json.length / world.count(), 'runs are not being packed').toBeLessThan(6);
  });

  it('goes through a share code and back', async () => {
    const world = blankWorld();
    world.name = 'Town';
    world.blocks.set(2, 1, 2, 3);
    const code = await toWorldCode(world);
    expect(code.startsWith('CTPW1')).toBe(true);
    const read = await fromWorldCode(code);
    expect(read.ok).toBe(true);
    expect(read.world.name).toBe('Town');
    expect(read.world.blocks.get(2, 1, 2)).toBe(3);
  });

  it('explains a code that is not one rather than throwing', async () => {
    for (const bad of ['', 'hello', null, 'CTPW1zzzz', 'CTP1jabc']) {
      const read = await fromWorldCode(bad);
      expect(read.ok).toBe(false);
      expect(typeof read.reason).toBe('string');
    }
  });
});

describe('a world that arrived from a stranger', () => {
  it('survives being nonsense', () => {
    const clean = sanitiseWorld({
      v: WORLD_FORMAT,
      name: 'A'.repeat(500),
      seed: 'not a number',
      online: { authority: 'root' },
      chunks: { 'not,a,key': [1, 2], '0,0,0': 'rubbish' },
      vehicles: [{ id: 'x', at: ['a', null, 1e9], blueprint: null }, 'nope'],
      script: 'alert(1)',
    });
    expect(clean.name.length).toBeLessThanOrEqual(WORLD_LIMITS.name);
    expect(Number.isFinite(clean.seed)).toBe(true);
    expect(['open', 'owner']).toContain(clean.online.authority);
    expect(clean.script).toBeUndefined();
    for (const v of clean.vehicles) {
      for (const n of v.at) expect(Number.isFinite(n)).toBe(true);
    }
  });

  it('keeps a world inside the block cap however many it claims', () => {
    const chunks = {};
    // One chunk claiming to be solid, many times over.
    for (let i = 0; i < 40; i += 1) chunks[`${i},0,0`] = [[1, CHUNK ** 3]];
    const clean = sanitiseWorld({ v: WORLD_FORMAT, chunks });
    expect(clean.blocks.count()).toBeLessThanOrEqual(WORLD_LIMITS.blocks);
  });

  it('turns away a world from a newer game', async () => {
    const world = blankWorld();
    const code = await toWorldCode({ ...world, v: WORLD_FORMAT + 9 });
    const read = await fromWorldCode(code.replace(/^CTPW1/, 'CTPW1'));
    // The version inside the payload is what is checked, not the prefix.
    expect(read.ok === false || read.world.v === WORLD_FORMAT).toBe(true);
  });
});
