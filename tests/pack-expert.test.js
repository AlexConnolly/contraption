import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Machine } from '../src/sim/machine.js';
import { Arena } from '../src/sim/arena.js';
import { SignalBus } from '../src/sim/signals.js';
import { ObjectiveTracker, withinBudget } from '../src/challenges/objectives.js';
import { getLevel } from '../src/challenges/levels.js';
import { createWorld } from '../src/sim/world.js';
import { groupBlueprint } from '../src/sim/grouping.js';
import { autocrane } from '../src/studio/autocrane.js';
import { striker, BALL_TAG } from '../src/studio/freekick.js';
import { sorter, RED_TAG } from '../src/studio/blindsort.js';

const STEP = 1 / 60;

/**
 * A keyboard that keeps count of every time it is asked anything.
 *
 * These three levels are the hands-off ones, and "hands off" is a claim about
 * what the machine is *not* given rather than about what it does. Passing in a
 * keyboard that answers no to everything would leave the claim resting on the
 * program happening not to have any key bindings in it; passing one that
 * remembers being asked turns it into something the run can be checked against
 * afterwards.
 */
function deadKeyboard() {
  const asked = [];
  return {
    asked,
    isDown: (code) => { asked.push(code); return false; },
    wasPressed: (code) => { asked.push(code); return false; },
  };
}

function run(blueprint, level, seed, seconds, tweak) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const arena = new Arena({
    RAPIER, world, scene, level, seed,
  });
  const machine = new Machine({
    RAPIER, world, scene, blueprint, level, spawn: new THREE.Vector3(...level.spawn),
  });
  if (tweak) tweak(machine);
  const keyboard = deadKeyboard();
  const bus = new SignalBus(keyboard);
  const tracker = new ObjectiveTracker(level);

  const states = new Set();
  let report = tracker.report();
  let flipped = false;
  for (let i = 0; i < Math.round(seconds / STEP) && !report.complete; i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    states.add(machine.computers[0].stateId);
    flipped = flipped || machine.isUpsideDown();
    report = tracker.update(STEP, {
      propPosition: (id) => arena.propPosition(id),
      corePosition: () => machine.corePosition(),
      machine,
    });
  }
  const at = (id) => arena.propPosition(id);
  return {
    report, machine, arena, states, keyboard, flipped, at,
  };
}

beforeAll(async () => {
  await RAPIER.init();
}, 30000);

// Whole courses, several of them per case, so wall-clock time here is a fact
// about the machine the suite runs on rather than about anything under test.
const LONG = 180000;

describe('the expert pack', () => {
  const ids = ['blind-sort', 'autocrane', 'free-kick'];

  it.each(ids)('%s asks for a program and forbids rotors', (id) => {
    const level = getLevel(id);
    expect(level.handsOff).toBe(true);
    expect(level.demands.autonomous).toBe(true);
    expect(level.bans).toContain('flight');
  });

  it.each(ids)('%s has a worked answer that fits inside its budget', (id) => {
    const machines = { 'blind-sort': sorter, autocrane, 'free-kick': striker };
    const blueprint = machines[id]();
    expect(withinBudget(blueprint, getLevel(id)).ok).toBe(true);
    // One chassis and four wheels: nothing hanging off unattached, and no
    // joint bridged solid by a part resting across it.
    const grouped = groupBlueprint(blueprint);
    expect(grouped.disconnected).toEqual([]);
    expect(grouped.seized).toEqual([]);
  });
});

describe('autocrane', () => {
  it('lifts the payload onto the platform with nothing pressed', () => {
    const level = getLevel('autocrane');
    const { report, keyboard, states } = run(autocrane(), level, 1, 60);
    expect(report.complete).toBe(true);
    expect(report.elapsed).toBeLessThan(level.par);
    expect(keyboard.asked).toEqual([]);
    // All four moves in order, not a lucky shove across the floor.
    expect([...states]).toEqual(['approach', 'lift', 'carry', 'place']);
  }, LONG);

  it('carries the payload rather than dragging it', () => {
    // The lift state exists to get the load off the ground before the machine
    // moves off, and a run that skipped it would still finish — by ploughing
    // the payload along the floor and losing it somewhere on the way.
    const level = getLevel('autocrane');
    const { report, at } = run(autocrane(), level, 1, 60);
    expect(report.complete).toBe(true);
    expect(at('payload').y).toBeGreaterThan(1);
  }, LONG);
});

