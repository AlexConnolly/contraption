// Static `pieces` are fixed geometry, `props` are dynamic objects the machine
// has to move, and `zones` are the trigger volumes objectives test against.
//
// The levels themselves live in packs under ./packs. The campaign is those
// packs in order, and the order is the difficulty ramp — `tests/tiers.test.js`
// will tell you if a pack has been dropped in the wrong place.

import { CORE } from './packs/core.js';

/**
 * What a challenge asks of you, and the skill level that follows from it.
 * Written as the demands rather than as a label so the rule lives in one
 * place and a level cannot quietly end up marked easier than it plays.
 *
 *   steps       how many distinct things the machine has to do
 *   flies       whether it has to leave the ground
 *   autonomous  whether it has to run without you
 */
export const TIERS = [
  { id: 'easy', name: 'Easy', note: 'One thing to do, on the ground.' },
  { id: 'medium', name: 'Medium', note: 'Several steps, or it has to fly.' },
  { id: 'hard', name: 'Hard', note: 'Several steps, and it has to fly.' },
  { id: 'expert', name: 'Expert', note: 'It has to run itself.' },
];

/**
 * A ban makes a level harder, so it has to count. Taking flight away removes
 * the answer to almost everything, and a level that would be a gentle haul
 * becomes a real problem — marking it Easy because the demands are modest
 * would be a lie to the player.
 *
 * One step up the ramp per ban, on top of whatever the demands come to.
 */
export function tierOf(level) {
  const demands = level?.demands;
  if (!demands) return null;
  if (demands.autonomous) return 'expert';

  const many = (demands.steps ?? 1) > 1;
  let at = 0;
  if (many && demands.flies) at = 2;
  else if (many || demands.flies) at = 1;

  at += (level.bans ?? []).length;
  return TIERS[Math.min(at, TIERS.length - 1)].id;
}

export function tier(id) {
  return TIERS.find((t) => t.id === id) ?? null;
}

export const LEVELS = [
  ...CORE,
];

export function getLevel(id) {
  return LEVELS.find((level) => level.id === id) ?? LEVELS[0];
}

/** The campaign in order, which is everything that sets a problem. */
export function campaign() {
  return LEVELS.filter((level) => level.objectives.length > 0);
}

/** The one after this, or null at the end of the campaign. */
export function nextLevel(id) {
  const run = campaign();
  const at = run.findIndex((level) => level.id === id);
  return at >= 0 ? run[at + 1] ?? null : run[0] ?? null;
}
