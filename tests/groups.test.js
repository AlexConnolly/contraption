import { describe, it, expect } from 'vitest';

import { Blueprint } from '../src/core/blueprint.js';
import {
  GROUP_LIMITS,
  childrenOf,
  createGroup,
  depthOf,
  dissolveGroup,
  groupTree,
  isWithin,
  partsOfGroup,
  renameGroup,
  sanitiseGroups,
  setGroupOf,
  setGroupParent,
  ungroupedParts,
} from '../src/core/groups.js';
import { cloneGroup, moveGroup, rotateGroup } from '../src/core/group.js';

/**
 * Groups the builder makes and names.
 *
 * The thing to keep straight throughout: a group decides what the editor acts
 * on and nothing else. It is not a weld, the physics never sees it, and a
 * group spanning a hinge still bends at that hinge. Everything here is about
 * organising, and the tests that matter most are the ones about a tree
 * somebody has dragged into a shape it should not be in.
 */

function machine() {
  const bp = new Blueprint({ name: 'crane' });
  bp.place('core', [0, 0, 0]);
  for (let z = 1; z <= 4; z += 1) bp.place('block', [0, 0, z]);
  for (let z = 1; z <= 2; z += 1) bp.place('beam', [2, 0, z]);
  return bp;
}

const ids = (bp, type) => bp.list().filter((p) => p.type === type).map((p) => p.id);

describe('making a group', () => {
  it('names it and puts parts in it', () => {
    const bp = machine();
    const { id } = createGroup(bp, { name: 'Boom' });
    setGroupOf(bp, ids(bp, 'block'), id);

    expect(bp.groups.get(id).name).toBe('Boom');
    expect(partsOfGroup(bp, id).length).toBe(4);
  });

  it('holds a part in one group at a time', () => {
    const bp = machine();
    const a = createGroup(bp, { name: 'A' }).id;
    const b = createGroup(bp, { name: 'B' }).id;
    const block = ids(bp, 'block')[0];

    setGroupOf(bp, [block], a);
    setGroupOf(bp, [block], b);
    expect(partsOfGroup(bp, a)).toEqual([]);
    expect(partsOfGroup(bp, b)).toEqual([block]);
  });

  it('takes parts back out again', () => {
    const bp = machine();
    const id = createGroup(bp, { name: 'Boom' }).id;
    setGroupOf(bp, ids(bp, 'block'), id);
    setGroupOf(bp, ids(bp, 'block'), null);
    expect(partsOfGroup(bp, id)).toEqual([]);
    expect(ungroupedParts(bp).length).toBe(bp.list().length);
  });

  it('will not be renamed to nothing', () => {
    const bp = machine();
    const id = createGroup(bp, { name: 'Boom' }).id;
    expect(renameGroup(bp, id, '   ').ok).toBe(false);
    expect(bp.groups.get(id).name).toBe('Boom');
  });
});

describe('nesting', () => {
  it('puts a group inside another', () => {
    const bp = machine();
    const gantry = createGroup(bp, { name: 'Gantry' }).id;
    const boom = createGroup(bp, { name: 'Boom', parent: gantry }).id;
    setGroupOf(bp, ids(bp, 'block'), boom);

    // Acting on the gantry takes the boom with it, which is the point of it.
    expect(partsOfGroup(bp, gantry).length).toBe(4);
    expect(partsOfGroup(bp, gantry, { deep: false })).toEqual([]);
    expect(childrenOf(bp.groups, gantry).map((g) => g.id)).toEqual([boom]);
  });

  it('refuses to put a group inside itself', () => {
    const bp = machine();
    const a = createGroup(bp, { name: 'A' }).id;
    expect(setGroupParent(bp, a, a).ok).toBe(false);
  });

  it('refuses to put a group inside its own child, which would lose the branch', () => {
    const bp = machine();
    const a = createGroup(bp, { name: 'A' }).id;
    const b = createGroup(bp, { name: 'B', parent: a }).id;
    const c = createGroup(bp, { name: 'C', parent: b }).id;

    const out = setGroupParent(bp, a, c);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/inside itself/i);
    expect(bp.groups.get(a).parent).toBeNull();
  });

  it('stops before nesting gets silly', () => {
    const bp = machine();
    let parent = null;
    for (let i = 0; i < GROUP_LIMITS.depth; i += 1) {
      parent = createGroup(bp, { name: `L${i}`, parent }).id;
    }
    expect(createGroup(bp, { name: 'too deep', parent }).ok).toBe(false);
    expect(depthOf(bp.groups, parent)).toBe(GROUP_LIMITS.depth);
  });

  it('knows what sits under what', () => {
    const bp = machine();
    const a = createGroup(bp, { name: 'A' }).id;
    const b = createGroup(bp, { name: 'B', parent: a }).id;
    expect(isWithin(bp.groups, b, a)).toBe(true);
    expect(isWithin(bp.groups, a, b)).toBe(false);
  });
});

