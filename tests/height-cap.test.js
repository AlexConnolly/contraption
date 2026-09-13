import { describe, it, expect } from 'vitest';

import { Blueprint } from '../src/core/blueprint.js';
import { withinHeight, buildProblem, ObjectiveTracker } from '../src/challenges/objectives.js';
import { sanitiseLevel } from '../src/challenges/format.js';
import { centreOfMass } from '../src/ui/hud.js';

/**
 * A height cap on the machine.
 *
 * Measured on the machine as built, in cells, and never on the machine as it
 * runs. That distinction is the whole mechanic: a cap you could not exceed at
 * runtime would just be a shorter machine, but a cap on what you may assemble
 * forces the height to come from somewhere else — a mast that telescopes, an
 * arm that unfolds, a tower built lying down and stood up.
 */

const machine = (cells) => {
  const bp = new Blueprint();
  bp.place('core', [0, 0, 0]);
  for (const [x, y, z] of cells) bp.place('block', [x, y, z]);
  return bp;
};

// A column of blocks n cells tall, counting the core at the bottom.
const column = (n) => machine(
  Array.from({ length: Math.max(0, n - 1) }, (_, i) => [0, i + 1, 0]),
);

describe('how tall a machine is', () => {
  it('is counted in cells from its lowest part to its highest', () => {
    expect(column(1).height()).toBe(1);
    expect(column(4).height()).toBe(4);
    expect(column(9).height()).toBe(9);
  });

  it('does not care where in the build box it was drawn', () => {
    const low = machine([[0, 1, 0], [0, 2, 0]]);
    const high = new Blueprint();
    high.place('core', [0, 7, 0]);
    high.place('block', [0, 8, 0]);
    high.place('block', [0, 9, 0]);
    expect(high.height()).toBe(low.height());
  });

  // Measured off the cells a part fills rather than the cell it was placed at,
  // so a part that is two cells long counts for two wherever it points.
  it('counts the room a multi-cell part takes up', () => {
    const bp = new Blueprint();
    bp.place('core', [0, 0, 0]);
    bp.place('beam', [0, 1, 0]);
    expect(bp.extent().size[0]).toBeGreaterThan(1);
    expect(bp.height()).toBe(2);
  });

  it('is nothing at all when nothing is built', () => {
    expect(new Blueprint().height()).toBe(0);
  });
});

describe('the cap itself', () => {
  const level = { heightCap: 4, budget: { cost: 999 } };

  it('lets through a machine inside it', () => {
    expect(withinHeight(column(4), level).ok).toBe(true);
  });

  it('turns away one a single cell over', () => {
    const out = withinHeight(column(5), level);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/5 .* 4/);
  });

  it('is not a rule on levels that do not set one', () => {
    expect(withinHeight(column(30), {}).ok).toBe(true);
  });

  /**
   * Checked while building rather than at the start of a run, like the parts
   * budget and unlike the mass cap — being told the machine is too tall only
   * once you press Play is being told too late to do anything about it.
   */
  it('is one of the reasons the game will not run a machine', () => {
    expect(buildProblem(column(5), level)).toMatch(/too tall/i);
    expect(buildProblem(column(4), level)).toBe(null);
  });

  it('survives a level that asks for a silly one', () => {
    for (const cap of [-4, 0, 'tall', 1e9, null]) {
      const clean = sanitiseLevel({ name: 'x', heightCap: cap });
      expect(clean.heightCap === undefined || clean.heightCap >= 1).toBe(true);
    }
    expect(sanitiseLevel({ name: 'x', heightCap: 4 }).heightCap).toBe(4);
  });
});

/**
 * The job the cap makes interesting: a tower of loads, and a green one that has
 * to end up on top of it.
 */
