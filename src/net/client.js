import { Blueprint } from '../core/blueprint.js';
import {
  FROM_CLIENT, FROM_HOST, decodeSnapshot, applySnapshot, inputWire,
} from './protocol.js';

/**
 * The other end of the wire.
 *
 * A client does not open a world file: it is told one. So this owns the world
 * from the moment it connects — it builds the session out of the `welcome`,
 * keeps its fleet and its blocks in step with what the host says, and hands
 * the game a session that behaves exactly like an offline one.
 *
 * Everything a client does to the world is a request, not a change. Placing a
 * block sends the edit and waits for it to come back; taking the controls asks
 * and is told yes or no. That is what makes one machine the authority rather
 * than four people each sure they are right, and it costs a round trip on
 * things nobody notices a round trip on.
 *
 * It is deliberately transport-agnostic: give it a WebSocket implementation
 * and it does not care whether it is in a tab or in a test.
 */

/** How long without a snapshot before it is worth saying so on screen. */
const QUIET = 3000;

/** What `npm run host` listens on unless told otherwise. */
export const DEFAULT_PORT = 7777;

/**
 * What a person typed, turned into something a socket will take.
 *
 * Parsed rather than pattern-matched, because the patterns all have a hole in
 * them: `ws://` on its own passed a scheme check and produced an address with
 * no host in it, which fails much later and much less clearly than it should.
 *
 * Pasting the address bar of a page the host is serving works, and it is the
 * most likely thing anybody has to hand.
 */
export function wsAddress(typed) {
  const text = String(typed ?? '').trim();
  if (!text) return null;
  const scheme = /^(wss?|https?):\/\//.test(text);
  let url;
  try {
    url = new URL(scheme ? text : `ws://${text}`);
  } catch {
    return null;
  }
  if (!url.hostname) return null;
  const secure = url.protocol === 'wss:' || url.protocol === 'https:';
  const where = url.port ? url.host : `${url.host}:${DEFAULT_PORT}`;
  return `${secure ? 'wss' : 'ws'}://${where}${url.pathname}${url.search}`;
}

export class NetClient {
  constructor({
    url,
    name = 'Player',
    make,
    handlers = {},
    WebSocketImpl = globalThis.WebSocket,
    now = () => Date.now(),
  }) {
    this.url = url;
    this.name = name;
    this.make = make;
    this.h = handlers;
    this.WebSocketImpl = WebSocketImpl;
    this.now = now;

    this.socket = null;
    this.session = null;
    this.you = null;
    this.owner = null;
    this.authority = 'owner';
    this.players = new Map();
    this.driving = null;
    this.snapshots = 0;
    this.lastSnapshot = 0;
    this.state = 'idle';
  }

  get connected() {
    return this.state === 'playing';
  }

  /** True when the world has stopped arriving, which is worth saying. */
  get quiet() {
    return this.connected && this.now() - this.lastSnapshot > QUIET;
  }

  /** Whether this player is allowed to change the world itself. */
  get mayBuild() {
    return this.authority === 'open' || this.owner === null || this.owner === this.you;
  }

