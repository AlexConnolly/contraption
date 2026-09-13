import { describe, it, expect } from 'vitest';

import { LEVELS } from '../src/challenges/levels.js';

/**
 * Nothing starts inside anything else.
 *
 * A crate that spawns half sunk into a conveyor is not a puzzle, it is a bug
 * you have to work out is a bug: the solver shoves it out on the first step,
 * so it either jumps, or sticks, or slides off somewhere the level did not
 * intend, and the player concludes the physics is unreliable.
 *
 * Sorting Bay had two of them. The middle belt ran from z = 0 all the way
 * through the crate bin, and the two crates on the centre line sat 35 cm
 * inside it. So this checks every level rather than that one, because the
 * mistake is easy to make again and impossible to see in a level file.
 */

/** How far two things may overlap before it is a mistake rather than contact. */
const TOUCHING = 0.011;

const boxOf = (pos, size) => ({
  min: [0, 1, 2].map((i) => pos[i] - size[i] / 2),
  max: [0, 1, 2].map((i) => pos[i] + size[i] / 2),
});

/** How far two boxes overlap on their least-overlapping axis. */
function overlap(a, b) {
  let least = Infinity;
  for (let i = 0; i < 3; i += 1) {
    least = Math.min(least, Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]));
  }
  return least;
}

/**
 * Props parked below the floor are not in play yet: a launcher teleports them
 * to its muzzle when it fires, and until then nine of them sit in a heap sixty
 * metres down where nothing can reach them.
 */
const inPlay = (prop) => (prop.pos?.[1] ?? 0) > -5;

/** A prop's box. Balls are given the box that contains them. */
function propBox(prop) {
  if (prop.size) return boxOf(prop.pos, prop.size);
  const d = (prop.radius ?? 0.4) * 2;
  return boxOf(prop.pos, [d, d, d]);
}

// A turned piece is not its bounding box, and comparing against one would
// report ramps and walls that are nowhere near. There are few of them and
// they carry nothing.
const flat = (piece) => !piece.rotX && !piece.rotY;

describe('what a level puts down', () => {
  it('never starts a prop inside a piece of scenery', () => {
    const wrong = [];
    for (const level of LEVELS) {
      for (const prop of (level.props ?? []).filter(inPlay)) {
        const box = propBox(prop);
        for (const piece of (level.pieces ?? []).filter(flat)) {
          const into = overlap(box, boxOf(piece.pos, piece.size));
          if (into > TOUCHING) {
            wrong.push(`${level.id}: ${prop.id} is ${into.toFixed(2)} m inside a piece at ${piece.pos}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('never starts two props inside each other', () => {
    const wrong = [];
    for (const level of LEVELS) {
      const props = (level.props ?? []).filter(inPlay);
      for (let i = 0; i < props.length; i += 1) {
        for (let j = i + 1; j < props.length; j += 1) {
          const into = overlap(propBox(props[i]), propBox(props[j]));
          if (into > TOUCHING) {
            wrong.push(`${level.id}: ${props[i].id} and ${props[j].id} overlap by ${into.toFixed(2)} m`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('never starts the machine inside a piece of scenery', () => {
    const wrong = [];
    for (const level of LEVELS) {
      if (!level.spawn) continue;
      // A level you start mounted on something is asking a different question:
      // Monorail spawns you hanging off a rail, so the rail is inside the
      // machine on purpose and says so.
      if (level.mounted) continue;
      // A machine's lowest part sits on the spawn and it grows upward from
      // there, so the box starts at the spawn rather than straddling it --
      // otherwise every level with a platform to stand on looks wrong.
      const box = boxOf([level.spawn[0], level.spawn[1] + 1.01, level.spawn[2]], [3, 2, 3]);
      for (const piece of (level.pieces ?? []).filter(flat)) {
        const into = overlap(box, boxOf(piece.pos, piece.size));
        if (into > TOUCHING) {
          wrong.push(`${level.id}: the spawn is ${into.toFixed(2)} m inside a piece at ${piece.pos}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
