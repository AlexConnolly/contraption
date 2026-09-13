import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { railRun, railUnder, runningOff } from '../src/sim/rails.js';
import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';
import { CELL } from '../src/parts/registry.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * A rail and the dolly that runs on it.
 *
 * A piston carries its own stroke; a dolly does not. It runs on whatever track
 * it is standing on, so how far it goes is a fact about the machine — lay more
 * rail and it goes further — and that is the whole reason to build a gantry
 * out of parts rather than set a slider.
 *
 * The ends are where it gets interesting. Rail that runs out into thin air is
 * an open end: reach it with the power on and the dolly leaves the track and
 * carries on under its own momentum. Put anything at all in the cell past the
 * last sleeper and that end is a stop.
 */

const FLOOR = {
  id: 'floor',
  name: 'Floor',
  spawn: [0, 1.4, 0],
  groundSize: 200,
  budget: { cost: 9999 },
  pieces: [],
  props: [],
  zones: [],
  objectives: [],
  demands: { steps: 1, flies: false },
  bans: [],
  par: 60,
};

const keys = (...codes) => ({
  enabled: true,
  down: new Set(codes),
  pressed: new Set(),
  isDown: (c) => codes.includes(c),
  wasPressed: () => false,
});

/**
 * A chassis with a run of rail along it and a dolly standing on the middle,
 * carrying a block. `stops` says which ends are blocked off.
 */
function gantry({
  from = -3, to = 3, at = 0, stops = [], load = true,
} = {}) {
  const bp = new Blueprint({ name: 'gantry' });
  for (let z = from; z <= to; z += 1) {
    bp.place('block', [0, 0, z]);
    bp.place('rail', [0, 1, z]);
  }
  bp.place('core', [1, 0, 0]);
  if (stops.includes('forward')) bp.place('block', [0, 1, to + 1]);
  if (stops.includes('back')) bp.place('block', [0, 1, from - 1]);
  const dolly = bp.place('dolly', [0, 2, at]);
  if (load) bp.place('block', [0, 3, at]);
  return { bp, dolly: bp.get(dolly.id) };
}

const runOf = (shape) => {
  const { bp, dolly } = gantry(shape);
  return railRun(bp, dolly);
};

describe('the run of rail under a dolly', () => {
  it('finds the rail it is standing on', () => {
    const { bp, dolly } = gantry();
    expect(railUnder(bp, dolly).rail.type).toBe('rail');
  });

  it('finds nothing when it is standing on a block', () => {
    const bp = new Blueprint();
    bp.place('core', [0, 0, 0]);
    bp.place('block', [0, 1, 0]);
    const dolly = bp.place('dolly', [0, 2, 0]);
    expect(railUnder(bp, bp.get(dolly.id))).toBe(null);
    expect(railRun(bp, bp.get(dolly.id))).toBe(null);
  });

  it('measures how far it can go each way', () => {
    const run = runOf({ from: -3, to: 3, at: 0 });
    expect(run.forward).toBeCloseTo(3 * CELL, 6);
    expect(run.back).toBeCloseTo(3 * CELL, 6);
    expect(run.length).toBeCloseTo(7 * CELL, 6);
  });

  it('measures from where the dolly actually sits, not from the middle', () => {
    const run = runOf({ from: -1, to: 5, at: 4 });
    expect(run.forward).toBeCloseTo(1 * CELL, 6);
    expect(run.back).toBeCloseTo(5 * CELL, 6);
  });

  it('grows when more rail is laid, which is the point of it', () => {
    const short = runOf({ from: -1, to: 1 });
    const long = runOf({ from: -9, to: 9 });
    expect(long.length).toBeGreaterThan(short.length * 4);
  });

  it('runs the way the rail is turned, not the way the dolly is', () => {
    expect(Math.abs(runOf({}).axis[2])).toBe(1);

    // The same idea with every rail turned a quarter: the dolly is placed
    // exactly as before and must now run across rather than along.
    const bp = new Blueprint();
    const across = yawStep(IDENTITY_ORIENTATION);
    for (let x = -2; x <= 2; x += 1) {
      bp.place('block', [x, 0, 0]);
      bp.place('rail', [x, 1, 0], across);
    }
    bp.place('core', [0, 0, 2]);
    const dolly = bp.place('dolly', [0, 2, 0]);
    const run = railRun(bp, bp.get(dolly.id));
    expect(Math.abs(run.axis[0])).toBe(1);
    expect(run.forward + run.back).toBeCloseTo(4 * CELL, 6);
  });
});

