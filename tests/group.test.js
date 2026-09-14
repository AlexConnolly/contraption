import { describe, it, expect } from 'vitest';

import { Blueprint, occupiedCells } from '../src/core/blueprint.js';
import {
  canCloneGroup,
  canMoveGroup,
  cloneGroup,
  connectedTo,
  groupCells,
  groupExtent,
  moveGroup,
  removeGroup,
  rotateGroup,
  canRotateGroup,
  pivotOf,
} from '../src/core/group.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';

/**
 * Moving, copying and deleting several parts at once.
 *
 * The case that decides whether this is any use is the smallest one: a row of
 * parts sliding a single cell along. Every part lands where its neighbour was
 * standing a moment ago, so anything that checks one part at a time against a
 * board still holding the rest will refuse it — and refusing to nudge a
 * selection is refusing the feature.
 */

/** A row of blocks along Z, returned with its ids. */
function row(bp, { x = 0, y = 0, from = 0, to = 3, type = 'block' } = {}) {
  const ids = [];
  for (let z = from; z <= to; z += 1) ids.push(bp.place(type, [x, y, z]).id);
  return ids;
}

const cellsOf = (bp, id) => {
  const p = bp.get(id);
  return occupiedCells(p.type, p.cell, p.rot);
};

describe('sliding a selection', () => {
  it('moves it one cell, which means every part lands on its neighbour', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 5 });

    expect(moveGroup(bp, ids, [0, 0, 1]).ok).toBe(true);
    expect(bp.list().map((p) => p.cell[2]).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('takes the whole selection or none of it', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 3 });
    bp.place('block', [0, 0, 5]);                       // a wall one step beyond

    const before = bp.list().map((p) => [...p.cell]);
    const out = moveGroup(bp, ids, [0, 0, 2]);
    expect(out.ok).toBe(false);
    expect(bp.list().map((p) => [...p.cell])).toEqual(before);
  });

  it('slides past something that is not in the way', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 3 });
    bp.place('block', [3, 0, 0]);

    expect(moveGroup(bp, ids, [0, 1, 0]).ok).toBe(true);
  });

  it('will not leave the build area', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 2 });
    const out = canMoveGroup(bp, ids, [0, 0, 999]);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/build area/i);
  });

  it('keeps the occupancy map honest, so the cells it left are free again', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 2 });
    moveGroup(bp, ids, [2, 0, 0]);

    expect(bp.partAt([0, 0, 0])).toBeNull();
    expect(bp.partAt([2, 0, 0])).toBeTruthy();
    expect(bp.canPlace('block', [0, 0, 0]).ok).toBe(true);
  });

  it('is a no-op for a delta of nothing, rather than an error', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp);
    expect(moveGroup(bp, ids, [0, 0, 0]).ok).toBe(true);
  });

  it('says so plainly when nothing is selected', () => {
    const bp = new Blueprint({ name: 't' });
    expect(canMoveGroup(bp, [], [0, 0, 1]).reason).toMatch(/nothing selected/i);
  });

  it('ignores ids that name no part', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 2 });
    expect(moveGroup(bp, [...ids, 'ghost-id'], [0, 1, 0]).moved).toBe(3);
  });
});

describe('copying a selection', () => {
  it('leaves the originals and makes the same parts alongside', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 3 });

    const out = cloneGroup(bp, ids, [1, 0, 0]);
    expect(out.ok).toBe(true);
    expect(out.ids.length).toBe(4);
    expect(bp.list().length).toBe(8);
  });

  it('hands back the new ids, so copying twice walks instead of stacking', () => {
    const bp = new Blueprint({ name: 't' });
    let ids = row(bp, { from: 0, to: 1 });

    for (let i = 0; i < 3; i += 1) {
      const out = cloneGroup(bp, ids, [1, 0, 0]);
      expect(out.ok).toBe(true);
      ids = out.ids;
    }
    expect(bp.list().length).toBe(8);
    expect(new Set(bp.list().map((p) => p.cell[0]))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('carries the settings across, which is most of why anybody copies', () => {
    const bp = new Blueprint({ name: 't' });
    const wheel = bp.place('wheel', [0, 0, 0], IDENTITY_ORIENTATION).id;
    bp.setConfig(wheel, { power: 3, torque: 5 });

    const out = cloneGroup(bp, [wheel], [2, 0, 0]);
    expect(bp.get(out.ids[0]).config).toEqual({ power: 3, torque: 5 });
  });

  it('carries rotation across too', () => {
    const bp = new Blueprint({ name: 't' });
    const turned = yawStep(IDENTITY_ORIENTATION);
    const wedge = bp.place('wedge', [0, 0, 0], turned).id;
    const out = cloneGroup(bp, [wedge], [0, 1, 0]);
    expect(bp.get(out.ids[0]).rot).toBe(turned);
  });

  it('refuses to land on the originals', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 3 });
    const out = cloneGroup(bp, ids, [0, 0, 1]);
    expect(out.ok).toBe(false);
    expect(bp.list().length).toBe(4);
  });

  it('refuses by name when the selection holds a one-of-a-kind part', () => {
    // Dropping the core quietly would hand somebody a chassis that looks right
    // and will not run, and they would find out several minutes later.
    const bp = new Blueprint({ name: 't' });
    const core = bp.place('core', [0, 0, 0]).id;
    const ids = [core, ...row(bp, { from: 1, to: 2 })];

    const out = cloneGroup(bp, ids, [4, 0, 0]);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/only be one/i);
    expect(bp.list().length).toBe(3);
  });

  it('leaves nothing behind when it gives up part way', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 3 });
    bp.place('block', [1, 0, 2]);                       // blocks one copy only

    const before = bp.list().length;
    expect(cloneGroup(bp, ids, [1, 0, 0]).ok).toBe(false);
    expect(bp.list().length).toBe(before);
  });
});

