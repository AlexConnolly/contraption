import { describe, it, expect } from 'vitest';

import {
  Catalogue,
  CatalogueCache,
  CATALOGUE_LIMITS,
  EXAMPLE_INDEX,
  OFFICIAL,
  levelsOf,
  packProblems,
  packURL,
  sanitiseIndex,
  sanitiseLevelPack,
} from '../src/challenges/catalogue.js';
import { LEVELS, getLevel } from '../src/challenges/levels.js';

/**
 * Challenges fetched from somewhere else.
 *
 * Two things are being checked here and they pull in opposite directions. A
 * catalogue has to be able to add levels to a game somebody already installed,
 * which means trusting a file off the internet enough to play it; and it must
 * not be able to do anything else at all, which means trusting it with nothing.
 *
 * The dangerous half is the index, because an index is a list of URLs and a
 * list of URLs is an instruction about where to go next. Everything below that
 * comes down to the same question asked several ways: can a file we did not
 * write make the game fetch, shadow, or swallow something it should not.
 */

/** A response, near enough for the one thing the code asks of it. */
const reply = (body, { ok = true, status = 200, length = null } = {}) => ({
  ok,
  status,
  headers: { get: (key) => (key.toLowerCase() === 'content-length' ? length : null) },
  text: async () => body,
});

/** A fetcher serving a fixed map of URLs, counting what was asked for. */
function server(files) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const at = files[url];
    if (at === undefined) return reply('', { ok: false, status: 404 });
    if (typeof at === 'function') return at(url);
    return reply(typeof at === 'string' ? at : JSON.stringify(at));
  };
  fetcher.calls = calls;
  return fetcher;
}

const INDEX_URL = `${OFFICIAL.url}index.json`;
const PACK_URL = `${OFFICIAL.url}packs/harbour.json`;

const HARBOUR = {
  v: 1,
  id: 'harbour',
  name: 'Harbour',
  levels: [{
    name: 'Crane the crate',
    brief: 'Put the crate on the barge.',
    spawn: [0, 1, -8],
    props: [{ id: 'crate', pos: [0, 0.6, 0] }],
    zones: [{ id: 'barge', pos: [0, 1, 9] }],
    objectives: [{ type: 'propInZone', prop: 'crate', zone: 'barge', hold: 2 }],
  }],
};

/** A catalogue wired to a fixed set of files and its own clock. */
function catalogue(files, { at = () => 1000, ...rest } = {}) {
  const fetcher = server(files);
  const store = new Catalogue({
    fetch: fetcher,
    cache: new CatalogueCache({ idb: null, now: at }),
    now: at,
    ...rest,
  });
  store.fetcher = fetcher;
  return store;
}

describe('where an index is allowed to point', () => {
  it('is at its own catalogue, and nowhere else', () => {
    const clean = sanitiseIndex({
      packs: [
        { id: 'ours', file: 'packs/ours.json' },
        { id: 'theirs', file: 'https://example.invalid/evil.json' },
      ],
    }, { source: OFFICIAL });

    expect(clean.packs.map((p) => p.id)).toEqual(['ours']);
    expect(clean.packs[0].url).toBe(PACK_URL.replace('harbour', 'ours'));
  });

  it('is not at a script, or at the player of the disk', () => {
    for (const file of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/json,{}']) {
      expect(packURL(OFFICIAL, file)).toBeNull();
    }
  });

  it('is not somewhere else on the same host, reached by climbing out', () => {
    // Sharing github.io with every other Pages site makes "the same host" far
    // too generous a test. The catalogue's own directory is the boundary.
    expect(packURL(OFFICIAL, '../../../../secrets.json')).toBeNull();
    expect(packURL(OFFICIAL, '../someone-else/packs/theirs.json')).toBeNull();
    expect(packURL(OFFICIAL, 'packs/ours.json')).toBe(PACK_URL.replace('harbour', 'ours'));
  });

  it('is not at another host given as a whole address', () => {
    // `new URL(name, base)` honours an absolute URL and throws the base away,
    // which is how an index turns into a redirector for anyone playing.
    expect(packURL(OFFICIAL, 'https://example.invalid/evil.json')).toBeNull();
    expect(packURL(OFFICIAL, '//example.invalid/evil.json')).toBeNull();
  });

  it('is somewhere, or the row is not a row', () => {
    const clean = sanitiseIndex({
      packs: [{ id: 'nameless' }, { file: 'packs/anonymous.json' }, { id: 'ok', file: 'a.json' }],
    }, { source: OFFICIAL });
    expect(clean.packs.map((p) => p.id)).toEqual(['ok']);
  });
});

