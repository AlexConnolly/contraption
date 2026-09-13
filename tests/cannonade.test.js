import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { ObjectiveTracker, droppedLoad } from '../src/challenges/objectives.js';
import { getLevel } from '../src/challenges/levels.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

const LEVEL = getLevel('cannonade');

/**
 * Runs the course with nothing in it to catch anything, which is the only way
 * to see where the balls were going.
 */
function fire(seconds = 34) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const arena = new Arena({
    RAPIER, world, scene: new THREE.Scene(), level: LEVEL, seed: 1,
  });
  const tracker = new ObjectiveTracker(LEVEL);
  const landed = new Map();
  const firedAt = new Map();
  let firstDrop = null;

  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    world.step();
    const t = i * STEP;
    for (const p of arena.liveProps()) {
      if (!firedAt.has(p.id)) firedAt.set(p.id, t);
      if (!landed.has(p.id) && p.point.y < LEVEL.catchFloor) {
        landed.set(p.id, { x: p.point.x, z: p.point.z, t });
      }
    }
    const dropped = droppedLoad(LEVEL, { liveProps: () => arena.liveProps() });
    if (dropped && firstDrop === null) firstDrop = { id: dropped, t };
    tracker.update(STEP, {
      propPosition: (id) => arena.propPosition(id),
      corePosition: () => ({ x: 0, y: 1, z: LEVEL.spawn[2] }),
      props: () => arena.propStates(),
      liveProps: () => arena.liveProps(),
      elapsed: t,
    });
  }
  return {
    landed, firedAt, firstDrop, report: tracker.report(), arena,
  };
}

describe('Cannonade fires the way the brief says it does', () => {
  // Lazily, because a describe body runs before beforeAll and Rapier is not
  // up yet at that point.
  let out = null;
  beforeAll(() => { out = fire(); }, 200000);

  it('sends every ball, and no more than every ball', () => {
    expect(out.firedAt.size).toBe(9);
    expect(LEVEL.props).toHaveLength(9);
  }, 120000);

  it('sends them one every three seconds, taking the cannons in turn', () => {
    const times = [...out.firedAt.values()].sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) {
      const gap = times[i] - times[i - 1];
      expect(gap, `shot ${i} came ${gap.toFixed(2)}s after the last`).toBeGreaterThan(2.9);
      expect(gap).toBeLessThan(3.1);
    }
  }, 120000);

  it('keeps them out of play until their turn', () => {
    // Nothing is in play before the first shot is due.
    const early = [...out.firedAt.values()].filter((t) => t < LEVEL.launchers[0].first - 0.1);
    expect(early).toEqual([]);
  }, 120000);

  /**
   * The design question. Balls that land behind the machine, or a hundred
   * metres past it, make a level nobody can play however good the machinery
   * is. They should come down somewhere a machine starting at the spawn can
   * get under.
   */
  it('drops them somewhere a machine could be', () => {
    expect(out.landed.size, 'some balls never came down').toBe(9);
    const zs = [...out.landed.values()].map((l) => l.z);
    const xs = [...out.landed.values()].map((l) => l.x);
    const near = Math.min(...zs);
    const far = Math.max(...zs);
    const wide = Math.max(...xs.map(Math.abs));
    // Reported, because these are the numbers that decide whether it plays.
    console.log(
      `landing zone: z ${near.toFixed(1)} to ${far.toFixed(1)}, `
      + `x within ${wide.toFixed(1)}, spawn z ${LEVEL.spawn[2]}`,
    );
    expect(far - near, 'the landing zone is spread too far to cover').toBeLessThan(22);
    expect(wide, 'the balls land too far out to the sides').toBeLessThan(14);
  }, 120000);

  // Nothing was there to catch them, so the level must say so.
  it('is lost by an empty course', () => {
    expect(out.firstDrop, 'nine balls hit the floor and nothing failed').not.toBe(null);
    expect(out.report.complete).toBe(false);
  }, 120000);
});
