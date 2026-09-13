import { describe, it, expect } from 'vitest';

import { ObjectiveTracker, plateZone, inZone } from '../src/challenges/objectives.js';
import { sanitiseLevel } from '../src/challenges/format.js';
import { BANS, banFor, bannedParts } from '../src/challenges/bans.js';

/**
 * A pressure plate is a square of floor that wants a particular thing standing
 * on it. Coloured plates want cargo of that colour and nothing else; a neutral
 * plate takes anything at all, the machine's own body included, which is what
 * makes it the interesting one — it is the plate you have to stand on
 * yourself.
 *
 * The point of the whole mechanic is that plates are held, not ticked. Three
 * plates is not three errands, it is one problem: everything has to be down at
 * the same moment, so with fewer blocks than plates the machine has to become
 * part of the answer.
 */

const PLATES = [
  { id: 'red', pos: [-4, 0.15, 0], size: [2, 0.3, 2], tag: 1 },
  { id: 'blue', pos: [0, 0.15, 0], size: [2, 0.3, 2], tag: 2 },
  { id: 'any', pos: [4, 0.15, 0], size: [2, 0.3, 2] },
];

const level = {
  plates: PLATES,
  scored: false,
  objectives: [
    { type: 'platePressed', plate: 'red', hold: 0, label: 'Red plate' },
    { type: 'platePressed', plate: 'blue', hold: 0, label: 'Blue plate' },
    { type: 'platePressed', plate: 'any', hold: 0, label: 'Neutral plate' },
  ],
};

// Somewhere resting on the named plate.
const on = (id, extra = {}) => {
  const plate = PLATES.find((p) => p.id === id);
  return { x: plate.pos[0], y: plate.pos[1] + 0.5, z: plate.pos[2], ...extra };
};

/** The world as the tracker sees it: some loose props, and a machine. */
const world = ({ props = [], machine = [] } = {}) => ({
  props: () => props,
  machinePoints: () => machine,
  propPosition: () => null,
  corePosition: () => ({ x: 0, y: 0, z: 0 }),
});

const run = (ctx, l = level) => {
  const tracker = new ObjectiveTracker(l);
  return tracker.update(1 / 60, ctx);
};

describe('what presses a plate', () => {
  it('is a block of the plate’s own colour', () => {
    const report = run(world({ props: [{ id: 'a', tag: 1, point: on('red') }] }));
    expect(report.objectives[0].done).toBe(true);
  });

  it('is not a block of the wrong colour, however well parked', () => {
    const report = run(world({ props: [{ id: 'a', tag: 2, point: on('red') }] }));
    expect(report.objectives[0].done).toBe(false);
  });

  /**
   * Any red block will do. A level with three red blocks and one red plate is
   * not a puzzle about which red block.
   */
  it('is any block of that colour, not one particular block', () => {
    for (const id of ['r1', 'r2', 'r3']) {
      const report = run(world({ props: [{ id, tag: 1, point: on('red') }] }));
      expect(report.objectives[0].done, `${id} should have counted`).toBe(true);
    }
  });

  it('is nothing at all when the block is beside the plate rather than on it', () => {
    const beside = { x: -4, y: 0.65, z: 3.5 };
    const report = run(world({ props: [{ id: 'a', tag: 1, point: beside }] }));
    expect(report.objectives[0].done).toBe(false);
  });

  // Airspace is not the plate. Something held a long way above it is not on it.
  it('is nothing when the block is held high above the plate', () => {
    const above = { x: -4, y: 4, z: 0 };
    const report = run(world({ props: [{ id: 'a', tag: 1, point: above }] }));
    expect(report.objectives[0].done).toBe(false);
  });
});

describe('the neutral plate', () => {
  it('takes a block of any colour', () => {
    for (const tag of [0, 1, 2, 7]) {
      const report = run(world({ props: [{ id: 'a', tag, point: on('any') }] }));
      expect(report.objectives[2].done, `tag ${tag} should have counted`).toBe(true);
    }
  });

  /**
   * The affordance the whole design turns on: you can hold it down yourself.
   * Without this, three plates and one block is unsolvable rather than hard.
   */
  it('takes the machine itself', () => {
    const report = run(world({ machine: [on('any')] }));
    expect(report.objectives[2].done).toBe(true);
  });
});

describe('a coloured plate', () => {
  // Otherwise every colour puzzle has the same answer: park on it.
  it('is not fooled by parking the machine on it', () => {
    const report = run(world({ machine: [on('red'), on('blue')] }));
    expect(report.objectives[0].done).toBe(false);
    expect(report.objectives[1].done).toBe(false);
  });
});

/**
 * The reason the mechanic is worth having. The tracker already refuses to
 * remember a condition that has lapsed, so plates cost nothing to make
 * simultaneous — and simultaneous is the whole game.
 */
