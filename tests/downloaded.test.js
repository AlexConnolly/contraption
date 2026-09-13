import {
  describe, it, expect, beforeEach,
} from 'vitest';

import {
  clearDownloaded,
  downloadedLevel,
  downloadedLevels,
  downloadedPacks,
  dropPack,
  getPack,
  hasPack,
  keepPack,
  loadDownloaded,
} from '../src/challenges/downloaded.js';
import { Catalogue, CatalogueCache, OFFICIAL } from '../src/challenges/catalogue.js';
import { resolveLevel } from '../src/challenges/custom.js';
import { LEVELS } from '../src/challenges/levels.js';
import { readPacks, indexFor, rowFor } from '../tools/build-catalogue.js';

/**
 * Packs you keep, and the folder they are published from.
 *
 * The shelf exists so that downloading and playing are separate things. A
 * catalogue needs the network; what you already own must not, because the game
 * is meant to be something you run rather than something you stream. So the
 * tests that matter most here are the ones with no network in them at all.
 */

const LEVEL = {
  name: 'Crane the crate',
  spawn: [0, 1, -8],
  props: [{ id: 'crate', pos: [0, 0.6, 0] }],
  zones: [{ id: 'barge', pos: [0, 1, 9] }],
  objectives: [{ type: 'propInZone', prop: 'crate', zone: 'barge', hold: 2 }],
};

const HARBOUR = { id: 'harbour', name: 'Harbour', levels: [LEVEL] };

beforeEach(async () => {
  await loadDownloaded({ idb: null });
  await clearDownloaded();
});

describe('keeping a pack', () => {
  it('puts its levels where the game can find them', async () => {
    const out = await keepPack(HARBOUR);
    expect(out.ok).toBe(true);
    expect(hasPack('harbour')).toBe(true);
    expect(downloadedLevels().length).toBe(1);
    expect(downloadedLevel('harbour/0').name).toBe('Crane the crate');
  });

  it('replaces an earlier copy rather than shelving it twice', async () => {
    await keepPack(HARBOUR);
    await keepPack({ ...HARBOUR, name: 'Harbour (revised)' });
    expect(downloadedPacks().length).toBe(1);
    expect(downloadedPacks()[0].name).toBe('Harbour (revised)');
  });

  it('refuses a pack with nothing playable in it', async () => {
    const out = await keepPack({ id: 'empty', levels: [] });
    expect(out.ok).toBe(false);
    expect(downloadedPacks()).toEqual([]);
  });

  it('is undone by dropping it', async () => {
    await keepPack(HARBOUR);
    await dropPack('harbour');
    expect(hasPack('harbour')).toBe(false);
    expect(downloadedLevels()).toEqual([]);
  });
});

describe('a kept pack and the campaign', () => {
  it('is reachable by id without the network', async () => {
    await keepPack(HARBOUR);
    // No Catalogue, no fetch, nothing to time out.
    expect(resolveLevel('harbour/0').name).toBe('Crane the crate');
  });

  it('never answers for a campaign level, nor the campaign for it', async () => {
    await keepPack({ id: 'harbour', levels: LEVELS.slice(0, 3).map((l) => ({ ...l })) });
    for (const level of LEVELS.slice(0, 3)) {
      expect(resolveLevel(level.id).id).toBe(level.id);
    }
    expect(downloadedLevels().every((l) => l.id.startsWith('harbour/'))).toBe(true);
  });

  it('is marked with where it came from, so it is never shown as campaign', async () => {
    await keepPack(HARBOUR, { source: OFFICIAL.id });
    expect(resolveLevel('harbour/0').source).toBe(OFFICIAL.id);
    expect(resolveLevel(LEVELS[0].id).source).toBeUndefined();
  });

  it('still resolves to a campaign level for an id nobody knows', async () => {
    expect(resolveLevel('no-such-level').id).toBe(LEVELS[0].id);
  });
});

describe('downloading one', () => {
  it('fetches the pack and shelves it in one go', async () => {
    const url = `${OFFICIAL.url}packs/harbour.json`;
    const catalogue = new Catalogue({
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(HARBOUR),
      }),
      cache: new CatalogueCache({ idb: null }),
    });

    const out = await getPack({ id: 'harbour', url, source: 'official' }, { catalogue });
    expect(out.ok).toBe(true);
    expect(resolveLevel('harbour/0').name).toBe('Crane the crate');
  });

  it('says so plainly when the download did not work', async () => {
    const catalogue = new Catalogue({
      fetch: async () => ({ ok: false, status: 500, headers: { get: () => null } }),
      cache: new CatalogueCache({ idb: null }),
    });
    const out = await getPack({ id: 'gone', url: `${OFFICIAL.url}packs/gone.json` }, { catalogue });
    expect(out.ok).toBe(false);
    expect(downloadedPacks()).toEqual([]);
  });
});

describe('storage that will not have it', () => {
  it('is a game that works and forgets, not a game that breaks', async () => {
    // A private window blocks IndexedDB outright. The shelf still fills for
    // this session; it simply does not survive a reload.
    await loadDownloaded({ idb: null });
    const out = await keepPack(HARBOUR);
    expect(out.ok).toBe(true);
    expect(downloadedLevel('harbour/0')).toBeTruthy();
  });
});

describe('building the catalogue that gets published', () => {
  it('describes a folder of packs with the same rules the game applies', async () => {
    const { packs, broken } = await readPacks('tests/fixtures/packs');
    expect(broken).toEqual([]);
    const index = indexFor(packs, { updated: '2026-09-13' });
    expect(index.packs.map((p) => p.id)).toEqual(['harbour']);
    expect(index.packs[0].count).toBe(1);
    expect(index.packs[0].file).toBe('packs/harbour.json');
  });

  it('refuses to publish a pack the game would have thrown away', async () => {
    const { broken } = await readPacks('tests/fixtures/broken-packs');
    expect(broken.length).toBe(2);
    expect(broken.join(' ')).toContain('asks the player for nothing');
    expect(broken.join(' ')).toContain('not valid JSON');
  });

  it('carries ratings baked in at build time, since static files cannot count', () => {
    const row = rowFor({ id: 'harbour', file: 'packs/harbour.json', pack: { name: 'Harbour', author: '', note: '', levels: [LEVEL] } }, { harbour: 42 });
    expect(row.likes).toBe(42);
  });
});