describe('what an index may not do to the game', () => {
  it('cannot list more packs than the store will hold', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `p${i}`, file: `${i}.json` }));
    expect(sanitiseIndex({ packs: many }, { source: OFFICIAL }).packs.length)
      .toBe(CATALOGUE_LIMITS.packs);
  });

  it('cannot list one pack twice to take two rows', () => {
    const clean = sanitiseIndex({
      packs: [{ id: 'same', file: 'a.json' }, { id: 'same', file: 'b.json' }],
    }, { source: OFFICIAL });
    expect(clean.packs.length).toBe(1);
  });

  it('cannot claim a pack holds more than a pack can hold', () => {
    const clean = sanitiseIndex({
      packs: [{ id: 'big', file: 'a.json', count: 99999 }],
    }, { source: OFFICIAL });
    expect(clean.packs[0].count).toBe(CATALOGUE_LIMITS.levels);
  });

  it('survives being handed something that is not an index at all', () => {
    for (const junk of [null, 42, 'nope', [], { packs: 'lots' }]) {
      expect(sanitiseIndex(junk, { source: OFFICIAL }).packs).toEqual([]);
    }
  });
});

describe('a downloaded level', () => {
  it('cannot take the id of a campaign level', () => {
    // `getLevel` falls back to the first campaign level for an id it does not
    // know, so a collision would hand somebody the wrong problem and mark the
    // wrong one solved. Namespacing is what stops it.
    const stolen = sanitiseLevelPack({
      levels: LEVELS.slice(0, 5).map((level) => ({ ...level })),
    }, { id: 'harbour' });

    for (const level of stolen.levels) {
      expect(LEVELS.some((real) => real.id === level.id)).toBe(false);
      expect(level.id.startsWith('harbour/')).toBe(true);
    }
    expect(getLevel('first-haul').id).toBe('first-haul');
  });

  it('says which pack it came from, so it is never shown as campaign', () => {
    const pack = sanitiseLevelPack(HARBOUR, { id: 'harbour', source: 'official' });
    expect(pack.levels[0].pack).toBe('harbour');
    expect(pack.levels[0].source).toBe('official');
  });

  it('is sanitised exactly as a share code is', () => {
    const pack = sanitiseLevelPack({
      levels: [{
        name: 'x'.repeat(500),
        pieces: Array.from({ length: 9999 }, () => ({ pos: [0, 0, 0], size: [1, 1, 1] })),
        props: Array.from({ length: 9999 }, (_, i) => ({ id: `p${i}`, pos: [0, 1e12, 0] })),
      }],
    }, { id: 'nasty' });

    const level = pack.levels[0];
    expect(level.name.length).toBeLessThanOrEqual(60);
    expect(level.pieces.length).toBeLessThanOrEqual(250);
    expect(level.props.length).toBeLessThanOrEqual(60);
    for (const prop of level.props) expect(Math.abs(prop.pos[1])).toBeLessThanOrEqual(200);
  });

  it('keeps the same id however many times it is cleaned', () => {
    // The shelf sanitises on the way out of storage as well as in, so a pack
    // goes through here again on every boot. If naming were not idempotent the
    // id would gain a segment each launch and every solved time recorded
    // against it would come unstuck from the level it belongs to.
    let pack = sanitiseLevelPack(HARBOUR, { id: 'harbour' });
    const first = pack.levels[0].id;
    for (let i = 0; i < 5; i += 1) pack = sanitiseLevelPack(pack, { id: 'harbour' });
    expect(pack.levels[0].id).toBe(first);
    expect(first).toBe('harbour/0');
  });

  it('is dropped past the cap rather than filling the list', () => {
    const pack = sanitiseLevelPack({
      levels: Array.from({ length: 500 }, () => HARBOUR.levels[0]),
    }, { id: 'huge' });
    expect(pack.levels.length).toBe(CATALOGUE_LIMITS.levels);
  });
});

