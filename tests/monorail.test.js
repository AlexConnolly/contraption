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
import { fallLine } from '../src/challenges/format.js';
import { getLevel } from '../src/challenges/levels.js';
import { railer } from '../src/studio/railer.js';
import { starterRover } from '../src/studio/presets.js';
import { centreOfMass } from '../src/ui/hud.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

const LEVEL = getLevel('monorail');
const FLOOR = fallLine(LEVEL);

/** Drives the rail and reports how far it got before it fell, if it fell. */
function ride(blueprint, seconds = 80) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const arena = new Arena({
    RAPIER, world, scene, level: LEVEL, seed: 1,
  });
  const machine = new Machine({
    RAPIER, world, scene, blueprint, level: LEVEL, spawn: new THREE.Vector3(...LEVEL.spawn),
  });
  const held = new Set(['KeyW']);
  const bus = new SignalBus({ isDown: (c) => held.has(c), wasPressed: () => false });
  const tracker = new ObjectiveTracker(LEVEL);

  let fell = null;
  let report = null;
  let reached = -Infinity;
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    const at = machine.corePosition();
    reached = Math.max(reached, at.z);
    report = tracker.update(STEP, {
      propPosition: (id) => arena.propPosition(id),
      corePosition: () => at,
      props: () => arena.propStates(),
      liveProps: () => arena.liveProps(),
      elapsed: i * STEP,
    });
    // Stops on the pad rather than running off the end of the rail. Letting
    // go is not enough at this weight, so it brakes with reverse.
    if (report.objectives[0].progress > 0) {
      held.clear();
      if (at.z > 22.4) held.add('KeyS');
    }
    if (at.y < FLOOR) { fell = { t: i * STEP, z: at.z }; break; }
    if (report.complete) break;
  }
  return { fell, report, reached };
}

describe('Monorail', () => {
  it('drops you if you leave the rail', () => {
    expect(FLOOR, 'no fall line, so falling off costs nothing').not.toBe(null);
    expect(LEVEL.bans).toContain('flight');
  });

  it('is a machine the game would let you run', () => {
    expect(buildProblem(railer(), LEVEL)).toBe(null);
  });

  /**
   * The idea the level is built around, stated as a number: everything heavy
   * is below the rail the machine is running on.
   */
  it('carries its weight below the rail it runs on', () => {
    const com = centreOfMass(railer());
    expect(com.above, 'the weight is not slung under the rail').toBeLessThan(com.height * 0.3);
  });

  it('gets to the far end without coming off', () => {
    const out = ride(railer());
    expect(out.fell, out.fell && `fell at z ${out.fell.z.toFixed(1)} after ${out.fell.t.toFixed(1)}s`)
      .toBe(null);
    expect(out.report.complete, `only got to z ${out.reached.toFixed(1)}`).toBe(true);
  }, 200000);

  /**
   * And the control: an ordinary four-wheeled machine, which is wider than the
   * rail and carries its weight above it.
   */
  it('is not something you can drive an ordinary rover along', () => {
    const out = ride(starterRover(), 30);
    expect(out.fell, 'the stock rover rode a half-metre rail').not.toBe(null);
  }, 200000);
});
