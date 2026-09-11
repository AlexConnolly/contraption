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
  const track = [];
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps && !report.complete; i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    states.add(machine.computers[0].stateId);
    if (!touched) touched = machine.contact();
    if (i % 15 === 0) track.push(machine.corePosition().x);
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
  return { level, arena, machine, report, states, worstClearance, wandered, touched, track };
}

beforeAll(async () => {
  await RAPIER.init();
}, 30000);

function arenaFor(seed) {
  const level = getLevel('traffic');
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  return new Arena({ RAPIER, world, scene: new THREE.Scene(), level, seed });
}

describe('the obstacles', () => {
  it('runs at a different speed and starts somewhere else on every seed', () => {
    const sample = (seed) => arenaFor(seed).movers
      .map((m) => [m.rate.toFixed(4), m.offset.toFixed(4)].join('/'));
    const a = sample(1);
    expect(a).toHaveLength(6);
    expect(a).not.toEqual(sample(2));
    // Three gates of two panels: six movers, three sets of numbers.
    expect(new Set(a).size).toBe(3);
  });

  it('keeps the two panels of a gate locked together', () => {
    // They have to slide as one, or the gap between them would open and close
    // instead of moving, and could shut completely.
    const movers = arenaFor(4).movers;
    for (let i = 0; i < movers.length; i += 2) {
      expect(movers[i].rate).toBe(movers[i + 1].rate);
      expect(movers[i].offset).toBe(movers[i + 1].offset);
    }
  });

  it('holds the gap open, out in the corridor and never against a wall', () => {
    const level = getLevel('traffic');
    const half = 14;
    const gates = new Map();
    for (const mover of level.movers) {
      if (!gates.has(mover.group)) gates.set(mover.group, []);
      gates.get(mover.group).push(mover);
    }
    expect(gates.size).toBe(3);

    for (const [, panels] of gates) {
      expect(panels).toHaveLength(2);
      const [left, right] = panels.sort((a, b) => a.pos[0] - b.pos[0]);
      const inner = (panel, shift) => panel.pos[0] + shift;
      for (const shift of [-panels[0].span, 0, panels[0].span]) {
        const gapFrom = inner(left, shift) + left.size[0] / 2;
        const gapTo = inner(right, shift) - right.size[0] / 2;
        expect(gapTo - gapFrom).toBeCloseTo(6, 5);
        expect(half - Math.max(Math.abs(gapFrom), Math.abs(gapTo)))
          .toBeGreaterThan(2.5);
        // And the panels reach past the walls, so nothing slips round the end.
        expect(inner(left, shift) - left.size[0] / 2).toBeLessThan(-half);
        expect(inner(right, shift) + right.size[0] / 2).toBeGreaterThan(half);
      }
    }
  });

  it('puts the gap somewhere other than the middle most of the time', () => {
    // A gap that always covered the centreline would let a machine fly
    // straight at the pad and never have to look at anything.
    const level = getLevel('traffic');
    const gate = level.movers[0];
    expect(gate.span).toBeGreaterThan(3);
  });

  it('reproduces exactly for a given seed, so a failure can be looked at again', () => {
    const positionsAt = (seed) => {
      const arena = arenaFor(seed);
      for (let i = 0; i < 300; i += 1) {
        arena.step(STEP);
        arena.world.step();
      }
      return arena.movers.map((m) => m.body.translation().x.toFixed(4));
    };
    expect(positionsAt(7)).toEqual(positionsAt(7));
    expect(positionsAt(7)).not.toEqual(positionsAt(8));
  });

  it('draws a new set of numbers when the run is reset', () => {
    const arena = arenaFor(5);
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
      expect(run.wandered).toBeGreaterThan(3.5);
    }
  });

  // Ten full 170-second runs in one case, so it needs longer than the default.
  it('flies the whole course without touching anything', () => {
    for (const seed of seeds) {
      const run = fly(seed);
      expect(run.touched, `seed ${seed}`).toBe(null);
    }
  }, 30000);

  it('takes a different path through each time', () => {
    const paths = [1, 2, 3, 4].map((seed) => fly(seed).wandered.toFixed(2));
    expect(new Set(paths).size).toBeGreaterThan(1);
  });

  it('keeps well away from the corridor walls', () => {
    // Hugging a wall to squeeze past is exactly what the gates are shaped to
    // avoid forcing, so the machine should never be near one.
    for (const seed of [1, 2, 3, 4, 5]) {
      const run = fly(seed);
      expect(run.report.complete).toBe(true);
      let nearest = Infinity;
      for (const x of run.track) nearest = Math.min(nearest, 14 - Math.abs(x) - 0.75);
      expect(nearest).toBeGreaterThan(1.5);
    }
  });

  it('keeps the dodger inside the budget', () => {
    expect(withinBudget(dodger(), getLevel('traffic')).ok).toBe(true);
  });

  it('cannot fly it blind: with the beams reading clear it hits something', () => {
    // The same machine and the same program, with every beam reporting open
    // air. It may still blunder as far as the pad on a lucky draw, but on a
    // course where touching anything ends the run, that is no use to it.
    for (const seed of [1, 2, 3, 4, 5]) {
      const level = getLevel('traffic');
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      world.timestep = STEP;
      const scene = new THREE.Scene();
      const arena = new Arena({ RAPIER, world, scene, level, seed });
      const machine = new Machine({
        RAPIER, world, scene, blueprint: dodger(), level,
        spawn: new THREE.Vector3(...level.spawn),
      });
      machine.sensorDistance = () => 9;
      const bus = new SignalBus(NO_INPUT);

      let touched = null;
      for (let i = 0; i < Math.round(60 / STEP) && !touched; i += 1) {
        arena.step(STEP);
        machine.update(STEP, bus);
        world.step();
        touched = machine.contact();
      }
      expect(touched, `seed ${seed}`).not.toBe(null);
    }
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