describe('plates are held, not ticked off', () => {
  const pressed = () => world({
    props: [
      { id: 'r', tag: 1, point: on('red') },
      { id: 'b', tag: 2, point: on('blue') },
    ],
    machine: [on('any')],
  });

  it('is complete only while every one of them is down', () => {
    expect(run(pressed()).complete).toBe(true);
  });

  /**
   * Measured before the run is won, because a won run is over: the tracker
   * stops looking the moment it completes, which is right, and means the only
   * place this can be seen is while the hold is still being built up.
   */
  it('comes undone the moment one is let go', () => {
    const held = { ...level, objectives: level.objectives.map((o) => ({ ...o, hold: 2 })) };
    const tracker = new ObjectiveTracker(held);
    for (let i = 0; i < 60; i += 1) tracker.update(1 / 60, pressed());
    expect(tracker.report().objectives.every((o) => !o.done)).toBe(true);

    // The machine drives off the neutral plate to go and fetch something.
    const lifted = world({
      props: [
        { id: 'r', tag: 1, point: on('red') },
        { id: 'b', tag: 2, point: on('blue') },
      ],
    });
    const after = tracker.update(1 / 60, lifted);
    expect(after.complete).toBe(false);
    // A second of hold on the neutral plate, thrown away.
    for (let i = 0; i < 61; i += 1) tracker.update(1 / 60, lifted);
    expect(tracker.report().complete, 'it finished without the neutral plate').toBe(false);
  });

  it('will not let a hold be built up across two separate visits', () => {
    const held = { ...level, objectives: level.objectives.map((o) => ({ ...o, hold: 1 })) };
    const tracker = new ObjectiveTracker(held);
    for (let i = 0; i < 30; i += 1) tracker.update(1 / 60, pressed());
    // Half a second of hold banked, then it lapses.
    tracker.update(1 / 60, world({}));
    for (let i = 0; i < 30; i += 1) tracker.update(1 / 60, pressed());
    expect(tracker.report().complete, 'the hold carried over a lapse').toBe(false);
    for (let i = 0; i < 31; i += 1) tracker.update(1 / 60, pressed());
    expect(tracker.report().complete).toBe(true);
  });
});

describe('the volume a plate reads', () => {
  it('sits on top of the slab rather than inside it', () => {
    const zone = plateZone(PLATES[0]);
    expect(zone.pos[1]).toBeGreaterThan(PLATES[0].pos[1]);
    expect(inZone({ x: -4, y: 0.5, z: 0 }, zone)).toBe(true);
  });

  it('is no wider than the plate, so a near miss is a miss', () => {
    const zone = plateZone(PLATES[0]);
    expect(zone.size[0]).toBe(PLATES[0].size[0]);
    expect(zone.size[2]).toBe(PLATES[0].size[2]);
  });
});

/**
 * Plates arrive in levels people built, so they go through the sanitiser like
 * everything else.
 */
describe('a plate that arrived from a stranger', () => {
  it('survives being nonsense', () => {
    const clean = sanitiseLevel({
      name: 'Plates',
      plates: [
        { id: 'ok', pos: [0, 0, 0], size: [2, 0.3, 2], tag: 3 },
        { id: 'silly', pos: ['x', null, 1e9], size: [-4, 0, 0], tag: 99 },
        'not even an object',
      ],
      objectives: [
        { type: 'platePressed', plate: 'ok', hold: 2 },
        { type: 'platePressed', plate: 'nowhere' },
      ],
    });
    // Rubbish becomes a harmless default rather than being dropped, which is
    // what every other list in a level does with it.
    expect(clean.plates).toHaveLength(3);
    for (const plate of clean.plates) {
      expect(plate.id).toBeTruthy();
      expect(plate.tag).toBeLessThanOrEqual(9);
      expect(plate.tag).toBeGreaterThanOrEqual(0);
      for (const n of [...plate.pos, ...plate.size]) expect(Number.isFinite(n)).toBe(true);
    }
    // An objective pointing at a plate that is not there cannot be completed
    // and gives the player no way to know, so it does not survive.
    expect(clean.objectives).toHaveLength(1);
    expect(clean.objectives[0].plate).toBe('ok');
  });
});

/**
 * "No decoupling" is a constraint the puzzles want to state, and bans read
 * behaviour rather than names, so it covers anything that lets go of itself —
 * including a coupling somebody writes in a parts pack.
 */
describe('the no-couplings ban', () => {
  it('exists', () => {
    expect(BANS.map((b) => b.id)).toContain('coupling');
  });

  it('covers the coupling', () => {
    expect(banFor({ bans: ['coupling'] }, 'coupling')?.id).toBe('coupling');
  });

  it('reads the behaviour, so a pack coupling is covered too', () => {
    const ban = BANS.find((b) => b.id === 'coupling');
    expect(ban.covers({ id: 'mine:quickrelease', actuator: { kind: 'release' } })).toBe(true);
  });

  it('leaves everything that does not let go alone', () => {
    for (const id of ['wheel', 'piston', 'grabber', 'hinge', 'block']) {
      expect(bannedParts({ bans: ['coupling'] }).has(id), `${id} was banned`).toBe(false);
    }
  });
});
