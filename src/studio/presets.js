import { Blueprint } from '../core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../core/orientation.js';

// A four-wheel rover that drives on WASD straight away, so a new player has
// something to test before they have built anything.
export function starterRover() {
  const bp = new Blueprint({ name: 'Starter rover' });
  const facingLeft = yawStep(yawStep(IDENTITY_ORIENTATION));
  bp.place('panel', [0, 0, 0]);
  bp.place('core', [0, 1, 0]);
  bp.place('ballast', [0, 1, 1]);
  bp.place('wheel', [2, 0, 1]);
  bp.place('wheel', [2, 0, -1]);
  bp.place('wheel', [-2, 0, 1], facingLeft);
  bp.place('wheel', [-2, 0, -1], facingLeft);
  return bp;
}

// A four-rotor drone wired to a flight controller. The rotors carry no key
// binding of their own: the controller works out each one's share.
export function quadcopter() {
  const bp = new Blueprint({ name: 'Quadcopter' });
  bp.place('panel', [0, 0, 0]);
  bp.place('core', [0, 1, 0]);
  bp.place('controller', [0, 1, -1]);
  for (const cell of [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1]]) {
    bp.place('propeller', cell, IDENTITY_ORIENTATION, { binding: { mode: 'flight' } });
  }
  return bp;
}
