import { getLevel } from './levels.js';
import { funLevel } from './fun.js';
import { sanitiseLevel } from './format.js';
import { downloadedLevel } from './downloaded.js';
import { store } from '../ui/progress.js';

/**
 * Levels people made themselves.
 *
 * Kept apart from the campaign on purpose. The campaign is an ordered ramp
 * whose difficulty is derived and whose solved count means something; a level
 * somebody built this afternoon has no place in either. Custom levels sit
 * alongside it, are marked as custom wherever they appear, and never count
 * toward the tally.
 *
 * Everything here goes through `sanitiseLevel`, including what comes back out
 * of the player's own browser storage — a saved level is still untrusted, both
 * because it may have arrived by share code and because storage can be edited
 * by hand.
 */

function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Every custom level, newest first, ready to play. */
export function customLevels() {
  return store.customLevels().map((entry) => sanitiseLevel(entry.level, { id: entry.id }));
}

export function customLevel(id) {
  const entry = store.customLevel(id);
  return entry ? sanitiseLevel(entry.level, { id: entry.id }) : null;
}

/**
 * A level by id from anywhere — the campaign, a downloaded pack, or somebody's
 * own work. The one place that has to know all three exist, so nothing else
 * does.
 *
 * `getLevel` is last because it answers for an id it does not recognise by
 * handing back the first campaign level. Anything that can say "not mine" has
 * to be asked before the thing that cannot.
 */
export function resolveLevel(id, { fun = false } = {}) {
  const level = customLevel(id) ?? downloadedLevel(id) ?? getLevel(id);
  // The rules come off here rather than at each of the dozen places that ask
  // one, so a level with fun mode on is simply a level with no rules on it and
  // nothing else in the game has to know.
  return fun ? funLevel(level) : level;
}

/** The saved level, or null if there was no room to save it. */
export function saveCustomLevel(level, { id } = {}) {
  const at = id ?? newId();
  const clean = sanitiseLevel(level, { id: at });
  const written = store.saveCustomLevel({ id: at, name: clean.name, level: clean });
  return written ? clean : null;
}

export function deleteCustomLevel(id) {
  store.deleteCustomLevel(id);
}

/** A blank problem to start from: ground, a crate, a goal, and the job stated. */
export function blankLevel() {
  return sanitiseLevel({
    name: 'Untitled problem',
    brief: 'Move the crate into the green square.',
    spawn: [0, 1, -8],
    groundSize: 120,
    props: [{ id: 'crate', pos: [0, 0.6, 0], size: [1.1, 1.1, 1.1], mass: 8, colour: 0xc98b4b }],
    zones: [{ id: 'goal', pos: [0, 1, 9], size: [4, 2.4, 4], colour: 0x4ade80 }],
    objectives: [{
      type: 'propInZone', prop: 'crate', zone: 'goal', hold: 3, label: 'Crate parked in the square',
    }],
    budget: { cost: 120 },
    par: 120,
  });
}
