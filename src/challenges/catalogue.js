import { sanitiseLevel, LIMITS } from './format.js';

/**
 * Challenges that did not ship with the game.
 *
 * The campaign is ten packs compiled into the build, which means a new problem
 * costs a release and everybody has to download one. That is the wrong shape
 * for the thing this game is actually good at: the levels are the product, and
 * levels are small. A pack of a dozen is tens of kilobytes.
 *
 * So packs can also arrive from a catalogue over the wire. A catalogue is two
 * kinds of static file and nothing else — an index listing what exists, and one
 * file per pack — which means it can be hosted anywhere that serves bytes with
 * permissive CORS. GitHub Pages does, on a CDN, for nothing, which is where the
 * official one lives.
 *
 * Two rules hold this together and both matter more than they look.
 *
 * **Static files, never an API.** It is tempting to list packs by asking the
 * host what is in a directory. GitHub's API allows sixty unauthenticated calls
 * an hour *per address*, so a single office or campus would exhaust it between
 * them and the store would fail for everyone at once, intermittently, in a way
 * that looks like a bug in the game. An index built when the catalogue changes
 * is one cached file and has no such limit.
 *
 * **Source-agnostic.** A source is a name and a URL. The official catalogue is
 * one row in that list and has no privileges the format does not give it. Steam
 * Workshop, a shared drive, or a folder on disk are the same shape, so none of
 * them is a rewrite later.
 *
 * Everything that comes back is untrusted, including what comes back out of our
 * own cache, because a cache is a file on someone's machine. Levels go through
 * `sanitiseLevel` exactly as a share code does.
 */

export const CATALOGUE_FORMAT = 1;

/**
 * Caps, so a catalogue cannot be a denial of service.
 *
 * The byte limits are the important ones. Everything else here bounds how much
 * work a hostile file can make the game do; these bound how much of it we agree
 * to read at all, and they are checked against the declared length before the
 * body is touched as well as against what actually arrives, because a server
 * may lie about the first.
 */
export const CATALOGUE_LIMITS = {
  packs: 200,
  levels: 60,
  id: 40,
  name: 60,
  author: 40,
  note: 200,
  indexBytes: 256 * 1024,
  packBytes: 4 * 1024 * 1024,
};

/** How long a catalogue is worth believing before asking again. */
export const FRESH_FOR = 30 * 60 * 1000;

/** How long to wait on a host that has stopped answering. */
export const PATIENCE = 10000;

/**
 * The catalogue the game ships knowing about.
 *
 * Served from GitHub Pages rather than raw.githubusercontent.com: both send
 * `Access-Control-Allow-Origin: *`, but Pages is behind a CDN and caches for
 * ten minutes rather than five.
 */
export const OFFICIAL = Object.freeze({
  id: 'official',
  name: 'Official challenges',
  url: 'https://alexconnolly.github.io/contraption-challenges/',
  official: true,
});

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const slug = (value, max) => text(value, max).toLowerCase().replace(/[^a-z0-9-]/g, '');

const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);

/** The source's own directory, which is the only place its files may live. */
const rootOf = (source) => {
  const url = text(source?.url, 500);
  return url.endsWith('/') ? url : `${url}/`;
};

/**
 * A URL a pack may be fetched from, or null.
 *
 * Resolving against the source is not enough on its own, and getting this
 * wrong is the whole risk in the feature. `new URL(name, base)` honours an
 * absolute URL and discards the base, so an index that lists a full
 * `https://` address would send the game — and with it the address of whoever
 * is playing — anywhere the file asked. A catalogue describes its own
 * contents, so the answer has to land inside its own directory or it is not a
 * pack: that rules out another host, another user's Pages site, and climbing
 * out with `../` in one check rather than three.
 *
 * Only http and https, so `file:`, `data:` and `javascript:` never get as far
 * as the prefix test.
 */
export function packURL(source, file) {
  const name = text(file, 200);
  if (!name) return null;
  const root = rootOf(source);
  try {
    const at = new URL(name, root);
    if (at.protocol !== 'https:' && at.protocol !== 'http:') return null;
    return at.href.startsWith(root) ? at.href : null;
  } catch {
    return null;
  }
}

/**
 * The index of a catalogue: what packs exist, and enough about each to show a
 * row without fetching it.
 *
 * A pack with no id or no reachable file is dropped rather than repaired. An
 * unplayable level is worth salvaging because somebody wrote it; a row that
 * cannot name what it points at is not a row.
 */
