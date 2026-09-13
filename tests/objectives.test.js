import { describe, it, expect } from 'vitest';
import { ObjectiveTracker, inZone, withinBudget } from '../src/challenges/objectives.js';
import { LEVELS, getLevel } from '../src/challenges/levels.js';
import { Blueprint } from '../src/core/blueprint.js';

const level = {
  id: 'test',
  zones: [{ id: 'goal', pos: [0, 1, 10], size: [4, 2, 4] }],
  objectives: [
    { type: 'propInZone', prop: 'crate', zone: 'goal', hold: 2, label: 'Crate home' },
  ],
  budget: { cost: 10 },
};

function ctxAt(x, y, z) {
  return {
    propPosition: () => ({ x, y, z }),
    corePosition: () => ({ x, y, z }),
  };
}

describe('zones', () => {
  it('tests the zone as an axis-aligned box', () => {
    const zone = level.zones[0];
    expect(inZone({ x: 0, y: 1, z: 10 }, zone)).toBe(true);
    expect(inZone({ x: 1.9, y: 1.9, z: 11.9 }, zone)).toBe(true);
    expect(inZone({ x: 2.1, y: 1, z: 10 }, zone)).toBe(false);
    expect(inZone(null, zone)).toBe(false);
  });
});

describe('objective tracking', () => {
  it('only completes after the hold time has elapsed', () => {
    const tracker = new ObjectiveTracker(level);
    const inside = ctxAt(0, 1, 10);
    let report = tracker.update(1, inside);
    expect(report.complete).toBe(false);
    expect(report.objectives[0].progress).toBeCloseTo(0.5);
    report = tracker.update(1, inside);
    expect(report.complete).toBe(true);
  });

  it('resets the timer when the condition is lost', () => {
    const tracker = new ObjectiveTracker(level);
    tracker.update(1.5, ctxAt(0, 1, 10));
    const report = tracker.update(0.1, ctxAt(0, 1, 40));
    expect(report.objectives[0].progress).toBe(0);
    expect(report.complete).toBe(false);
  });

  it('stays complete once won', () => {
    const tracker = new ObjectiveTracker(level);
    tracker.update(2, ctxAt(0, 1, 10));
    const report = tracker.update(1, ctxAt(0, 1, 40));
    expect(report.complete).toBe(true);
  });

  it('tracks elapsed time and clears it on reset', () => {
    const tracker = new ObjectiveTracker(level);
    tracker.update(1, ctxAt(0, 0, 0));
    expect(tracker.elapsed).toBe(1);
    tracker.reset();
    expect(tracker.elapsed).toBe(0);
    expect(tracker.complete).toBe(false);
  });

  it('checks a core-in-zone objective against the machine core', () => {
    const coreLevel = {
      zones: level.zones,
      objectives: [{ type: 'coreInZone', zone: 'goal', hold: 0 }],
    };
    const tracker = new ObjectiveTracker(coreLevel);
    expect(tracker.update(0.1, ctxAt(0, 1, 10)).complete).toBe(true);
  });
});

describe('budget', () => {
  it('rejects a build over the level budget', () => {
    const bp = new Blueprint();
    for (let i = 0; i < 12; i += 1) bp.place('block', [i, 0, 0]);
    const result = withinBudget(bp, level);
    expect(result.ok).toBe(false);
    expect(result.cost).toBe(12);
    expect(result.reason).toMatch(/over budget/i);
  });

  it('accepts a build inside the budget', () => {
    const bp = new Blueprint();
    bp.place('block', [0, 0, 0]);
    expect(withinBudget(bp, level).ok).toBe(true);
  });
});

describe('levels', () => {
  it('gives every objective a zone and prop that exists', () => {
    for (const lvl of LEVELS) {
      for (const objective of lvl.objectives) {
        if (objective.zone) {
          expect(lvl.zones.some((z) => z.id === objective.zone)).toBe(true);
        }
        if (objective.prop) {
          expect(lvl.props.some((p) => p.id === objective.prop)).toBe(true);
        }
      }
    }
  });

  it('has unique level ids and falls back to the first course', () => {
    const ids = LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    // There is no Sandbox level any more; fun mode on a real course is what
    // it was for, so an unknown id lands on the first challenge instead.
    expect(getLevel('nope').id).toBe(LEVELS[0].id);
  });
});
