import { getLevel } from './levels.js';
import { sanitiseLevel } from './format.js';
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
 * A level by id from anywhere — the campaign or somebody's own work. The one
 * place that has to know both exist, so nothing else does.
 */
export function resolveLevel(id) {
  return customLevel(id) ?? getLevel(id);
}

export function saveCustomLevel(level, { id } = {}) {
  const at = id ?? newId();
  const clean = sanitiseLevel(level, { id: at });
  store.saveCustomLevel({ id: at, name: clean.name, level: clean });
  return clean;
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
