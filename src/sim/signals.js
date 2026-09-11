import { applyOrientation } from '../core/orientation.js';

// Turns key state and sensor readings into a signal in [-1, 1] per actuator.

export const BINDING_MODES = [
  { id: 'drive', name: 'Drive (throttle + steer)', keys: ['pos', 'neg', 'left', 'right'] },
  { id: 'axis', name: 'Axis (two keys)', keys: ['pos', 'neg'] },
  { id: 'hold', name: 'Hold', keys: ['pos'] },
  { id: 'toggle', name: 'Toggle', keys: ['pos'] },
  { id: 'flight', name: 'Flight controller', keys: [] },
  { id: 'sensor', name: 'Driven by sensor', keys: [] },
  { id: 'always', name: 'Always on', keys: [] },
];

export function defaultBinding(part) {
  return part.actuator?.defaultBinding
    ? { ...part.actuator.defaultBinding }
    : { mode: 'hold', pos: null };
}

export class SignalBus {
  constructor(input) {
    this.input = input;
    this.toggles = new Map();
    this.sensors = new Map();
    this.channels = new Map();
  }

  setSensor(partId, value) {
    this.sensors.set(partId, value);
  }

  setChannel(partId, value) {
    this.channels.set(partId, value);
  }

  channel(partId) {
    return this.channels.get(partId) ?? 0;
  }

  sensor(partId) {
    return this.sensors.get(partId) ?? 0;
  }

  reset() {
    this.toggles.clear();
    this.sensors.clear();
    this.channels.clear();
  }

  resolve(partId, binding) {
    if (!binding) return 0;
    const down = (code) => (code ? this.input.isDown(code) : false);
    switch (binding.mode) {
      // One wheel either side of the machine turns by slowing itself and
      // speeding up its opposite number, so WASD steers like a tank. Steering
      // right means driving the left-hand wheels harder, hence the plus.
      case 'drive': {
        const throttle = (down(binding.pos) ? 1 : 0) - (down(binding.neg) ? 1 : 0);
        const steer = (down(binding.right) ? 1 : 0) - (down(binding.left) ? 1 : 0);
        const side = binding.side ?? 1;
        // Backing up swaps which way the same key swings the machine, so left
        // is still left from where the driver is sitting. Turning on the spot
        // has no direction of travel to reverse, so it keeps the forward sense.
        const sense = throttle < 0 ? -1 : 1;
        return Math.max(-1, Math.min(1, throttle + side * steer * sense));
      }
      case 'axis':
        return (down(binding.pos) ? 1 : 0) - (down(binding.neg) ? 1 : 0);
      case 'hold':
        return down(binding.pos) ? 1 : 0;
      case 'toggle': {
        if (binding.pos && this.input.wasPressed(binding.pos)) {
          this.toggles.set(partId, !this.toggles.get(partId));
        }
        return this.toggles.get(partId) ? 1 : 0;
      }
      // The controller writes a throttle per thruster before anything resolves.
      case 'flight':
        return this.channel(partId);
      case 'sensor': {
        const raw = this.sensor(binding.source);
        return binding.invert ? 1 - raw : raw;
      }
      case 'always':
        return 1;
      default:
        return 0;
    }
  }
}

export function bindingLabel(binding) {
  if (!binding) return 'unbound';
  switch (binding.mode) {
    case 'drive':
      return `${keyLabel(binding.pos)}${keyLabel(binding.left)}${keyLabel(binding.neg)}${keyLabel(binding.right)}`;
    case 'axis':
      return `${keyLabel(binding.pos)} / ${keyLabel(binding.neg)}`;
    case 'hold':
      return `hold ${keyLabel(binding.pos)}`;
    case 'toggle':
      return `toggle ${keyLabel(binding.pos)}`;
    case 'flight':
      return 'flight controller';
    case 'sensor':
      return binding.invert ? 'sensor (inverted)' : 'sensor';
    case 'always':
      return 'always on';
    default:
      return 'unbound';
  }
}

export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return code.replace('Left', ' L').replace('Right', ' R');
}

/**
 * Which way round a wheel is bolted on: +1 when its axle points along a
 * positive world axis, -1 when it points the other way. Two wheels facing each
 * other across a chassis have opposite axle directions, so one of them has to
 * be driven in reverse to roll the same way as the other.
 *
 * With forward at +Z and up at +Y, the machine's right is forward x up = -X,
 * so a wheel returning +1 sits on the machine's LEFT.
 */
export function driveSide(rot) {
  const axle = applyOrientation(rot, [1, 0, 0]);
  const dominant = axle.find((n) => n !== 0) ?? 1;
  return dominant < 0 ? -1 : 1;
}
