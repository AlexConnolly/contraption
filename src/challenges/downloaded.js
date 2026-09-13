import {
  Catalogue,
  OFFICIAL,
  SHELF,
  openCatalogueDB,
  readRecord,
  sanitiseLevelPack,
  writeRecord,
} from './catalogue.js';

/**
 * Packs this machine has kept.
 *
 * Downloading a pack and playing a pack are deliberately separate. A catalogue
 * is a shop window and needs the network; the shelf is what you own and must
 * not. Once a pack is on the shelf the game never asks the internet about it
 * again — it opens, plays and shows progress with the aeroplane mode on, which
 * is the whole difference between shipping levels and streaming them.
 *
 * The shelf is read once at boot into memory and served synchronously after
 * that. Level lookup is called from the middle of a frame in a dozen places
 * and is not worth making asynchronous for a few hundred kilobytes that could
 * simply be resident.
 *
 * Everything is sanitised coming out of storage as well as going in, on the
 * same reasoning as installed part packs: storage is a file on somebody's
 * machine, and a pack that was safe when it was saved is still a stranger's
 * data the next time it is read.
 */

/** The most packs one machine keeps, so the shelf cannot fill a disk. */
export const KEEP = 64;

let shelf = [];
let db = null;

/** Every pack on the shelf, newest first. */
export function downloadedPacks() {
  return shelf;
}

/** The levels from every kept pack, ready to play. */
export function downloadedLevels() {
  return shelf.flatMap((pack) => pack.levels);
}

/**
 * A downloaded level by id.
 *
 * Ids are namespaced `pack/level` by `sanitiseLevelPack`, so this can never
 * answer for a campaign id and a campaign lookup can never answer for this.
 */
export function downloadedLevel(id) {
  return downloadedLevels().find((level) => level.id === id) ?? null;
}

export function hasPack(id) {
  return shelf.some((pack) => pack.id === id);
}

const key = (pack) => `${pack.source ?? 'official'}:${pack.id}`;

/**
 * Reads the shelf into memory. Called once, at boot, and awaited before the
 * challenge list is drawn so a kept pack never flickers in a moment late.
 */
export async function loadDownloaded({ idb = globalThis.indexedDB, name } = {}) {
  db = await openCatalogueDB(idb, name);
  const held = await readRecord(db, SHELF, 'shelf');
  const saved = Array.isArray(held?.packs) ? held.packs.slice(0, KEEP) : [];
  shelf = saved
    .map((pack) => sanitiseLevelPack(pack, { id: pack?.id, source: pack?.source }))
    .filter((pack) => pack.levels.length > 0);
  return shelf;
}

async function commit() {
  return writeRecord(db, SHELF, { id: 'shelf', packs: shelf, at: Date.now() });
}

/**
 * Puts a pack on the shelf, replacing any earlier copy of the same one.
 *
 * Returns whether it was written. A pack with nothing playable in it is
 * refused rather than kept as an empty row, because the only thing an empty
 * row can do is confuse somebody into thinking a download worked.
 */
export async function keepPack(raw, { source } = {}) {
  const pack = sanitiseLevelPack(raw, { id: raw?.id, source: source ?? raw?.source });
  if (!pack.levels.length) return { ok: false, reason: 'That pack has no levels in it' };

  shelf = [pack, ...shelf.filter((held) => key(held) !== key(pack))].slice(0, KEEP);
  const written = await commit();
  return written ? { ok: true, pack } : { ok: true, pack, kept: false };
}

/** Takes a pack off the shelf. Progress against its levels is left alone. */
export async function dropPack(id, { source } = {}) {
  const want = `${source ?? 'official'}:${id}`;
  shelf = shelf.filter((pack) => key(pack) !== want);
  return commit();
}

/**
 * Fetches a pack from a catalogue row and keeps it.
 *
 * The two halves are one call because every caller wants both and the failure
 * they care about is the same either way: they pressed Get and it is either on
 * the shelf now or it is not.
 */
export async function getPack(entry, { catalogue = new Catalogue() } = {}) {
  const pack = await catalogue.pack(entry);
  if (!pack) return { ok: false, reason: 'That pack could not be downloaded' };
  return keepPack(pack, { source: entry.source ?? OFFICIAL.id });
}

/** Empties the shelf. Used by tests, and by a player clearing their data. */
export async function clearDownloaded() {
  shelf = [];
  return commit();
}
