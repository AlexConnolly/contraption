/**
 * The same problem, with nothing stopping you.
 *
 * Every challenge is two things bolted together: a job to do, and a set of
 * rules about how you are allowed to do it. The job is the interesting half —
 * get the crate up there, catch all nine, park on the rail. The rules are what
 * make it a puzzle rather than an errand: no flight, a budget, a clock, a
 * keep-out, one attempt.
 *
 * Sometimes you do not want the puzzle. You want to see what a hundred
 * thrusters does to a crate, or to find out what the course looks like from
 * above, or to try a part you have just written. That used to mean a Sandbox
 * level with nothing in it, which answered none of those because it had none
 * of the courses in it.
 *
 * So this takes any level and drops the rules while keeping the job. A
 * no-flight course becomes flyable, a clock stops being a clock, a budget
 * stops counting, and a keep-out is somewhere you may now go. What is left is
 * the course and the thing it asks for.
 *
 * Nothing is recorded. A win in fun mode is not a win — it says so on the
 * card — because a time set with the rules off is not a time, and a leaderboard
 * that cannot tell the two apart is worth nothing.
 */

/** How much of a budget "no budget" is. Enough that nobody meets it. */
const OPEN_BUDGET = 2000;

/**
 * The rules that are simply taken off.
 *
 * Listed rather than guessed at, so adding a new rule to the format is a
 * decision about whether fun mode drops it, not something that silently keeps
 * biting because nobody remembered this file.
 */
export const DROPPED = [
  // What you may build with.
  'massCap',
  'heightCap',
  // How long you have.
  'deadline',
  // What ends the run early.
  'noContact',
  'noBumps',
  'noRespawn',
  'handsOff',
];

/**
 * The rules that are emptied instead of removed, because the level format
 * requires them to be there and a level without them will not load.
 */
export const EMPTIED = ['bans', 'keepout'];

/**
 * Whether a level has anything for fun mode to take off. A course with no
 * rules on it plays the same either way, and the toggle should say so rather
 * than pretending it did something.
 */
export function hasRules(level) {
  if (!level) return false;
  if (EMPTIED.some((key) => (level[key] ?? []).length > 0)) return true;
  if (level.budget?.cost && level.budget.cost < OPEN_BUDGET) return true;
  return DROPPED.some((key) => level[key] !== undefined && level[key] !== false);
}

/**
 * A level with its rules off.
 *
 * The objectives, the scenery, the props, the gravity and the wind all stay:
 * those are the course. Only the things that refuse you are removed, and the
 * level keeps its own id so progress, saved designs and the level picker all
 * go on pointing at the same place.
 */
export function funLevel(level) {
  if (!level) return level;
  const open = { ...level };
  for (const key of DROPPED) delete open[key];

  open.fun = true;
  open.bans = [];
  // Keep-outs are a rule wearing the clothes of scenery: a red volume you are
  // told off for entering. Off with the rest of them.
  open.keepout = [];
  open.budget = { ...level.budget, cost: OPEN_BUDGET };
  // `bansBite` is what a ban is checked against, and there are none now.
  open.demands = { ...level.demands, bansBite: false };
  return open;
}

/** What to say on the win card when the rules were off. */
export const FUN_NOTE = 'Fun mode — nothing recorded';
