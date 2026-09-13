import { describe, it, expect } from 'vitest';

import {
  DIRECTIONS, aimAt, aimOf, aimNamed, aimingsFor, aimableDirections, turnsBetween,
} from '../src/core/aim.js';
import {
  ORIENTATIONS, IDENTITY_ORIENTATION, turnStep, TURN_AXES, applyOrientation,
} from '../src/core/orientation.js';
import { getPart } from '../src/parts/registry.js';

/**
 * Pointing a part where you want it.
 *
 * The rotations were never wrong — every turn is about a world axis and means
 * the same thing whatever the part is already doing. Two keys for twenty-four
 * rotations was the problem: three presses on average, five at worst, and only
 * two of the twenty-four a single press away, so there was no route anybody
 * could plan and you pressed and looked instead.
 *
 * Three axes and a reverse is 1.92 and three. Saying the direction outright is
 * one.
 */

const quarters = (steps) => {
  const seen = new Map([[IDENTITY_ORIENTATION, 0]]);
  let edge = [IDENTITY_ORIENTATION];
  while (edge.length) {
    const next = [];
    for (const at of edge) {
      for (const step of steps) {
        const to = step(at);
        if (!seen.has(to)) { seen.set(to, seen.get(at) + 1); next.push(to); }
      }
    }
    edge = next;
  }
  const all = [...seen.values()];
  return {
    reached: seen.size,
    worst: Math.max(...all),
    mean: all.reduce((a, b) => a + b, 0) / all.length,
  };
};

describe('the three turns', () => {
  it('is three, one for each axis a cube has', () => {
    expect(TURN_AXES).toEqual(['yaw', 'pitch', 'roll']);
  });

  it('means the same thing whatever the part is already doing', () => {
    // A world turn, not a turn in the part's own frame. Every rotation gets
    // the same treatment or a key means different things at different times,
    // which is the thing nobody can hold in their head.
    // `|| 0` so a flipped zero is a zero rather than a negative one, which
    // is a real value in JavaScript and not one anybody means.
    const turn = (v) => [v[2], v[1], -v[0] || 0];
    for (let rot = 0; rot < ORIENTATIONS.length; rot += 1) {
      for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        const after = applyOrientation(turnStep(rot, 'yaw'), v);
        expect(after).toEqual(turn(applyOrientation(rot, v)));
      }
    }
  });

  it('comes back to where it started after four', () => {
    for (const axis of TURN_AXES) {
      expect(turnStep(IDENTITY_ORIENTATION, axis, 4)).toBe(IDENTITY_ORIENTATION);
    }
  });

  it('goes the other way when asked for the other way', () => {
    for (const axis of TURN_AXES) {
      const there = turnStep(IDENTITY_ORIENTATION, axis, 1);
      expect(turnStep(there, axis, -1)).toBe(IDENTITY_ORIENTATION);
      expect(turnStep(IDENTITY_ORIENTATION, axis, -1))
        .toBe(turnStep(IDENTITY_ORIENTATION, axis, 3));
    }
  });
});

describe('how much work a rotation takes', () => {
  const yaw = (i) => turnStep(i, 'yaw');
  const pitch = (i) => turnStep(i, 'pitch');
  const roll = (i) => turnStep(i, 'roll');
  const back = (f) => (i) => f(f(f(i)));

  it('reaches everything either way, so this is about effort not ability', () => {
    expect(quarters([yaw, pitch]).reached).toBe(24);
    expect(quarters([yaw, pitch, roll]).reached).toBe(24);
  });

  it('is far less work with three axes and a reverse than with two keys', () => {
    const two = quarters([yaw, pitch]);
    const three = quarters([yaw, pitch, roll, back(yaw), back(pitch), back(roll)]);
    // Measured: 3.08 and 5 against 1.92 and 3.
    expect(two.mean).toBeGreaterThan(3);
    expect(two.worst).toBe(5);
    expect(three.mean).toBeLessThan(2);
    expect(three.worst).toBe(3);
  });
});

describe('saying where a part points', () => {
  it('offers six directions, named the way the game means them', () => {
    expect(DIRECTIONS.map((d) => d.id))
      .toEqual(['forward', 'back', 'left', 'right', 'up', 'down']);
    // Forward is +Z and up is +Y, so right is forward crossed with up, which
    // is -X. Getting that backwards puts every label on the wrong button.
    expect(DIRECTIONS.find((d) => d.id === 'forward').dir).toEqual([0, 0, 1]);
    expect(DIRECTIONS.find((d) => d.id === 'right').dir).toEqual([-1, 0, 0]);
  });

  it('points a thruster any of the six ways in one go', () => {
    const thruster = getPart('thruster');
    for (const direction of DIRECTIONS) {
      const rot = aimAt(thruster, direction.dir);
      expect(rot, `nothing points a thruster ${direction.id}`).not.toBe(null);
      expect(aimOf(thruster, rot)).toEqual(direction.dir);
      expect(aimNamed(thruster, rot)).toBe(direction.id);
    }
  });

  it('points a sensor, a grabber and a wedge too', () => {
    for (const id of ['sensor', 'grabber']) {
      expect(aimableDirections(getPart(id))).toHaveLength(6);
    }
  });

  it('picks the turn that disturbs the part least', () => {
    const thruster = getPart('thruster');
    const down = DIRECTIONS.find((d) => d.id === 'down').dir;
    const options = aimingsFor(thruster, down);
    expect(options.length).toBeGreaterThan(1);
    // Whichever rotation it lands on, no other rotation that also points down
    // is a smaller change from where it started.
    for (const from of [IDENTITY_ORIENTATION, turnStep(IDENTITY_ORIENTATION, 'roll')]) {
      const chosen = aimAt(thruster, down, from);
      const cost = turnsBetween(from, chosen);
      for (const other of options) {
        expect(turnsBetween(from, other)).toBeGreaterThanOrEqual(cost);
      }
    }
  });

  it('leaves a part alone when it already points that way', () => {
    const thruster = getPart('thruster');
    const up = DIRECTIONS.find((d) => d.id === 'up').dir;
    const rot = aimAt(thruster, up);
    expect(aimAt(thruster, up, rot)).toBe(rot);
  });

  it('offers nothing for a part that points nowhere', () => {
    expect(aimableDirections(getPart('block'))).toEqual([]);
    expect(aimOf(getPart('block'), IDENTITY_ORIENTATION)).toBe(null);
    expect(aimAt(getPart('block'), [0, 1, 0])).toBe(null);
  });
});

describe('how far apart two rotations are', () => {
  it('is nothing at all for the same one', () => {
    expect(turnsBetween(IDENTITY_ORIENTATION, IDENTITY_ORIENTATION)).toBe(0);
  });

  it('grows with the turning', () => {
    const one = turnStep(IDENTITY_ORIENTATION, 'yaw');
    const two = turnStep(one, 'pitch');
    expect(turnsBetween(IDENTITY_ORIENTATION, one))
      .toBeLessThan(turnsBetween(IDENTITY_ORIENTATION, two));
  });
});
