import { describe, it, expect } from 'vitest';

import { Blueprint } from '../src/core/blueprint.js';
import { groupBlueprint } from '../src/sim/grouping.js';
import { outlineOf, idsOfRow } from '../src/studio/outliner.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';

/**
 * The machine written down.
 *
 * A flat list of every part is useless — a hundred rows saying "Block" is
 * worse than looking at the model. What makes a panel worth the space is that
 * it groups things the way the machine is actually put together, so the rows
 * are decisions rather than parts: "the forty rollers", "the things on the
 * piston", "the three pieces that are not attached to anything".
 */

const outline = (bp) => outlineOf(bp, groupBlueprint(bp));

/** A chassis with a core, some blocks and four wheels. */
function rover() {
  const bp = new Blueprint({ name: 'rover' });
  bp.place('core', [0, 1, 0]);
  for (let z = -1; z <= 1; z += 1) {
    for (let x = -1; x <= 1; x += 1) bp.place('block', [x, 0, z]);
  }
  const mirrored = yawStep(yawStep(IDENTITY_ORIENTATION));
  for (const z of [-1, 1]) {
    for (const [x, rot] of [[2, IDENTITY_ORIENTATION], [-2, mirrored]]) {
      bp.place('wheel', [x, 0, z], rot);
    }
  }
  return bp;
}

describe('the shape of it', () => {
  it('puts the chassis first and calls it that', () => {
    const out = outline(rover());
    expect(out.bodies[0].isRoot).toBe(true);
    expect(out.bodies[0].name).toBe('Chassis');
  });

  it('gathers parts by type with a count, not one row each', () => {
    const out = outline(rover());
    const blocks = out.bodies[0].types.find((t) => t.type === 'block');
    expect(blocks.count).toBe(9);
    expect(blocks.name).toBe('Block');
    // Nine blocks are one row, not nine.
    expect(out.bodies[0].types.length).toBeLessThan(5);
    // And the whole panel for a nine-block rover with four wheels is a
    // handful of rows rather than a screenful.
    const rows = out.bodies.length + out.bodies.reduce((n, b) => n + b.types.length, 0);
    expect(rows).toBeLessThan(8);
  });

  it('puts the biggest group of a body at the top of it', () => {
    const out = outline(rover());
    const counts = out.bodies[0].types.map((t) => t.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it('counts every part exactly once across the whole tree', () => {
    const bp = rover();
    const out = outline(bp);
    const seen = new Set();
    for (const body of out.bodies) for (const id of body.ids) seen.add(id);
    for (const id of out.loose?.ids ?? []) seen.add(id);
    expect(seen.size).toBe(bp.list().length);
  });
});

describe('naming a group after what moves it', () => {
  it('says which joint carries it, because an index number says nothing', () => {
    const bp = rover();
    bp.place('piston', [0, 2, 0]);
    bp.place('block', [0, 3, 0]);
    bp.place('block', [0, 4, 0]);

    // The rover already has a body per wheel, so name the one we mean.
    const out = outline(bp);
    const carried = out.bodies.find((b) => b.name === 'On the Piston');
    expect(carried).toBeTruthy();
    // The piston travels with what it carries, so it is in this group too.
    expect(carried.count).toBe(3);
    expect(carried.types.map((t) => t.type).sort()).toEqual(['block', 'piston']);
    expect(carried.bodies).toBe(1);
  });

  it('says four identical wheels once, not four times', () => {
    // Each wheel turns on its own joint, so the physics has four bodies. The
    // panel has one row: forty rollers on a conveyor would otherwise be forty
    // identical lines, which is the wall of noise this exists to avoid.
    const out = outline(rover());
    const carried = out.bodies.filter((b) => !b.isRoot);
    expect(carried.length).toBe(1);
    expect(carried[0].name).toBe('Powered Wheel ×4');
    expect(carried[0].bodies).toBe(4);
    expect(carried[0].count).toBe(4);
  });

  it('selects every one of them from that single row', () => {
    const bp = rover();
    const out = outline(bp);
    const row = out.bodies.find((b) => !b.isRoot);
    const ids = idsOfRow(out, { body: row.index });
    expect(ids.length).toBe(4);
    expect(ids.every((id) => bp.get(id).type === 'wheel')).toBe(true);
  });

  it('keeps groups apart when they are built differently', () => {
    const bp = rover();
    bp.place('piston', [0, 2, 0]);
    bp.place('block', [0, 3, 0]);

    const out = outline(bp);
    const names = out.bodies.map((b) => b.name);
    expect(names).toContain('Powered Wheel ×4');
    expect(names).toContain('On the Piston');
  });
});

describe('parts that are not attached to anything', () => {
  it('are called out together, however many islands they are in', () => {
    const bp = rover();
    bp.place('block', [8, 0, 8]);
    bp.place('block', [8, 0, 9]);
    bp.place('beam', [-8, 0, -8]);

    const out = outline(bp);
    expect(out.loose.count).toBe(3);
    expect(out.loose.types.map((t) => t.type).sort()).toEqual(['beam', 'block']);
  });

  it('are not also counted as part of the machine', () => {
    const bp = rover();
    const stray = bp.place('block', [9, 0, 9]).id;
    const out = outline(bp);
    expect(out.bodies.some((b) => b.ids.includes(stray))).toBe(false);
  });

  it('are absent entirely when everything is joined up', () => {
    expect(outline(rover()).loose).toBeNull();
  });
});

describe('what a row selects', () => {
  it('is every part of that type in that body', () => {
    const bp = rover();
    const out = outline(bp);
    const ids = idsOfRow(out, { body: out.bodies[0].index, type: 'block' });
    expect(ids.length).toBe(9);
    expect(ids.every((id) => bp.get(id).type === 'block')).toBe(true);
  });

  it('is the whole body when no type is named', () => {
    const bp = rover();
    const out = outline(bp);
    expect(idsOfRow(out, { body: out.bodies[0].index }).length).toBe(out.bodies[0].count);
  });

  it('is the unattached parts when that row is clicked', () => {
    const bp = rover();
    bp.place('block', [9, 0, 9]);
    const out = outline(bp);
    expect(idsOfRow(out, { loose: true }).length).toBe(1);
  });

  it('is nothing for a row that is not there any more', () => {
    expect(idsOfRow(outline(rover()), { body: 999, type: 'block' })).toEqual([]);
  });
});

describe('an empty plate', () => {
  it('is an empty tree rather than a crash', () => {
    const out = outline(new Blueprint({ name: 'empty' }));
    expect(out.bodies).toEqual([]);
    expect(out.parts).toBe(0);
  });

  it('survives being handed nothing at all', () => {
    expect(outlineOf(null, null).bodies).toEqual([]);
  });
});
