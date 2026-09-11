import { describe, it, expect } from 'vitest';
import {
  sanitiseLevel, levelProblems, toShareCode, fromShareCode, LEVEL_FORMAT, LIMITS,
} from '../src/challenges/format.js';

const good = {
  name: 'My problem',
  brief: 'Push the crate into the square.',
  spawn: [0, 1, -8],
  pieces: [{ pos: [0, 0, 4], size: [6, 1, 6], colour: 0x6b7480 }],
  props: [{ id: 'crate', pos: [0, 1, 0], size: [1, 1, 1], mass: 8 }],
  zones: [{ id: 'goal', pos: [0, 1, 8], size: [4, 2, 4] }],
  objectives: [{ type: 'propInZone', prop: 'crate', zone: 'goal', hold: 3, label: 'Crate home' }],
  bans: ['flight'],
  budget: { cost: 90 },
  par: 100,
};

/**
 * Once one level has been shared, the format is public and cannot quietly
 * change. These are the promises it makes.
 */
describe('the level format', () => {
  it('carries a level there and back unchanged', async () => {
    const code = await toShareCode(good);
    const back = await fromShareCode(code);
    expect(back.ok).toBe(true);
    expect(back.level).toEqual(sanitiseLevel(good));
  });

  it('makes a code you could paste into a message', async () => {
    const code = await toShareCode(good);
    expect(code.startsWith('CTP1')).toBe(true);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(1200);
  });

  it('survives being wrapped and padded by a chat client', async () => {
    const code = await toShareCode(good);
    const mangled = `  ${code.slice(0, 20)}\n${code.slice(20)}  `;
    expect((await fromShareCode(mangled)).ok).toBe(true);
  });

  it('explains itself rather than throwing', async () => {
    for (const rubbish of ['', 'hello', 'CTP1', 'CTP1zzz!!!', null, undefined, 42]) {
      const out = await fromShareCode(rubbish);
      expect(out.ok).toBe(false);
      expect(typeof out.reason).toBe('string');
    }
  });

  it('refuses a code from a version it does not know', async () => {
    const out = await fromShareCode(`CTP1q${'a'.repeat(20)}`);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/newer version/i);
  });

  it('is stamped with a version, so old codes can be recognised later', async () => {
    expect(LEVEL_FORMAT).toBe(1);
    expect((await fromShareCode(await toShareCode(good))).ok).toBe(true);
  });
});

describe('a level someone else made is untrusted', () => {
  it('drops fields it was never asked for', () => {
    const level = sanitiseLevel({ ...good, script: 'alert(1)', onLoad: 'x' });
    expect(level.script).toBeUndefined();
    expect(level.onLoad).toBeUndefined();
  });

  it('keeps every list inside a size the game can survive', () => {
    const level = sanitiseLevel({
      ...good,
      pieces: new Array(5000).fill({ pos: [0, 0, 0], size: [1, 1, 1] }),
      props: new Array(5000).fill({ id: 'x', pos: [0, 1, 0] }),
      objectives: new Array(500).fill(good.objectives[0]),
    });
    expect(level.pieces.length).toBe(LIMITS.pieces);
    expect(level.props.length).toBe(LIMITS.props);
    expect(level.objectives.length).toBeLessThanOrEqual(LIMITS.objectives);
  });

  it('pulls wild numbers back to something the engine survives', () => {
    const level = sanitiseLevel({
      ...good,
      spawn: [1e9, -1e9, NaN],
      gravity: -100000,
      par: 0,
      budget: { cost: -5 },
      pieces: [{ pos: [0, 0, 0], size: [0, 1e9, -4] }],
    });
    for (const n of level.spawn) expect(Number.isFinite(n)).toBe(true);
    expect(level.gravity).toBeGreaterThanOrEqual(-40);
    expect(level.par).toBeGreaterThan(0);
    expect(level.budget.cost).toBeGreaterThan(0);
    for (const n of level.pieces[0].size) expect(n).toBeGreaterThan(0);
  });

  it('strips anything unprintable out of text it will display', () => {
    const nasty = `ev${String.fromCharCode(0)}il${String.fromCharCode(27)}[31m`;
    const level = sanitiseLevel({ ...good, name: nasty, brief: nasty });
    for (const ch of level.name + level.brief) {
      expect(ch.codePointAt(0)).toBeGreaterThan(31);
      expect(ch.codePointAt(0)).not.toBe(127);
    }
    expect(level.name).toContain('evil');
  });

  it('throws away an objective pointing at something that is not there', () => {
    const level = sanitiseLevel({
      ...good,
      objectives: [
        { type: 'propInZone', prop: 'ghost', zone: 'goal', label: 'nope' },
        good.objectives[0],
      ],
    });
    expect(level.objectives).toHaveLength(1);
    expect(level.objectives[0].prop).toBe('crate');
  });

  it('refuses an objective type it does not know how to score', () => {
    const level = sanitiseLevel({
      ...good,
      objectives: [{ type: 'runArbitraryCode', label: 'no' }, good.objectives[0]],
    });
    expect(level.objectives).toHaveLength(1);
    expect(level.objectives[0].type).toBe('propInZone');
  });

  it('only accepts bans the game actually has', () => {
    expect(sanitiseLevel({ ...good, bans: ['flight', 'nonsense', 'flight'] }).bans)
      .toEqual(['flight']);
  });

  it('always gives back something playable, whatever it was handed', () => {
    for (const rubbish of [null, undefined, 42, 'a string', [], { props: 'no' }]) {
      const level = sanitiseLevel(rubbish);
      expect(typeof level.name).toBe('string');
      expect(Array.isArray(level.pieces)).toBe(true);
      expect(level.budget.cost).toBeGreaterThan(0);
    }
  });

  it('marks anything that came through here as custom', () => {
    expect(sanitiseLevel(good).custom).toBe(true);
  });
});

describe('telling the author what is still wrong', () => {
  it('is happy with a finished level', () => {
    expect(levelProblems(sanitiseLevel(good))).toEqual([]);
  });

  it('says when there is nothing to finish', () => {
    expect(levelProblems(sanitiseLevel({ ...good, objectives: [] })).join(' '))
      .toMatch(/objective/i);
  });

  it('says when the spawn is buried', () => {
    expect(levelProblems(sanitiseLevel({ ...good, spawn: [0, -5, 0], groundY: 0 })).join(' '))
      .toMatch(/under the ground/i);
  });
});
