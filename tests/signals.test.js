import { describe, it, expect } from 'vitest';
import { SignalBus, bindingLabel, keyLabel, driveSide, driveMix, STEER_BIAS } from '../src/sim/signals.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';

function fakeInput() {
  const down = new Set();
  const pressed = new Set();
  return {
    down,
    pressed,
    isDown: (code) => down.has(code),
    wasPressed: (code) => pressed.has(code),
  };
}

describe('signals', () => {
  it('reads an axis binding as forward minus reverse', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    const binding = { mode: 'axis', pos: 'KeyW', neg: 'KeyS' };
    expect(bus.resolve('a', binding)).toBe(0);
    input.down.add('KeyW');
    expect(bus.resolve('a', binding)).toBe(1);
    input.down.add('KeyS');
    expect(bus.resolve('a', binding)).toBe(0);
    input.down.delete('KeyW');
    expect(bus.resolve('a', binding)).toBe(-1);
  });

  it('reads a hold binding only while the key is down', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    const binding = { mode: 'hold', pos: 'Space' };
    expect(bus.resolve('a', binding)).toBe(0);
    input.down.add('Space');
    expect(bus.resolve('a', binding)).toBe(1);
  });

  it('latches a toggle on the key edge, not while held', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    const binding = { mode: 'toggle', pos: 'KeyG' };

    input.pressed.add('KeyG');
    expect(bus.resolve('a', binding)).toBe(1);
    input.pressed.clear();
    input.down.add('KeyG');
    expect(bus.resolve('a', binding)).toBe(1);

    input.down.clear();
    input.pressed.add('KeyG');
    expect(bus.resolve('a', binding)).toBe(0);
  });

  it('keeps toggle state separate per part', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    const binding = { mode: 'toggle', pos: 'KeyG' };
    input.pressed.add('KeyG');
    expect(bus.resolve('a', binding)).toBe(1);
    bus.toggles.set('b', false);
    expect(bus.toggles.get('a')).toBe(true);
    expect(bus.toggles.get('b')).toBe(false);
  });

  it('follows a sensor source, and inverts it on request', () => {
    const bus = new SignalBus(fakeInput());
    bus.setSensor('s1', 0.75);
    expect(bus.resolve('a', { mode: 'sensor', source: 's1' })).toBe(0.75);
    expect(bus.resolve('a', { mode: 'sensor', source: 's1', invert: true })).toBe(0.25);
    expect(bus.resolve('a', { mode: 'sensor', source: 'missing' })).toBe(0);
  });

  it('reads zero for an unbound actuator', () => {
    const bus = new SignalBus(fakeInput());
    expect(bus.resolve('a', null)).toBe(0);
    expect(bus.resolve('a', { mode: 'hold', pos: null })).toBe(0);
  });

  it('labels bindings for the UI', () => {
    expect(bindingLabel({ mode: 'axis', pos: 'KeyW', neg: 'KeyS' })).toBe('W / S');
    expect(bindingLabel({ mode: 'toggle', pos: 'KeyG' })).toBe('toggle G');
    expect(bindingLabel(null)).toBe('unbound');
    expect(keyLabel('ShiftLeft')).toBe('Shift L');
  });
});

describe('drive bindings', () => {
  const binding = { mode: 'drive', pos: 'KeyW', neg: 'KeyS', left: 'KeyA', right: 'KeyD' };
  // Forward is +Z and up is +Y, so the machine's right is forward x up = -X.
  // driveSide is +1 for a wheel whose axle points along +X, which puts it on
  // the machine's left.
  const LEFT = { ...binding, side: 1 };
  const RIGHT = { ...binding, side: -1 };

  it('drives both sides equally on throttle alone', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    input.down.add('KeyW');
    expect(bus.resolve('l', LEFT)).toBe(1);
    expect(bus.resolve('r', RIGHT)).toBe(1);
  });

  it('steers right by driving the left wheels and reversing the right', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    input.down.add('KeyD');
    expect(bus.resolve('l', LEFT)).toBe(1);
    expect(bus.resolve('r', RIGHT)).toBe(-1);
  });

  it('steers left the opposite way round', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    input.down.add('KeyA');
    expect(bus.resolve('l', LEFT)).toBe(-1);
    expect(bus.resolve('r', RIGHT)).toBe(1);
  });

  // Adding steer to a full throttle and clamping does not steer: the outside
  // wheel saturates and the inside one is only brought to a stop, which on a
  // machine already moving is a wheel being dragged. The throttle is backed
  // off first so the inside wheel can actually reverse.
  it('reverses the inside wheel rather than merely stopping it', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    input.down.add('KeyW');
    input.down.add('KeyA');
    expect(bus.resolve('l', LEFT)).toBeLessThan(0);
    expect(bus.resolve('r', RIGHT)).toBe(1);
  });

  it('keeps both wheels inside the motor range', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    input.down.add('KeyW');
    input.down.add('KeyA');
    for (const binding of [LEFT, RIGHT]) {
      const value = bus.resolve('x', binding);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('still carries some throttle through a turn rather than pivoting', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    input.down.add('KeyW');
    input.down.add('KeyA');
    // Both wheels reversed would be a spin; one forward and one back, with the
    // pair summing forward, is a machine driving round a corner.
    expect(bus.resolve('l', LEFT) + bus.resolve('r', RIGHT)).toBeGreaterThan(0);
  });

  // Reversing swaps which way the machine swings for the same key, the way a
  // car does: hold left while backing up and the machine comes round to the
  // right, which is what it looks like from behind the wheel.
  it('swaps the steering round while reversing', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    input.down.add('KeyS');
    input.down.add('KeyA');
    // Forward and left drives the left wheels back and the right wheels on.
    // Backward and left has to do the opposite of that.
    expect(bus.resolve('l', LEFT)).toBeGreaterThan(0);
    expect(bus.resolve('r', RIGHT)).toBe(-1);
  });

  it('steers normally again as soon as it is driving forward', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    input.down.add('KeyW');
    input.down.add('KeyA');
    expect(bus.resolve('l', LEFT)).toBeLessThan(0);
    expect(bus.resolve('r', RIGHT)).toBe(1);
  });

  it('steers on the spot the same way whichever keys got it there', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    input.down.add('KeyA');
    expect(bus.resolve('l', LEFT)).toBe(-1);
    expect(bus.resolve('r', RIGHT)).toBe(1);
  });

  it('leaves a straight line alone', () => {
    const input = fakeInput();
    const bus = new SignalBus(input);
    input.down.add('KeyW');
    expect(driveMix(1, 0)).toBe(1);
    expect(bus.resolve('l', LEFT)).toBe(1);
    expect(bus.resolve('r', RIGHT)).toBe(1);
  });

  it('backs the throttle off in proportion to the steer asked for', () => {
    expect(driveMix(1, 1)).toBeCloseTo(1 - STEER_BIAS, 6);
    expect(driveMix(1, -1)).toBeCloseTo(1 - STEER_BIAS, 6);
    expect(driveMix(-1, 1)).toBeCloseTo(-(1 - STEER_BIAS), 6);
    expect(driveMix(0, 1)).toBe(0);
  });

  it('reads the axle direction a wheel is bolted on with', () => {
    expect(driveSide(IDENTITY_ORIENTATION)).toBe(1);
    const flipped = yawStep(yawStep(IDENTITY_ORIENTATION));
    expect(driveSide(flipped)).toBe(-1);
  });

  it('labels a drive binding with its four keys', () => {
    expect(bindingLabel(binding)).toBe('WASD');
  });
});
