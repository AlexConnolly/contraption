// Turns key state and sensor readings into a signal in [-1, 1] per actuator.

export const BINDING_MODES = [
  { id: 'axis', name: 'Axis (two keys)', keys: ['pos', 'neg'] },
  { id: 'hold', name: 'Hold', keys: ['pos'] },
  { id: 'toggle', name: 'Toggle', keys: ['pos'] },
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
  }

  setSensor(partId, value) {
    this.sensors.set(partId, value);
  }

  sensor(partId) {
    return this.sensors.get(partId) ?? 0;
  }

  reset() {
    this.toggles.clear();
    this.sensors.clear();
  }

  resolve(partId, binding) {
    if (!binding) return 0;
    const down = (code) => (code ? this.input.isDown(code) : false);
    switch (binding.mode) {
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
    case 'axis':
      return `${keyLabel(binding.pos)} / ${keyLabel(binding.neg)}`;
    case 'hold':
      return `hold ${keyLabel(binding.pos)}`;
    case 'toggle':
      return `toggle ${keyLabel(binding.pos)}`;
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
