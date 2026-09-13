import {
  describe, it, expect, beforeEach,
} from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { WorldStore, freeName, KEEP } from '../src/world/worldstore.js';
import { blankWorld, WORLD_LIMITS } from '../src/world/format.js';

/**
 * Worlds kept between sessions.
 *
 * The garage goes in one localStorage key that is rewritten whole every time
 * anything changes. A town is thousands of blocks and there are several of
 * them, so worlds go to IndexedDB instead — one record written without
 * touching the others, and room measured in hundreds of megabytes.
 *
 * The thing being proved here is mostly the unhappy half: a browser that will
 * not give you IndexedDB at all, and a write it refuses partway through. Both
 * have to come back as "no", never as a save that quietly did not happen.
 */

/** A world with a floor and a wall in it, so there is something to lose. */
function town(name = 'Town') {
  const world = blankWorld();
  world.name = name;
  for (let x = 0; x < 10; x += 1) {
    for (let z = 0; z < 10; z += 1) world.blocks.set(x, 0, z, 6);
  }
  for (let y = 1; y < 4; y += 1) world.blocks.set(0, y, 0, 3);
  return world;
}

let store;
let clock;

beforeEach(() => {
  clock = 1000;
  store = new WorldStore({
    idb: new IDBFactory(),
    name: 'test.worlds',
    now: () => { clock += 1000; return clock; },
  });
});

describe('saving a world', () => {
  it('hands back a card describing what was written', async () => {
    const card = await store.save(town('Harbour'));
    expect(card.name).toBe('Harbour');
    expect(card.blocks).toBe(103);
    expect(card.vehicles).toBe(0);
    expect(card.id).toMatch(/^w/);
  });

  it('loads it back with every block where it was', async () => {
    const card = await store.save(town());
    const back = await store.load(card.id);
    expect(back.blocks.count()).toBe(103);
    expect(back.blocks.get(0, 3, 0)).toBe(3);
    expect(back.blocks.get(9, 0, 9)).toBe(6);
    expect(back.blocks.get(5, 5, 5)).toBe(0);
    expect(back.id).toBe(card.id);
  });

  it('keeps the name, spawn and authority', async () => {
    const world = town('Deeptown');
    world.spawn = [4, 9, -2];
    world.online = { authority: 'open' };
    const card = await store.save(world);
    const back = await store.load(card.id);
    expect(back.name).toBe('Deeptown');
    expect(back.spawn).toEqual([4, 9, -2]);
    expect(back.online.authority).toBe('open');
  });

  it('saves the vehicles parked in it', async () => {
    const world = town();
    world.vehicles = [{
      id: 'v1', name: 'Rover', at: [2, 1, 3], rot: 0, blueprint: { version: 1, parts: [] },
    }];
    const card = await store.save(world);
    expect(card.vehicles).toBe(1);
    const back = await store.load(card.id);
    expect(back.vehicles[0].name).toBe('Rover');
    expect(back.vehicles[0].at).toEqual([2, 1, 3]);
  });

  it('replaces a world saved under the same id rather than making a second', async () => {
    const first = await store.save(town('Draft'));
    const grown = town('Draft');
    grown.blocks.set(20, 0, 20, 5);
    await store.save(grown, { id: first.id });
    const cards = await store.list();
    expect(cards).toHaveLength(1);
    expect(cards[0].blocks).toBe(104);
  });

  it('lists the newest first', async () => {
    await store.save(town('One'));
    await store.save(town('Two'));
    await store.save(town('Three'));
    const cards = await store.list();
    expect(cards.map((c) => c.name)).toEqual(['Three', 'Two', 'One']);
  });

  it('forgets the oldest once there are too many', async () => {
    for (let i = 0; i < KEEP + 3; i += 1) await store.save(town(`W${i}`));
    const cards = await store.list();
    expect(cards).toHaveLength(KEEP);
    expect(cards.at(-1).name).toBe(`W${3}`);
  });
});

describe('removing a world', () => {
  it('takes out the card and the blocks together', async () => {
    const card = await store.save(town());
    expect(await store.remove(card.id)).toBe(true);
    expect(await store.list()).toEqual([]);
    expect(await store.load(card.id)).toBe(null);
  });
});

describe('a world that is not there', () => {
  it('loads as nothing rather than throwing', async () => {
    expect(await store.load('nope')).toBe(null);
  });
});

describe('a saved world is still a stranger', () => {
  it('goes through the sanitiser on the way out', async () => {
    const card = await store.save(town());
    const db = await store.open();
    const tx = db.transaction('worlds', 'readwrite');
    tx.objectStore('worlds').put({
      id: card.id,
      data: {
        v: 1,
        name: 'x'.repeat(500),
        spawn: [99999, 99999, 99999],
        chunks: { 'not a key': [[1, 2]] },
        vehicles: 'lots',
      },
    });
    await new Promise((resolve) => { tx.oncomplete = resolve; });

    const back = await store.load(card.id);
    expect(back.name).toHaveLength(WORLD_LIMITS.name);
    expect(back.spawn[0]).toBe(WORLD_LIMITS.reach);
    expect(back.blocks.count()).toBe(0);
    expect(back.vehicles).toEqual([]);
  });
});

describe('a browser that will not have it', () => {
  it('says it is unavailable instead of throwing', async () => {
    const blocked = new WorldStore({ idb: null });
    expect(blocked.available).toBe(false);
    expect(await blocked.list()).toEqual([]);
    expect(await blocked.load('anything')).toBe(null);
    expect(await blocked.save(town())).toBe(null);
    expect(await blocked.remove('anything')).toBe(false);
  });

  it('treats an open that is refused as unavailable', async () => {
    const refusing = {
      open() {
        const req = {};
        queueMicrotask(() => { req.error = new Error('denied'); req.onerror?.(); });
        return req;
      },
    };
    const store2 = new WorldStore({ idb: refusing });
    expect(await store2.save(town())).toBe(null);
    expect(await store2.list()).toEqual([]);
  });

  it('treats an open that throws outright as unavailable', async () => {
    const hostile = { open() { throw new DOMException('blocked', 'SecurityError'); } };
    expect(await new WorldStore({ idb: hostile }).save(town())).toBe(null);
  });
});

describe('a write the browser abandons', () => {
  it('comes back as null rather than a card', async () => {
    const card = await store.save(town());
    const db = await store.open();
    const real = db.transaction.bind(db);
    db.transaction = (...args) => {
      const tx = real(...args);
      if (args[1] !== 'readwrite') return tx;
      queueMicrotask(() => tx.abort());
      return tx;
    };
    expect(await store.save(town('Lost'), { id: card.id })).toBe(null);
    db.transaction = real;
    const back = await store.load(card.id);
    expect(back.name).toBe('Town');
  });
});

describe('naming a new world', () => {
  it('leaves a free name alone', () => {
    expect(freeName([{ name: 'Harbour' }], 'Town')).toBe('Town');
  });

  it('counts up past one already taken', () => {
    const cards = [{ name: 'Town' }, { name: 'Town 2' }];
    expect(freeName(cards, 'Town')).toBe('Town 3');
  });
});