describe('what is at the end of the run', () => {
  it('is open when the rail stops in mid air', () => {
    const run = runOf({});
    expect(run.openForward).toBe(true);
    expect(run.openBack).toBe(true);
  });

  it('is stopped by anything at all put in the way', () => {
    const run = runOf({ stops: ['forward'] });
    expect(run.openForward).toBe(false);
    expect(run.openBack).toBe(true);
  });

  it('only lets go at an open end, and only while still going that way', () => {
    const open = {
      forward: 1.5, back: 1.5, openForward: true, openBack: true,
    };
    const shut = { ...open, openForward: false, openBack: false };
    // At the end and driving on.
    expect(runningOff(open, 1.5, 2)).toBe(true);
    expect(runningOff(open, -1.5, -2)).toBe(true);
    // At the end and stopped: parked against the buffers is not falling off.
    expect(runningOff(open, 1.5, 0)).toBe(false);
    // At the end, driving, and the end is blocked.
    expect(runningOff(shut, 1.5, 2)).toBe(false);
    // Halfway along at full speed.
    expect(runningOff(open, 0, 2)).toBe(false);
    expect(runningOff(null, 0, 2)).toBe(false);
  });
});

/** Builds the gantry for real and drives the dolly for a few seconds. */
function drive({ seconds = 5, held = ['KeyB'], ...shape } = {}) {
  const { bp, dolly } = gantry(shape);
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const arena = new Arena({
    RAPIER, world, scene, level: FLOOR, seed: 1,
  });
  const machine = new Machine({
    RAPIER, world, scene, blueprint: bp, spawn: new THREE.Vector3(0, 2.5, 0), level: FLOOR,
  });
  const bus = new SignalBus(keys(...held));
  const core = bp.list().find((p) => p.type === 'core');
  const chassis = () => machine.partWorldPoint(core);
  const carriage = () => machine.partWorldPoint(dolly);
  const start = carriage().clone().sub(chassis());

  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
  }
  const moved = carriage().clone().sub(chassis()).sub(start);
  const entry = machine.joints.find((j) => j.partId === dolly.id);
  const out = {
    along: moved.z,
    across: Math.hypot(moved.x, moved.y),
    released: Boolean(entry?.released),
  };
  machine.dispose();
  arena.dispose();
  return out;
}

describe('driving one', () => {
  it('runs along the rail when told to advance', () => {
    const out = drive({ from: -4, to: 4, stops: ['forward', 'back'] });
    expect(out.along).toBeGreaterThan(1.2);
  }, 60000);

  it('runs the other way when told to retreat', () => {
    const out = drive({
      from: -4, to: 4, stops: ['forward', 'back'], held: ['KeyV'],
    });
    expect(out.along).toBeLessThan(-1.2);
  }, 60000);

  it('does not sway, however much it is carrying', () => {
    const out = drive({ from: -4, to: 4, stops: ['forward', 'back'] });
    // A prismatic joint has one degree of freedom and no rotation at all, so
    // the carriage stays square to the track whatever is bolted on top.
    expect(out.across).toBeLessThan(0.06);
  }, 60000);

  it('stops at a blocked end and stays on the track', () => {
    const out = drive({
      from: -2, to: 2, stops: ['forward', 'back'], seconds: 6,
    });
    expect(out.released).toBe(false);
    expect(out.along).toBeLessThan(2 * CELL + 0.08);
  }, 60000);
});

describe('running out of rail', () => {
  it('leaves the track at an open end', () => {
    const out = drive({ from: -2, to: 2, stops: ['back'], seconds: 6 });
    expect(out.released, 'the dolly stayed jointed past the end of the rail').toBe(true);
  }, 60000);

  it('carries on going, rather than stopping dead where the rail ran out', () => {
    const out = drive({ from: -2, to: 2, stops: ['back'], seconds: 6 });
    // Past the last sleeper and still travelling: it took its momentum with
    // it. Falling is what happens next, and that is only gravity.
    expect(out.along).toBeGreaterThan(2 * CELL + 0.1);
  }, 60000);

  it('stays put when the end is stopped, however hard it is driven', () => {
    const open = drive({ from: -2, to: 2, stops: ['back'], seconds: 6 });
    const shut = drive({
      from: -2, to: 2, stops: ['back', 'forward'], seconds: 6,
    });
    expect(open.released).toBe(true);
    expect(shut.released).toBe(false);
    expect(shut.along).toBeLessThan(open.along);
  }, 90000);
});
