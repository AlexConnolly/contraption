import { describe, it, expect } from 'vitest';

import { Blueprint } from '../src/core/blueprint.js';
import { starterRover, quadcopter, openingMachine } from '../src/studio/presets.js';
import { getLevel } from '../src/challenges/levels.js';

/**
 * What a level opens with.
 *
 * Finishing a challenge used to throw your machine away: the next level had no
 * design of its own, so it handed you the stock rover, and whatever you had
 * spent ten minutes building was gone unless you had thought to save it to the
 * garage first. You now arrive with the thing you were just driving, which is
 * both the sensible starting point for the next job and the moment you get to
 * decide whether it is worth keeping.
 */
describe('the machine you arrive with', () => {
  const rover = () => {
    const bp = new Blueprint({ name: 'My rover' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('wheel', [2, 0, 0]);
    bp.place('wheel', [-2, 0, 0]);
    bp.place('piston', [0, 2, 0]);
    return bp;
  };

  it('is the one you were just driving', () => {
    const carried = rover();
    const out = openingMachine({ carried, level: getLevel('rough-ground') });
    expect(out.from).toBe('carried');
    expect(out.blueprint.name).toBe('My rover');
    expect(out.blueprint.size).toBe(carried.size);
  });

  /**
   * A level you have already built something for keeps what you built. Coming
   * back to a half-finished answer and finding last level's machine in its
   * place would be worse than the problem this solves.
   */
  it('is your own saved design where you have one, whatever you arrived in', () => {
    const stored = starterRover();
    const out = openingMachine({ stored, carried: rover(), level: getLevel('rough-ground') });
    expect(out.from).toBe('stored');
    expect(out.blueprint).toBe(stored);
  });

  it('is the stock rover when there is nothing to carry', () => {
    expect(openingMachine({ level: getLevel('first-haul') }).from).toBe('starter');
  });

  // A bare core is not a machine, and arriving with nothing at all helps
  // nobody.
  it('is the stock rover when what you were driving was barely anything', () => {
    const bare = new Blueprint();
    bare.place('core', [0, 0, 0]);
    expect(openingMachine({ carried: bare, level: getLevel('first-haul') }).from).toBe('starter');
  });

  /**
   * Carrying a machine into a level that forbids it would hand the player
   * something that cannot run and no explanation of why.
   */
  it('is not one this level has banned', () => {
    const drone = quadcopter();
    const out = openingMachine({ carried: drone, level: getLevel('shunt') });
    expect(out.from).toBe('starter');
    expect(out.refused?.id).toBe('flight');
  });

  it('still comes through on a level with no ban against it', () => {
    const out = openingMachine({ carried: quadcopter(), level: getLevel('airlift') });
    expect(out.from).toBe('carried');
  });

  /**
   * The machine left behind has already been written to storage under the old
   * level. Handing the same object to the new level would make every edit
   * there an edit to the old level's design as well.
   */
  it('is a copy, so editing it does not reach back into the last level', () => {
    const carried = rover();
    const out = openingMachine({ carried, level: getLevel('rough-ground') });
    expect(out.blueprint).not.toBe(carried);
    out.blueprint.place('block', [0, 3, 0]);
    expect(out.blueprint.size).toBe(carried.size + 1);
  });

  // Over budget is a thing you can see and fix; being handed the stock rover
  // instead, because the game quietly decided for you, is not.
  it('comes through even when it costs more than this level allows', () => {
    const heavy = rover();
    const level = getLevel('letterbox');
    for (let x = -4; x <= 4 && heavy.cost() <= level.budget.cost; x += 1) {
      for (let z = -4; z <= 4 && heavy.cost() <= level.budget.cost; z += 1) {
        heavy.place('block', [x, 4, z]);
      }
    }
    expect(heavy.cost()).toBeGreaterThan(level.budget.cost);
    expect(openingMachine({ carried: heavy, level }).from).toBe('carried');
  });
});
