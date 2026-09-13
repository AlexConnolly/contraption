import { describe, it, expect } from 'vitest';
import {
  WORLD_TOOLS, MODE_NAMES, deployAt, swatches,
} from '../src/ui/sandbox.js';
import { ago } from '../src/ui/frontend.js';
import { MODES } from '../src/world/session.js';
import { MATERIALS, BLOCK } from '../src/world/terrain.js';
import { WORLD_LIMITS } from '../src/world/format.js';

/**
 * The open world's chrome, minus the DOM.
 *
 * What is worth checking here is the arithmetic and the lists: a machine put
 * down on the corner of a cell instead of the middle of it, or a material
 * rack that offers a material the store will not accept, are both the kind of
 * thing that looks fine until somebody uses it.
 */

describe('the tool rack', () => {
  it('offers a tool for each thing a click can do in a world', () => {
    expect(WORLD_TOOLS.map((t) => t.id)).toEqual(['place', 'erase', 'deploy']);
  });

  it('says what each one does, because none of them is obvious', () => {
    for (const tool of WORLD_TOOLS) expect(tool.hint.length, tool.id).toBeGreaterThan(10);
  });

  it('names the same three modes the session has', () => {
    expect(MODE_NAMES.map((m) => m.id)).toEqual([...MODES]);
  });
});

describe('the material rack', () => {
  it('offers every material the world format will accept, and no air', () => {
    const offered = swatches();
    expect(offered).toHaveLength(WORLD_LIMITS.materials);
    expect(offered[0].index).toBe(1);
    expect(offered.at(-1).index).toBe(WORLD_LIMITS.materials);
    expect(MATERIALS[0]).toBe(null);
  });

  it('gives every one of them a name and a colour to show', () => {
    for (const spec of swatches()) {
      expect(spec.name, String(spec.index)).toBeTruthy();
      expect(Number.isInteger(spec.colour), spec.name).toBe(true);
    }
  });
});

describe('standing a machine on a cell', () => {
  it('puts it in the middle of the cell, not on its corner', () => {
    const at = deployAt([4, 0, -7]);
    expect(at[0]).toBeCloseTo(4 + BLOCK / 2, 6);
    expect(at[2]).toBeCloseTo(-7 + BLOCK / 2, 6);
  });

  it('stands it on the floor of the cell being pointed at', () => {
    // `aim` gives the empty cell a block would fill, so its floor is the
    // surface. A machine is built up from its lowest part.
    expect(deployAt([0, 0, 0])[1]).toBeCloseTo(0.05, 6);
    expect(deployAt([0, 3, 0])[1]).toBeCloseTo(3 + 0.05, 6);
  });

  it('never buries it in the surface it is standing on', () => {
    for (const y of [0, 1, 5, 20]) expect(deployAt([0, y, 0])[1]).toBeGreaterThan(y);
  });
});

describe('how long ago a world was saved', () => {
  const now = 1_000_000_000;
  const back = (seconds) => ago(now - seconds * 1000, now);

  it('calls the last minute just now', () => {
    expect(back(0)).toBe('just now');
    expect(back(60)).toBe('just now');
  });

  it('counts minutes, then hours, then days, then weeks', () => {
    expect(back(60 * 30)).toBe('30 min ago');
    expect(back(3600 * 5)).toBe('5 hr ago');
    expect(back(86400 * 3)).toBe('3 days ago');
    expect(back(86400 * 30)).toBe('4 weeks ago');
  });

  it('never reports the future as an age', () => {
    expect(ago(now + 60_000, now)).toBe('just now');
  });
});
