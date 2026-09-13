import {
  describe, it, expect, beforeAll,
} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { WorldSession } from '../src/world/session.js';
import { Host } from '../server/host.js';
import { snapshotOf, encodeSnapshot } from '../src/net/protocol.js';
import { SignalBus } from '../src/sim/signals.js';
import { STEP } from '../src/sim/world.js';
import { WORLD_LIMITS } from '../src/world/format.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * Whether it holds up.
 *
 * The target is a town of five thousand blocks with forty machines in it and
 * four people connected, at sixty frames a second. Everything here is measured
 * rather than assumed, and the budgets are written against a frame — 16.7 ms —
 * rather than against the numbers this machine happens to produce, so a slower
 * machine running these is being asked the same question.
 *
 * The measurements, on the machine this was written on:
 *
 *     5000 blocks, nothing moving            0.007 ms a step, 30 chunks
 *     40 machines parked                     0.05  ms a step, 39 of 40 asleep
 *     40 machines driving, on the town       2.3   ms a step
 *     host tick, 4 players, 40 driving       1.0   ms, 31 KB/s each
 *
 * And where it stops, driving machines straight at the fleet past the world
 * format's cap of sixty-four:
 *
 *      64 machines   320 bodies    2.0 ms    12% of a frame
 *     100 machines   500 bodies    3.2 ms    19%
 *     150 machines   750 bodies    7.1 ms    43%
 *     220 machines  1100 bodies   13.5 ms    81%
 *     300 machines  1500 bodies   17.9 ms   107%  — over
 *
 * So what breaks first is the cap, not the simulation, and it breaks with
 * about four times the headroom still in hand. That is a number to raise when
 * somebody wants to, not a wall.
 */

/** A frame at sixty a second. Everything below has to fit inside one. */
const FRAME = 1000 / 60;

function rover(name = 'Rover') {
  const bp = new Blueprint({ name });
  const other = yawStep(yawStep(IDENTITY_ORIENTATION));
  bp.place('panel', [0, 0, 0]);
  bp.place('core', [0, 1, 0]);
  for (const z of [-1, 1]) {
    bp.place('wheel', [2, 0, z], IDENTITY_ORIENTATION);
    bp.place('wheel', [-2, 0, z], other);
  }
  return bp;
}

const keys = (...codes) => ({
  enabled: true,
  down: new Set(codes),
  pressed: new Set(),
  isDown: (c) => codes.includes(c),
  wasPressed: () => false,
  endFrame() {},
  take() {},
});

/** Milliseconds a step, averaged, after letting everything settle. */
function costOf(session, steps = 200) {
  const at = performance.now();
  for (let i = 0; i < steps; i += 1) session.step();
  return (performance.now() - at) / steps;
}

/** A flat town of `blocks` blocks, laid down straight into the store. */
function town(session, blocks) {
  let n = 0;
  for (let x = -40; n < blocks; x += 1) {
    for (let z = -40; z < 40 && n < blocks; z += 1) {
      session.world.blocks.set(x, 0, z, 5);
      n += 1;
    }
  }
  return n;
}

function fleetOf(session, many, { spread = 8, radius = 0 } = {}) {
  for (let i = 0; i < many; i += 1) {
    const at = radius
      ? [
        Math.cos((i / many) * Math.PI * 2) * radius, 1.2,
        Math.sin((i / many) * Math.PI * 2) * radius,
      ]
      : [-38 + (i % 10) * spread, 1.2, -38 + Math.floor(i / 10) * spread];
    session.deploy({ blueprint: rover(`m${i}`), at });
  }
  return session;
}

const driveAll = (session) => {
  for (const member of session.fleet.list()) member.bus = new SignalBus(keys('KeyW'));
};

describe('a town of five thousand blocks', () => {
  it('is thirty chunks, not five thousand of anything', () => {
    const session = new WorldSession({ RAPIER, headless: true });
    town(session, WORLD_LIMITS.blocks);
    expect(session.counts().blocks).toBe(WORLD_LIMITS.blocks);
    // One mesh per material per chunk and one body per chunk. Thirty of each
    // is what makes this a town rather than five thousand draw calls.
    expect(session.counts().chunks).toBe(30);
    session.dispose();
  }, 60000);

  it('costs nothing a step when nothing in it is moving', () => {
    const session = new WorldSession({ RAPIER, headless: true });
    town(session, WORLD_LIMITS.blocks);
    session.step();
    expect(costOf(session, 200)).toBeLessThan(FRAME / 8);
    session.dispose();
  }, 60000);
});

describe('forty machines standing in it', () => {
  it('park and go to sleep, so they cost nothing until touched', () => {
    const session = new WorldSession({ RAPIER, headless: true });
    town(session, WORLD_LIMITS.blocks);
    fleetOf(session, 40);
    for (let i = 0; i < 300; i += 1) session.step();

    const asleep = session.fleet.list()
      .filter((m) => m.machine.bodies.every((b) => b.isSleeping())).length;
    expect(asleep).toBeGreaterThanOrEqual(38);
    expect(costOf(session, 200)).toBeLessThan(FRAME / 4);
    session.dispose();
  }, 120000);

  it('all drive at once inside a frame, town and all', () => {
    const session = new WorldSession({ RAPIER, headless: true });
    town(session, WORLD_LIMITS.blocks);
    fleetOf(session, 40);
    for (let i = 0; i < 120; i += 1) session.step();
    driveAll(session);
    for (let i = 0; i < 60; i += 1) session.step();

    // Measured at 2.3 ms. The budget is a whole frame, because that is the
    // actual requirement and this has to mean the same thing on a slower
    // machine than the one it was written on.
    const cost = costOf(session, 200);
    expect(cost).toBeLessThan(FRAME);
    expect(session.fleet.list().every((m) => m.machine.corePosition().y > -2)).toBe(true);
    session.dispose();
  }, 120000);
});

