import RAPIER from '@dimforge/rapier3d-compat';

import { Host, attach } from '../server/host.js';
import { NetClient } from '../src/net/client.js';
import { WorldSession } from '../src/world/session.js';
import { STEP } from '../src/sim/world.js';
import { makeRng } from '../src/sim/rng.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';

/**
 * A host and a client on a link with weather on it, with the clock turned by
 * hand.
 *
 * Kept out of the test file so that the same rig can be run as a sweep from
 * the command line while tuning, and so the numbers the tests assert are the
 * numbers the tuning was chosen from rather than a second, similar rig.
 */

export function rover(name = 'Rover') {
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

/**
 * A wire with weather on it.
 *
 * Each end looks enough like a socket for the host and the client to use it
 * without knowing. Messages are held until their time comes round, which is
 * what makes the whole thing repeatable: nothing here waits on a real clock.
 *
 * Nothing is ever actually dropped, because this is modelling a WebSocket and
 * a WebSocket is TCP. A lost packet on TCP is not a gap, it is a stall: the
 * message is resent, and everything queued behind it waits for it. So `loss`
 * here is the chance of a retransmit, and what it costs is a hole in time
 * rather than a hole in the data — which is the thing that actually makes a
 * game feel bad over TCP, and the thing the smoothing has to survive.
 */
export function laggyLink({
  latency = 50, jitter = 0, loss = 0, seed = 7, resend = null,
} = {}) {
  const rng = makeRng(seed);
  const queue = [];
  const ends = {};
  const clear = { a: 0, b: 0 };
  const wait = resend ?? latency * 2;

  const endpoint = (side) => {
    const listeners = new Map();
    const on = (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    };
    return {
      readyState: 1,
      binaryType: 'arraybuffer',
      listeners,
      // The host speaks Node's `socket.on`; the client speaks the browser's
      // `addEventListener`. Both, so neither has to know which it is talking to.
      on,
      addEventListener: on,
      send(data) {
        const to = side === 'a' ? 'b' : 'a';
        let at = Math.max(
          ends.now + latency + (jitter ? rng() * jitter : 0),
          clear[to],
        );
        // A retransmit holds the stream open until the resend lands, and
        // everything already in flight behind it arrives in the same bunch.
        // Two losses inside one stall do not cost two stalls, which is what
        // stops a modest loss rate turning into an unbounded queue.
        if (rng() < loss) at = Math.max(at, ends.now + latency + wait);
        clear[to] = Math.max(clear[to], at);
        queue.push({ to, at, data });
      },
      close() {
        this.readyState = 3;
        for (const fn of listeners.get('close') ?? []) fn();
      },
      deliver(data) {
        const binary = typeof data !== 'string';
        for (const fn of listeners.get('message') ?? []) {
          // Node style takes (data, isBinary); browser style takes an event.
          if (fn.length >= 2) fn(data, binary);
          else fn({ data });
        }
      },
    };
  };

  ends.now = 0;
  ends.a = endpoint('a');
  ends.b = endpoint('b');
  ends.pump = (now) => {
    ends.now = now;
    // In order, and only what is due. Out-of-order delivery is a separate
    // problem and WebSocket does not have it.
    for (let i = 0; i < queue.length;) {
      if (queue[i].at > now) { i += 1; continue; }
      const message = queue.splice(i, 1)[0];
      ends[message.to].deliver(message.data);
    }
  };
  return ends;
}

export const keys = (...codes) => ({
  enabled: true,
  down: new Set(codes),
  pressed: new Set(),
  isDown: (c) => codes.includes(c),
  wasPressed: () => false,
});

/**
 * A host and one client, joined by a link with weather on it, with the clock
 * turned by hand. Returns what happened rather than what it looked like.
 */
export async function runLink({
  seconds = 6, latency = 50, jitter = 0, loss = 0, tuning = null, drive = true,
  // Somebody else is driving. The client never asks for the controls, so what
  // is measured is a machine it only watches -- which is the common case in a
  // world with other people in it, and the one the other half of the tuning
  // is for.
  watch = false,
} = {}) {
  const hostSession = new WorldSession({ RAPIER, headless: true });
  hostSession.deploy({ blueprint: rover('Shared'), at: [0, 1.2, -20] });
  const host = new Host({ session: hostSession, now: 0 });

  const link = laggyLink({ latency, jitter, loss });
  attach(host, link.a);

  let clock = 0;
  const client = new NetClient({
    url: 'ws://fake/',
    name: 'Ada',
    now: () => clock,
    WebSocketImpl: class { constructor() { return link.b; } },
    make: (world) => new WorldSession({ RAPIER, world, headless: true }),
  });
  if (tuning) client.tuning = tuning;

  const ready = client.connect();
  // The open event a real socket fires; the fake link is already up.
  for (const fn of link.b.listeners.get('open') ?? []) fn();
  // Let the greeting and the welcome cross the wire.
  for (let i = 0; i < 60; i += 1) {
    clock += STEP * 1000;
    host.pump(clock);
    link.pump(clock);
  }
  const session = await ready;

  const id = session.fleet.list()[0].id;
  if (watch) hostSession.control(id, keys('KeyW'));
  if (drive && !watch) {
    client.askToControl(id);
    for (let i = 0; i < 60; i += 1) {
      clock += STEP * 1000;
      host.pump(clock);
      link.pump(clock);
    }
  }

  const held = drive && !watch ? keys('KeyW') : keys();
  const errors = [];
  let worstError = 0;
  let worstJump = 0;
  let worstShift = 0;
  let last = session.fleet.get(id).machine.corePosition().clone();

  for (let i = 0; i < seconds * 60; i += 1) {
    clock += STEP * 1000;
    client.sendInput(held);
    client.lookingAt(session.fleet.get(id).machine.corePosition());
    host.pump(clock);
    link.pump(clock);
    session.advance(STEP);

    const mine = session.fleet.get(id).machine.corePosition();
    const truth = hostSession.fleet.get(id).machine.corePosition();
    const off = mine.distanceTo(truth);
    errors.push(off);
    worstError = Math.max(worstError, off);

    // What a frame of its own speed would explain, and how far past that it
    // actually went. That surplus is the part a player sees as a jump.
    const speed = session.fleet.get(id).machine.bodies[0].linvel();
    const explained = Math.hypot(speed.x, speed.y, speed.z) * STEP;
    worstJump = Math.max(worstJump, Math.max(0, mine.distanceTo(last) - explained));
    worstShift = Math.max(worstShift, client.correction.shifted ?? 0);
    last = mine.clone();
  }

  const out = {
    worstShift,
    worstError,
    meanError: errors.reduce((a, b) => a + b, 0) / errors.length,
    worstJump,
    snapshots: client.snapshots,
    ping: client.trip.rtt,
    travelled: session.fleet.get(id).machine.corePosition().z + 20,
  };
  client.dispose();
  hostSession.dispose();
  return out;
}
