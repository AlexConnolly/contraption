import { Blueprint } from '../core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../core/orientation.js';

/**
 * A machine wide enough to hold down both ends of The Span.
 *
 * It exists to answer one question about that level — whether ten metres apart
 * and two metres up is actually reachable by something a player could build,
 * or whether the pillars were set out at a spacing nobody can meet. So it is
 * deliberately the dumbest thing that could work, and it does not touch the
 * crate at all: what it shows is reach, not a finished answer.
 *
 * The part worth keeping is the bumper. Driven straight at the pillars without
 * one, the machine arrives two metres out of square across the beam and only
 * one arm ever finds a plate. A long flat rail low down meets all three pillar
 * faces at once and squares the whole thing up as it stops, which is the same
 * trick anybody building for this level will end up finding.
 */
export function spanner({
  arm = 10, lift = 5, reach = 6, rail = 2,
} = {}) {
  const bp = new Blueprint({ name: 'Spanner' });
  const place = (...args) => {
    const out = bp.place(...args);
    if (!out.ok) throw new Error(`Spanner could not place a part: ${out.reason}`);
    return out;
  };
  const facingLeft = yawStep(yawStep(IDENTITY_ORIENTATION));

  // A wide flat base. The first version hung the bumper off the front of a
  // narrow chassis and the whole machine pitched onto its nose the moment it
  // was let go of; putting the wheels at the corners of the widest thing on
  // the machine fixes that and squares it up at the same time.
  for (let x = -arm + 1; x <= arm - 1; x += 1) {
    place('block', [x, 0, -3]);
    place('block', [x, 0, rail]);
  }
  for (let z = -2; z < rail; z += 1) place('block', [0, 0, z]);
  place('core', [1, 0, -1]);
  for (const z of [-3, rail]) {
    place('wheel', [arm, 0, z], IDENTITY_ORIENTATION);
    place('wheel', [-arm, 0, z], facingLeft);
  }

  // The stalk, up the middle to beam height.
  for (let y = 1; y < lift; y += 1) place('block', [0, y, 0]);

  // The beam, and an arm reaching forward at each end. The arms are what land
  // on the plates: the front of the base stops against the pillar faces, so
  // anything that has to be over a pillar top has to overhang it by that much.
  for (let x = -arm; x <= arm; x += 1) place('block', [x, lift, 0]);
  for (const x of [-arm, arm]) {
    for (let z = 1; z <= reach; z += 1) place('block', [x, lift, z]);
  }

  return bp;
}
