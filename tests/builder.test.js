import { describe, it, expect, beforeEach } from 'vitest';
import { sanitiseLevel, toShareCode, fromShareCode } from '../src/challenges/format.js';
import { TOOLS } from '../src/ui/builder.js';

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
  };
}

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
});

/**
 * The builder's own logic, as opposed to the format's. What matters here is
 * that a level assembled a piece at a time stays a level: its objectives keep
 * pointing at things that exist, and what comes out the other end of a share
 * code is what was built.
 */
describe('what the builder can put down', () => {
  it('offers a tool for every kind of thing a level is made of', () => {
    const kinds = new Set(TOOLS.map((t) => t.kind));
    for (const kind of ['pieces', 'props', 'zones', 'keepout', 'spawn']) {
      expect(kinds, kind).toContain(kind);
    }
  });

  it('makes something the format accepts unchanged, for every tool', () => {
    for (const tool of TOOLS.filter((t) => t.make)) {
      const item = tool.make([2, 0, 3]);
      const level = sanitiseLevel({ [tool.kind]: [{ ...item, id: 'thing' }] });
      expect(level[tool.kind], tool.id).toHaveLength(1);
      const [kept] = level[tool.kind];
      // Nothing a tool produces should be quietly corrected on the way in.
      expect(kept.pos, tool.id).toEqual(item.pos);
      if (item.size) expect(kept.size, tool.id).toEqual(item.size);
      if (item.radius) expect(kept.radius, tool.id).toEqual(item.radius);
    }
  });

  it('starts a ball rolling and a crate sitting, not buried', () => {
    const ball = TOOLS.find((t) => t.id === 'ball').make([0, 0, 0]);
    const crate = TOOLS.find((t) => t.id === 'crate').make([0, 0, 0]);
    expect(ball.radius).toBeGreaterThan(0);
    expect(crate.size[1]).toBeGreaterThan(0);
  });
});

