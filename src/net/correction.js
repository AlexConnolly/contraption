import * as THREE from 'three';

/**
 * Making somebody else's world feel like this one.
 *
 * The honest version — put every body exactly where the host last said it was
 * — is correct and horrible. On a hundred-millisecond link the machine you are
 * driving answers the accelerator a tenth of a second late and then jerks
 * twenty times a second as it is dragged back to where the host had it a tenth
 * of a second ago. Everything below exists to take that away without lying
 * about where anything is.
 *
 * Three things do the work, and they are in order of how much:
 *
 * **Velocity.** The snapshot carries how each body is moving, not only where
 * it is. A client fed that carries on under its own physics between snapshots
 * and arrives at almost the right place by itself, so the correction has
 * nearly nothing left to do. Without it a machine somebody else is driving
 * stands still and is dragged forward twenty times a second.
 *
 * **Lead.** What arrived is where things were half a round trip ago. Carried
 * forward by that much, using the velocity that came with it, it says where
 * they are now — which is what the player should be looking at.
 *
 * **Blend.** Whatever error is left is closed over several snapshots rather
 * than in one step, so a correction is a drift rather than a jump. The machine
 * you are driving gets the gentlest blend of all, because a correction you can
 * feel through the controls is far worse than one you merely see.
 *
 * The one thing that is not smoothed is being properly wrong. Past a few
 * metres the body is not drifting, it is somewhere else — through a wall, or
 * still on a roof it fell off — and easing it across the gap looks far worse
 * than putting it where it belongs.
 */

/**
 * Swept on the rig in `tests/laglink.js`, at fifty milliseconds clean and at a
 * hundred with forty of jitter and a five per cent retransmit rate, against
 * how far the client is from the host and how far a body is shifted by one
 * correction. Against putting every body exactly where the host last said it
 * was, on the bad link, this is:
 *
 *                                      flat      here
 *     watching somebody else drive     0.43 m    0.20 m   out of place
 *                                      1.31 m    0.19 m   shifted at once
 *     driving it yourself              0.41 m    0.19 m   out of place
 *                                      0.49 m    0.15 m   shifted at once
 *
 * — that is, better on both counts at once, which is not what a smoothing
 * usually buys. It is the velocity and the lead that do it: with those, the
 * client is mostly right by itself, so the blend can afford to be gentle.
 */
export const CORRECTION = {
  /**
   * How much of the remaining error is closed per snapshot. The sweep put the
   * machine you are driving and the ones you are watching at the same number,
   * which is a coincidence rather than a rule; they are kept apart because
   * what they are trading off is different.
   */
  blend: 0.1,
  ownBlend: 0.1,
  /**
   * How much of the host's velocity is taken per snapshot.
   *
   * Nearly all of it, and all of it for the machine in your hands — which is
   * the opposite of what it sounds like it should be. The host has your keys,
   * so the velocity it reports is what your machine is genuinely doing; taking
   * it outright costs nothing and stops the drift before it starts. It is the
   * position that must not be shoved, and the position has its own gentle
   * number above.
   */
  adopt: 0.8,
  ownAdopt: 1,
  /** Metres of error past which it is not drift, it is somewhere else. */
  snapAt: 3,
  ownSnapAt: 8,
  /** Below this, the body is where it should be and is left alone asleep. */
  still: 0.004,
};

const here = new THREE.Quaternion();
const there = new THREE.Quaternion();
const spin = new THREE.Quaternion();
const axis = new THREE.Vector3();

/** A rotation carried forward by the way it is turning. */
function leadRotation(q, w, lead) {
  const rate = Math.hypot(w[0], w[1], w[2]);
  there.set(q[0], q[1], q[2], q[3]);
  if (rate < 1e-4 || lead <= 0) return there;
  axis.set(w[0] / rate, w[1] / rate, w[2] / rate);
  spin.setFromAxisAngle(axis, rate * lead);
  return there.premultiply(spin);
}

/**
 * Puts a snapshot onto a world as a correction rather than as the truth.
 *
 * `mine` is the machine this player is driving, which is predicted locally and
 * so is corrected far more gently than the rest.
 */
