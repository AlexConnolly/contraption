import * as THREE from 'three';
import { groupBlueprint } from './grouping.js';
import { getPart, CELL } from '../parts/registry.js';
import { applyOrientation } from '../core/orientation.js';
import { occupiedCells } from '../core/blueprint.js';

export const CHANNELS = ['climb', 'pitch', 'yaw', 'roll'];

const EPSILON = 1e-4;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

/**
 * The machine's reference frame, taken from the controller's own orientation
 * so a controller mounted sideways flies the machine sideways. Forward is its
 * local +Z and up its local +Y; right is forward x up, which is -X.
 */
export function frameFromAxes(forward, up) {
  const f = new THREE.Vector3(...forward).normalize();
  const u = new THREE.Vector3(...up).normalize();
  return { forward: f, up: u, right: f.clone().cross(u).normalize() };
}

/**
 * Works out what each thruster can actually do for each control channel,
 * from where it sits and which way it points.
 *
 * `climb` is the honest fraction of its thrust that acts along the machine's
 * up axis. The three attitude channels come from the torque it makes about the
 * centre of mass — offset x thrust, plus a rotor's reaction torque, which is
 * the only thing that lets a flat drone with four upward rotors yaw at all.
 * Those three are normalised across the machine, so they are a share of the
 * available authority rather than a physical quantity.
 */
export function deriveGains(thrusters, frame) {
  const { forward, up, right } = frame;
  const raw = thrusters.map((t) => {
    const dir = new THREE.Vector3(...t.dir).normalize();
    const offset = new THREE.Vector3(...t.offset);
    const force = dir.clone().multiplyScalar(t.maxThrust);
    const torque = offset.clone().cross(force);
    if (t.reaction) {
      torque.addScaledVector(dir, -(t.spin ?? 1) * t.reaction);
    }
    return {
      id: t.id,
      climb: clamp(dir.dot(up), 0, 1),
      // Nose-down is negative torque about `right`, and nose-down is how a
      // rotorcraft moves forward; a thruster already facing forward counts
      // directly.
      pitch: force.dot(forward) - torque.dot(right),
      yaw: -torque.dot(up),
      roll: torque.dot(forward),
    };
  });

  for (const channel of ['pitch', 'yaw', 'roll']) {
    const scale = Math.max(...raw.map((r) => Math.abs(r[channel])), 0);
    for (const entry of raw) {
      entry[channel] = scale > EPSILON ? entry[channel] / scale : 0;
    }
  }

  const gains = new Map();
  for (const entry of raw) {
    gains.set(entry.id, {
      climb: round(entry.climb),
      pitch: round(entry.pitch),
      yaw: round(entry.yaw),
      roll: round(entry.roll),
    });
  }
  return gains;
}

