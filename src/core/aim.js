import { ORIENTATIONS, applyOrientation, IDENTITY_ORIENTATION } from './orientation.js';
import { workingAxis } from '../parts/registry.js';

/**
 * Pointing a part where you want it, instead of guessing at it.
 *
 * The rotations themselves are right. `R` is always a quarter turn about the
 * world's up axis and `T` always a quarter turn about the world's X, whatever
 * the part happens to be doing already — which is the predictable convention,
 * not the one where a key means something different depending on what you
 * pressed last.
 *
 * The interface is the problem. Two keys generate all twenty-four rotations of
 * a cube, but badly: from square on, reaching a given one takes three presses
 * on average and five at worst, and only two of the twenty-four are a single
 * press away. There is no route you can plan, so you press and look, press and
 * look. That is not a rotation system anybody can hold in their head.
 *
 * Almost every part that cares about rotation cares about one direction: which
 * way a thruster pushes, a wheel drives, a sensor looks, a grabber faces, a
 * ram extends, a wedge slopes, a rail runs. So say the direction and let the
 * rotation be worked out. The four turns that all point the same way are the
 * same answer to the question being asked, and picking the one nearest to
 * where the part already is means the rest of it does not spin for no reason.
 */

/**
 * The six directions, named as the player sees them.
 *
 * Forward is +Z and up is +Y, so the machine's right is forward crossed with
 * up, which is -X. Getting that backwards would put every label on the wrong
 * button, which is a worse rotation system than no labels at all.
 */
export const DIRECTIONS = [
  { id: 'forward', name: 'Forward', dir: [0, 0, 1] },
  { id: 'back', name: 'Back', dir: [0, 0, -1] },
  { id: 'left', name: 'Left', dir: [1, 0, 0] },
  { id: 'right', name: 'Right', dir: [-1, 0, 0] },
  { id: 'up', name: 'Up', dir: [0, 1, 0] },
  { id: 'down', name: 'Down', dir: [0, -1, 0] },
];

export const directionNamed = (id) => DIRECTIONS.find((d) => d.id === id) ?? null;

/** Which way a part set at this rotation actually works, in world terms. */
export function aimOf(part, rot) {
  const working = workingAxis(part, rot);
  if (!working) return null;
  return applyOrientation(rot, working.axis).map((n) => Math.round(n));
}

/** Which way it points, as one of the six, or null if it points nowhere. */
export function aimNamed(part, rot) {
  const aim = aimOf(part, rot);
  if (!aim) return null;
  return DIRECTIONS.find((d) => d.dir.every((n, i) => n === aim[i]))?.id ?? null;
}

const same = (a, b) => a.every((n, i) => n === b[i]);

/**
 * How far apart two rotations are, as the angle between them in quarter turns.
 *
 * Used to pick which of the four rotations that point the right way is the
 * least disturbing. Worked out from how much of the part stays where it was:
 * three axes agreeing is no change at all, and fewer is further.
 */
export function turnsBetween(a, b) {
  let agreed = 0;
  for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    if (same(applyOrientation(a, v), applyOrientation(b, v))) agreed += 1;
  }
  // Three axes held is the same rotation; one held is a quarter or a half
  // turn about it; none held is the awkward corner-to-corner ones.
  return 3 - agreed;
}

/** Every rotation that makes this part work in the given direction. */
export function aimingsFor(part, dir) {
  const out = [];
  for (let rot = 0; rot < ORIENTATIONS.length; rot += 1) {
    const aim = aimOf(part, rot);
    if (aim && same(aim, dir)) out.push(rot);
  }
  return out;
}

/**
 * The rotation that points this part the wanted way and disturbs it least.
 *
 * `null` when the part has no direction to speak of — a block points nowhere
 * and the six buttons should not be offered for it — or when nothing can point
 * that way, which a part with a fixed vertical axis cannot help.
 */
export function aimAt(part, dir, from = IDENTITY_ORIENTATION) {
  const options = aimingsFor(part, dir);
  if (options.length === 0) return null;
  let best = options[0];
  let closest = turnsBetween(from, best);
  for (const rot of options.slice(1)) {
    const cost = turnsBetween(from, rot);
    if (cost < closest) {
      best = rot;
      closest = cost;
    }
  }
  return best;
}

/** Which of the six a part can be pointed, so the rest can be greyed out. */
export function aimableDirections(part) {
  return DIRECTIONS.filter((d) => aimingsFor(part, d.dir).length > 0).map((d) => d.id);
}