export function correct(session, snap, options = {}) {
  const {
    mine = null, lead = 0, ...tuning
  } = options;
  const set = { ...CORRECTION, ...tuning };

  let moved = 0;
  let snapped = 0;
  let worst = 0;
  let total = 0;
  // The furthest any single body is actually shifted by this correction. That
  // is the discontinuity a player sees, as opposed to the error, which is what
  // they would have seen if nothing were done about it.
  let shifted = 0;

  for (const vehicle of snap.vehicles) {
    const member = session.fleet.get(`v${vehicle.num}`);
    if (!member) continue;
    const { bodies } = member.machine;
    if (bodies.length !== vehicle.bodies.length) continue;

    const own = member.id === mine;
    const blend = own ? set.ownBlend : set.blend;
    const adopt = own ? set.ownAdopt : set.adopt;
    const limit = own ? set.ownSnapAt : set.snapAt;

    for (let i = 0; i < bodies.length; i += 1) {
      const body = bodies[i];
      const {
        p, q, v, w,
      } = vehicle.bodies[i];

      // Where the host's copy would have got to by now.
      const wantX = p[0] + v[0] * lead;
      const wantY = p[1] + v[1] * lead;
      const wantZ = p[2] + v[2] * lead;

      const at = body.translation();
      const dx = wantX - at.x;
      const dy = wantY - at.y;
      const dz = wantZ - at.z;
      const off = Math.hypot(dx, dy, dz);
      worst = Math.max(worst, off);
      total += off;

      const speed = Math.hypot(v[0], v[1], v[2]) + Math.hypot(w[0], w[1], w[2]);
      // Already where it should be and going nowhere: leave it alone, which
      // also leaves it asleep. Waking a parked machine twenty times a second
      // to tell it that it has not moved is the whole cost of a city.
      if (off < set.still && speed < set.still) continue;

      const target = leadRotation(q, w, lead);
      if (off > limit) {
        body.setTranslation({ x: wantX, y: wantY, z: wantZ }, true);
        body.setRotation({
          x: target.x, y: target.y, z: target.z, w: target.w,
        }, true);
        body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
        body.setAngvel({ x: w[0], y: w[1], z: w[2] }, true);
        snapped += 1;
        moved += 1;
        shifted = Math.max(shifted, off);
        continue;
      }

      body.setTranslation({
        x: at.x + dx * blend, y: at.y + dy * blend, z: at.z + dz * blend,
      }, true);
      shifted = Math.max(shifted, off * blend);

      const r = body.rotation();
      here.set(r.x, r.y, r.z, r.w);
      here.slerp(target, blend);
      body.setRotation({
        x: here.x, y: here.y, z: here.z, w: here.w,
      }, true);

      const lv = body.linvel();
      body.setLinvel({
        x: lv.x + (v[0] - lv.x) * adopt,
        y: lv.y + (v[1] - lv.y) * adopt,
        z: lv.z + (v[2] - lv.z) * adopt,
      }, true);
      const av = body.angvel();
      body.setAngvel({
        x: av.x + (w[0] - av.x) * adopt,
        y: av.y + (w[1] - av.y) * adopt,
        z: av.z + (w[2] - av.z) * adopt,
      }, true);
      moved += 1;
    }
  }

  session.tick = snap.tick;
  session.elapsed = snap.elapsed;
  return {
    moved, snapped, worst, shifted, average: moved ? total / moved : 0,
  };
}

/**
 * How long a message takes to arrive, as a number that does not jump about.
 *
 * A single round trip is a noisy thing to steer by — one slow packet would
 * throw every machine on screen forward and back again — so it is smoothed,
 * and it comes down faster than it goes up so a brief spike does not linger.
 */
export class Trip {
  constructor({ smoothing = 0.1 } = {}) {
    this.smoothing = smoothing;
    this.rtt = 0;
    this.samples = 0;
  }

  add(ms) {
    if (!Number.isFinite(ms) || ms < 0) return this.rtt;
    this.samples += 1;
    if (this.samples === 1) {
      this.rtt = ms;
      return this.rtt;
    }
    const k = ms < this.rtt ? Math.min(1, this.smoothing * 3) : this.smoothing;
    this.rtt += (ms - this.rtt) * k;
    return this.rtt;
  }

  /**
   * How far forward a snapshot should be carried: the half of the round trip
   * it spent coming to us, plus half the gap between snapshots, so a body is
   * shown in the middle of the window it is known to be in rather than at the
   * back of it.
   *
   * Capped, because carrying a physics body forward is a guess that a
   * constant velocity holds, and past a fraction of a second it does not: the
   * machine has hit something, or turned, or bounced. Measured on a link bad
   * enough to need more than this, leading further made it worse, not better.
   */
  lead(snapshotPeriod = 0.05, cap = 0.2) {
    return Math.min(cap, this.rtt / 2000 + snapshotPeriod / 2);
  }
}
