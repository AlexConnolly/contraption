import { Blueprint } from '../core/blueprint.js';
import { IDENTITY_ORIENTATION } from '../core/orientation.js';

/**
 * A machine that stays on a rail one square wide.
 *
 * It does not balance on the rail, because nothing balances on a rail through
 * a bend. It hangs off it: a single line of wheels along the top, a frame down
 * one side, and a cross member under the rail with the ballast on it. That
 * puts the weight below the thing it is running on, which makes the machine a
 * pendulum — lean it and it comes back.
 *
 * The frame is on one side only because the wheels have to bolt to something,
 * and something either side of a half-metre rail is something in the rail.
 */
export function railer({ long = 1, drop = 3, weights = 2 } = {}) {
  const bp = new Blueprint({ name: 'Railer' });
  const place = (...args) => {
    const out = bp.place(...args);
    if (!out.ok) throw new Error(`Railer could not place a part: ${out.reason}`);
    return out;
  };

  // A wall down each side of the rail, and the wheels that ride along the top
  // of it. The two walls are what make this work through a bend: the machine
  // cannot steer -- both its wheels are in one line, so there is no steering to
  // do -- so instead it is captured by the rail and goes where the rail goes.
  for (let z = -long; z <= long; z += 1) {
    for (let y = 0; y >= -drop; y -= 1) {
      place('block', [-1, y, z]);
      if (y < 0) place('block', [1, y, z]);
    }
  }
  for (const z of [-long, long]) place('wheel', [0, 0, z], IDENTITY_ORIENTATION);

  // Under the rail, and the weight that hangs there. This is the whole idea:
  // everything heavy is below the rail, so leaning costs the machine height
  // and it falls back upright rather than over.
  for (let z = -long; z <= long; z += 1) place('block', [0, -drop, z]);
  for (let i = 0; i < weights; i += 1) {
    const z = i - Math.floor(weights / 2);
    place('ballast', [0, -drop - 1, z]);
    place('ballast', [1, -drop - 1, z]);
  }

  place('core', [-1, 1, 0]);
  return bp;
}
