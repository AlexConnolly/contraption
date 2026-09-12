import { store } from '../ui/progress.js';
import {
  installParts, uninstallPack, installedParts, findPart,
} from './registry.js';
import { sanitisePack, fromPackCode, packProblems } from './packs.js';

/**
 * The packs this browser has installed.
 *
 * Storage is the source of truth and the registry is a cache of it, rebuilt
 * from scratch on every change, so removing a pack takes its parts out of the
 * palette straight away without a reload. Everything is put through
 * `sanitisePack` on the way out of storage as well as on the way in — storage
 * can be edited by hand, and a pack that was safe when it was installed is
 * still a stranger's data the next time it is read.
 */

export function installedPacks() {
  return store.packs().map((entry) => sanitisePack(entry));
}

/** Puts what is in storage into the registry. Called once, at boot. */
export function loadPacks() {
  const packs = installedPacks();
  for (const pack of packs) installParts(pack.parts);
  return packs;
}

function rebuild() {
  for (const part of installedParts()) uninstallPack(part.pack);
  return loadPacks();
}

/**
 * Installs a pack, replacing any earlier version of the same one. Returns what
 * it thinks of the pack rather than throwing: a pack always installs, and the
 * problems are things its author should fix, not reasons to refuse it.
 */
export function installPack(raw) {
  const pack = sanitisePack(raw);
  if (!pack.parts.length) {
    return { ok: false, reason: 'That pack has no parts in it' };
  }
  if (!store.savePack(pack)) {
    return { ok: false, reason: 'There is no room left to save it' };
  }
  rebuild();
  return { ok: true, pack, problems: packProblems(pack) };
}

export function removePack(id) {
  store.deletePack(id);
  rebuild();
}

/** A pack from a share code, installed. */
export async function installPackCode(code) {
  const read = await fromPackCode(code);
  if (!read.ok) return read;
  return installPack(read.pack);
}

/** Which installed pack a part came from, if it came from one at all. */
export function packOf(part) {
  return part?.pack ? installedPacks().find((p) => p.id === part.pack) ?? null : null;
}

/**
 * Whether a machine has anything from a pack on it.
 *
 * A pack sets its own costs and masses, so a time set with one is not
 * comparable with a time set without one, and the game does not record it —
 * the same line custom levels are already on, for the same reason. Play with
 * whatever you like; the board stays worth something.
 */
export function usesPacks(blueprint) {
  return (blueprint?.list() ?? []).some((placed) => Boolean(findPart(placed.type)?.pack));
}
