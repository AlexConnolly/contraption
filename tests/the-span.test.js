import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { ObjectiveTracker, buildProblem } from '../src/challenges/objectives.js';
import { getLevel } from '../src/challenges/levels.js';
import { firstBanned } from '../src/challenges/bans.js';
import { spanner } from '../src/studio/spanner.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

const LEVEL = getLevel('the-span');

/**
 * Drives a machine straight at the pillars and reports what the level made of
 * it: which plates went down, and whether any two were ever down together.
 */
function run(blueprint, seconds = 22) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const arena = new Arena({
    RAPIER, world, scene, level: LEVEL, seed: 2,
  });
  const machine = new Machine({
    RAPIER, world, scene, blueprint, level: LEVEL, spawn: new THREE.Vector3(...LEVEL.spawn),
  });
  const held = new Set(['KeyW']);
  const bus = new SignalBus({
    isDown: (code) => held.has(code),
    wasPressed: () => false,
  });
  const tracker = new ObjectiveTracker(LEVEL);

  const ever = new Set();
  let bothEnds = 0;
  let report = null;
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    let props = null;
    let points = null;
    report = tracker.update(STEP, {
      propPosition: (id) => arena.propPosition(id),
      corePosition: () => machine.corePosition(),
      props: () => (props ??= arena.propStates()),
      machinePoints: () => (points ??= blueprint.list()
        .map((placed) => machine.partWorldPoint(placed))),
    });
    const down = new Set(report.objectives.filter((o) => o.done).map((o) => o.plate));
    // progress is the hold as a fraction, so anything above zero means the
    // plate is under something right now.
    const live = report.objectives.filter((o) => o.progress > 0).map((o) => o.plate);
    for (const id of live) ever.add(id);
    if (live.includes('left') && live.includes('right')) {
      bothEnds += STEP;
      // What a player does when the ends come down: stop driving and let it
      // settle. Holding the throttle into the pillars is not a parked machine.
      held.clear();
    }
    if (down.size === 3) break;
  }
  return { report, ever, bothEnds };
}

describe('The Span is a level somebody could actually finish', () => {
  it('lets a machine wide enough to reach be built inside the build box', () => {
    expect(() => spanner()).not.toThrow();
  });

  it('is within the parts budget with room to spare for the lift', () => {
    const cost = spanner().cost();
    expect(cost).toBeLessThan(LEVEL.budget.cost);
    // The spanner does nothing about the crate. Whatever answers that has to
    // fit in what is left, so the margin is the interesting number.
    expect(LEVEL.budget.cost - cost).toBeGreaterThan(60);
  });

  /**
   * Against the same check the Play button runs, not a looser one. The first
   * version of this machine had no Control Core on it: it drove perfectly in
   * the test harness and the game refused to start it.
   */
  it('is a machine the game would actually let you run', () => {
    expect(buildProblem(spanner(), LEVEL)).toBe(null);
    expect(firstBanned(LEVEL, spanner())).toBe(null);
  });

  /**
   * The question the level turns on. Ten metres apart and two metres up is
   * either reachable by one rigid machine or it is not, and no amount of
   * cleverness elsewhere would rescue it if it were not.
   */
  it('reaches both outer plates at the same time', () => {
    const out = run(spanner());
    expect(out.ever.has('left'), 'never reached the left plate').toBe(true);
    expect(out.ever.has('right'), 'never reached the right plate').toBe(true);
    expect(out.bothEnds, 'never held both ends at once').toBeGreaterThan(1);
  }, 120000);

  /**
   * And the reason it is still a puzzle. The middle plate is red, so the
   * machine sitting across all three pillars is not an answer to it: the crate
   * has to be brought, which is the part the spanner deliberately cannot do.
   */
  it('cannot press the red plate by parking on it', () => {
    const out = run(spanner());
    const middle = out.report.objectives.find((o) => o.plate === 'middle');
    expect(middle.done, 'the machine pressed a coloured plate').toBe(false);
    expect(out.report.complete, 'the level was won without the crate').toBe(false);
  }, 120000);
});
