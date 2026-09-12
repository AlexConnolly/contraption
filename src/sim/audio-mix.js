/**
 * What the machine should sound like, worked out from what it is doing.
 *
 * Everything on these machines is electric, so none of it idles and none of it
 * has a combustion note: what rises is the whine, and it rises with shaft
 * speed rather than with throttle. The clips these numbers drive are looped
 * and re-pitched rather than triggered, so the sound follows the controls
 * continuously — see ui/audio.js, which is where the files are named.
 *
 * This module is only the numbers, which is what makes it testable.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A motor under load pulls its pitch up; the whine is the inverter switching,
// so it tracks shaft speed rather than road speed.
export const DRIVE = {
  base: 42,
  perSpeed: 190,
  top: 1400,
  gain: 0.34,
};

export const ROTOR = {
  // Blade passes per revolution: the note a rotor makes is not its shaft
  // speed, it is how often a blade goes past you.
  blades: 2,
  base: 26,
  perSpin: 30,
  top: 900,
  gain: 0.40,
};

// Hinges, pistons and turntables are all the same thing to listen to: a small
// electric motor through a reduction. They share one voice, so a machine with
// six of them sounds like a machine rather than like six of them.
export const SERVO = {
  base: 60,
  perRate: 240,
  top: 1100,
  gain: 0.30,
};

export const JET = {
  // A thruster is mostly noise, so what changes with throttle is how bright
  // it is rather than what note it is.
  base: 420,
  perThrottle: 2600,
  gain: 0.46,
};

/**
 * One voice per kind of thing, rather than one per part: forty rotors at the
 * same throttle should sound like a big machine, not like forty machines.
 * Level rises with how many are running but flattens off, the way real
 * sources sum.
 */
export function blend(signals) {
  if (signals.length === 0) return { level: 0, drive: 0 };
  let energy = 0;
  let peak = 0;
  for (const value of signals) {
    const at = Math.abs(value);
    energy += at * at;
    peak = Math.max(peak, at);
  }
  // Sources that are not in step add as energy, not as amplitude, so four of
  // them are twice one rather than four times. The knee after that keeps a
  // machine with forty rotors on it from pinning the output: it approaches
  // full scale without ever arriving.
  const amplitude = Math.sqrt(energy);
  return { level: clamp(amplitude / (amplitude + 1), 0, 1), drive: peak };
}

/**
 * @param {object} state
 * @param {number[]} state.wheels     signal per driven wheel, -1..1
 * @param {number} state.wheelSpeed   fastest wheel's shaft speed, rad/s
 * @param {number[]} state.rotors     throttle per rotor, 0..1
 * @param {number} state.rotorSpin    fastest rotor's shaft speed, rad/s
 * @param {number[]} state.jets       throttle per thruster, 0..1
 */
export function voicesFor(state = {}) {
  const wheels = state.wheels ?? [];
  const rotors = state.rotors ?? [];
  const jets = state.jets ?? [];
  const servos = state.servos ?? [];

  const drive = blend(wheels);
  const rotor = blend(rotors);
  const jet = blend(jets);
  const servo = blend(servos);

  return {
    drive: {
      gain: drive.level * DRIVE.gain,
      freq: clamp(DRIVE.base + Math.abs(state.wheelSpeed ?? 0) * DRIVE.perSpeed, DRIVE.base, DRIVE.top),
    },
    rotor: {
      gain: rotor.level * ROTOR.gain,
      freq: clamp(
        ROTOR.base + Math.abs(state.rotorSpin ?? 0) * ROTOR.perSpin * ROTOR.blades,
        ROTOR.base,
        ROTOR.top,
      ),
    },
    jet: {
      gain: jet.level * JET.gain,
      cut: JET.base + jet.drive * JET.perThrottle,
    },
    servo: {
      gain: servo.level * SERVO.gain,
      freq: clamp(
        SERVO.base + Math.abs(state.servoRate ?? 0) * SERVO.perRate,
        SERVO.base,
        SERVO.top,
      ),
    },
  };
}
