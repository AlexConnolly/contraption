import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Machine } from '../src/sim/machine.js';
import { Arena } from '../src/sim/arena.js';
import { SignalBus } from '../src/sim/signals.js';
import { ObjectiveTracker, withinBudget } from '../src/challenges/objectives.js';
import { getLevel } from '../src/challenges/levels.js';
import { dodger } from '../src/studio/dodger.js';
import { makeRng } from '../src/sim/rng.js';

const STEP = 1 / 60;
const NO_INPUT = { isDown: () => false, wasPressed: () => false };

function fly(seed, seconds = 170) {
  const level = getLevel('traffic');
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const scene = new THREE.Scene();
  const arena = new Arena({ RAPIER, world, scene, level, seed });
  const blueprint = dodger();
  const machine = new Machine({
    RAPIER, world, scene, blueprint, level,
    spawn: new THREE.Vector3(...level.spawn),
  });
  const bus = new SignalBus(NO_INPUT);
  const tracker = new ObjectiveTracker(level);

  const states = new Set();
  let report = tracker.report();
  let worstClearance = Infinity;
  let wandered = 0;
  let touched = null;
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps && !report.complete; i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    states.add(machine.computers[0].stateId);
    if (!touched) touched = machine.contact();
    report = tracker.update(STEP, {
      propPosition: (id) => arena.propPosition(id),
      corePosition: () => machine.corePosition(),
    });
    // Lateral clearance only counts while the machine is actually level with
    // a blocker. Measuring it head-on would just report how close it got
    // before sliding aside, which says nothing about whether it got through.
    if (i % 5 === 0) {
      const at = machine.corePosition();
      for (const mover of arena.movers) {
        const t = mover.body.translation();
        if (Math.abs(t.z - at.z) > mover.spec.size[2]) continue;
        const edge = Math.abs(t.x - at.x) - mover.spec.size[0] / 2;
        worstClearance = Math.min(worstClearance, edge);
        wandered = Math.max(wandered, Math.abs(at.x));
      }
    }
  }
  return { level, arena, machine, report, states, worstClearance, wandered, touched };
}

beforeAll(async () => {
  await RAPIER.init();
}, 30000);

describe('the obstacles', () => {
  it('runs at a different speed and starts somewhere else on every seed', () => {
    const sample = (seed) => {
      const level = getLevel('traffic');
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      world.timestep = STEP;
      const arena = new Arena({
        RAPIER, world, scene: new THREE.Scene(), level, seed,
      });
      return arena.movers.map((m) => [m.rate.toFixed(4), m.offset.toFixed(4)].join('/'));
    };
    const a = sample(1);
    const b = sample(2);
    expect(a).toHaveLength(3);
    expect(a).not.toEqual(b);
    // And distinct from each other within a run, so they never march in step.
    expect(new Set(a).size).toBe(3);
  });

  it('reproduces exactly for a given seed, so a failure can be looked at again', () => {
    const positionsAt = (seed) => {
      const level = getLevel('traffic');
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      world.timestep = STEP;
      const arena = new Arena({
        RAPIER, world, scene: new THREE.Scene(), level, seed,
      });
      for (let i = 0; i < 300; i += 1) {
        arena.step(STEP);
        world.step();
      }
      return arena.movers.map((m) => m.body.translation().x.toFixed(4));
    };
    expect(positionsAt(7)).toEqual(positionsAt(7));
    expect(positionsAt(7)).not.toEqual(positionsAt(8));
  });

  it('always leaves a way past, however far across it slides', () => {
    const level = getLevel('traffic');
    const half = 7.5;
    for (const mover of level.movers) {
      const widest = mover.size[0] / 2 + mover.span;
      expect(widest).toBeLessThan(half * 2 - 2);
    }
  });

  it('draws a new set of numbers when the run is reset', () => {
    const level = getLevel('traffic');
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = STEP;
    const arena = new Arena({ RAPIER, world, scene: new THREE.Scene(), level, seed: 5 });
    const before = arena.movers.map((m) => m.rate);
    arena.reset();
    expect(arena.movers.map((m) => m.rate)).not.toEqual(before);
    expect(arena.elapsed).toBe(0);
  });
});