describe('free kick', () => {
  // Six draws, which is every arrangement of the three objects several times
  // over. A program that had memorised where the ball was would score on a
  // third of them.
  const seeds = [1, 2, 3, 4, 5, 6];

  it.each(seeds)('finds the ball and scores on seed %i, hands off', (seed) => {
    const level = getLevel('free-kick');
    const {
      report, keyboard, flipped, at,
    } = run(striker(), level, seed, 90);
    expect(report.complete).toBe(true);
    expect(report.elapsed).toBeLessThan(level.par);
    expect(keyboard.asked).toEqual([]);
    expect(flipped).toBe(false);
    expect(at('ball').z).toBeGreaterThan(14);
  }, LONG);

  it('is dealt a different hand on different seeds', () => {
    const where = (seed) => {
      const level = getLevel('free-kick');
      const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
      const arena = new Arena({
        RAPIER, world, scene: new THREE.Scene(), level, seed,
      });
      return arena.propPosition('ball').x.toFixed(2);
    };
    expect(new Set([1, 2, 3, 4, 5, 6].map(where)).size).toBeGreaterThan(1);
  });

  it('cannot score by trusting the tag: with everything reading as the ball it shoots a crate', () => {
    // The same machine and the same program, with the eye insisting that
    // whatever it is looking at is the ball. It shoulders the first thing it
    // comes to toward the goal instead, which is what the reading is there to
    // prevent.
    const level = getLevel('free-kick');
    const { report, at } = run(striker(), level, 1, 90, (machine) => {
      machine.sensorTag = () => BALL_TAG;
    });
    expect(report.complete).toBe(false);
    expect(at('ball').z).toBeLessThan(14);
  }, LONG);
});

describe('blind sort', () => {
  const seeds = [1, 2, 3, 4, 5, 6];

  it.each(seeds)('puts every crate in its own bay on seed %i, hands off', (seed) => {
    const level = getLevel('blind-sort');
    const {
      report, keyboard, flipped, at,
    } = run(sorter(), level, seed, 180);
    expect(report.complete).toBe(true);
    expect(report.elapsed).toBeLessThan(level.par);
    expect(keyboard.asked).toEqual([]);
    expect(flipped).toBe(false);
    expect(at('crate-red-1').x).toBeLessThan(-10);
    expect(at('crate-red-2').x).toBeLessThan(-10);
    expect(at('crate-blue').x).toBeGreaterThan(10);
  }, LONG);

  it('takes both roads, and comes back round for the ones it has not done', () => {
    const level = getLevel('blind-sort');
    const { states } = run(sorter(), level, 1, 180);
    // Something went west and something went east, which no single route
    // through the states could have managed.
    expect(states.has('to-red')).toBe(true);
    expect(states.has('to-blue')).toBe(true);
    // And it went back past a spot it had already cleared.
    expect(states.has('regroup')).toBe(true);
  }, LONG);

  it('is dealt a different hand on different seeds', () => {
    const where = (seed) => {
      const level = getLevel('blind-sort');
      const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
      const arena = new Arena({
        RAPIER, world, scene: new THREE.Scene(), level, seed,
      });
      return arena.propPosition('crate-blue').x.toFixed(2);
    };
    expect(new Set([1, 2, 3, 4, 5, 6].map(where)).size).toBeGreaterThan(1);
  });

  it('cannot sort by route: with every crate reading red the blue one goes to the wrong bay', () => {
    // The decision is the whole level. With the eye reporting red whatever it
    // is looking at, the same machine runs the same states in the same order
    // and delivers the blue crate west with the others.
    const level = getLevel('blind-sort');
    const { report, at } = run(sorter(), level, 1, 180, (machine) => {
      machine.sensorTag = () => RED_TAG;
    });
    expect(report.complete).toBe(false);
    expect(at('crate-blue').x).toBeLessThan(0);
  }, LONG);
});
