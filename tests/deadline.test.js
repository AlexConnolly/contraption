import { describe, it, expect } from 'vitest';
import { sanitiseLevel, outOfTime } from '../src/challenges/format.js';
import { getLevel, LEVELS } from '../src/challenges/levels.js';

/**
 * Par is a target you can miss and still win. A deadline is not: run past it
 * and the run is failed. They are different things and a level can carry both.
 */
describe('a hard clock', () => {
  it('is carried through the level format', () => {
    expect(sanitiseLevel({ deadline: 12 }).deadline).toBe(12);
  });

  it('is absent unless a level asks for one', () => {
    expect(sanitiseLevel({}).deadline).toBeUndefined();
  });

  it('is pulled back to something a run could survive', () => {
    expect(sanitiseLevel({ deadline: 99999 }).deadline).toBeLessThanOrEqual(3600);
    expect(sanitiseLevel({ deadline: -5 }).deadline).toBeGreaterThan(0);
    expect(sanitiseLevel({ deadline: 'soon' }).deadline).toBeUndefined();
  });

  it('survives being shared and read back', async () => {
    const { toShareCode, fromShareCode } = await import('../src/challenges/format.js');
    const back = await fromShareCode(await toShareCode({ ...sanitiseLevel({}), deadline: 9 }));
    expect(back.ok).toBe(true);
    expect(back.level.deadline).toBe(9);
  });
});

describe('running out of it', () => {
  it('ends the run once the clock is spent', () => {
    expect(outOfTime({ deadline: 10 }, 10)).toBe(true);
    expect(outOfTime({ deadline: 10 }, 10.5)).toBe(true);
  });

  it('leaves the run alone right up to the moment it is', () => {
    expect(outOfTime({ deadline: 10 }, 9.99)).toBe(false);
    expect(outOfTime({ deadline: 10 }, 0)).toBe(false);
  });

  it('never ends a run on a level that has no clock', () => {
    for (const level of [{}, { par: 5 }, { deadline: 0 }, null, undefined]) {
      expect(outOfTime(level, 99999)).toBe(false);
    }
  });
});

describe('Sunday League', () => {
  const level = getLevel('sunday-league');

  /**
   * Ten seconds is not enough to drive round, line a shot up and stroke it in,
   * which was the whole trouble with it: it was a football level you could
   * solve by nudging the ball at walking pace.
   */
  it('gives you ten seconds and no more', () => {
    expect(level.deadline).toBe(10);
  });

  it('sets par inside the deadline, so par is still winnable', () => {
    expect(level.par).toBeLessThanOrEqual(level.deadline);
  });

  it('says so in the brief, rather than springing it on you', () => {
    expect(`${level.brief} ${level.hint}`.toLowerCase()).toMatch(/ten seconds|10 ?s/);
  });
});

describe('every level', () => {
  it('leaves par achievable wherever there is a deadline', () => {
    for (const level of LEVELS) {
      if (!level.deadline) continue;
      expect(level.par, level.id).toBeLessThanOrEqual(level.deadline);
    }
  });
});