describe('the traffic challenge', () => {
  // Ten different worlds. A program that had memorised a path would only ever
  // get through the one it was written for.
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it.each(seeds)('is solved hands-off on seed %i', (seed) => {
    const { level, machine, report } = fly(seed);
    expect(machine.isUpsideDown()).toBe(false);
    expect(report.complete).toBe(true);
    expect(report.elapsed).toBeLessThan(level.par);
  });

  it('goes round the blockers rather than straight down the middle', () => {
    // Every blocker covers the middle of the corridor, so passing one means
    // being a long way off the centreline when level with it. A machine that
    // flew straight at the pad would be square in the way.
    const runs = seeds.slice(0, 6).map((seed) => fly(seed));
    for (const run of runs) {
      expect(run.report.complete).toBe(true);
      expect(run.wandered).toBeGreaterThan(3);
    }
  });

  it('flies the whole course without touching anything', () => {
    for (const seed of seeds) {
      const run = fly(seed);
      expect(run.touched, `seed ${seed}`).toBe(null);
    }
  });

  it('takes a different path through each time', () => {
    const paths = [1, 2, 3, 4].map((seed) => fly(seed).wandered.toFixed(2));
    expect(new Set(paths).size).toBeGreaterThan(1);
  });

  it('passes the blockers with room to spare rather than scraping through', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const run = fly(seed);
      expect(run.report.complete).toBe(true);
      expect(run.worstClearance).toBeGreaterThan(0.2);
    }
  });

  it('keeps the dodger inside the budget', () => {
    expect(withinBudget(dodger(), getLevel('traffic')).ok).toBe(true);
  });

  it('gets nowhere if it cannot see: blind, it does not finish', () => {
    // Same machine, same program, but the forward sensor reads clear always.
    const level = getLevel('traffic');
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = STEP;
    const scene = new THREE.Scene();
    const arena = new Arena({ RAPIER, world, scene, level, seed: 3 });
    const blueprint = dodger();
    const machine = new Machine({
      RAPIER, world, scene, blueprint, level,
      spawn: new THREE.Vector3(...level.spawn),
    });
    const original = machine.sensorDistance.bind(machine);
    machine.sensorDistance = () => 99;
    const bus = new SignalBus(NO_INPUT);
    const tracker = new ObjectiveTracker(level);

    let report = tracker.report();
    for (let i = 0; i < Math.round(60 / STEP) && !report.complete; i += 1) {
      arena.step(STEP);
      machine.update(STEP, bus);
      world.step();
      report = tracker.update(STEP, {
        propPosition: (id) => arena.propPosition(id),
        corePosition: () => machine.corePosition(),
      });
    }
    expect(report.complete).toBe(false);
    void original;
  });
});

describe('the seeded generator', () => {
  it('gives the same stream for the same seed and a different one otherwise', () => {
    const take = (seed) => Array.from({ length: 5 }, makeRng(seed));
    expect(take(42)).toEqual(take(42));
    expect(take(42)).not.toEqual(take(43));
  });

  it('stays inside zero to one', () => {
    const rng = makeRng(99);
    for (let i = 0; i < 500; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('the no-contact rule', () => {
  it('is switched on for this challenge', () => {
    expect(getLevel('traffic').noContact).toBe(true);
    expect(getLevel('first-haul').noContact).toBeUndefined();
  });

  it('reports what a machine is touching, and nothing while it is clear', () => {
    const level = getLevel('traffic');
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = STEP;
    const scene = new THREE.Scene();
    const arena = new Arena({ RAPIER, world, scene, level, seed: 3 });
    const machine = new Machine({
      RAPIER, world, scene, blueprint: dodger(), level,
      spawn: new THREE.Vector3(...level.spawn),
    });
    const bus = new SignalBus(NO_INPUT);
    for (let i = 0; i < 120; i += 1) {
      arena.step(STEP);
      machine.update(STEP, bus);
      world.step();
    }
    // Airborne in clear air at the start of the run.
    expect(machine.contact()).toBe(null);

    // Put it where a blocker is and it should notice on the next step.
    const body = machine.bodies[machine.grouping.rootBody];
    const blocker = arena.movers[0].body.translation();
    body.setTranslation({ x: blocker.x, y: blocker.y, z: blocker.z }, true);
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    expect(machine.contact()).not.toBe(null);
  });

  it('does not count a machine touching its own parts', () => {
    // The dodger is one chassis plus four rotors, all bolted together and all
    // in contact with each other; none of that is a crash.
    const level = getLevel('traffic');
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = STEP;
    const scene = new THREE.Scene();
    const arena = new Arena({ RAPIER, world, scene, level, seed: 11 });
    const machine = new Machine({
      RAPIER, world, scene, blueprint: dodger(), level,
      spawn: new THREE.Vector3(...level.spawn),
    });
    const bus = new SignalBus(NO_INPUT);
    for (let i = 0; i < 200; i += 1) {
      arena.step(STEP);
      machine.update(STEP, bus);
      world.step();
      expect(machine.contact()).toBe(null);
    }
  });
});