describe('fetching a catalogue', () => {
  it('reads the index and then the pack it was asked for', async () => {
    const store = catalogue({ [INDEX_URL]: EXAMPLE_INDEX, [PACK_URL]: HARBOUR });

    const index = await store.index();
    expect(index.from).toBe('network');
    expect(index.packs[0].name).toBe('Harbour');

    const pack = await store.pack(index.packs[0]);
    expect(pack.levels[0].name).toBe('Crane the crate');
    expect(levelsOf([pack]).length).toBe(1);
  });

  it('never asks an API what is in a directory', async () => {
    // Sixty unauthenticated calls an hour, shared by everyone behind one
    // address, is a store that breaks for a whole office at once.
    const store = catalogue({ [INDEX_URL]: EXAMPLE_INDEX, [PACK_URL]: HARBOUR });
    const index = await store.index();
    await store.pack(index.packs[0]);
    for (const url of store.fetcher.calls) expect(url).not.toContain('api.github.com');
  });

  it('does not ask twice for something it asked for a minute ago', async () => {
    const store = catalogue({ [INDEX_URL]: EXAMPLE_INDEX });
    await store.index();
    await store.index();
    expect(store.fetcher.calls.length).toBe(1);
  });

  it('asks again once what it has is old', async () => {
    let clock = 1000;
    const store = catalogue({ [INDEX_URL]: EXAMPLE_INDEX }, { at: () => clock });
    await store.index();
    clock += 60 * 60 * 1000;
    await store.index();
    expect(store.fetcher.calls.length).toBe(2);
  });
});

describe('when the network is not there', () => {
  it('shows what it had, and says that is what it is doing', async () => {
    let clock = 1000;
    const files = { [INDEX_URL]: EXAMPLE_INDEX };
    const store = catalogue(files, { at: () => clock });

    expect((await store.index()).from).toBe('network');

    clock += 60 * 60 * 1000;
    delete files[INDEX_URL];
    const later = await store.index();
    expect(later.from).toBe('stale');
    expect(later.packs[0].name).toBe('Harbour');
  });

  it('is an empty list and a reason, never a thrown error', async () => {
    const store = catalogue({});
    const index = await store.index();
    expect(index.from).toBe('offline');
    expect(index.packs).toEqual([]);
    expect(index.error).toBeTruthy();
  });

  it('gives up on a host that has stopped answering', async () => {
    const store = new Catalogue({
      fetch: (url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
      cache: new CatalogueCache({ idb: null }),
      patience: 20,
    });
    const index = await store.index();
    expect(index.from).toBe('offline');
  });

  it('treats a catalogue that is not JSON as broken, not as empty', async () => {
    const store = catalogue({ [INDEX_URL]: '<!doctype html><h1>404</h1>' });
    expect((await store.index()).from).toBe('broken');
  });
});

describe('what the store refuses to download', () => {
  it('is anything that says up front it is too big', async () => {
    const huge = CATALOGUE_LIMITS.indexBytes + 1;
    let read = false;
    const store = catalogue({
      [INDEX_URL]: () => ({
        ok: true,
        status: 200,
        headers: { get: () => String(huge) },
        text: async () => { read = true; return 'x'.repeat(huge); },
      }),
    });

    expect((await store.index()).from).toBe('offline');
    expect(read).toBe(false);
  });

  it('is anything that turns out to be too big despite what it said', async () => {
    const store = catalogue({
      [INDEX_URL]: () => reply('x'.repeat(CATALOGUE_LIMITS.indexBytes + 1), { length: '10' }),
    });
    expect((await store.index()).from).toBe('offline');
  });
});

describe('checking a pack before it is published', () => {
  it('passes one that sets a problem', () => {
    expect(packProblems(sanitiseLevelPack(HARBOUR, { id: 'harbour' }))).toEqual([]);
  });

  it('objects to a pack with nothing in it', () => {
    expect(packProblems(sanitiseLevelPack({ levels: [] }, { id: 'empty' })).length)
      .toBeGreaterThan(0);
  });

  it('objects to a level that asks the player for nothing', () => {
    const pack = sanitiseLevelPack({ levels: [{ name: 'Scenery' }] }, { id: 'idle' });
    expect(packProblems(pack).join(' ')).toContain('asks the player for nothing');
  });
});
