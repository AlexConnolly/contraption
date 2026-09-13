import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { ObjectiveTracker, buildProblem } from '../src/challenges/objectives.js';
import { getLevel } from '../src/challenges/levels.js';
import { Blueprint } from '../src/core/blueprint.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

const LEVEL = getLevel('stacked-loop');
const RISE = LEVEL.objectives[0].rise;

/**
 * Runs the level with its loads already piled up, to answer the question the
 * level design turns on: does a finished tower actually satisfy it. This says
 * nothing about whether a machine can build one — only that the pad, the beam
 * and the count agree with each other and with the physics.
 */
function withTower({ n = 10, greenOn = n, jitter = 0 } = {}) {
  const props = LEVEL.props.map((p) => ({ ...p }));
  const order = [
    ...props.filter((p) => p.id !== 'green'),
    props.find((p) => p.id === 'green'),
  ];
  // Put `greenOn` at that level of the tower and the rest around it.
  const tower = order.filter((p) => p.id !== 'green').slice(0, n - 1);
  tower.splice(greenOn - 1, 0, order[order.length - 1]);

  const wobble = (i) => (jitter ? ((i * 2654435761) % 1000) / 1000 - 0.5 : 0) * 2 * jitter;
  const piled = props.map((p) => {
    const at = tower.findIndex((t) => t.id === p.id);
    if (at < 0) return p;
    return { ...p, pos: [wobble(at), 0.45 + at * RISE, wobble(at + 7)] };
  });

  const level = { ...LEVEL, props: piled };
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const arena = new Arena({
    RAPIER, world, scene: new THREE.Scene(), level, seed: 5,
  });
  const tracker = new ObjectiveTracker(level);
  let report = null;
  for (let i = 0; i < Math.round(12 / STEP); i += 1) {
    arena.step(STEP);
    world.step();
    let cache = null;
    report = tracker.update(STEP, {
      propPosition: (id) => arena.propPosition(id),
      corePosition: () => ({ x: 0, y: 0, z: 0 }),
      props: () => (cache ??= arena.propStates()),
      machinePoints: () => [],
    });
  }
  return { report, arena };
}

describe('Stacked Loop holds together as a level', () => {
  it('caps how tall the machine may be built', () => {
    expect(LEVEL.heightCap).toBe(6);
    const tall = new Blueprint();
    tall.place('core', [0, 0, 0]);
    for (let y = 1; y <= LEVEL.heightCap; y += 1) tall.place('block', [0, y, 0]);
    expect(buildProblem(tall, LEVEL)).toMatch(/too tall/i);
  });

  it('will not let you fly the loads up there', () => {
    expect(LEVEL.bans).toContain('flight');
  });

  /**
   * The whole thing, finished: ten loads standing on the pad with the green
   * one on top of them, still there twelve seconds later.
   */
  it('is complete once ten are stacked with the green one on top', () => {
    const { report } = withTower({ n: 10, greenOn: 10 });
    const [stack, green] = report.objectives;
    expect(stack.count, `only ${stack.count} counted`).toBe(10);
    expect(green.done, 'the green load was not in the beam').toBe(true);
    expect(report.complete).toBe(true);
  }, 120000);

  it('still stands when every load goes down a little off-centre', () => {
    const { report } = withTower({ n: 10, greenOn: 10, jitter: 0.12 });
    expect(report.objectives[0].count).toBe(10);
    expect(report.complete).toBe(true);
  }, 120000);

  // Ten of them in a heap is not the job; the green one has to be the top one.
  it('is not complete with the green load buried in the middle', () => {
    const { report } = withTower({ n: 10, greenOn: 5 });
    const [stack, green] = report.objectives;
    expect(stack.count).toBe(10);
    expect(green.done, 'a buried green load reached the beam').toBe(false);
    expect(report.complete).toBe(false);
  }, 120000);

  // And a tower one short does not reach the beam either.
  it('is not complete one load short', () => {
    const { report } = withTower({ n: 9, greenOn: 9 });
    expect(report.objectives[0].count).toBeLessThan(10);
    expect(report.complete).toBe(false);
  }, 120000);
});