export function sanitiseIndex(raw, { source } = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const from = source ?? OFFICIAL;

  const seen = new Set();
  const packs = [];
  for (const entry of list(input.packs, CATALOGUE_LIMITS.packs)) {
    const id = slug(entry?.id, CATALOGUE_LIMITS.id);
    const url = packURL(from, entry?.file);
    if (!id || !url || seen.has(id)) continue;
    seen.add(id);
    packs.push({
      id,
      url,
      source: from.id,
      name: text(entry?.name, CATALOGUE_LIMITS.name) || id,
      author: text(entry?.author, CATALOGUE_LIMITS.author),
      note: text(entry?.note, CATALOGUE_LIMITS.note),
      // What the row claims it holds. Believed for display only — the real
      // count is however many levels survive sanitising the pack itself.
      count: Number.isInteger(entry?.count)
        ? Math.max(0, Math.min(entry.count, CATALOGUE_LIMITS.levels))
        : 0,
      // Reactions counted when the catalogue was built. Static hosting cannot
      // total votes on demand, so this is a number baked in at build time
      // rather than anything live.
      likes: Number.isInteger(entry?.likes) ? Math.max(0, entry.likes) : 0,
      updated: text(entry?.updated, 40),
    });
  }

  return {
    v: CATALOGUE_FORMAT,
    source: from.id,
    name: text(input.name, CATALOGUE_LIMITS.name) || from.name,
    updated: text(input.updated, 40),
    packs,
  };
}

/**
 * One pack's levels, cleaned and ready to play.
 *
 * Ids are prefixed with the pack so a downloaded level can never shadow a
 * campaign one. `getLevel` falls back to the first campaign level when it does
 * not recognise an id, so a collision would silently hand somebody the wrong
 * problem and mark the wrong thing solved.
 */
export function sanitiseLevelPack(raw, { id, source } = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const at = slug(id ?? input.id, CATALOGUE_LIMITS.id) || 'pack';

  const levels = list(input.levels, CATALOGUE_LIMITS.levels).map((level, i) => {
    // Idempotent on purpose. The shelf sanitises on the way out of storage as
    // well as on the way in, so a pack is cleaned again on every boot: naming
    // blindly would prefix an already-prefixed id, the id would grow by a
    // segment each time the game started, and progress recorded against it
    // would come unstuck from the level it belongs to. Take the last segment,
    // which is the level's own name for itself however many times it has been
    // through here.
    const given = text(level?.id, CATALOGUE_LIMITS.id * 2);
    const own = slug(given.split('/').pop(), CATALOGUE_LIMITS.id) || `${i}`;
    return {
      ...sanitiseLevel(level, { id: `${at}/${own}` }),
      pack: at,
      source: source ?? null,
    };
  });

  return {
    id: at,
    source: source ?? null,
    name: text(input.name, CATALOGUE_LIMITS.name) || at,
    author: text(input.author, CATALOGUE_LIMITS.author),
    note: text(input.note, CATALOGUE_LIMITS.note),
    levels,
  };
}

/**
 * Reads a response without agreeing to read all of it.
 *
 * The declared length is checked first so an enormous file costs one header
 * rather than a download, and the body is checked again afterwards because a
 * server is free to have understated it.
 */
async function bodyOf(response, cap) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    throw new Error(`too big: ${declared} bytes`);
  }
  const body = await response.text();
  if (body.length > cap) throw new Error(`too big: ${body.length} bytes`);
  return body;
}

/**
 * Somewhere to keep what has been fetched.
 *
 * Offline is the normal case, not the exception: the game is meant to ship as
 * something you run, and a plane or a locked-down network must not empty the
 * challenge list. So a catalogue is cached whole, served from the cache
 * immediately, and only refreshed when it has gone stale.
 *
 * IndexedDB where it exists, memory where it does not, and a refusal is never
 * fatal — a private window that blocks storage gets a game that works and
 * forgets, which is the same bargain `WorldStore` makes.
 */
export const DB_NAME = 'contraption.catalogue';

/** What has been fetched, and what the player chose to keep. */
export const FILES = 'files';
export const SHELF = 'packs';

/**
 * Opens the catalogue database, or resolves null when the browser will not.
 *
 * Both stores are created together at version one, so adding the shelf later
 * never needs a migration on a machine that only ever had the cache.
 */
