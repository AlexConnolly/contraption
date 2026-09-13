import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { ObjectiveTracker, droppedLoad, buildProblem } from '../src/challenges/objectives.js';
import { getLevel } from '../src/challenges/levels.js';
import { catcher } from '../src/studio/catcher.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

const LEVEL = getLevel('cannonade');
// Far enough forward that the tray covers where the balls come down.
const PARK = 2.2;

/**
 * Plays the level: drives forward until the tray is under the landing zone,
 * stops, and takes whatever the cannons send.
 */
function play(blueprint, { seconds = 38, park = PARK } = {}) {
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

  let dropped = null;
  let report = null;
  let caught = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    const t = i * STEP;

    // Creeps up to the landing zone and stops. No steering: skid steer on a
    // machine ten metres wide turns a nudge into a spin, and with the spawn
    // this close to the landing zone there is nothing to correct anyway.
    const at = machine.corePosition();
    held.clear();
    if (at.z < park - 0.2) held.add('KeyW');
    else if (at.z > park + 0.2) held.add('KeyS');

    report = tracker.update(STEP, {
      propPosition: (id) => arena.propPosition(id),
      corePosition: () => machine.corePosition(),
      props: () => arena.propStates(),
      liveProps: () => arena.liveProps(),
      elapsed: t,
    });
    const live = arena.liveProps();
    caught = live.filter((p) => p.point.y >= LEVEL.catchFloor).length;
    const down = droppedLoad(LEVEL, { liveProps: () => live });
    if (down && !dropped) dropped = { id: down, t };
    if (dropped || report.complete) break;
  }
  return { dropped, report, caught };
}

describe('Cannonade can be caught', () => {
  it('is a machine the game would let you run', () => {
    const bp = catcher();
    expect(buildProblem(bp, LEVEL)).toBe(null);
    expect(bp.cost()).toBeLessThanOrEqual(LEVEL.budget.cost);
  });

  /**
   * The whole level, played. Nine balls out of three cannons over half a
   * minute, and none of them reaches the floor.
   */
  it('catches all nine without dropping one', () => {
    const out = play(catcher());
    expect(out.dropped, out.dropped && `dropped ${out.dropped.id} at ${out.dropped.t.toFixed(1)}s`)
      .toBe(null);
    expect(out.caught, `only ${out.caught} balls were still up`).toBe(9);
    expect(out.report.complete, 'survived the cannons but the run did not finish').toBe(true);
  }, 200000);

  /**
   * The depth is not padding. Nine balls arrive in three places, three times
   * each, and a shallow tray puts the second one down on top of the first and
   * knocks it out. What the depth buys is somewhere for a ball to end up that
   * is not where the next one lands.
   */
  it('needs a tray deep enough that a catch clears the landing line', () => {
    const shallow = play(catcher({ deep: 2 }));
    expect(shallow.dropped, 'a shallow tray held all nine').not.toBe(null);
  }, 200000);

  /**
   * And the level is not simply passable by turning up. A tray with no wall on
   * it is the thing everybody builds first: the balls arrive doing eleven
   * metres a second and go straight across it and off the back.
   */
  it('is not passed by a flat deck with no wall on it', () => {
    const open = catcher({ wall: 0 });
    const out = play(open);
    expect(out.dropped, 'an open deck held nine balls doing 11 m/s').not.toBe(null);
    expect(out.report.complete).toBe(false);
  }, 200000);
});