describe('counting a stack', () => {
  const zone = { id: 'pad', pos: [0, 0, 0], size: [2, 1, 2], colour: 0 };
  const level = {
    zones: [zone],
    objectives: [{
      type: 'propsStacked', zone: 'pad', count: 4, rise: 1, hold: 0, label: 'Stacked',
    }],
  };
  const at = (y, x = 0, z = 0) => ({ x, y, z });
  const run = (props, l = level) => new ObjectiveTracker(l)
    .update(1 / 60, { props: () => props, propPosition: () => null, corePosition: () => at(0) });

  const pile = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
    id: `c${i}`, tag: 0, point: at(0.5 + i, extra.x ?? 0, extra.z ?? 0),
  }));

  it('counts a tower one load at a time', () => {
    for (const n of [1, 2, 3]) {
      expect(run(pile(n)).objectives[0].count, `${n} high`).toBe(n);
    }
  });

  it('is satisfied once the tower is tall enough', () => {
    expect(run(pile(4)).objectives[0].done).toBe(true);
    expect(run(pile(3)).objectives[0].done).toBe(false);
  });

  // Otherwise the answer to every stacking level is to park them in a row.
  it('does not count loads laid out side by side', () => {
    const spread = [
      { id: 'a', tag: 0, point: at(0.5, -0.8) },
      { id: 'b', tag: 0, point: at(0.5, 0) },
      { id: 'c', tag: 0, point: at(0.5, 0.8) },
      { id: 'd', tag: 0, point: at(0.5, 0.4, 0.8) },
    ];
    expect(run(spread).objectives[0].count).toBe(1);
  });

  it('does not count loads outside the pad', () => {
    expect(run(pile(4, { x: 6 })).objectives[0].count).toBe(0);
  });

  // A gap where a load should be is a tower in two halves, not a tall one.
  it('stops counting at a hole in the tower', () => {
    const holed = [...pile(2), { id: 'far', tag: 0, point: at(6.5) }];
    expect(run(holed).objectives[0].count).toBe(2);
  });

  /**
   * The tower has to be standing when the run ends, not to have stood at some
   * point. Every objective in the game already works that way; here it is the
   * difference between stacking and knocking over.
   */
  it('comes undone when the tower falls', () => {
    // Watched while the hold is still running, because a won run is over: the
    // tracker stops looking the moment it completes.
    const held = { ...level, objectives: [{ ...level.objectives[0], hold: 2 }] };
    const tracker = new ObjectiveTracker(held);
    const ctx = (props) => ({
      props: () => props, propPosition: () => null, corePosition: () => at(0),
    });
    for (let i = 0; i < 60; i += 1) tracker.update(1 / 60, ctx(pile(4)));
    expect(tracker.report().objectives[0].progress).toBeGreaterThan(0);

    // The top two slide off and land beside the pad.
    const fallen = [
      ...pile(2),
      { id: 'x', tag: 0, point: at(0.5, 4) },
      { id: 'y', tag: 0, point: at(0.5, 5) },
    ];
    const after = tracker.update(1 / 60, ctx(fallen));
    expect(after.objectives[0].count).toBe(2);
    expect(after.objectives[0].done).toBe(false);
    expect(after.complete).toBe(false);

    // And the second built out of the same loads has to stand for the full
    // hold again rather than inheriting the first one's.
    for (let i = 0; i < 60; i += 1) tracker.update(1 / 60, ctx(pile(4)));
    expect(tracker.report().complete, 'the hold carried over the collapse').toBe(false);
    for (let i = 0; i < 62; i += 1) tracker.update(1 / 60, ctx(pile(4)));
    expect(tracker.report().complete).toBe(true);
  });
});

/**
 * Where the weight sits. Three numbers, and the one players never check until
 * it has already tipped them over is the third.
 */
describe('centre of mass', () => {

  const bp = (cells) => {
    const b = new Blueprint();
    b.place('core', [0, 0, 0]);
    for (const [type, cell] of cells) b.place(type, cell);
    return b;
  };

  it('is in the middle of something symmetrical', () => {
    const even = bp([['block', [-1, 0, 0]], ['block', [1, 0, 0]]]);
    const com = centreOfMass(even);
    expect(Math.abs(com.right)).toBeLessThan(0.01);
    expect(Math.abs(com.forward)).toBeLessThan(0.01);
  });

  it('leans towards the heavy end', () => {
    const lopsided = bp([['ballast', [2, 0, 0]], ['block', [-1, 0, 0]]]);
    expect(centreOfMass(lopsided).right).toBeGreaterThan(0);
  });

  it('rises when the weight goes up, which is the number that tips you over', () => {
    const low = bp([['ballast', [0, 0, 1]]]);
    const high = bp([['block', [0, 1, 0]], ['ballast', [0, 2, 0]]]);
    expect(centreOfMass(high).above).toBeGreaterThan(centreOfMass(low).above);
  });

  it('says nothing about nothing', () => {
    expect(centreOfMass(new Blueprint())).toBe(null);
  });
});
