import { describe, it, expect } from 'vitest';
import { voicesFor, blend, DRIVE, ROTOR } from '../src/sim/audio-mix.js';

describe('the machine mix', () => {
  it('is silent when nothing is running', () => {
    const v = voicesFor({});
    expect(v.drive.gain).toBe(0);
    expect(v.rotor.gain).toBe(0);
    expect(v.jet.gain).toBe(0);
  });

  it('raises the motor note with shaft speed, not with throttle', () => {
    const slow = voicesFor({ wheels: [1], wheelSpeed: 1 });
    const fast = voicesFor({ wheels: [1], wheelSpeed: 5 });
    expect(fast.drive.freq).toBeGreaterThan(slow.drive.freq);
    expect(fast.drive.gain).toBeCloseTo(slow.drive.gain, 5);
  });

  it('never lets the whine run away', () => {
    expect(voicesFor({ wheels: [1], wheelSpeed: 1e6 }).drive.freq).toBe(DRIVE.top);
    expect(voicesFor({ rotors: [1], rotorSpin: 1e6 }).rotor.freq).toBe(ROTOR.top);
  });

  it('sounds the same going backwards as forwards', () => {
    const forward = voicesFor({ wheels: [1, 1], wheelSpeed: 4 });
    const back = voicesFor({ wheels: [-1, -1], wheelSpeed: -4 });
    expect(back.drive.gain).toBeCloseTo(forward.drive.gain, 6);
    expect(back.drive.freq).toBeCloseTo(forward.drive.freq, 6);
  });

  it('pitches a rotor by blade passes, not by shaft speed', () => {
    const v = voicesFor({ rotors: [1], rotorSpin: 3 });
    expect(v.rotor.freq).toBeCloseTo(ROTOR.base + 3 * ROTOR.perSpin * ROTOR.blades, 6);
  });

  it('opens a thruster up as it is pushed, rather than changing its note', () => {
    const idle = voicesFor({ jets: [0.1] });
    const full = voicesFor({ jets: [1] });
    expect(full.jet.cut).toBeGreaterThan(idle.jet.cut * 2);
    expect(full.jet.gain).toBeGreaterThan(idle.jet.gain);
  });
});

describe('blending many of the same thing', () => {
  it('is silent with nothing to blend', () => {
    expect(blend([])).toEqual({ level: 0, drive: 0 });
  });

  it('gets louder with more sources but not proportionally', () => {
    const one = blend([1]).level;
    const four = blend([1, 1, 1, 1]).level;
    expect(four).toBeGreaterThan(one);
    expect(four).toBeLessThan(one * 4);
  });

  it('is led by the hardest-working source', () => {
    expect(blend([0, 0, 0, 1]).drive).toBe(1);
    expect(blend([0.2, 0.2]).drive).toBeCloseTo(0.2, 6);
  });

  it('stays inside the range whatever it is given', () => {
    const many = blend(new Array(64).fill(1));
    expect(many.level).toBeLessThanOrEqual(1);
    expect(many.level).toBeGreaterThan(0);
  });
});
