import { describe, it, expect } from 'vitest';
import { SignalBus, bindingLabel, keyLabel } from '../src/sim/signals.js';

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
