import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { buildProblem } from '../src/challenges/objectives.js';
import { getLevel } from '../src/challenges/levels.js';
import { stacker } from '../src/studio/stacker.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

const LEVEL = getLevel('stacked-loop');

/**
 * A machine inside the height cap that fetches a load off the floor and lifts
 * it clear: mast, arm, and a grabber that looks down.
 *
 * Placing a load at a chosen height is a different problem and is not this
 * machine's: four rams on one key are all the way out or all the way in, and
 * a ten-course tower wants ten heights. That wants the ram's target driven as
 * a number, which is what the computer is for.
 */
function fetch(seconds = 60) {
  const { blueprint, grab } = stacker();
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const arena = new Arena({
    RAPIER, world, scene, level: LEVEL, seed: 4,
  });
  const machine = new Machine({
    RAPIER, world, scene, blueprint, level: LEVEL, spawn: new THREE.Vector3(...LEVEL.spawn),
  });
  const held = new Set();
  const pressed = new Set();
  const bus = new SignalBus({
    isDown: (c) => held.has(c),
    wasPressed: (c) => pressed.delete(c),
  });
  const core = blueprint.list().find((p) => p.type === 'core');
  const hook = blueprint.get(grab);
  const mark = 'load-1';

  let holding = false;
  let lifted = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    holding = machine.grabs.has(grab);
    const load = arena.propPosition(mark);
    const nose = machine.partWorldPoint(hook);

    if (!holding) {
      // Point at the load and drive at it.
      const ahead = machine.partWorldAxis(core, [0, 0, 1]);
      const want = new THREE.Vector3(load.x - nose.x, 0, load.z - nose.z).normalize();
      const flat = new THREE.Vector3(ahead.x, 0, ahead.z).normalize();
      held.clear();
      if (flat.dot(want) < 0.985) held.add(flat.x * want.z - flat.z * want.x > 0 ? 'KeyD' : 'KeyA');
      else held.add('KeyW');
      if (i % 15 === 0) pressed.add('KeyG');
    } else {
      held.clear();
      held.add('KeyE');
      lifted = Math.max(lifted, load.y);
    }
  }
  return { holding, lifted, blueprint };
}

describe('a machine that stacks, inside the cap', () => {
  it('is a machine the game would let you run', () => {
    const { blueprint } = stacker();
    expect(blueprint.height()).toBeLessThanOrEqual(LEVEL.heightCap);
    expect(buildProblem(blueprint, LEVEL)).toBe(null);
  });

  /**
   * It finds a load, takes hold of it and picks it clear of the floor, which
   * is the part of the job the height cap was supposed to make interesting:
   * a machine three metres tall reaching well above itself.
   */
  it('fetches a load and lifts it far above its own height', () => {
    const out = fetch();
    expect(out.holding, 'never got hold of a load').toBe(true);
    expect(out.lifted, `only lifted it to ${out.lifted.toFixed(2)}m`)
      .toBeGreaterThan(out.blueprint.height() * 0.5 * 1.5);
  }, 200000);
});