export function openCatalogueDB(idb = globalThis.indexedDB, name = DB_NAME) {
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request;
    try {
      request = idb.open(name, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'url' });
      if (!db.objectStoreNames.contains(SHELF)) db.createObjectStore(SHELF, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/** Reads one record out of a store, treating every refusal as "not there". */
export async function readRecord(db, store, key) {
  if (!db) return null;
  try {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    return await new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Writes one record, reporting whether it landed rather than throwing. */
export async function writeRecord(db, store, record, { remove = false } = {}) {
  if (!db) return false;
  try {
    const tx = db.transaction(store, 'readwrite');
    const at = tx.objectStore(store);
    if (remove) at.delete(record);
    else at.put(record);
    return await new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export class CatalogueCache {
  constructor({ idb = globalThis.indexedDB, name = DB_NAME, now = () => Date.now() } = {}) {
    this.idb = idb ?? null;
    this.name = name;
    this.now = now;
    this.memory = new Map();
    this.db = null;
    this.opening = null;
  }

  async open() {
    if (this.db || !this.idb) return this.db;
    this.opening ??= openCatalogueDB(this.idb, this.name);
    this.db = await this.opening;
    return this.db;
  }

  async get(url) {
    const held = this.memory.get(url);
    if (held) return held;
    const got = await readRecord(await this.open(), FILES, url);
    if (got) this.memory.set(url, got);
    return got;
  }

  async put(url, body) {
    const record = { url, body, at: this.now() };
    this.memory.set(url, record);
    return writeRecord(await this.open(), FILES, record);
  }
}

/**
 * The catalogues the game knows about, and what is in them.
 *
 * Every read answers from the cache when it has something, whether or not the
 * network is working, and reports how it answered. A store that says "offline,
 * showing what you had" is honest; one that shows an empty list because a
 * request timed out is not.
 */
export class Catalogue {
  constructor({
    fetch: fetcher = globalThis.fetch?.bind(globalThis),
    cache = new CatalogueCache(),
    now = () => Date.now(),
    patience = PATIENCE,
    fresh = FRESH_FOR,
  } = {}) {
    this.fetcher = fetcher ?? null;
    this.cache = cache;
    this.now = now;
    this.patience = patience;
    this.fresh = fresh;
  }

  /**
   * Fetches a file, falling back to whatever was cached.
   *
   * Returns the body and where it came from. `stale` is the interesting state:
   * we have content, it is older than we would like, and the network did not
   * give us anything better. That is a normal Tuesday on a train, and it is not
   * an error.
   */
  async file(url, cap, { force = false } = {}) {
    const held = await this.cache.get(url);
    const age = held ? this.now() - held.at : Infinity;
    if (held && !force && age < this.fresh) return { body: held.body, from: 'cache' };

    if (!this.fetcher) {
      return held ? { body: held.body, from: 'stale' } : { body: null, from: 'offline' };
    }

    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), this.patience);
    try {
      const response = await this.fetcher(url, { signal: stop.signal, redirect: 'follow' });
      if (!response?.ok) throw new Error(`${response?.status ?? '?'} from ${url}`);
      const body = await bodyOf(response, cap);
      await this.cache.put(url, body);
      return { body, from: 'network' };
    } catch (error) {
      if (held) return { body: held.body, from: 'stale', error };
      return { body: null, from: 'offline', error };
    } finally {
      clearTimeout(timer);
    }
  }

  /** What a source is offering, or an empty catalogue and the reason why. */
  async index(source = OFFICIAL, options = {}) {
    const at = packURL(source, 'index.json') ?? source.url;
    const got = await this.file(at, CATALOGUE_LIMITS.indexBytes, options);
    if (!got.body) {
      return { ...sanitiseIndex(null, { source }), from: got.from, error: got.error ?? null };
    }
    try {
      const parsed = JSON.parse(got.body);
      return { ...sanitiseIndex(parsed, { source }), from: got.from, error: got.error ?? null };
    } catch (error) {
      return { ...sanitiseIndex(null, { source }), from: 'broken', error };
    }
  }

  /** One pack's levels, by the row the index gave for it. */
  async pack(entry, options = {}) {
    if (!entry?.url) return null;
    const got = await this.file(entry.url, CATALOGUE_LIMITS.packBytes, options);
    if (!got.body) return null;
    try {
      return {
        ...sanitiseLevelPack(JSON.parse(got.body), { id: entry.id, source: entry.source }),
        from: got.from,
      };
    } catch {
      return null;
    }
  }
}

/**
 * What a catalogue file must look like, written out so the repository that
 * holds the official one can check itself with the same rules the game uses.
 */
export const EXAMPLE_INDEX = Object.freeze({
  v: CATALOGUE_FORMAT,
  name: 'Official challenges',
  updated: '2026-09-13',
  packs: [{
    id: 'harbour',
    name: 'Harbour',
    author: 'Construct It',
    note: 'Six problems on the dockside. Cranes, mostly.',
    count: 6,
    file: 'packs/harbour.json',
  }],
});

/** The levels in a pack, keyed the way the rest of the game expects them. */
export function levelsOf(packs) {
  return packs.flatMap((pack) => pack?.levels ?? []);
}

/** Caps a pack file must respect to be worth publishing at all. */
export function packProblems(pack) {
  const problems = [];
  if (!pack?.levels?.length) problems.push('the pack has no levels in it');
  if ((pack?.levels?.length ?? 0) > CATALOGUE_LIMITS.levels) {
    problems.push(`a pack holds at most ${CATALOGUE_LIMITS.levels} levels`);
  }
  for (const level of pack?.levels ?? []) {
    if (!level.objectives?.length) problems.push(`"${level.name}" asks the player for nothing`);
    if ((level.pieces?.length ?? 0) > LIMITS.pieces) {
      problems.push(`"${level.name}" has more than ${LIMITS.pieces} pieces`);
    }
  }
  return problems;
}
