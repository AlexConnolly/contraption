import { describe, it, expect } from 'vitest';

import { ObjectiveTracker, droppedLoad } from '../src/challenges/objectives.js';
import { sanitiseLevel } from '../src/challenges/format.js';

/**
 * Catch is the first level in the game you can lose by doing nothing.
 *
 * Everything else is a job: move that, get there, hold this down. Here the
 * course acts and you react, and the only way to fail is to let something
 * happen. That needs two pieces neither of which existed — a run that is won
 * by outlasting it rather than by finishing anything, and a failure that comes
 * from a prop rather than from the machine.
 */

const level = {
  catchFloor: 0.6,
  objectives: [{ type: 'survived', seconds: 30, label: 'All nine caught' }],
};

const ctx = (elapsed, live = []) => ({
  liveProps: () => live,
  props: () => live,
  propPosition: () => null,
  corePosition: () => ({ x: 0, y: 1, z: 0 }),
  elapsed,
});

const at = (y) => ({ x: 0, y, z: 0 });

describe('a run you win by outlasting', () => {
  const run = (seconds) => {
    const tracker = new ObjectiveTracker(level);
    let report = null;
    for (let t = 0; t < seconds * 60; t += 1) report = tracker.update(1 / 60, ctx(t / 60));
    return report;
  };

  it('is not finished early', () => {
    expect(run(10).complete).toBe(false);
    expect(run(29).complete).toBe(false);
  });

  it('is finished once the clock runs out', () => {
    expect(run(31).complete).toBe(true);
  });

  it('shows how far through it you are', () => {
    const report = run(15);
    expect(report.objectives[0].progress).toBeGreaterThan(0.4);
    expect(report.objectives[0].progress).toBeLessThan(0.6);
  });
});

describe('a load on the floor', () => {
  it('is spotted wherever it lands', () => {
    expect(droppedLoad(level, ctx(5, [{ id: 'ball-3', point: at(0.3) }]))).toBe('ball-3');
  });

  it('is not spotted while it is still in the air', () => {
    expect(droppedLoad(level, ctx(5, [{ id: 'ball-1', point: at(4) }]))).toBe(null);
  });

  // Caught low is still caught. The line is where a ball resting on the ground
  // would sit, not where a careful player would like to hold one.
  it('is not a load sitting in a low basket', () => {
    expect(droppedLoad(level, ctx(5, [{ id: 'ball-1', point: at(0.75) }]))).toBe(null);
  });

  /**
   * Only balls that have been fired count. The rest are still in the cannon,
   * parked out of play under the course, and a level that failed you for its
   * own unfired ammunition would be unplayable.
   */
  it('is never one that has not been launched yet', () => {
    const loaded = ctx(5, []);
    expect(droppedLoad(level, loaded)).toBe(null);
  });

  it('is not a rule on levels that do not set a floor', () => {
    expect(droppedLoad({}, ctx(5, [{ id: 'x', point: at(-20) }]))).toBe(null);
  });
});

describe('what a cannon looks like in a level file', () => {
  const raw = {
    name: 'Catch',
    catchFloor: 0.6,
    props: [
      { id: 'b1', pos: [0, 1, 0], radius: 0.35, mass: 2 },
      { id: 'b2', pos: [0, 1, 0], radius: 0.35, mass: 2 },
    ],
    launchers: [
      {
        id: 'left', pos: [-9, 1.4, 16], aim: [0.3, 0.45, -1], speed: 13,
        balls: ['b1', 'b2'], first: 3, gap: 9,
      },
      { id: 'junk', pos: ['x', null, 1e9], aim: [0, 0, 0], speed: 1e6, balls: ['nope'], first: -5, gap: 0 },
    ],
    objectives: [
      { type: 'survived', seconds: 30, label: 'Caught' },
      { type: 'survived', seconds: 999999 },
    ],
  };
  const clean = sanitiseLevel(raw);

  it('keeps a sane one', () => {
    const left = clean.launchers.find((l) => l.id === 'left');
    expect(left.balls).toEqual(['b1', 'b2']);
    expect(left.speed).toBe(13);
    expect(left.first).toBe(3);
  });

  it('makes a nonsense one harmless', () => {
    const junk = clean.launchers.find((l) => l.id === 'junk');
    for (const n of [...junk.pos, ...junk.aim, junk.speed, junk.first, junk.gap]) {
      expect(Number.isFinite(n)).toBe(true);
    }
    // A launcher pointed nowhere would drop its load on its own foot.
    expect(junk.aim.some(Boolean)).toBe(true);
    // And it cannot fire ammunition the level has not got.
    expect(junk.balls).toEqual([]);
  });

  it('clamps how long a level may ask you to last', () => {
    expect(clean.objectives[1].seconds).toBeLessThanOrEqual(900);
    expect(clean.catchFloor).toBe(0.6);
  });
});
