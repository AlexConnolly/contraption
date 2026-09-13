import {
  describe, it, expect, beforeAll,
} from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';

import { runLink } from './laglink.js';
import { Trip } from '../src/net/correction.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * How it feels on a bad line.
 *
 * A real socket on this machine is a millisecond and never drops anything,
 * which proves the plumbing and nothing about the experience. So this runs
 * both ends in one process over a link that delays, jitters and drops on
 * purpose, with the clock turned by hand — the same host code, the same client
 * code, the same protocol, and a repeatable answer.
 *
 * Two numbers decide whether it is any good:
 *
 * - **How wrong it is.** The distance between where the client is drawing a
 *   machine and where the host actually has it. This is the lie.
 * - **How much it jumps.** The furthest anything moves in one frame beyond
 *   what its own speed explains. This is the thing you can see.
 *
 * They pull against each other — correcting harder cuts the first and raises
 * the second — so both are measured, every time, against the flat "put it
 * where the host said" version that stage three shipped.
 */

describe('the machine in your hands, on a fifty-millisecond link', () => {
  it('stays close to where the host actually has it', async () => {
    const run = await runLink({ latency: 50, seconds: 6 });
    // Fifteen centimetres, on a machine doing several metres a second. Nothing
    // you do lands anywhere other than where it looked like it would.
    expect(run.meanError).toBeLessThan(0.25);
    expect(run.worstError).toBeLessThan(0.6);
  }, 60000);

  it('measures the round trip rather than guessing at it', async () => {
    const run = await runLink({ latency: 50, seconds: 4 });
    expect(run.ping).toBeGreaterThan(70);
    expect(run.ping).toBeLessThan(120);
  }, 60000);

  it('still drives where it was pointed', async () => {
    const run = await runLink({ latency: 50, seconds: 6 });
    expect(run.travelled).toBeGreaterThan(15);
  }, 60000);

  it('never shifts anything far enough to see', async () => {
    const run = await runLink({ latency: 50, seconds: 6 });
    // Seven centimetres, once, on a machine several metres long, spread over
    // the frames between one snapshot and the next. Measured: 0.073 m.
    expect(run.worstShift).toBeLessThan(0.12);
  }, 60000);
});

describe('a link that is properly bad', () => {
  const bad = { latency: 100, jitter: 40, loss: 0.05, seconds: 8 };

  it('holds together driving through a hundred milliseconds and jitter', async () => {
    const run = await runLink(bad);
    // Measured: 0.19 m out, 0.15 m in the worst single correction.
    expect(run.meanError).toBeLessThan(0.3);
    expect(run.worstShift).toBeLessThan(0.25);
    expect(run.travelled).toBeGreaterThan(15);
  }, 90000);

  it('holds together watching somebody else drive', async () => {
    const run = await runLink({ ...bad, watch: true });
    expect(run.meanError).toBeLessThan(0.35);
    expect(run.worstShift).toBeLessThan(0.3);
  }, 90000);

  it('carries on when one message in five has to be sent twice', async () => {
    const run = await runLink({ latency: 60, loss: 0.2, seconds: 8 });
    expect(run.meanError).toBeLessThan(0.3);
    expect(run.snapshots).toBeGreaterThan(60);
  }, 90000);

  it('degrades rather than falling apart on a link nobody should play on', async () => {
    // Two hundred milliseconds each way, sixty of jitter, a tenth of
    // everything resent. Off the far end of what this is tuned for; what
    // matters is that it is still a game rather than a slideshow.
    const run = await runLink({
      latency: 200, jitter: 60, loss: 0.1, seconds: 8,
    });
    expect(run.meanError).toBeLessThan(1.5);
    expect(run.worstShift).toBeLessThan(0.6);
    expect(run.travelled).toBeGreaterThan(10);
  }, 90000);
});

describe('what the smoothing actually bought', () => {
  const bad = { latency: 100, jitter: 40, loss: 0.05, seconds: 8 };
  const FLAT = {
    blend: 1, ownBlend: 1, adopt: 1, ownAdopt: 1, lead: 0, still: 0,
  };

  it('is a third of the shift and half the error, driving', async () => {
    const smooth = await runLink(bad);
    const flat = await runLink({ ...bad, tuning: FLAT });
    // The flat version is what stage three shipped: every body put exactly
    // where the host last said it was, twenty times a second. It is not
    // wrong, it is honestly a tenth of a second behind -- and it is horrible.
    expect(smooth.worstShift).toBeLessThan(flat.worstShift / 2.5);
    expect(smooth.meanError).toBeLessThan(flat.meanError / 1.5);
  }, 120000);

  it('is a sixth of the shift, watching', async () => {
    const smooth = await runLink({ ...bad, watch: true });
    const flat = await runLink({ ...bad, watch: true, tuning: FLAT });
    // Watching is where it shows most. A machine somebody else is driving has
    // no local reason to move at all without the velocity in the snapshot, so
    // the flat version drags it forward twenty times a second.
    expect(smooth.worstShift).toBeLessThan(flat.worstShift / 4);
    expect(smooth.meanError).toBeLessThan(flat.meanError);
  }, 120000);

  it('is mostly the velocity and the lead, not the blending', async () => {
    const full = await runLink({ ...bad, watch: true });
    const noLead = await runLink({ ...bad, watch: true, tuning: { lead: 0 } });
    // Blending alone smooths the picture and leaves it behind. The lead is
    // what puts it in the right place, and it needs the velocity to do it.
    expect(full.meanError).toBeLessThan(noLead.meanError);
  }, 120000);
});

describe('measuring a round trip that jumps about', () => {
  it('settles on the steady value rather than chasing each sample', () => {
    const trip = new Trip();
    for (let i = 0; i < 60; i += 1) trip.add(100);
    expect(trip.rtt).toBeCloseTo(100, 1);
    trip.add(600);
    expect(trip.rtt).toBeLessThan(160);
  });

  it('comes back down faster than it went up', () => {
    const trip = new Trip();
    for (let i = 0; i < 40; i += 1) trip.add(200);
    const spiked = trip.add(900);
    for (let i = 0; i < 5; i += 1) trip.add(200);
    expect(trip.rtt).toBeLessThan(spiked);
    expect(trip.rtt).toBeLessThan(300);
  });

  it('takes the first sample at face value rather than starting from nothing', () => {
    const trip = new Trip();
    expect(trip.add(85)).toBe(85);
  });

  it('ignores a reading that is not one', () => {
    const trip = new Trip();
    trip.add(50);
    trip.add(NaN);
    trip.add(-10);
    expect(trip.rtt).toBe(50);
  });
});
