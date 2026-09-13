import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, gravityOf, STEP } from '../src/sim/world.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';
import { ObjectiveTracker } from '../src/challenges/objectives.js';
import { LEVELS } from '../src/challenges/levels.js';
import { getPart } from '../src/parts/registry.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * A new part must not answer old questions for free.
 *
 * The all-terrain wheel climbs a metre where a powered wheel stops at 0.4, and
 * a fair number of levels have scenery in exactly that band — a kerb, a loading
 * bay, the lip of a quarry. If any of them can now be finished by holding W at
 * it, the wheel did not add a capability, it deleted a puzzle.
 *
 * So every level with a rise in the newly-reachable band gets driven at by the
 * dumbest machine its budget allows, on both wheels, and the two answers have
 * to agree. This is not asking whether the levels are solvable; it is asking
 * whether they are solvable *by accident*.
 */

/** Taller than a powered wheel manages, no taller than an all-terrain one. */
const OPENED = [0.45, 1.06];

const flat = (piece) => !piece.rotX && !piece.rotY;
const topOf = (piece) => piece.pos[1] + piece.size[1] / 2;

/** The levels the new wheel could plausibly have changed anything about. */
export const atRisk = LEVELS.filter((level) => level.spawn
  && (level.objectives?.length ?? 0) > 0
  && (level.pieces ?? []).filter(flat)
    .some((p) => topOf(p) > OPENED[0] && topOf(p) <= OPENED[1]));

const keys = (...codes) => ({
  enabled: true,
  down: new Set(codes),
  pressed: new Set(),
  isDown: (c) => codes.includes(c),
  wasPressed: () => false,
});

/**
 * The dumbest machine that can be built on a given wheel: a slab, a core and
 * four wheels, as big as the budget allows and with nothing clever on it.
 */
function plainRover(type, budget) {
  const part = getPart(type);
  const reach = part.size[2] === 3 ? 2 : 1;
  const bp = new Blueprint({ name: type });
  const mirrored = yawStep(yawStep(IDENTITY_ORIENTATION));
  for (let z = -reach; z <= reach; z += 1) {
    for (let x = -1; x <= 1; x += 1) bp.place('block', [x, 0, z]);
  }
  bp.place('core', [0, 1, 0]);
  for (const z of [-reach, reach]) {
    bp.place(type, [2, 0, z], IDENTITY_ORIENTATION);
    bp.place(type, [-2, 0, z], mirrored);
  }
  // Whatever is left over goes on as ballast, because weight is the first
  // thing anybody reaches for and it must not turn out to be the answer.
  for (let z = -reach; z <= reach && bp.cost() + getPart('ballast').cost <= budget; z += 1) {
    bp.place('ballast', [0, 1, z]);
  }
  return bp.cost() <= budget ? bp : null;
}

/** Holds the accelerator down at a level and says whether that finished it. */
function holdW(level, type, seconds) {
  const blueprint = plainRover(type, level.budget?.cost ?? 0);
  if (!blueprint) return { built: false, complete: false };

  const world = createWorld(RAPIER, gravityOf(level));
  const scene = new THREE.Scene();
  const arena = new Arena({
    RAPIER, world, scene, level, seed: 1,
  });
  const machine = new Machine({
    RAPIER, world, scene, blueprint, spawn: new THREE.Vector3(...level.spawn), level,
  });
  const tracker = new ObjectiveTracker(level);
  const bus = new SignalBus(keys('KeyW'));

  let complete = false;
  for (let i = 0; i < Math.round(seconds / STEP) && !complete; i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    let props = null;
    let points = null;
    const report = tracker.update(STEP, {
      propPosition: (id) => arena.propPosition(id),
      corePosition: () => machine.corePosition(),
      props: () => (props ??= arena.propStates()),
      liveProps: () => arena.liveProps(),
      machinePoints: () => (points ??= machine.blueprint.list()
        .map((placed) => machine.partWorldPoint(placed))),
    });
    complete = report.complete;
  }
  machine.dispose();
  arena.dispose();
  return { built: true, complete };
}

describe('the levels the new wheel could have changed', () => {
  it('found the ones worth asking about', () => {
    // A dozen or so: kerbs, loading bays, the lip of a quarry. If this ever
    // drops to nothing, the band or the scan is wrong rather than the game.
    expect(atRisk.length).toBeGreaterThan(6);
  });

  it('is none of them, by simply driving at it', () => {
    const broken = [];
    for (const level of atRisk) {
      // Long enough to cross any of these courses and then some; short enough
      // that the whole sweep is a few seconds of test.
      const seconds = Math.min(level.par ?? 40, 30);
      const plain = holdW(level, 'wheel', seconds);
      const big = holdW(level, 'atv', seconds);
      if (!big.built) continue;
      if (big.complete && !plain.complete) {
        broken.push(`${level.id} is finished by holding W on all-terrain wheels and was not before`);
      }
    }
    expect(broken).toEqual([]);
  }, 180000);
});
