import { describe, it, expect } from 'vitest';
import { LEVELS, TIERS, tierOf, tier } from '../src/challenges/levels.js';

describe('skill levels', () => {
  it('calls one thing on the ground easy', () => {
    expect(tierOf({ demands: { steps: 1, flies: false } })).toBe('easy');
  });

  it('calls several steps, or flying, medium', () => {
    expect(tierOf({ demands: { steps: 3, flies: false } })).toBe('medium');
    expect(tierOf({ demands: { steps: 1, flies: true } })).toBe('medium');
  });

  it('calls several steps and flying hard', () => {
    expect(tierOf({ demands: { steps: 2, flies: true } })).toBe('hard');
  });

  it('calls anything that runs itself expert, however simple the job', () => {
    expect(tierOf({ demands: { steps: 1, flies: false, autonomous: true } })).toBe('expert');
    expect(tierOf({ demands: { steps: 4, flies: true, autonomous: true } })).toBe('expert');
  });

  it('leaves free play untiered', () => {
    expect(tierOf({})).toBe(null);
    expect(tierOf(undefined)).toBe(null);
  });

  it('gives every challenge a tier, and only the sandbox none', () => {
    for (const level of LEVELS) {
      const got = tierOf(level);
      if (level.id === 'sandbox') expect(got).toBe(null);
      else expect(TIERS.map((t) => t.id)).toContain(got);
    }
  });

  it('never gets easier as the campaign goes on', () => {
    const order = TIERS.map((t) => t.id);
    const campaign = LEVELS.filter((l) => tierOf(l));
    const ranks = campaign.map((l) => order.indexOf(tierOf(l)));
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i], campaign[i].name).toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });

  // Flight is the answer to almost everything, so taking it away is the single
  // biggest thing a level can do to itself.
  it('moves a level up a tier for every ban on it', () => {
    const demands = { steps: 1, flies: false };
    expect(tierOf({ demands })).toBe('easy');
    expect(tierOf({ demands, bans: ['flight'] })).toBe('medium');
    expect(tierOf({ demands, bans: ['flight', 'wheels'] })).toBe('hard');
  });

  // A ban is only a step up when the banned thing was a way out. Taking rotors
  // away from a level nobody could have flown does not make it harder.
  it('does not count a ban that was never an answer anyway', () => {
    const demands = { steps: 1, flies: false, bansBite: false };
    expect(tierOf({ demands, bans: ['flight'] })).toBe('easy');
    expect(tierOf({ demands: { ...demands, steps: 2 }, bans: ['flight'] })).toBe('medium');
  });

  it('still counts one by default, because usually it is a way out', () => {
    expect(tierOf({ demands: { steps: 1, flies: false }, bans: ['flight'] })).toBe('medium');
  });

  it('does not run off the end of the ramp', () => {
    const demands = { steps: 3, flies: true };
    expect(tierOf({ demands, bans: ['flight', 'wheels', 'grabber'] })).toBe('expert');
  });

  it('still calls anything autonomous expert, bans or not', () => {
    expect(tierOf({ demands: { steps: 1, autonomous: true }, bans: ['flight'] })).toBe('expert');
  });

  it('names each tier for the UI', () => {
    expect(tier('expert').name).toBe('Expert');
    expect(tier('nope')).toBe(null);
  });
});
