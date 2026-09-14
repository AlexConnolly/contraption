import { describe, it, expect } from 'vitest';

import { Blueprint } from '../src/core/blueprint.js';
import { groupBlueprint } from '../src/sim/grouping.js';
import { outlineOf, flatten, findGroup } from '../src/studio/outliner.js';
import { createGroup, setGroupOf } from '../src/core/groups.js';

/**
 * The machine written down, as the builder arranged it.
 *
 * The tree is whatever somebody dragged it into — no automatic tidying, which
 * was the previous version's mistake. The one thing worked out rather than
 * organised is which parts the core cannot reach, because no amount of
 * arranging reveals that and it is how machines are quietly broken.
 */

const outline = (bp) => outlineOf(bp, groupBlueprint(bp));

function machine() {
  const bp = new Blueprint({ name: 'crane' });
  bp.place('core', [0, 0, 0]);
  for (let z = 1; z <= 4; z += 1) bp.place('block', [0, 0, z]);
  return bp;
}

const idsOf = (bp, type) => bp.list().filter((p) => p.type === type).map((p) => p.id);

describe('an unorganised machine', () => {
  it('is all one list', () => {
    const out = outline(machine());
    expect(out.groups).toEqual([]);
    expect(out.items.length).toBe(5);
    expect(out.parts).toBe(5);
  });

  it('lists parts one by one rather than gathering them by type', () => {
    const out = outline(machine());
    expect(out.items.filter((p) => p.type === 'block').length).toBe(4);
  });
});

describe('groups and loose parts share one list', () => {
  it('puts a part outside every group at the top level, with no heading over it', () => {
    const bp = machine();
    const boom = createGroup(bp, { name: 'Boom' }).id;
    setGroupOf(bp, idsOf(bp, 'block'), boom);

    const out = outline(bp);
    // One group row and one loose core, side by side in the same list.
    expect(out.items.map((i) => i.kind)).toEqual(['group', 'part']);
    expect(out.items[1].name).toBe('Control Core');
    expect(out.items[1].depth).toBe(0);
  });

  it('has no separate ungrouped collection to keep in step', () => {
    expect('ungrouped' in outline(machine())).toBe(false);
  });
});

describe('a machine somebody has organised', () => {
  it('puts the group in the tree with its parts under it', () => {
    const bp = machine();
    const boom = createGroup(bp, { name: 'Boom' }).id;
    setGroupOf(bp, idsOf(bp, 'block'), boom);

    const out = outline(bp);
    expect(out.groups.length).toBe(1);
    expect(out.groups[0].name).toBe('Boom');
    expect(out.groups[0].parts.length).toBe(4);
    expect(out.items.filter((i) => i.kind === 'part').length).toBe(1);
  });

  it('nests, and a parent row acts on everything beneath it', () => {
    const bp = machine();
    const gantry = createGroup(bp, { name: 'Gantry' }).id;
    const boom = createGroup(bp, { name: 'Boom', parent: gantry }).id;
    setGroupOf(bp, idsOf(bp, 'block'), boom);

    const out = outline(bp);
    expect(out.groups[0].name).toBe('Gantry');
    expect(out.groups[0].count).toBe(4);
    expect(out.groups[0].parts).toEqual([]);
    expect(out.groups[0].children[0].name).toBe('Boom');
    expect(out.groups[0].children[0].depth).toBe(1);
  });

  it('can be walked flat, and a group found by id wherever it sits', () => {
    const bp = machine();
    const gantry = createGroup(bp, { name: 'Gantry' }).id;
    const boom = createGroup(bp, { name: 'Boom', parent: gantry }).id;

    const out = outline(bp);
    expect(flatten(out).map((g) => g.id).sort()).toEqual([gantry, boom].sort());
    expect(findGroup(out, boom).name).toBe('Boom');
    expect(findGroup(out, 'nope')).toBeNull();
  });
});

describe('parts the core cannot reach', () => {
  it('are counted whether they are organised or not', () => {
    const bp = machine();
    bp.place('block', [9, 0, 9]);
    expect(outline(bp).detached).toBe(1);
  });

  it('mark the group holding them, so the warning is not buried when folded', () => {
    const bp = machine();
    const stray = bp.place('block', [9, 0, 9]).id;
    const bits = createGroup(bp, { name: 'Bits' }).id;
    setGroupOf(bp, [stray], bits);

    const out = outline(bp);
    expect(out.groups[0].detached).toBe(true);
    expect(out.groups[0].parts[0].detached).toBe(true);
  });

  it('are none of them when everything is joined up', () => {
    expect(outline(machine()).detached).toBe(0);
  });
});

describe('an empty plate', () => {
  it('is an empty tree rather than a crash', () => {
    const out = outline(new Blueprint({ name: 'empty' }));
    expect(out.groups).toEqual([]);
    expect(out.items).toEqual([]);
    expect(out.parts).toBe(0);
  });

  it('survives being handed nothing at all', () => {
    expect(outlineOf(null).items).toEqual([]);
    expect(outlineOf(new Blueprint({ name: 'x' })).parts).toBe(0);
  });
});
