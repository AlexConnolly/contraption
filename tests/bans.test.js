import { describe, it, expect } from 'vitest';
import { Blueprint } from '../src/core/blueprint.js';
import { getPart, allParts } from '../src/parts/registry.js';
import {
  BANS, bansOn, banFor, bannedParts, firstBanned,
} from '../src/challenges/bans.js';
import { LEVELS } from '../src/challenges/levels.js';

/**
 * A ban is the cheapest content in the game: no new parts, no new physics,
 * and it changes the whole shape of a level. What it must never do is take a
 * player by surprise twenty minutes into a build, so everything here is about
 * knowing early and exactly what is off the table.
 */
describe('what a ban covers', () => {
  const covered = (banId, partId) => Boolean(banFor({ bans: [banId] }, partId));

  it('takes away everything that can hold a machine up', () => {
    expect(covered('flight', 'propeller')).toBe(true);
    expect(covered('flight', 'thruster')).toBe(true);
    expect(covered('flight', 'controller')).toBe(true);
  });

  it('leaves the ground machine alone when flight is banned', () => {
    for (const id of ['core', 'block', 'wheel', 'piston', 'sensor']) {
      expect(covered('flight', id), id).toBe(false);
    }
  });

  it('takes away anything that rolls on an axle', () => {
    expect(covered('wheels', 'wheel')).toBe(true);
    expect(covered('wheels', 'castor')).toBe(true);
  });

  // A turntable turns on an axle too, but it is not a wheel — banning wheels
  // must not quietly remove the one part that makes a walker possible.
  it('leaves the turntable and the hinge out of the wheel ban', () => {
    expect(covered('wheels', 'turntable')).toBe(false);
    expect(covered('wheels', 'hinge')).toBe(false);
  });

  it('takes away anything that latches on', () => {
    expect(covered('grabber', 'grabber')).toBe(true);
    expect(covered('grabber', 'piston')).toBe(false);
  });

  it('allows everything on a level with no bans', () => {
    for (const part of allParts()) {
      expect(banFor({}, part.id), part.name).toBe(null);
    }
  });

  it('names the ban that did it, so the player can be told why', () => {
    const ban = banFor({ bans: ['flight'] }, 'propeller');
    expect(ban.id).toBe('flight');
    expect(ban.name).toMatch(/flight/i);
  });
});

describe('the set of parts a level forbids', () => {
  it('is empty when nothing is banned', () => {
    expect(bannedParts({}).size).toBe(0);
  });

  it('lists every part the ban reaches', () => {
    const forbidden = bannedParts({ bans: ['flight'] });
    expect(forbidden.has('propeller')).toBe(true);
    expect(forbidden.has('thruster')).toBe(true);
    expect(forbidden.has('controller')).toBe(true);
    expect(forbidden.has('wheel')).toBe(false);
  });

  it('adds up when a level bans more than one thing', () => {
    const forbidden = bannedParts({ bans: ['flight', 'wheels'] });
    expect(forbidden.has('propeller')).toBe(true);
    expect(forbidden.has('wheel')).toBe(true);
    expect(forbidden.has('castor')).toBe(true);
  });

  it('ignores a ban nobody has written a rule for', () => {
    expect(bansOn({ bans: ['flight', 'nonsense'] }).map((b) => b.id)).toEqual(['flight']);
  });
});

/**
 * The case that will actually bite: a machine built on one level, saved to the
 * garage, and loaded onto a level that forbids half of it.
 */
describe('checking a machine against a level', () => {
  function drone() {
    const bp = new Blueprint();
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('propeller', [2, 1, 0]);
    return bp;
  }

  function rover() {
    const bp = new Blueprint();
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('wheel', [2, 0, 0]);
    return bp;
  }

  it('passes a machine that breaks nothing', () => {
    expect(firstBanned({ bans: ['flight'] }, rover())).toBe(null);
  });

  it('passes anything at all on a level with no bans', () => {
    expect(firstBanned({}, drone())).toBe(null);
  });

  it('names the part and the ban, not just that something is wrong', () => {
    const found = firstBanned({ bans: ['flight'] }, drone());
    expect(found).not.toBe(null);
    expect(found.part.id).toBe('propeller');
    expect(found.part.name).toBe(getPart('propeller').name);
    expect(found.ban.id).toBe('flight');
  });

  it('catches a machine that breaks the second of two bans', () => {
    const found = firstBanned({ bans: ['flight', 'wheels'] }, rover());
    expect(found?.ban.id).toBe('wheels');
  });
});

describe('the levels themselves', () => {
  it('only ever ban something there is a rule for', () => {
    const known = new Set(BANS.map((ban) => ban.id));
    for (const level of LEVELS) {
      for (const id of level.bans ?? []) {
        expect(known, `${level.name} bans "${id}"`).toContain(id);
      }
    }
  });

  // A level that bans everything you could build a machine out of is not a
  // hard level, it is a broken one.
  it('never ban a level down to nothing buildable', () => {
    for (const level of LEVELS) {
      const forbidden = bannedParts(level);
      const left = allParts().filter((part) => !forbidden.has(part.id));
      expect(left.length, level.name).toBeGreaterThan(4);
      expect(left.some((p) => p.id === 'core'), level.name).toBe(true);
    }
  });
});
