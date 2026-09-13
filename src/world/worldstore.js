import { sanitiseWorld, worldJSON, WORLD_LIMITS } from './format.js';

/**
 * Where worlds are kept.
 *
 * Everything else the game remembers lives in one localStorage key that is
 * read, changed and written back whole on a 500 ms debounce, and already
 * carries a base64 thumbnail for every machine in the garage. A world is a
 * different size of thing: thousands of blocks, a list of vehicles with a
 * blueprint each, and several of them saved at once. Putting that through the
 * same key would rewrite every byte of a town on every autosave and reach the
 * quota within a few saves.
 *
 * So worlds go to IndexedDB, which stores structured data by key, writes one
 * record without touching the others, and has room measured in hundreds of
 * megabytes rather than five.
 *
 * Two stores, written in one transaction: the world itself, and a card — name,
 * when it was saved, how big it is. Listing the worlds reads only the cards,
 * so opening the picker does not deserialise a town per row.
 *
 * IndexedDB can be missing or refused outright — a private window may block
 * it, and a full disk aborts a write. Nothing here throws for that: it reports
 * that it could not, exactly as the localStorage store does, because a save
 * that claims to have worked is worse than one that admits it did not.
 */

const DB_NAME = 'contraption.worlds';
const VERSION = 1;
const WORLDS = 'worlds';
const CARDS = 'cards';

/** The most worlds one browser keeps. Beyond this the oldest is dropped. */
export const KEEP = 32;

const asPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error ?? new Error('IndexedDB refused the request'));
});

const settled = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve(true);
  tx.onerror = () => reject(tx.error ?? new Error('IndexedDB refused the write'));
  tx.onabort = () => reject(tx.error ?? new Error('IndexedDB abandoned the write'));
});

/** Two worlds saved in the same millisecond must not share an id. */
export function newWorldId() {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export class WorldStore {
  constructor({ idb = globalThis.indexedDB, name = DB_NAME, now = () => Date.now() } = {}) {
    this.idb = idb ?? null;
    this.name = name;
    this.now = now;
    this.db = null;
    this.opening = null;
  }

  get available() {
    return Boolean(this.idb);
  }

  /**
   * Opens the database once and hands the same one to everybody after that.
   * A refusal resolves to null rather than rejecting, so every caller has one
   * thing to check instead of a try around each.
   */
  async open() {
    if (this.db) return this.db;
    if (!this.idb) return null;
    if (!this.opening) {
      this.opening = new Promise((resolve) => {
        let req;
        try {
          req = this.idb.open(this.name, VERSION);
        } catch {
          resolve(null);
          return;
        }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(WORLDS)) db.createObjectStore(WORLDS, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(CARDS)) db.createObjectStore(CARDS, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      });
    }
    this.db = await this.opening;
    return this.db;
  }

  /** What is saved, newest first, without reading a single block. */
  async list() {
    const db = await this.open();
    if (!db) return [];
    try {
      const cards = await asPromise(db.transaction(CARDS, 'readonly').objectStore(CARDS).getAll());
      return cards.sort((a, b) => b.saved - a.saved);
    } catch {
      return [];
    }
  }

  /** One world, made safe on the way out — a saved file is still a file. */
  async load(id) {
    const db = await this.open();
    if (!db) return null;
    try {
      const record = await asPromise(
        db.transaction(WORLDS, 'readonly').objectStore(WORLDS).get(id),
      );
      if (!record?.data) return null;
      return { ...sanitiseWorld(record.data), id: record.id };
    } catch {
      return null;
    }
  }

  /**
   * Writes a world and its card together. Returns the card, or null when the
   * browser would not take it.
   */
  async save(world, { id = null } = {}) {
    const db = await this.open();
    if (!db) return null;
    const key = id ?? world.id ?? newWorldId();
    const data = worldJSON(world);
    const card = {
      id: key,
      name: data.name,
      saved: this.now(),
      blocks: world.blocks ? world.blocks.count() : 0,
      vehicles: data.vehicles.length,
    };
    try {
      const tx = db.transaction([WORLDS, CARDS], 'readwrite');
      tx.objectStore(WORLDS).put({ id: key, data });
      tx.objectStore(CARDS).put(card);
      await settled(tx);
    } catch {
      return null;
    }
    await this.trim();
    return card;
  }

  async remove(id) {
    const db = await this.open();
    if (!db) return false;
    try {
      const tx = db.transaction([WORLDS, CARDS], 'readwrite');
      tx.objectStore(WORLDS).delete(id);
      tx.objectStore(CARDS).delete(id);
      await settled(tx);
      return true;
    } catch {
      return false;
    }
  }

  /** Keeps the list from growing without end. The oldest go first. */
  async trim(keep = KEEP) {
    const cards = await this.list();
    if (cards.length <= keep) return 0;
    const spare = cards.slice(keep);
    for (const card of spare) await this.remove(card.id);
    return spare.length;
  }

  close() {
    this.db?.close();
    this.db = null;
    this.opening = null;
  }
}

/** A name that is not already taken, for "New world" pressed twice. */
export function freeName(cards, wanted = 'Untitled world') {
  const taken = new Set(cards.map((card) => card.name));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; n < 999; n += 1) {
    const tried = `${wanted} ${n}`.slice(0, WORLD_LIMITS.name);
    if (!taken.has(tried)) return tried;
  }
  return wanted;
}
