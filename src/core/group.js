import { occupiedCells, key } from './blueprint.js';
import { applyOrientation, turnStep, IDENTITY_ORIENTATION } from './orientation.js';
import { getPart } from '../parts/registry.js';

/**
 * Doing something to several parts at once.
 *
 * Everything in the studio has been one part at a time: place one, turn one,
 * delete one. That is fine for a rover and hopeless for anything with a
 * repeated structure — a conveyor is forty wheels laid in two rows, and laying
 * the second row by hand after the first is not a puzzle, it is typing.
 *
 * Three operations cover nearly all of it: move a selection, copy a selection,
 * throw a selection away. Rotating one is deliberately left out for now —
 * turning a group about its own centre is a different and much fiddlier
 * problem, because the parts have to swap places as well as turn, and getting
 * it half right is worse than not offering it.
 *
 * Every operation is checked in full before any of it is applied. A move that
 * half happens would leave a machine that never existed on screen, and the
 * player would have no idea which half went where.
 */

/** Only the ids that name a part, so a stale selection cannot cause trouble. */
export function membersOf(blueprint, ids) {
  const out = [];
  for (const id of ids ?? []) {
    const placed = blueprint.get(id);
    if (placed) out.push(placed);
  }
  return out;
}

/** Every cell a selection stands on. */
export function groupCells(blueprint, ids) {
  const cells = [];
  for (const placed of membersOf(blueprint, ids)) {
    cells.push(...occupiedCells(placed.type, placed.cell, placed.rot));
  }
  return cells;
}

/** The box a selection fills, in cells, or null when nothing is selected. */
export function groupExtent(blueprint, ids) {
  const cells = groupCells(blueprint, ids);
  if (cells.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const c of cells) {
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i], c[i]);
      max[i] = Math.max(max[i], c[i]);
    }
  }
  return { min, max, size: [0, 1, 2].map((i) => max[i] - min[i] + 1) };
}

const shift = (cell, delta) => [0, 1, 2].map((i) => cell[i] + delta[i]);

/**
 * Whether a selection can slide by a whole number of cells.
 *
 * The selection ignores itself, which is the point: parts sliding together
 * pass through the cells their neighbours are leaving, and checking each one
 * against a board that still holds the rest would refuse every move of less
 * than the selection's own width.
 */
export function canMoveGroup(blueprint, ids, delta) {
  const members = membersOf(blueprint, ids);
  if (members.length === 0) return { ok: false, reason: 'Nothing selected' };
  if (delta.every((n) => n === 0)) return { ok: true, members, cells: [] };

  const moving = new Set(members.map((p) => p.id));
  for (const placed of members) {
    const to = shift(placed.cell, delta);
    const fits = blueprint.canPlace(placed.type, to, placed.rot, moving);
    if (!fits.ok) return { ok: false, reason: fits.reason };
  }
  return { ok: true, members, cells: groupCells(blueprint, ids).map((c) => shift(c, delta)) };
}

/**
 * Slides a selection. Reports what it did rather than throwing, and changes
 * nothing at all when the move will not fit.
 *
 * Applied by lifting every member off the board first and then setting them
 * all down. Doing it one at a time would have the first part land on a cell
 * the second has not vacated yet, which is the same self-collision the check
 * above exists to avoid.
 */
export function moveGroup(blueprint, ids, delta) {
  const check = canMoveGroup(blueprint, ids, delta);
  if (!check.ok) return check;

  for (const placed of check.members) {
    for (const c of occupiedCells(placed.type, placed.cell, placed.rot)) {
      if (blueprint.occupancy.get(key(c)) === placed.id) blueprint.occupancy.delete(key(c));
    }
  }
  for (const placed of check.members) {
    placed.cell = shift(placed.cell, delta);
    for (const c of occupiedCells(placed.type, placed.cell, placed.rot)) {
      blueprint.occupancy.set(key(c), placed.id);
    }
  }
  return { ok: true, moved: check.members.length };
}

/**
 * Whether a selection can be copied to an offset.
 *
 * Unlike a move, the originals stay where they are, so the copy has to clear
 * them as well as everything else. A part there can only be one of refuses the
 * whole copy by name: quietly leaving the core out of a duplicated chassis
 * would hand somebody a machine that looks right and does not run, and they
 * would find out several minutes later.
 */
export function canCloneGroup(blueprint, ids, delta) {
  const members = membersOf(blueprint, ids);
  if (members.length === 0) return { ok: false, reason: 'Nothing selected' };

  for (const placed of members) {
    const part = getPart(placed.type);
    if (part.unique) {
      return { ok: false, reason: `There can only be one ${part.name}` };
    }
  }
  // Copies must clear each other as well as the board, so they are checked
  // against a running tally rather than one at a time against the original.
  const taken = new Set();
  for (const placed of members) {
    const to = shift(placed.cell, delta);
    const fits = blueprint.canPlace(placed.type, to, placed.rot);
    if (!fits.ok) return { ok: false, reason: fits.reason };
    for (const c of fits.cells) {
      if (taken.has(key(c))) return { ok: false, reason: 'Something is already there' };
      taken.add(key(c));
    }
  }
  return { ok: true, members, cells: [...taken].map((k) => k.split(',').map(Number)) };
}

