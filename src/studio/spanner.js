import { Blueprint } from '../core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../core/orientation.js';

// The rotation whose up axis points along +Z, which is the way the machine
// faces.
const FORWARD = 2;

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
  arm = 10, lift = 5, reach = 6, rail = 2, hoist = false,
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

  // The crate half of the job. A fork cannot slide under a crate sitting flat
  // on the ground -- there is nothing thin enough to get under it -- so the
  // crate is picked up instead: a grabber low at the front takes hold of it on
  // the way past, and a ram lifts the pair of them onto the middle pillar.
  const rig = {};
  if (hoist) {
    const ram = place('piston', [0, 1, rail]);
    bp.setConfig(ram.id, { stroke: 2.4, tension: 6 });
    rig.ram = ram.id;
    // A hook that reaches back down in front of the ram. Sitting the grabber
    // straight on top of the ram puts its face a metre and a half up, which is
    // over the crate rather than against it; this brings it down to the
    // crate's own height and takes it by the side on the way past.
    // Everything the ram carries has to touch the ram and nothing else. Hung
    // one cell closer, the grabber also sat against the front rail, which
    // bridges the joint and seizes it solid -- the crate was dragged the whole
    // way along the floor with the ram straining against its own chassis.
    place('block', [0, 2, rail]);
    place('block', [0, 2, rail + 1]);
    place('block', [0, 2, rail + 2]);
    // Turned to face forward. A grabber reaches along its own up axis, so one
    // placed the natural way up takes hold of the sky; this one looks the way
    // the machine is going and takes the crate on the nose.
    // Half a metre higher than it needs to be to reach the crate on the
    // ground, because the ram's full stroke has to end with the crate's
    // underside above the pillar it is going on to. Slung lower, the crate is
    // lifted to just under the pillar top and jams against the face of it.
    const grab = place('grabber', [0, 1, rail + 2], FORWARD);
    rig.grab = grab.id;
  }

  return hoist ? { blueprint: bp, ...rig } : bp;
}
