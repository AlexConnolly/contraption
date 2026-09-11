import { Blueprint } from '../core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../core/orientation.js';

/**
 * The machine turning behind the title screen.
 *
 * It is not a preset and you cannot load it: it exists to answer the question
 * a new player has before they have asked it, which is "how far does this go".
 * A rover made of seven parts does not answer that. A tower crane on a slew
 * ring, with a counterweighted jib and a grabber on the hoist, does.
 *
 * It is built out of the same parts anybody else gets, on the same grid, and
 * every piece of it is properly attached — see tests/showpiece.test.js. A
 * display model that could not actually be built would be a lie told on the
 * first screen of the game.
 */

const QUARTER = yawStep(IDENTITY_ORIENTATION);

export function crane() {
  const bp = new Blueprint({ name: 'Tower crane' });

  // ---------------------------------------------------------------- carrier
  // Three decks end to end make a nine-cell chassis to put it all on.
  for (const z of [-3, 0, 3]) bp.place('panel', [0, 0, z]);

  // Eight wheels, four a side. The far ones are turned about so their axles
  // face inwards, which is what the drive handedness expects.
  for (const z of [-3, -1, 1, 3]) {
    bp.place('wheel', [2, 0, z], IDENTITY_ORIENTATION);
    bp.place('wheel', [-2, 0, z], yawStep(QUARTER));
  }

  // Outriggers: a beam out to each side, front and back, with a foot under it.
  for (const z of [-3, 3]) {
    bp.place('beam', [0, 1, z]);
    bp.place('ballast', [-1, 1, z]);
    bp.place('ballast', [1, 1, z]);
  }

  // ------------------------------------------------------------------ tower
  // The slew ring. Everything above this turns on it.
  bp.place('turntable', [0, 1, 0]);

  // Nine storeys, with a wider lattice course every third one so it reads as
  // a tower rather than as a column of bricks.
  for (let y = 2; y <= 10; y += 1) {
    if (y === 4 || y === 7) bp.place('beam', [0, y, 0]);
    else bp.place('block', [0, y, 0]);
  }

  // -------------------------------------------------------------------- cab
  bp.place('block', [0, 11, 0]);
  bp.place('core', [0, 12, 0]);
  bp.place('sensor', [1, 12, 0], QUARTER);
  bp.place('gps', [-1, 12, 0]);
  bp.place('computer', [0, 13, 0]);

  // ------------------------------------------------------------------- jib
  // Twelve cells of boom out the front, on beams turned to run along it.
  for (const z of [2, 5, 8, 11]) bp.place('beam', [0, 11, z], QUARTER);

  // A hinged strut back to the tower, the way a real jib is stayed.
  bp.place('hinge', [0, 12, 2], QUARTER);

  // The counter-jib, and the weight that makes the whole thing stand up.
  for (const z of [-2, -5]) bp.place('beam', [0, 11, z], QUARTER);
  for (const z of [-4, -5, -6]) bp.place('ballast', [0, 12, z]);

  // ----------------------------------------------------------------- hoist
  // Down off the end of the jib: a ram, and a magnet on the end of it.
  bp.place('piston', [0, 10, 11]);
  bp.place('grabber', [0, 9, 11]);

  // Something to pick up, sitting under the hook.
  bp.place('block', [0, 8, 11]);

  return bp;
}