describe('what a player is actually sent', () => {
  it('is only what is near them, once they have been told the rest', () => {
    const session = new WorldSession({ RAPIER, headless: true });
    fleetOf(session, 40, { radius: 240 });
    for (let i = 0; i < 60; i += 1) session.step();
    driveAll(session);
    for (let i = 0; i < 60; i += 1) session.step();

    const host = new Host({ session, now: 0 });
    const player = {
      id: 'p1',
      focus: [240, 1, 0],
      told: new Map(),
      socket: { readyState: 1 },
      keys: keys(),
      driving: null,
    };
    host.players.set('p1', player);

    const everything = encodeSnapshot(snapshotOf(session)).byteLength;
    // The first pass restates the lot on purpose, so that somebody who has
    // only just arrived is told about the far side of the world once.
    host.visibleTo(player);
    host.tick += 1;
    const near = encodeSnapshot(
      snapshotOf(session, { only: host.visibleTo(player) }),
    ).byteLength;

    // Measured: 6332 bytes down to 1434, on machines spread over 500 m.
    expect(near).toBeLessThan(everything / 2);
    expect(near * 20).toBeLessThan(80 * 1024);
    session.dispose();
  }, 120000);

  it('is restated within a second even when it is far away and still', () => {
    const session = new WorldSession({ RAPIER, headless: true });
    fleetOf(session, 6, { radius: 300 });
    for (let i = 0; i < 30; i += 1) session.step();

    const host = new Host({ session, now: 0 });
    const player = {
      id: 'p1',
      focus: [0, 1, 0],
      told: new Map(),
      socket: { readyState: 1 },
      keys: keys(),
      driving: null,
    };
    host.players.set('p1', player);
    host.visibleTo(player);

    // Nothing for a while: everything is asleep and out of range.
    host.tick += 30;
    expect(host.visibleTo(player)).toHaveLength(0);
    // And then, a second on, all of it again — which is what makes it safe to
    // send nothing for a while.
    host.tick += 40;
    expect(host.visibleTo(player)).toHaveLength(6);
    session.dispose();
  }, 60000);
});

describe('four people in one world', () => {
  it('is one millisecond of host per tick, and a broadband trickle each', () => {
    const session = new WorldSession({ RAPIER, headless: true });
    fleetOf(session, 40, { radius: 240 });
    for (let i = 0; i < 60; i += 1) session.step();
    driveAll(session);
    for (let i = 0; i < 60; i += 1) session.step();

    const host = new Host({ session, now: 0 });
    const sent = [];
    for (let p = 1; p <= 4; p += 1) {
      const angle = ((p - 1) / 4) * Math.PI * 2;
      host.players.set(`p${p}`, {
        id: `p${p}`,
        focus: [Math.cos(angle) * 240, 1, Math.sin(angle) * 240],
        told: new Map(),
        socket: {
          readyState: 1,
          send: (buffer) => sent.push(buffer.byteLength ?? buffer.length),
        },
        keys: keys(),
        driving: null,
      });
    }

    const at = performance.now();
    const ticks = 300;
    for (let i = 0; i < ticks; i += 1) host.step();
    const cost = (performance.now() - at) / ticks;

    // Measured at 1.0 ms a tick and 31 KB/s each.
    expect(cost).toBeLessThan(FRAME);
    const each = (sent.reduce((a, b) => a + b, 0) / 4) / (ticks * STEP);
    expect(each).toBeLessThan(200 * 1024);
    expect(sent.length).toBeGreaterThan(0);
    session.dispose();
  }, 120000);
});

describe('where it actually stops', () => {
  it('is the cap on machines, with the simulation still half idle', () => {
    const session = new WorldSession({ RAPIER, headless: true });
    session.world.ground = 4000;
    // Past the world format's cap, straight at the fleet, to find out where
    // the physics gives up rather than where the format says to stop.
    for (let i = 0; i < 150; i += 1) {
      session.fleet.deploy({
        blueprint: rover(`m${i}`),
        spawn: new THREE.Vector3((i % 13) * 20 - 130, 1.2, Math.floor(i / 13) * 20 - 130),
      });
    }
    for (let i = 0; i < 60; i += 1) session.step();
    driveAll(session);
    for (let i = 0; i < 30; i += 1) session.step();

    const cost = costOf(session, 150);
    // A hundred and fifty machines, seven hundred and fifty bodies, all
    // driving: measured at 7.1 ms, which is still inside a frame. The cap is
    // sixty-four.
    expect(session.fleet.list()).toHaveLength(150);
    expect(cost).toBeLessThan(FRAME);
    expect(WORLD_LIMITS.vehicles).toBeLessThan(150);
    session.dispose();
  }, 180000);
});
