import { describe, it, expect } from 'vitest';

import { funLevel, hasRules, DROPPED, EMPTIED } from '../src/challenges/fun.js';
import { LEVELS, getLevel, campaign } from '../src/challenges/levels.js';
import { sanitiseLevel } from '../src/challenges/format.js';
import { bannedParts } from '../src/challenges/bans.js';
import { withinBudget, withinHeight, buildProblem } from '../src/challenges/objectives.js';
import { outOfTime } from '../src/challenges/format.js';
import { Blueprint } from '../src/core/blueprint.js';

/**
 * A challenge with its rules off.
 *
 * The job stays and the rules go. What is worth checking is that the line
 * between the two is drawn where it should be: every objective survives, every
 * piece of scenery survives, and every single thing that can refuse you stops
 * refusing you.
 */

const flight = LEVELS.find((l) => (l.bans ?? []).includes('flight'));
const clocked = LEVELS.find((l) => l.deadline);
const capped = LEVELS.find((l) => l.heightCap);
const fenced = LEVELS.find((l) => (l.keepout ?? []).length > 0);

describe('what fun mode keeps', () => {
  it('keeps the job', () => {
    for (const level of campaign()) {
      const open = funLevel(level);
      expect(open.objectives, level.id).toEqual(level.objectives);
      expect(open.id, 'the level has to stay the same level').toBe(level.id);
    }
  });

  it('keeps the course', () => {
    for (const level of campaign()) {
      const open = funLevel(level);
      expect(open.pieces, level.id).toEqual(level.pieces);
      expect(open.props, level.id).toEqual(level.props);
      expect(open.spawn, level.id).toEqual(level.spawn);
      expect(open.gravity, level.id).toBe(level.gravity);
    }
  });

  it('leaves the level it came from alone', () => {
    const before = JSON.stringify(flight);
    funLevel(flight);
    expect(JSON.stringify(flight)).toBe(before);
  });
});

describe('what fun mode drops', () => {
  it('lets you fly on a course that forbids it', () => {
    expect(bannedParts(flight).size).toBeGreaterThan(0);
    expect(bannedParts(funLevel(flight)).size).toBe(0);
  });

  it('stops the clock on a course that has one', () => {
    expect(outOfTime(clocked, clocked.deadline + 1)).toBe(true);
    expect(outOfTime(funLevel(clocked), 1e6)).toBe(false);
  });

  it('stops counting the budget', () => {
    const huge = new Blueprint();
    huge.place('core', [0, 0, 0]);
    for (let y = 1; y < 40; y += 1) {
      for (let x = -4; x <= 4; x += 1) huge.place('block', [x, y, 0]);
    }
    const level = campaign()[0];
    expect(huge.cost()).toBeGreaterThan(level.budget.cost);
    expect(withinBudget(huge, level).ok).toBe(false);
    expect(withinBudget(huge, funLevel(level)).ok).toBe(true);
  });

  it('stops capping how tall you may build', () => {
    const tall = new Blueprint();
    tall.place('core', [0, 0, 0]);
    for (let i = 1; i <= capped.heightCap + 4; i += 1) tall.place('block', [0, i, 0]);
    expect(withinHeight(tall, capped).ok).toBe(false);
    expect(withinHeight(tall, funLevel(capped)).ok).toBe(true);
  });

  it('opens the keep-outs', () => {
    expect(fenced.keepout.length).toBeGreaterThan(0);
    expect(funLevel(fenced).keepout).toEqual([]);
  });

  it('drops every rule it says it drops', () => {
    for (const level of campaign()) {
      const open = funLevel(level);
      for (const key of DROPPED) {
        expect(open[key], `${level.id} kept ${key}`).toBeUndefined();
      }
      // These two are emptied rather than removed: the level format requires
      // them, and a level without them will not load.
      for (const key of EMPTIED) {
        expect(open[key], `${level.id} kept ${key}`).toEqual([]);
      }
    }
  });

  it('lets a build through that the level would have refused', () => {
    // A tall stack with a banned part on it, on a course that bans it.
    const bad = new Blueprint();
    bad.place('core', [0, 0, 0]);
    bad.place('block', [0, 1, 0]);
    bad.place('thruster', [0, 2, 0]);
    expect(buildProblem(bad, flight)).not.toBe(null);
    expect(buildProblem(bad, funLevel(flight))).toBe(null);
  });
});

describe('whether there is anything to switch off', () => {
  it('says so for a course with rules on it', () => {
    expect(hasRules(flight)).toBe(true);
    expect(hasRules(clocked)).toBe(true);
    expect(hasRules(capped)).toBe(true);
  });

  it('says so for every campaign level, because they all have a budget', () => {
    for (const level of campaign()) expect(hasRules(level), level.id).toBe(true);
  });

  it('says no once the rules are already off', () => {
    expect(hasRules(funLevel(flight))).toBe(false);
  });

  it('says no for nothing at all', () => {
    expect(hasRules(null)).toBe(false);
  });
});

describe('a level with its rules off is still a level', () => {
  it('survives the format unchanged where it matters', () => {
    const open = sanitiseLevel(funLevel(flight));
    expect(open.objectives).toHaveLength(flight.objectives.length);
    expect(open.bans).toEqual([]);
    expect(open.pieces).toHaveLength(flight.pieces.length);
  });

  it('marks itself, so the rest of the game can tell', () => {
    expect(funLevel(flight).fun).toBe(true);
    expect(flight.fun).toBeUndefined();
  });
});

describe('the sandbox level', () => {
  it('is gone — fun mode on a real course is what it was for', () => {
    expect(LEVELS.find((l) => l.id === 'sandbox')).toBeUndefined();
  });

  it('is no longer what an unknown level falls back to', () => {
    expect(getLevel('nope').id).toBe(LEVELS[0].id);
    expect(getLevel('nope').objectives.length).toBeGreaterThan(0);
  });
});