describe('dissolving a group', () => {
  it('keeps the parts and hands them to whatever held it', () => {
    const bp = machine();
    const gantry = createGroup(bp, { name: 'Gantry' }).id;
    const boom = createGroup(bp, { name: 'Boom', parent: gantry }).id;
    setGroupOf(bp, ids(bp, 'block'), boom);

    expect(dissolveGroup(bp, boom).ok).toBe(true);
    expect(bp.list().length).toBe(7);
    // Handed up, not dropped out to the top level.
    expect(partsOfGroup(bp, gantry).length).toBe(4);
  });

  it('hands its child groups up too', () => {
    const bp = machine();
    const a = createGroup(bp, { name: 'A' }).id;
    const b = createGroup(bp, { name: 'B', parent: a }).id;
    const c = createGroup(bp, { name: 'C', parent: b }).id;

    dissolveGroup(bp, b);
    expect(bp.groups.get(c).parent).toBe(a);
  });
});

describe('acting on a group', () => {
  it('moves everything nested inside it', () => {
    const bp = machine();
    const gantry = createGroup(bp, { name: 'Gantry' }).id;
    const boom = createGroup(bp, { name: 'Boom', parent: gantry }).id;
    setGroupOf(bp, ids(bp, 'block'), boom);
    setGroupOf(bp, ids(bp, 'beam'), gantry);

    expect(moveGroup(bp, partsOfGroup(bp, gantry), [0, 3, 0]).moved).toBe(6);
    for (const id of partsOfGroup(bp, gantry)) expect(bp.get(id).cell[1]).toBe(3);
  });

  it('turns as one thing about its own middle', () => {
    const bp = machine();
    const boom = createGroup(bp, { name: 'Boom' }).id;
    setGroupOf(bp, ids(bp, 'block'), boom);

    expect(rotateGroup(bp, partsOfGroup(bp, boom), 'yaw', 1).ok).toBe(true);
    const cells = partsOfGroup(bp, boom).map((id) => bp.get(id).cell);
    expect(new Set(cells.map((c) => c[2])).size).toBe(1);
  });

  it('leaves the copies organised rather than loose', () => {
    const bp = machine();
    const boom = createGroup(bp, { name: 'Boom' }).id;
    setGroupOf(bp, ids(bp, 'block'), boom);

    const out = cloneGroup(bp, partsOfGroup(bp, boom), [4, 0, 0]);
    expect(out.ok).toBe(true);
    for (const id of out.ids) expect(bp.get(id).group).toBe(boom);
  });
});

describe('saving and loading', () => {
  it('carries the groups and what is in them', () => {
    const bp = machine();
    const gantry = createGroup(bp, { name: 'Gantry' }).id;
    const boom = createGroup(bp, { name: 'Boom', parent: gantry }).id;
    setGroupOf(bp, ids(bp, 'block'), boom);

    const back = Blueprint.fromJSON(bp.toJSON());
    expect(back.groups.size).toBe(2);
    expect(back.groups.get(boom).parent).toBe(gantry);
    expect(partsOfGroup(back, gantry).length).toBe(4);
  });

  it('writes nothing extra for a machine with no groups', () => {
    const json = machine().toJSON();
    expect('groups' in json).toBe(false);
    expect(json.parts.every((p) => !('group' in p))).toBe(true);
  });

  it('still reads a machine saved before groups existed', () => {
    const old = { version: 1, name: 'old', parts: machine().toJSON().parts };
    const back = Blueprint.fromJSON(old);
    expect(back.groups.size).toBe(0);
    expect(back.list().length).toBe(7);
  });
});

describe('groups that arrive from somewhere else', () => {
  it('drops a parent that is not there, rather than losing the group', () => {
    const groups = sanitiseGroups([{ id: 'a', name: 'A', parent: 'nope' }]);
    expect(groups.get('a').parent).toBeNull();
  });

  it('breaks a loop rather than hanging on it', () => {
    const groups = sanitiseGroups([
      { id: 'a', name: 'A', parent: 'b' },
      { id: 'b', name: 'B', parent: 'a' },
    ]);
    expect(groups.size).toBe(2);
    const roots = [...groups.values()].filter((g) => !g.parent);
    expect(roots.length).toBeGreaterThan(0);
    // And the tree can actually be walked without looping forever.
    const bp = new Blueprint({ name: 't' });
    bp.groups = groups;
    expect(groupTree(bp).groups.length).toBeGreaterThan(0);
  });

  it('survives junk', () => {
    for (const junk of [null, 42, 'nope', [null, 7, {}]]) {
      expect(sanitiseGroups(junk).size).toBe(0);
    }
  });

  it('caps how many there can be', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `g${i}`, name: 'x' }));
    expect(sanitiseGroups(many).size).toBe(GROUP_LIMITS.groups);
  });

  it('ungroups a part whose group did not survive', () => {
    const bp = machine();
    const json = bp.toJSON();
    json.parts[1].group = 'ghost';
    const back = Blueprint.fromJSON(json);
    expect(back.get(json.parts[1].id).group).toBeUndefined();
  });
});

describe('the tree the panel draws', () => {
  it('is groups in order with their parts and what is loose', () => {
    const bp = machine();
    const gantry = createGroup(bp, { name: 'Gantry' }).id;
    const boom = createGroup(bp, { name: 'Boom', parent: gantry }).id;
    setGroupOf(bp, ids(bp, 'block'), boom);

    const tree = groupTree(bp);
    expect(tree.groups.length).toBe(1);
    expect(tree.groups[0].name).toBe('Gantry');
    expect(tree.groups[0].children[0].name).toBe('Boom');
    expect(tree.groups[0].children[0].parts.length).toBe(4);
    expect(tree.groups[0].all.length).toBe(4);
    expect(tree.loose.length).toBe(3);
  });
});
