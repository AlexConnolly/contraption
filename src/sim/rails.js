import { getPart, CELL } from '../parts/registry.js';
import { applyOrientation } from '../core/orientation.js';

/**
 * How far a dolly can run, and what happens at the ends.
 *
 * A dolly does not carry its own travel the way a piston carries a stroke. It
 * runs on whatever track it is standing on, so the length of the run is a fact
 * about the machine rather than a number in a panel: lay more rail and the
 * dolly goes further, which is the whole point of building a crane gantry out
 * of parts instead of setting a slider.
 *
 * It also takes its direction from the rail rather than from its own rotation.
 * Both are +Z parts and a player who turned one and not the other would get a
 * dolly that will not move and no way to find out why, so the rail decides and
 * the dolly follows.
 *
 * The ends are the interesting half. Rail that runs out into thin air is an
 * open end: reach it with any speed on and the dolly leaves the track and
 * carries on under its own momentum, which is what a runaway gantry does. Put
 * anything at all in the cell past the last sleeper and that end is stopped.
 */

/** The part a dolly stands on, and the direction that part runs in. */
export function railUnder(blueprint, dolly) {
  const part = getPart(dolly.type);
  const down = applyOrientation(dolly.rot, part.attach?.[0] ?? [0, -1, 0]);
  const cell = [0, 1, 2].map((i) => dolly.cell[i] + Math.round(down[i]));
  const under = blueprint.partAt(cell);
  if (!under || under.type !== 'rail') return null;
  return { rail: under, cell };
}

const step = (cell, dir, n) => [0, 1, 2].map((i) => cell[i] + Math.round(dir[i]) * n);

/**
 * The run of rail a dolly is standing on.
 *
 * Returns how far it may travel each way in metres, and whether each end is
 * open to the air or stopped by something. `null` when the dolly is not on a
 * rail at all, which is a machine that will not run rather than one that runs
 * badly — the studio says so as a disconnection.
 */
export function railRun(blueprint, dolly) {
  const found = railUnder(blueprint, dolly);
  if (!found) return null;
  const { rail, cell } = found;
  // The rail's own running direction. A rail is a +Z part, so this is where
  // its arrow points once it has been turned.
  const dir = applyOrientation(rail.rot, [0, 0, 1]);

  const reach = (sign) => {
    let n = 1;
    // A run is however much rail is laid end to end, and there is no cap on
    // it: "as long and as far as you want" is the feature.
    while (n < 512) {
      const at = blueprint.partAt(step(cell, dir, sign * n));
      if (!at || at.type !== 'rail') break;
      n += 1;
    }
    const last = n - 1;
    // What is in the cell past the final sleeper. Anything at all is a stop.
    const beyond = blueprint.partAt(step(cell, dir, sign * n));
    return { cells: last, open: !beyond };
  };

  const ahead = reach(1);
  const behind = reach(-1);
  return {
    axis: dir,
    forward: ahead.cells * CELL,
    back: behind.cells * CELL,
    openForward: ahead.open,
    openBack: behind.open,
    // A dolly on a single sleeper with nothing either side has nowhere to go
    // and both ends open, which is a machine that throws its own crane away.
    length: (ahead.cells + behind.cells + 1) * CELL,
  };
}

/** How much of a run is left before an end that lets go. */
export const LEAVING = 0.02;

/**
 * Whether a dolly is running off the end.
 *
 * Both halves have to be true: it is at an end that is open to the air, and it
 * is still going that way. Sitting parked against an open end is not falling
 * off it, or a gantry driven gently to the end of its track would throw itself
 * on the floor.
 */
export function runningOff(run, travel, rate, { threshold = 0.25 } = {}) {
  if (!run) return false;
  if (run.openForward && travel >= run.forward - LEAVING && rate > threshold) return true;
  return Boolean(run.openBack && travel <= -run.back + LEAVING && rate < -threshold);
}