  connect() {
    if (this.socket) return this.ready;
    const Socket = this.WebSocketImpl;
    const socket = new Socket(this.url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.state = 'joining';

    this.ready = new Promise((resolve, reject) => {
      this.settle = { resolve, reject };
    });

    socket.addEventListener('open', () => {
      this.send({ type: FROM_CLIENT.HELLO, name: this.name });
    });
    socket.addEventListener('message', (event) => this.receive(event.data));
    socket.addEventListener('close', () => {
      const was = this.state;
      this.state = 'gone';
      if (was === 'joining') this.settle.reject(new Error('The host closed the connection'));
      this.h.onClosed?.();
    });
    socket.addEventListener('error', () => {
      if (this.state === 'joining') this.settle.reject(new Error('Could not reach that host'));
    });
    return this.ready;
  }

  send(message) {
    if (this.socket?.readyState !== 1) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  // -------------------------------------------------------------- what arrives

  receive(data) {
    if (typeof data !== 'string') {
      const snap = decodeSnapshot(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      if (!snap || !this.session) return;
      applySnapshot(this.session, snap);
      this.snapshots += 1;
      this.lastSnapshot = this.now();
      return;
    }
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    switch (message.type) {
      case FROM_HOST.WELCOME: return this.welcomed(message);
      case FROM_HOST.JOINED:
        this.players.set(message.player.id, message.player);
        this.h.onPlayers?.([...this.players.values()]);
        return undefined;
      case FROM_HOST.LEFT:
        this.players.delete(message.player.id);
        this.h.onPlayers?.([...this.players.values()]);
        return undefined;
      case FROM_HOST.FLEET: return this.fleetChanged(message);
      case FROM_HOST.EDITS: return this.edited(message.ops);
      case FROM_HOST.DENIED:
        this.h.onDenied?.(message.reason);
        return undefined;
      default: return undefined;
    }
  }

  welcomed(message) {
    this.you = message.you;
    this.owner = message.owner;
    this.authority = message.authority ?? 'owner';
    this.players = new Map((message.players ?? []).map((p) => [p.id, p]));
    this.session = this.make(message.world);
    for (const wire of message.vehicles ?? []) this.addVehicle(wire);
    this.state = 'playing';
    this.lastSnapshot = this.now();
    this.settle.resolve(this.session);
    this.h.onReady?.(this.session);
    this.h.onPlayers?.([...this.players.values()]);
  }

  addVehicle(wire) {
    if (!this.session) return null;
    let blueprint;
    try {
      blueprint = Blueprint.fromJSON(wire.blueprint);
    } catch {
      return null;
    }
    const put = this.session.deploy({
      blueprint,
      at: wire.at,
      yaw: ((wire.yaw ?? 0) * Math.PI) / 180,
      name: wire.name,
      owner: wire.owner,
      num: wire.num,
    });
    return put.ok ? put.member : null;
  }

  fleetChanged(message) {
    for (const wire of message.added ?? []) this.addVehicle(wire);
    for (const num of message.removed ?? []) this.session?.remove(`v${num}`);
    if (message.driving && message.driving.player === this.you) {
      this.driving = message.driving.id;
      this.session?.control(this.driving, this.keys ?? null);
    }
    this.h.onFleet?.(message);
  }

  edited(ops) {
    if (!this.session || !Array.isArray(ops)) return;
    for (const [x, y, z, material] of ops) this.session.world.blocks.set(x, y, z, material);
    this.h.onEdits?.(ops);
  }

  // --------------------------------------------------------------- what it asks

  /**
   * The keys, every tick. Sent whether or not anything is held, because "no
   * keys" is as much a fact as "W" and a host that never hears it keeps
   * driving on the last thing it did hear.
   */
  sendInput(input) {
    this.keys = input;
    if (!this.connected) return false;
    return this.send({ type: FROM_CLIENT.INPUT, ...inputWire(input) });
  }

  askToControl(id) {
    return this.send({ type: FROM_CLIENT.CONTROL, id: id ?? null });
  }

  askToDeploy({
    blueprint, at, yaw = 0, name = null,
  }) {
    return this.send({
      type: FROM_CLIENT.DEPLOY, blueprint: blueprint.toJSON(), at, yaw, name,
    });
  }

  askToRemove(id) {
    return this.send({ type: FROM_CLIENT.REMOVE, id });
  }

  /** Block edits as `[x, y, z, material]`, applied when they come back. */
  askToEdit(ops) {
    return this.send({ type: FROM_CLIENT.EDIT, ops });
  }

  // ---------------------------------------------------------------------- loop

  /**
   * The client simulates too. Between snapshots it is the only thing making
   * the world move, and it is what makes contact between two machines resolve
   * properly rather than one of them hanging in the air until the next
   * correction arrives.
   */
  advance(dt) {
    return this.session ? this.session.advance(dt) : 0;
  }

  dispose() {
    this.socket?.close();
    this.socket = null;
    this.session?.dispose();
    this.session = null;
    this.state = 'idle';
  }
}
