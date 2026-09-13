import { Blueprint } from '../core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../core/orientation.js';

// A grabber reaches along its own up axis, so one turned like this looks at
// the floor and picks up what it is standing over.
const DOWNWARD = 1;

/**
 * A machine four blocks tall that stacks a tower four times its own height.
 *
 * Three rams, one on top of the next, are three of the four blocks the level
 * allows and give back their whole stroke once the run starts. The grabber is
 * not on top of them: it hangs off the mast on an arm that reaches back down
 * to the floor, because a grabber on top of a retracted mast is two metres up
 * and the loads are on the ground.
 *
 * Nothing the mast carries may touch the chassis as well, or the joint is
 * bridged and the ram strains against its own machine instead of lifting.
 */
export function stacker({ stages = 4, stroke = 2.4, arm = 3 } = {}) {
  const bp = new Blueprint({ name: 'Stacker' });
  const place = (...args) => {
    const out = bp.place(...args);
    if (!out.ok) throw new Error(`Stacker could not place a part: ${out.reason}`);
    return out;
  };
  const facingLeft = yawStep(yawStep(IDENTITY_ORIENTATION));

  // Everything that is not the mast shares the bottom block: every block spent
  // on a chassis is a block of stroke given up.
  for (let x = -1; x <= 1; x += 1) {
    for (const z of [-1, 0, 1]) place('block', [x, 0, z]);
  }
  place('core', [2, 0, 0]);
  place('ballast', [-2, 0, 0]);
  // Something for the wheels to bolt to. Without these they hang off nothing
  // and drop away the moment the run starts.
  for (const z of [-1, 1]) {
    place('block', [2, 0, z]);
    place('block', [-2, 0, z]);
  }
  for (const z of [-1, 1]) {
    place('wheel', [3, 0, z], IDENTITY_ORIENTATION);
    place('wheel', [-3, 0, z], facingLeft);
  }

  const rams = [];
  for (let i = 0; i < stages; i += 1) {
    const ram = place('piston', [0, i + 1, 0]);
    bp.setConfig(ram.id, { stroke, tension: 8 });
    rams.push(ram.id);
  }

  // The arm off the top of the mast, out and back down to the floor. It clears
  // the chassis by going out to z = arm before it comes down.
  const top = stages + 1;
  // From directly on top of the ram outwards, or the arm is not attached to
  // the mast at all and simply falls off.
  for (let z = 0; z <= arm; z += 1) place('block', [0, top, z]);
  for (let y = top - 1; y >= 3; y -= 1) place('block', [0, y, arm]);
  // A hand's breadth above a load rather than level with it. A grabber that
  // reaches downwards has to pass over what it is picking up; slung any lower
  // it meets the load edge-on and shoves it along the floor instead.
  const grab = place('grabber', [0, 2, arm], DOWNWARD);

  return { blueprint: bp, rams, grab: grab.id };
}