describe('a level assembled a piece at a time', () => {
  // The editor's real work: build up a draft the way clicking would, then
  // check the format still recognises it as a whole level.
  function build() {
    const draft = sanitiseLevel({ name: 'Test', props: [], zones: [], objectives: [] });
    const place = (toolId, at) => {
      const tool = TOOLS.find((t) => t.id === toolId);
      const item = tool.make(at);
      if (tool.kind !== 'pieces') item.id = `${tool.id}-${draft[tool.kind].length + 1}`;
      draft[tool.kind].push(item);
      return item;
    };
    return { draft, place };
  }

  it('keeps everything that was put down', () => {
    const { draft, place } = build();
    place('ground', [0, 0, 0]);
    place('ground', [4, 0, 0]);
    const crate = place('crate', [0, 0, 2]);
    const goal = place('zone', [0, 0, 8]);
    draft.objectives.push({
      type: 'propInZone', prop: crate.id, zone: goal.id, hold: 3, label: 'Done',
    });

    const clean = sanitiseLevel(draft);
    expect(clean.pieces).toHaveLength(2);
    expect(clean.props).toHaveLength(1);
    expect(clean.zones).toHaveLength(1);
    expect(clean.objectives).toHaveLength(1);
  });

  it('gives every prop and zone an id of its own', () => {
    const { draft, place } = build();
    place('crate', [0, 0, 0]);
    place('crate', [2, 0, 0]);
    place('zone', [0, 0, 4]);
    const clean = sanitiseLevel(draft);
    const ids = [...clean.props.map((p) => p.id), ...clean.zones.map((z) => z.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Removing a crate an objective depended on has to take the objective with
   * it. The format would drop that objective silently on the way out; doing it
   * in the open is the difference between a level that cannot be finished and
   * one the author knows about.
   */
  it('loses the objectives that depended on something removed', () => {
    const { draft, place } = build();
    const crate = place('crate', [0, 0, 0]);
    const goal = place('zone', [0, 0, 6]);
    draft.objectives.push({
      type: 'propInZone', prop: crate.id, zone: goal.id, hold: 3, label: 'Done',
    });

    draft.props = draft.props.filter((p) => p.id !== crate.id);
    draft.objectives = draft.objectives.filter(
      (o) => o.prop !== crate.id && o.zone !== crate.id,
    );

    const clean = sanitiseLevel(draft);
    expect(clean.props).toHaveLength(0);
    expect(clean.objectives).toHaveLength(0);
  });

  it('never leaves an objective pointing at something that is gone', () => {
    const { draft, place } = build();
    const crate = place('crate', [0, 0, 0]);
    const goal = place('zone', [0, 0, 6]);
    draft.objectives.push({
      type: 'propInZone', prop: crate.id, zone: goal.id, hold: 3, label: 'Done',
    });
    // Removed without tidying up after it — the format is the backstop.
    draft.props = [];
    expect(sanitiseLevel(draft).objectives).toHaveLength(0);
  });
});

describe('getting a level to somebody else', () => {
  it('survives the trip through a share code', async () => {
    const built = sanitiseLevel({
      name: 'Over the wall',
      brief: 'Get it past the wall.',
      spawn: [0, 1, -10],
      pieces: [
        { pos: [0, 1.5, 0], size: [8, 3, 1], colour: 0x6b7480 },
        { pos: [0, 0, -6], size: [6, 1, 6], colour: 0x6b7480 },
      ],
      props: [{ id: 'crate-1', pos: [0, 0.6, -6], size: [1.1, 1.1, 1.1], mass: 8 }],
      zones: [{ id: 'zone-1', pos: [0, 1, 8], size: [4, 2.4, 4] }],
      keepout: [{ id: 'keepout-1', pos: [0, 4, 4], size: [6, 8, 6] }],
      objectives: [{
        type: 'propInZone', prop: 'crate-1', zone: 'zone-1', hold: 3, label: 'Over it',
      }],
      bans: ['flight'],
      gravity: -6,
      budget: { cost: 140 },
      par: 90,
    });

    const back = await fromShareCode(await toShareCode(built));
    expect(back.ok).toBe(true);
    expect(back.level).toEqual(built);
  });

  it('keeps the shape of a big level inside a pasteable code', async () => {
    const pieces = [];
    for (let i = 0; i < 60; i += 1) {
      pieces.push({ pos: [i % 10, 0, Math.floor(i / 10)], size: [2, 1, 2], colour: 0x6b7480 });
    }
    const code = await toShareCode(sanitiseLevel({ name: 'Big', pieces }));
    const back = await fromShareCode(code);
    expect(back.ok).toBe(true);
    expect(back.level.pieces).toHaveLength(60);
  });
});

describe('a custom level stays out of the campaign', () => {
  it('is marked custom so nothing mistakes it for one of ours', async () => {
    const { customLevels, saveCustomLevel } = await import('../src/challenges/custom.js');
    saveCustomLevel({ name: 'Mine', objectives: [] });
    const mine = customLevels();
    expect(mine).toHaveLength(1);
    expect(mine[0].custom).toBe(true);
  });

  it('never counts toward the campaign tally', async () => {
    const { saveCustomLevel } = await import('../src/challenges/custom.js');
    const { store } = await import('../src/ui/progress.js');
    const { LEVELS } = await import('../src/challenges/levels.js');

    const saved = saveCustomLevel({ name: 'Mine', objectives: [] });
    // Even solved, it is not one of the campaign's ids, so the count that the
    // front end shows cannot move.
    store.recordWin(saved.id, 10, 20);

    const campaign = LEVELS.filter((l) => l.id !== 'sandbox').map((l) => l.id);
    expect(campaign).not.toContain(saved.id);
    expect(store.solvedCount(campaign)).toBe(0);
  });

  it('is found by id alongside the campaign, without joining it', async () => {
    const { saveCustomLevel, resolveLevel } = await import('../src/challenges/custom.js');
    const { LEVELS } = await import('../src/challenges/levels.js');
    const saved = saveCustomLevel({ name: 'Mine' });

    expect(resolveLevel(saved.id).name).toBe('Mine');
    expect(resolveLevel('first-haul').id).toBe('first-haul');
    expect(LEVELS.some((l) => l.id === saved.id)).toBe(false);
  });

  it('survives being saved, listed and deleted', async () => {
    const { saveCustomLevel, customLevels, deleteCustomLevel } = await import('../src/challenges/custom.js');
    const a = saveCustomLevel({ name: 'One' });
    const b = saveCustomLevel({ name: 'Two' });
    expect(customLevels().map((l) => l.name).sort()).toEqual(['One', 'Two']);
    deleteCustomLevel(a.id);
    expect(customLevels().map((l) => l.name)).toEqual(['Two']);
    expect(customLevels()[0].id).toBe(b.id);
  });

  it('editing one keeps its id rather than making a second', async () => {
    const { saveCustomLevel, customLevels } = await import('../src/challenges/custom.js');
    const first = saveCustomLevel({ name: 'Draft' });
    saveCustomLevel({ name: 'Draft, better' }, { id: first.id });
    const mine = customLevels();
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe('Draft, better');
  });

  it('cleans what comes back out of storage, not just what goes in', async () => {
    const { store } = await import('../src/ui/progress.js');
    const { customLevels } = await import('../src/challenges/custom.js');
    // Storage can be edited by hand, so it is no more trusted than a share code.
    store.saveCustomLevel({
      id: 'tampered',
      name: 'Tampered',
      level: { name: 'Tampered', par: 1e9, props: new Array(500).fill({ id: 'x' }) },
    });
    const [level] = customLevels();
    expect(level.par).toBeLessThanOrEqual(3600);
    expect(level.props.length).toBeLessThanOrEqual(60);
  });
});
