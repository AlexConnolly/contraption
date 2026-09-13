import { Blueprint } from '../core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../core/orientation.js';

/**
 * A machine that catches nine balls without dropping one.
 *
 * The shape of it comes from where the balls actually come down, which is the
 * same three places every run: x of plus and minus 3.84, and z between 0.6 and
 * 1.8. So this is a tray wide enough to cover all three and deep enough to
 * cover the spread, with one wall at the back of it.
 *
 * The wall is the part that matters. A ball arrives doing about eleven metres
 * a second forwards and seven downwards, so it does not land so much as skid;
 * on an open deck it crosses the tray and goes off the back. It needs
 * something to stop against, and the back of the machine is where it is going.
 *
 * The width is wider than the balls strictly need. Driven eight metres to the
 * landing zone this thing arrives about a metre to the right of where it set
 * off and slightly crooked with it, and a tray cut to fit the trajectories
 * exactly puts the outside balls on the floor.
 */
export function catcher({
  wide = 10, deep = 5, wall = 2, lip = true,
} = {}) {
  const bp = new Blueprint({ name: 'Catcher' });
  const place = (...args) => {
    const out = bp.place(...args);
    if (!out.ok) throw new Error(`Catcher could not place a part: ${out.reason}`);
    return out;
  };
  const facingLeft = yawStep(yawStep(IDENTITY_ORIENTATION));

  // The tray floor. Balls come in over the open front and stop at the back.
  for (let x = -wide; x <= wide; x += 1) {
    for (let z = -deep; z <= 0; z += 1) place('block', [x, 0, z]);
  }
  // The back wall.
  for (let x = -wide; x <= wide; x += 1) {
    for (let y = 1; y <= wall; y += 1) place('block', [x, y, -deep - 1]);
  }
  // Sides, so a ball that lands at an angle stays in.
  for (const x of [-wide, wide]) {
    for (let z = -deep; z <= 0; z += 1) {
      for (let y = 1; y <= wall; y += 1) place('block', [x, y, z]);
    }
  }
  // And a lip along the front. Without one the first ball is caught and then
  // knocked back out over the open edge by the third, five seconds later:
  // balls rebound off the back wall and roll, and a tray you can roll out of
  // is a tray that loses one eventually.
  if (lip) for (let x = -wide + 1; x <= wide - 1; x += 1) place('block', [x, 1, 1]);

  place('core', [0, 1, 0]);
  for (const z of [-deep, 0]) {
    place('wheel', [wide + 1, 0, z], IDENTITY_ORIENTATION);
    place('wheel', [-wide - 1, 0, z], facingLeft);
  }
  return bp;
}
