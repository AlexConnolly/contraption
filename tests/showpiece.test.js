import { describe, it, expect } from 'vitest';
import { crane } from '../src/studio/showpiece.js';
import { groupBlueprint } from '../src/sim/grouping.js';
import { DEFAULT_BOUNDS, occupiedCells } from '../src/core/blueprint.js';
import { getPart, workingAxis } from '../src/parts/registry.js';

/**
 * The first thing anybody sees is this model. If it could not actually be
 * built, the game would be opening with a lie — so it is held to the same
 * rules as anything a player makes.
 */
describe('the title screen crane', () => {
  const bp = crane();

  it('is big enough to be worth showing', () => {
    expect(bp.size).toBeGreaterThan(40);
  });

  it('is all one machine, with nothing floating loose', () => {
    const grouping = groupBlueprint(bp);
    expect(grouping.disconnected).toEqual([]);
  });

  it('has no joint bridged solid by the build around it', () => {
    expect(groupBlueprint(bp).seized).toEqual([]);
  });

  it('fits inside the build area', () => {
    for (const placed of bp.list()) {
      for (const cell of occupiedCells(placed.type, placed.cell, placed.rot)) {
        for (const axis of [0, 1, 2]) {
          expect(cell[axis]).toBeGreaterThanOrEqual(DEFAULT_BOUNDS.min[axis]);
          expect(cell[axis]).toBeLessThanOrEqual(DEFAULT_BOUNDS.max[axis]);
        }
      }
    }
  });

  it('stands tall, because that is the whole point of it', () => {
    const top = Math.max(...bp.list().flatMap((p) => occupiedCells(p.type, p.cell, p.rot).map((c) => c[1])));
    expect(top).toBeGreaterThan(10);
  });

  it('shows off more than a rover can: it slews, it reaches, it picks up', () => {
    const types = new Set(bp.list().map((p) => p.type));
    for (const wanted of ['turntable', 'piston', 'grabber', 'wheel', 'core']) {
      expect(types, wanted).toContain(wanted);
    }
  });

  it('carries parts that would show build markers, which the title must hide', () => {
    const marked = bp.list().filter((p) => workingAxis(getPart(p.type), p.rot));
    expect(marked.length).toBeGreaterThan(0);
  });
});
