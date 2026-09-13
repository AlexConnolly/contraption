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
import { spanner } from '../src/studio/spanner.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

const LEVEL = getLevel('the-span');

/**
 * Plays The Span end to end: drive up the course grabbing the crate on the
 * way, stop against the pillars, and hoist.
 */
function solve(seconds = 60) {
  const { blueprint, ram, grab } = spanner({ hoist: true, reach: 8 });
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const arena = new Arena({
    RAPIER, world, scene, level: LEVEL, seed: 2,
  });
  const machine = new Machine({
    RAPIER, world, scene, blueprint, level: LEVEL, spawn: new THREE.Vector3(...LEVEL.spawn),
  });
  const held = new Set(['KeyW']);
  const pressed = new Set();
  const bus = new SignalBus({
    isDown: (c) => held.has(c),
    wasPressed: (c) => pressed.delete(c),
  });
  const tracker = new ObjectiveTracker(LEVEL);

  let report = null;
  let best = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();

    const at = machine.corePosition();
    const holding = machine.grabs.has(grab);
    // Keep asking, rather than asking once: the grabber takes hold of what is
    // touching it at the moment it is pressed, and pressing it on the way up
    // to the crate takes hold of nothing.
    if (!holding && i % 20 === 0) pressed.add('KeyG');

    // Lift as soon as it has hold of the crate, and keep driving while it
    // lifts. Dragging the crate along the ground costs so much that the
    // machine never reaches the pillars at all.
    if (holding) held.add('KeyE');

    let cache = null;
    let points = null;
    report = tracker.update(STEP, {
      propPosition: (id) => arena.propPosition(id),
      corePosition: () => at,
      props: () => (cache ??= arena.propStates()),
      liveProps: () => arena.liveProps(),
      machinePoints: () => (points ??= blueprint.list()
        .map((placed) => machine.partWorldPoint(placed))),
      elapsed: i * STEP,
    });
    best = Math.max(best, report.objectives.filter((o) => o.progress > 0).length);
    if (report.complete) break;
  }
  return { report, best, blueprint };
}

describe('The Span, solved', () => {
  it('is a machine the game would let you run', () => {
    const { blueprint } = spanner({ hoist: true, reach: 8 });
    expect(buildProblem(blueprint, LEVEL)).toBe(null);
  });

  /**
   * All three at once: an arm on each outer plate, and the crate held on the
   * middle one. That last part is the half the reach test deliberately left
   * out, and it is the half the level is named for.
   */
  it('holds all three plates down at the same time', () => {
    const out = solve();
    const down = out.report.objectives.map((o) => `${o.label}: ${o.done ? 'down' : 'up'}`);
    expect(out.report.complete, down.join(' | ')).toBe(true);
  }, 200000);
});