describe('deleting a selection', () => {
  it('takes all of it', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 5 });
    bp.place('core', [3, 0, 0]);

    expect(removeGroup(bp, ids).removed).toBe(6);
    expect(bp.list().map((p) => p.type)).toEqual(['core']);
  });

  it('frees the cells', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 2 });
    removeGroup(bp, ids);
    expect(bp.canPlace('block', [0, 0, 1]).ok).toBe(true);
  });
});

describe('what the selection covers', () => {
  it('is every cell of every member, multi-cell parts included', () => {
    const bp = new Blueprint({ name: 't' });
    const atv = bp.place('atv', [0, 0, 0], IDENTITY_ORIENTATION).id;
    // The all-terrain wheel is 1x3x3, so it is nine cells on its own.
    expect(groupCells(bp, [atv]).length).toBe(9);
    expect(cellsOf(bp, atv).length).toBe(9);
  });

  it('is a box the studio can draw a ghost around', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 3 });
    expect(groupExtent(bp, ids)).toEqual({ min: [0, 0, 0], max: [0, 0, 3], size: [1, 1, 4] });
  });

  it('is null when nothing is selected', () => {
    expect(groupExtent(new Blueprint({ name: 't' }), [])).toBeNull();
  });
});

describe('selecting everything attached to a part', () => {
  it('walks through touching faces', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 5 });
    expect(connectedTo(bp, ids[0]).length).toBe(6);
  });

  it('stops at a gap', () => {
    const bp = new Blueprint({ name: 't' });
    const near = row(bp, { from: 0, to: 2 });
    row(bp, { from: 6, to: 8 });
    expect(connectedTo(bp, near[0]).length).toBe(3);
  });

  it('will not walk a whole machine when told to stop short', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 9 });
    expect(connectedTo(bp, ids[0], { limit: 4 }).length).toBeLessThanOrEqual(4);
  });
});

describe('turning a whole selection', () => {
  it('carries the parts round as well as turning them', () => {
    // An arm in a line along +Z, turned a quarter about the up axis, has to
    // end up in a line along an X axis. Turning each part where it stands
    // would leave the line pointing the way it started.
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 3 });

    expect(rotateGroup(bp, ids, 'yaw', 1).ok).toBe(true);
    const cells = ids.map((id) => bp.get(id).cell);
    expect(new Set(cells.map((c) => c[2])).size).toBe(1);
    expect(new Set(cells.map((c) => c[0])).size).toBe(4);
  });

  it('turns each part on the spot at the same time', () => {
    const bp = new Blueprint({ name: 't' });
    const wheel = bp.place('wheel', [0, 0, 0], IDENTITY_ORIENTATION).id;
    rotateGroup(bp, [wheel], 'yaw', 1);
    expect(bp.get(wheel).rot).toBe(yawStep(IDENTITY_ORIENTATION));
  });

  it('is back where it started after four quarter turns', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: -2, to: 2 });
    const before = ids.map((id) => ({ ...bp.get(id), cell: [...bp.get(id).cell] }));

    for (let i = 0; i < 4; i += 1) expect(rotateGroup(bp, ids, 'yaw', 1).ok).toBe(true);

    for (const was of before) {
      const now = bp.get(was.id);
      expect(now.cell).toEqual(was.cell);
      expect(now.rot).toBe(was.rot);
    }
  });

  it('turns about the middle of the selection by default', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: -2, to: 2 });
    expect(pivotOf(bp, ids)).toEqual([0, 0, 0]);
    rotateGroup(bp, ids, 'yaw', 1);
    // The middle part sits on the pivot, so it is the one that does not move.
    expect(bp.get(ids[2]).cell).toEqual([0, 0, 0]);
  });

  it('turns about a pivot you name, so an arm can swing from its shoulder', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 3 });
    rotateGroup(bp, ids, 'yaw', 1, [0, 0, 0]);
    expect(bp.get(ids[0]).cell).toEqual([0, 0, 0]);
  });

  it('takes all of it or none of it', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 3 });

    // Ask where the turn would put things, then stand something on one of
    // those cells. Guessing the destination by hand gets the handedness wrong
    // and quietly tests nothing.
    const plan = canRotateGroup(bp, ids, 'yaw', 1);
    expect(plan.ok).toBe(true);
    const landing = plan.placements.find((n) => !ids.includes(bp.partAt(n.cell)?.id));
    bp.place('block', landing.cell);

    const before = bp.list().map((p) => [...p.cell]);
    expect(rotateGroup(bp, ids, 'yaw', 1).ok).toBe(false);
    expect(bp.list().map((p) => [...p.cell])).toEqual(before);
  });

  it('frees the cells it turned out of', () => {
    const bp = new Blueprint({ name: 't' });
    const ids = row(bp, { from: 0, to: 3 });
    rotateGroup(bp, ids, 'yaw', 1);
    // Nothing left stranded in the occupancy map from where the arm was.
    const held = bp.list().flatMap((p) => occupiedCells(p.type, p.cell, p.rot).map(String));
    for (const c of held) expect(bp.partAt(c.split(',').map(Number))).toBeTruthy();
    expect(bp.canPlace('block', [0, 0, 3]).ok).toBe(true);
  });

  it('says so plainly when nothing is selected', () => {
    const bp = new Blueprint({ name: 't' });
    expect(canRotateGroup(bp, [], 'yaw', 1).reason).toMatch(/nothing selected/i);
  });
});