function range(entries) {
  let low = Infinity;
  let high = -Infinity;
  for (const entry of entries) {
    const value = entry.base + entry.trim;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return high - low;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Alternating rotor handedness in the usual X pattern, so diagonal pairs spin
 * the same way and differential thrust yaws the machine.
 */
export function defaultSpin(offset, frame) {
  const alongRight = new THREE.Vector3(...offset).dot(frame.right);
  const alongForward = new THREE.Vector3(...offset).dot(frame.forward);
  if (Math.abs(alongRight) < EPSILON || Math.abs(alongForward) < EPSILON) return 1;
  return Math.sign(alongRight * alongForward) || 1;
}

export function readFlightKeys(input, keys) {
  const down = (code) => (code ? input.isDown(code) : false);
  return {
    pitch: (down(keys.forward) ? 1 : 0) - (down(keys.back) ? 1 : 0),
    yaw: (down(keys.right) ? 1 : 0) - (down(keys.left) ? 1 : 0),
    climb: (down(keys.up) ? 1 : 0) - (down(keys.down) ? 1 : 0),
  };
}

/**
 * Turns pilot intent into a throttle for every thruster it drives.
 *
 * Altitude is held by a cascaded pair of proportional loops — altitude error
 * sets a target climb rate, climb-rate error sets an acceleration — and the
 * result is converted to throttle through the machine's real mass and the lift
 * the thrusters can actually produce. Nothing is teleported or damped by hand;
 * every output is a throttle that becomes a real force.
 */
export class FlightController {
  constructor(tuning) {
    this.tuning = tuning;
    this.targetAltitude = null;
    this.altitudeIntegral = 0;
    this.channels = { climb: 0, pitch: 0, yaw: 0, roll: 0 };
  }

  reset() {
    this.targetAltitude = null;
    this.altitudeIntegral = 0;
  }

  // A program can name the height to sit at instead of the controller keeping
  // whatever height the pilot last left it at.
  holdAltitude(altitude) {
    if (this.targetAltitude !== altitude) this.altitudeIntegral = 0;
    this.targetAltitude = altitude;
    this.commanded = true;
  }

  update(dt, command, state) {
    const t = this.tuning;
    const { mass, gravity, liftAuthority, altitude, verticalSpeed } = state;

    if (this.targetAltitude === null) this.targetAltitude = altitude;

    // Altitude -> climb rate -> acceleration. Holding a key drives the rate
    // directly and drags the held altitude along with it.
    let targetRate;
    if (Math.abs(command.climb) > EPSILON && !this.commanded) {
      targetRate = command.climb * t.maxClimbRate;
      this.targetAltitude = altitude;
      this.altitudeIntegral = 0;
    } else {
      const error = this.targetAltitude - altitude;
      // Proportional alone leaves the machine sitting slightly low, because
      // whatever lift the attitude trim spends never gets asked back. The
      // integral closes that gap; the limit stops it winding up while the
      // machine is held down or thrust-limited.
      this.altitudeIntegral = clamp(
        this.altitudeIntegral + error * dt,
        -t.integralLimit,
        t.integralLimit,
      );
      targetRate = clamp(
        error * t.altitudeGain,
        -t.maxClimbRate,
        t.maxClimbRate,
      );
    }
    const desiredAccel = (targetRate - verticalSpeed) * t.climbRateGain
      + this.altitudeIntegral * t.integralGain;

    // Thrust acts along the machine's up axis, so a banked machine needs more
    // of it to hold the same vertical force.
    const tilt = Math.max(0.25, state.bodyUp.dot(WORLD_UP));
    const neededForce = mass * (gravity + desiredAccel);
    const climb = liftAuthority > EPSILON
      ? clamp(neededForce / (liftAuthority * tilt), 0, 1)
      : 0;

    // With no stick input the controller leans against whatever drift it has,
    // which is how a real one loiters. It also quietly absorbs a lopsided
    // centre of mass: the craft settles at whatever trim holds it still.
    // Leaning a machine accelerates it the way it leans, so braking means
    // leaning against the drift: nose up to kill forward speed, left wing down
    // to kill rightward speed.
    const lean = (speed) => clamp(-speed * t.velocityGain, -t.maxLean, t.maxLean);
    const targetLean = Math.abs(command.pitch) > EPSILON
      ? command.pitch * t.maxLean
      : lean(state.forwardSpeed);
    // A program can ask for a lean sideways; with nothing asked the controller
    // goes back to leaning against its own drift.
    const targetRoll = Math.abs(command.roll ?? 0) > EPSILON
      ? command.roll * t.maxLean
      : lean(state.rightSpeed);

    const pitch = clamp(
      (targetLean - state.pitchDown) * t.attitudeGain
        - state.pitchRateDown * t.attitudeDamping,
      -1, 1,
    );
    const roll = clamp(
      (targetRoll - state.rollRight) * t.attitudeGain
        - state.rollRateRight * t.attitudeDamping,
      -1, 1,
    );
    const yaw = clamp(
      (command.yaw * t.maxYawRate - state.yawRateRight) * t.yawGain,
      -1, 1,
    );

    this.channels = { climb, pitch, yaw, roll };
    this.commanded = false;
    return this.channels;
  }

  /**
   * Blends the channels down to one throttle per thruster.
   *
   * Two things have to hold at once. Attitude control must survive, because a
   * machine that stops correcting its lean tips over and never comes back —
   * so where the mix would run past the ends of the throttle range, the whole
   * band slides instead of the differences between thrusters being flattened.
   * Losing a little height is recoverable; losing attitude authority is not.
   *
   * The exception is trim that costs net lift rather than just moving it
   * around, which is the single-rotor case: its reaction torque is welded to
   * its lift, so fighting the spin can only drop the machine. That much trim
   * is allowed only as far as the altitude loop has throttle left to win back.
   */
  mix(gains) {
    const { climb, pitch, yaw, roll } = this.channels;
    const authority = this.tuning.authority;
    const entries = [...gains].map(([id, g]) => ({
      id,
      climbGain: g.climb,
      base: climb * g.climb,
      trim: (pitch * g.pitch + yaw * g.yaw + roll * g.roll) * authority,
    }));

    let liftCost = 0;
    let totalClimbGain = 0;
    for (const entry of entries) {
      liftCost += entry.trim * entry.climbGain;
      totalClimbGain += entry.climbGain;
    }
    if (liftCost < -EPSILON) {
      const recoverable = (1 - clamp(climb, 0, 1)) * totalClimbGain;
      const allowed = clamp(recoverable / -liftCost, 0, 1);
      for (const entry of entries) entry.trim *= allowed;
    }

    // If the spread is wider than the throttle range itself, no amount of
    // sliding will fit it, so squeeze it down to something that does.
    const spread = range(entries);
    if (spread > 1) {
      for (const entry of entries) entry.trim /= spread;
    }

    // Only ever slide the band down. Sliding it up to make room for a
    // negative trim would hand the machine lift nobody asked for, and at low
    // throttle that compounds into a climb it cannot be talked out of.
    let over = 0;
    for (const entry of entries) {
      over = Math.max(over, entry.base + entry.trim - 1);
    }

    const out = new Map();
    for (const entry of entries) {
      out.set(entry.id, clamp(entry.base + entry.trim - over, 0, 1));
    }

    // Clamping at zero can still leave more lift than the climb channel asked
    // for, so take the difference back off every thruster evenly.
    if (totalClimbGain > EPSILON) {
      let demanded = 0;
      let produced = 0;
      for (const entry of entries) {
        demanded += entry.base * entry.climbGain;
        produced += out.get(entry.id) * entry.climbGain;
      }
      const excess = (produced - demanded) / totalClimbGain;
      if (excess > EPSILON) {
        for (const entry of entries) {
          out.set(entry.id, clamp(out.get(entry.id) - excess, 0, 1));
        }
      }
    }
    return out;
  }
}

/**
 * Attitude of a machine in terms a pilot cares about: how far the nose is
 * down, how far it is rolled to the right, and how fast each is changing.
 */
export function attitudeOf(frameWorld, angvel) {
  const { forward, up, right } = frameWorld;
  const omega = new THREE.Vector3(angvel.x, angvel.y, angvel.z);
  return {
    bodyUp: up,
    pitchDown: Math.asin(clamp(-forward.dot(WORLD_UP), -1, 1)),
    rollRight: Math.asin(clamp(-right.dot(WORLD_UP), -1, 1)),
    pitchRateDown: -omega.dot(right),
    rollRateRight: omega.dot(forward),
    yawRateRight: -omega.dot(up),
  };
}

export function firstController(blueprint) {
  return blueprint.list().find((p) => getPart(p.type).flight) ?? null;
}

export function controllerOf(blueprint, placed) {
  const binding = placed.config.binding;
  if (binding?.mode !== 'flight') return null;
  return binding.source ?? firstController(blueprint)?.id ?? null;
}

/**
 * The same mixing maths the machine runs, worked out from the blueprint alone
 * so the studio can show what each thruster will be asked to do before anyone
 * takes off. The centre of mass comes from part masses rather than from the
 * solver, so the numbers are a close estimate rather than the exact figures
 * the running machine derives.
 */
export function estimateGains(blueprint, controllerId) {
  const controller = blueprint.get(controllerId);
  if (!controller) return new Map();

  const grouping = groupBlueprint(blueprint);
  const bodyIndex = grouping.bodyOfPart.get(controllerId);
  const frame = frameFromAxes(
    applyOrientation(controller.rot, [0, 0, 1]),
    applyOrientation(controller.rot, [0, 1, 0]),
  );

  const com = new THREE.Vector3();
  let total = 0;
  for (const placed of blueprint.list()) {
    if (grouping.bodyOfPart.get(placed.id) !== bodyIndex) continue;
    const part = getPart(placed.type);
    const mass = part.mass * occupiedCells(placed.type, placed.cell, placed.rot).length;
    com.addScaledVector(new THREE.Vector3(...placed.cell).multiplyScalar(CELL), mass);
    total += mass;
  }
  if (total > EPSILON) com.divideScalar(total);

  const specs = [];
  for (const placed of blueprint.list()) {
    const part = getPart(placed.type);
    if (!part.thruster || controllerOf(blueprint, placed) !== controllerId) continue;
    const offset = new THREE.Vector3(...placed.cell).multiplyScalar(CELL).sub(com).toArray();
    specs.push({
      id: placed.id,
      offset,
      dir: applyOrientation(placed.rot, part.thruster.axis),
      maxThrust: part.thruster.maxThrust * (placed.config.power ?? 1),
      reaction: part.thruster.reaction ?? 0,
      spin: placed.config.spin ?? defaultSpin(offset, frame),
    });
  }
  return deriveGains(specs, frame);
}