/**
 * Copies a selection to an offset and returns the new ids, so the studio can
 * select what it just made — which is what every other editor does, and what
 * makes copying twice in a row land two cells apart instead of on top.
 */
export function cloneGroup(blueprint, ids, delta) {
  const check = canCloneGroup(blueprint, ids, delta);
  if (!check.ok) return check;

  const made = [];
  for (const placed of check.members) {
    const out = blueprint.place(
      placed.type, shift(placed.cell, delta), placed.rot, { ...placed.config },
    );
    if (!out.ok) {
      // Checked above, so this cannot normally happen; undo rather than leave
      // a half-made copy behind if it ever does.
      for (const id of made) blueprint.remove(id);
      return { ok: false, reason: out.reason };
    }
    made.push(out.id);
  }
  return { ok: true, ids: made, cloned: made.length };
}

/**
 * The cell a group turns about, when nobody has said otherwise.
 *
 * The middle of the box it fills, rounded to a cell. A group with an even
 * number of cells across has no middle cell, so it lands half a cell off and
 * the group shifts by that much as it turns. Every grid editor has this and
 * the alternative — refusing to turn even-sized groups — is worse.
 */
export function pivotOf(blueprint, ids) {
  const box = groupExtent(blueprint, ids);
  if (!box) return null;
  return [0, 1, 2].map((i) => Math.round((box.min[i] + box.max[i]) / 2));
}

/**
 * Turning a whole selection, which is a different thing from turning each part
 * where it stands.
 *
 * Two things have to happen together and agree: every part turns on the spot,
 * and every part is carried round the pivot to where that turn puts it. Doing
 * only the first leaves a crane arm pointing a new way with its pieces still in
 * a line the old way; doing only the second leaves the pieces in the right
 * places facing wrongly.
 *
 * Both use the same rotation so they cannot disagree: the quarter turn is taken
 * as an orientation, that orientation moves each part's offset from the pivot,
 * and the same step turns each part's own facing. There is one source of truth
 * about what "a quarter turn about X" means and it is `turnStep`.
 */
export function canRotateGroup(blueprint, ids, axis = 'yaw', quarters = 1, pivot = null) {
  const members = membersOf(blueprint, ids);
  if (members.length === 0) return { ok: false, reason: 'Nothing selected' };

  const about = pivot ?? pivotOf(blueprint, ids);
  const spin = turnStep(IDENTITY_ORIENTATION, axis, quarters);
  const moving = new Set(members.map((p) => p.id));

  const placements = members.map((placed) => {
    const offset = [0, 1, 2].map((i) => placed.cell[i] - about[i]);
    const turned = applyOrientation(spin, offset).map((n) => Math.round(n));
    return {
      placed,
      cell: [0, 1, 2].map((i) => about[i] + turned[i]),
      rot: turnStep(placed.rot, axis, quarters),
    };
  });

  for (const next of placements) {
    const fits = blueprint.canPlace(next.placed.type, next.cell, next.rot, moving);
    if (!fits.ok) return { ok: false, reason: fits.reason };
  }
  return { ok: true, members, placements, pivot: about };
}

/** Turns a selection about a pivot. All of it, or none of it. */
export function rotateGroup(blueprint, ids, axis = 'yaw', quarters = 1, pivot = null) {
  const check = canRotateGroup(blueprint, ids, axis, quarters, pivot);
  if (!check.ok) return check;

  // Lifted off the board first, exactly as a move is: a part set down early
  // would land on a cell another part has not left yet.
  for (const { placed } of check.placements) {
    for (const c of occupiedCells(placed.type, placed.cell, placed.rot)) {
      if (blueprint.occupancy.get(key(c)) === placed.id) blueprint.occupancy.delete(key(c));
    }
  }
  for (const next of check.placements) {
    next.placed.cell = next.cell;
    next.placed.rot = next.rot;
    for (const c of occupiedCells(next.placed.type, next.placed.cell, next.placed.rot)) {
      blueprint.occupancy.set(key(c), next.placed.id);
    }
  }
  return { ok: true, turned: check.placements.length, pivot: check.pivot };
}

/** Throws a selection away, and says how much of it was actually there. */
export function removeGroup(blueprint, ids) {
  let gone = 0;
  for (const placed of membersOf(blueprint, ids)) {
    if (blueprint.remove(placed.id)) gone += 1;
  }
  return { ok: gone > 0, removed: gone };
}

/**
 * Everything touching a starting part, as a flood fill through shared faces.
 *
 * Selecting a conveyor's worth of parts by clicking each one is the chore this
 * is meant to remove, so there has to be a way to say "this and everything
 * attached to it" without a rubber band. Stops at `limit` so a click on a
 * large machine cannot walk the whole thing by accident.
 */
export function connectedTo(blueprint, id, { limit = 512 } = {}) {
  const start = blueprint.get(id);
  if (!start) return [];

  const seen = new Set([start.id]);
  const queue = [start];
  const NEIGHBOURS = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  while (queue.length && seen.size < limit) {
    const placed = queue.shift();
    for (const c of occupiedCells(placed.type, placed.cell, placed.rot)) {
      for (const step of NEIGHBOURS) {
        const next = blueprint.partAt(shift(c, step));
        if (!next || seen.has(next.id)) continue;
        seen.add(next.id);
        queue.push(next);
      }
    }
  }
  return [...seen];
}
