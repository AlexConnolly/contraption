import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import { World } from '../src/world/world.js';
import { WorldEditor } from '../src/world/editor.js';
import { MATERIALS, BLOCK } from '../src/world/terrain.js';
import { WORLD_LIMITS } from '../src/world/format.js';

/**
 * Placing blocks in the world.
 *
 * The machine studio picks a cell by casting a ray at a build plate and the
 * parts already down; world building is the same idea against the ground plane
 * and the blocks already placed. What differs is that there is no build box
 * and no connectivity — a world is not a machine, blocks do not have to touch
 * anything, and the only rules are the world box and how many blocks a world
 * may hold.
 */

/** A ray as the camera would give it: an origin and a direction. */
const look = (from, at) => {
  const origin = new THREE.Vector3(...from);
  const dir = new THREE.Vector3(...at).sub(origin).normalize();
  return { origin, dir };
};

const editor = (blocks = new World()) => new WorldEditor({ blocks });

describe('aiming at the world', () => {
  it('picks the cell on the ground you are looking at', () => {
    const it0 = editor();
    const aim = it0.aim(look([0, 10, 0], [0, 0, 0]));
    expect(aim).not.toBe(null);
    expect(aim.cell).toEqual([0, 0, 0]);
  });

  it('picks the cell you are looking at further out', () => {
    const aim = editor().aim(look([0, 10, 0], [5.5, 0, -3.5]));
    expect(aim.cell).toEqual([5, 0, -4]);
  });

  /**
   * Looking at a block that is already there puts the next one against the
   * face you are looking at, which is how you build upwards at all.
   */
  it('stacks the next block on the face of the one you are looking at', () => {
    const blocks = new World();
    blocks.set(0, 0, 0, 1);
    const aim = editor(blocks).aim(look([0, 10, 0], [0.5, 0, 0.5]));
    expect(aim.cell).toEqual([0, 1, 0]);
    expect(aim.hit).toEqual([0, 0, 0]);
  });

  it('puts one against the side when you look at a side', () => {
    const blocks = new World();
    blocks.set(0, 0, 0, 1);
    const aim = editor(blocks).aim(look([6, 0.5, 0.5], [0.5, 0.5, 0.5]));
    expect(aim.cell).toEqual([1, 0, 0]);
  });

  it('finds nothing when you are looking at the sky', () => {
    expect(editor().aim(look([0, 2, 0], [0, 40, 0]))).toBe(null);
  });

  it('finds nothing past the edge of the world', () => {
    const far = WORLD_LIMITS.reach * 4;
    expect(editor().aim(look([0, 10, 0], [far, 0, far]))).toBe(null);
  });
});

describe('putting blocks down and taking them away', () => {
  it('puts down the material in hand', () => {
    const blocks = new World();
    const world = editor(blocks);
    world.material = 3;
    expect(world.place(look([0, 10, 0], [0, 0, 0]))).toBe(true);
    expect(blocks.get(0, 0, 0)).toBe(3);
  });

  it('takes away the one you are looking at, not the space in front of it', () => {
    const blocks = new World();
    blocks.set(0, 0, 0, 1);
    const world = editor(blocks);
    expect(world.remove(look([0, 10, 0], [0.5, 0, 0.5]))).toBe(true);
    expect(blocks.get(0, 0, 0)).toBe(0);
    expect(blocks.count()).toBe(0);
  });

  it('takes nothing away when there is nothing there', () => {
    const blocks = new World();
    expect(editor(blocks).remove(look([0, 10, 0], [0, 0, 0]))).toBe(false);
  });

  it('refuses to build past what a world may hold', () => {
    const blocks = new World({ cap: 2 });
    const world = editor(blocks);
    for (let x = 0; x < 5; x += 1) {
      world.place(look([x + 0.5, 10, 0.5], [x + 0.5, 0, 0.5]));
    }
    expect(blocks.count()).toBe(2);
  });

  it('paints a run of blocks in one drag', () => {
    const blocks = new World();
    const world = editor(blocks);
    world.material = 2;
    const put = world.line([0, 0, 0], [4, 0, 0]);
    expect(put).toBe(5);
    expect(blocks.count()).toBe(5);
    expect(blocks.get(2, 0, 0)).toBe(2);
  });

  it('fills a rectangle in one go', () => {
    const blocks = new World();
    const world = editor(blocks);
    expect(world.fill([0, 0, 0], [3, 1, 2])).toBe(4 * 2 * 3);
    expect(blocks.count()).toBe(24);
    expect(blocks.get(3, 1, 2)).toBe(1);
  });
});

describe('the materials you can build with', () => {
  it('are all real, and air is not one of them', () => {
    expect(MATERIALS[0]).toBe(null);
    for (let i = 1; i < MATERIALS.length; i += 1) {
      expect(MATERIALS[i].name, `material ${i}`).toBeTruthy();
      expect(Number.isFinite(MATERIALS[i].friction)).toBe(true);
    }
  });

  it('cover what the world format allows', () => {
    expect(MATERIALS.length - 1).toBe(WORLD_LIMITS.materials);
  });

  it('are a metre a block', () => {
    expect(BLOCK).toBe(1);
  });
});
