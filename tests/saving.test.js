import {
  describe, it, expect, beforeEach,
} from 'vitest';

/**
 * Saving that says it worked when it did not.
 *
 * Everything the game remembers lives in one localStorage key, rewritten whole
 * on every save, and every saved machine carries a base64 thumbnail inside it.
 * So the quota is reachable — and `saveMachine` threw away what `write` told
 * it and handed back the entry regardless, so the garage reported a save it
 * had not made.
 */

let full = false;
const shelf = new Map();
globalThis.localStorage = {
  getItem: (key) => shelf.get(key) ?? null,
  setItem: (key, value) => {
    if (full) throw new DOMException('exceeded the quota', 'QuotaExceededError');
    shelf.set(key, String(value));
  },
  removeItem: (key) => { shelf.delete(key); },
};

const { store } = await import('../src/ui/progress.js');

const machine = (name) => ({ name, blueprint: { version: 1, name, parts: [] }, thumb: 'x' });

describe('saving a machine to the garage', () => {
  beforeEach(() => { full = false; shelf.clear(); });

  it('hands back the entry when it is written', () => {
    const saved = store.saveMachine(machine('Rover'));
    expect(saved).not.toBe(null);
    expect(store.machines().map((m) => m.name)).toEqual(['Rover']);
  });

  it('says so when there is no room, rather than pretending', () => {
    full = true;
    expect(store.saveMachine(machine('Rover')), 'reported a save it never made').toBe(null);
  });

  it('does not lose what was already there when a later save fails', () => {
    store.saveMachine(machine('First'));
    full = true;
    store.saveMachine(machine('Second'));
    full = false;
    expect(store.machines().map((m) => m.name)).toEqual(['First']);
  });
});

describe('saving a level somebody built', () => {
  beforeEach(() => { full = false; shelf.clear(); });

  it('says so when there is no room', () => {
    full = true;
    expect(store.saveCustomLevel({ id: 'c1', name: 'Mine', level: {} })).toBe(null);
  });

  it('hands back the record otherwise', () => {
    const saved = store.saveCustomLevel({ id: 'c1', name: 'Mine', level: {} });
    expect(saved?.id).toBe('c1');
  });
});
