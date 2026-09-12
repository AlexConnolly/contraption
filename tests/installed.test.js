import {
  describe, it, expect, beforeEach,
} from 'vitest';

// The store reads and writes localStorage, which node has not got. This is the
// whole of what it uses.
const shelf = new Map();
globalThis.localStorage = {
  getItem: (key) => shelf.get(key) ?? null,
  setItem: (key, value) => { shelf.set(key, String(value)); },
  removeItem: (key) => { shelf.delete(key); },
};

const { EXAMPLE_PACK, toPackCode, blankPack } = await import('../src/parts/packs.js');
const {
  installPack, installPackCode, removePack, installedPacks, loadPacks, usesPacks, packOf,
} = await import('../src/parts/installed.js');
const { allParts, getPart, findPart } = await import('../src/parts/registry.js');
const { Blueprint } = await import('../src/core/blueprint.js');

const packParts = () => allParts().filter((p) => p.pack);

describe('installing a pack', () => {
  beforeEach(() => {
    for (const pack of installedPacks()) removePack(pack.id);
    shelf.clear();
    for (const part of packParts()) removePack(part.pack);
  });

  it('puts its parts in the palette straight away', () => {
    const result = installPack(EXAMPLE_PACK);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(getPart('heavy-plant:tractor-wheel').name).toBe('Tractor Wheel');
  });

  it('takes them back out again straight away', () => {
    installPack(EXAMPLE_PACK);
    removePack('heavy-plant');
    expect(findPart('heavy-plant:tractor-wheel')).toBe(null);
    expect(installedPacks()).toEqual([]);
  });

  /**
   * The one that would have gone unnoticed: storage is sanitised again on
   * every read, so anything the sanitiser does that is not idempotent renames
   * every part on the second read and orphans every machine built with them.
   */
  it('gives a part the same name every time it is read back', () => {
    installPack(EXAMPLE_PACK);
    const first = installedPacks()[0].parts.map((p) => p.id);
    const second = installedPacks()[0].parts.map((p) => p.id);
    expect(second).toEqual(first);
    loadPacks();
    loadPacks();
    expect(allParts().filter((p) => p.id === first[0])).toHaveLength(1);
    expect(getPart(first[0])).toBeDefined();
  });

  it('replaces an earlier version of the same pack rather than stacking it', () => {
    installPack(EXAMPLE_PACK);
    installPack({ ...EXAMPLE_PACK, name: 'Heavier Plant', parts: [EXAMPLE_PACK.parts[0]] });
    expect(installedPacks()).toHaveLength(1);
    expect(installedPacks()[0].name).toBe('Heavier Plant');
    expect(packParts()).toHaveLength(1);
  });

  it('refuses a pack with nothing in it', () => {
    const result = installPack({ id: 'empty', name: 'Empty', parts: [] });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no parts/);
  });

  it('survives a reload, because storage is where it lives', () => {
    installPack(EXAMPLE_PACK);
    for (const part of packParts()) removePack(part.pack);
    // Storage was cleared by removePack, so put it back and load as boot does.
    installPack(EXAMPLE_PACK);
    const loaded = loadPacks();
    expect(loaded.map((p) => p.id)).toEqual(['heavy-plant']);
    expect(getPart('heavy-plant:long-ram').name).toBe('Long Ram');
  });

  it('says which pack a part came from', () => {
    installPack(EXAMPLE_PACK);
    expect(packOf(getPart('heavy-plant:long-ram')).name).toBe('Heavy Plant');
    expect(packOf(getPart('wheel'))).toBe(null);
  });

  it('installs one that arrived as a code', async () => {
    const code = await toPackCode(blankPack());
    const result = await installPackCode(code);
    expect(result.ok).toBe(true);
    expect(getPart('my-pack:my-wheel').name).toBe('My Wheel');
  });

  it('explains a code that is not one', async () => {
    const result = await installPackCode('CTP1zwhatever');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not look like a parts pack/);
  });
});

/**
 * A pack writes its own costs and masses, so a run using one is not measured
 * against the same thing as everyone else's. It is played, it is won, and it
 * does not go on the board — the line custom levels are already on.
 */
describe('a machine with pack parts on it', () => {
  beforeEach(() => {
    shelf.clear();
    for (const part of packParts()) removePack(part.pack);
    installPack(EXAMPLE_PACK);
  });

  it('is known to have them', () => {
    const bp = new Blueprint();
    bp.place('core', [0, 0, 0]);
    expect(usesPacks(bp)).toBe(false);
    bp.place('heavy-plant:tractor-wheel', [2, 0, 0]);
    expect(usesPacks(bp)).toBe(true);
  });

  /**
   * Removing a pack out from under a machine that is on the screen. Everything
   * downstream takes it for granted that a placed type can be looked up, so
   * the parts have to come off rather than be tolerated one call site at a
   * time.
   */
  it('loses those parts, and only those, when the pack goes', () => {
    const bp = new Blueprint();
    bp.place('core', [0, 0, 0]);
    bp.place('wheel', [2, 0, 0]);
    bp.place('heavy-plant:tractor-wheel', [-2, 0, 0]);
    expect(bp.size).toBe(3);

    removePack('heavy-plant');
    expect(bp.dropMissing()).toEqual(['heavy-plant:tractor-wheel']);
    expect(bp.size).toBe(2);
    expect(bp.list().map((p) => p.type).sort()).toEqual(['core', 'wheel']);
    expect(() => bp.cost()).not.toThrow();
    // And the cells it held are free again.
    expect(bp.place('wheel', [-2, 0, 0]).ok).toBe(true);
  });

  it('loses nothing when every part is still there', () => {
    const bp = new Blueprint();
    bp.place('core', [0, 0, 0]);
    bp.place('heavy-plant:tractor-wheel', [2, 0, 0]);
    expect(bp.dropMissing()).toEqual([]);
    expect(bp.size).toBe(2);
  });

  it('is not confused with one built out of the box', () => {
    const bp = new Blueprint();
    bp.place('core', [0, 0, 0]);
    bp.place('wheel', [2, 0, 0]);
    bp.place('piston', [0, 1, 0]);
    expect(usesPacks(bp)).toBe(false);
  });
});
