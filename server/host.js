import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import { WebSocketServer } from 'ws';
import RAPIER from '@dimforge/rapier3d-compat';

import { WorldSession } from '../src/world/session.js';
import { STEP } from '../src/sim/world.js';
import { Blueprint } from '../src/core/blueprint.js';
import {
  worldJSON, sanitiseWorld, blankWorld, fromWorldCode, WORLD_LIMITS,
} from '../src/world/format.js';
import {
  PROTOCOL, FROM_CLIENT, FROM_HOST, snapshotOf, encodeSnapshot, vehicleWire,
} from '../src/net/protocol.js';

/**
 * The host.
 *
 * A browser cannot listen on a port, so "hit a toggle and other people can
 * join" has to be a small Node process. This is it: it runs the world, it is
 * the authority on what is true in it, and it serves the built game so that
 * whoever joins is running the same build as the host rather than whatever
 * their tab happened to have open.
 *
 * The world it runs is the same `WorldSession` the browser runs, headless.
 * That is not a coincidence or an economy — it is the whole design. There is
 * one simulation in this codebase and both ends run it, so a machine cannot
 * behave one way for the person driving it and another way for everybody
 * watching because two separate implementations drifted apart.
 *
 * Rapier is not deterministic across machines, and the host and the browser do
 * not even run the same wasm build, so this cannot be lockstep. It is:
 * everybody simulates, the host is the truth, and the truth is sent twenty
 * times a second. Stage three sends it and applies it flat, with the lag
 * visible and honest; smoothing it over is the next stage's job and should be
 * measured against how this feels.
 */

const TICK_MS = STEP * 1000;
/** Snapshots go out every third tick: sixty is more than anyone can see. */
const SNAPSHOT_EVERY = 3;
/** Ticks one wake-up may run before the host admits it is behind. */
const MAX_CATCHUP = 8;

/**
 * How far a player is sent the world around them.
 *
 * A city is mostly somewhere else. Sending somebody the far side of it costs
 * bandwidth on machines they cannot see, and they have a copy of the world
 * running locally that will do a perfectly good job of them until they get
 * close enough for it to matter.
 */
const INTEREST = 180;

/**
 * A machine that is not moving is still re-stated this often, so a client
 * that drifted, missed a correction or has only just come within range is put
 * right within a second rather than never.
 */
const RESTATE = 60;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

/**
 * A keyboard somebody else is typing on.
 *
 * A machine reads its keys through the same two questions whether the hand on
 * them is in this process or across a network, so what arrives over the wire
 * is turned back into exactly that and nothing about the machine changes.
 */
function remoteKeyboard() {
  const down = new Set();
  const pressed = new Set();
  return {
    enabled: true,
    isDown: (code) => down.has(code),
    wasPressed: (code) => pressed.has(code),
    down,
    pressed,
    take(wire) {
      down.clear();
      for (const code of wire?.down ?? []) down.add(String(code).slice(0, 24));
      for (const code of wire?.pressed ?? []) pressed.add(String(code).slice(0, 24));
    },
    endFrame() {
      pressed.clear();
    },
  };
}

export class Host {
  constructor({ session, name = 'A world', now = performance.now() }) {
    this.session = session;
    this.name = name;
    this.players = new Map();
    this.nextPlayer = 1;
    this.owner = null;
    this.tick = 0;
    // Taken rather than read, so a test can run the clock by hand and get the
    // same answer every time.
    this.started = now;
    this.behind = 0;
  }

  get authority() {
    return this.session.world.online?.authority ?? 'owner';
  }

  /** Whether this player is allowed to change the world itself. */
  mayBuild(player) {
    return this.authority === 'open' || this.owner === null || this.owner === player.id;
  }

  join(socket, name) {
    const player = {
      id: `p${this.nextPlayer}`,
      name: String(name ?? '').slice(0, 24) || `Player ${this.nextPlayer}`,
      socket,
      keys: remoteKeyboard(),
      driving: null,
      // Where they are looking, and when each machine was last described to
      // them. Both are per player, because what is worth sending is.
      focus: null,
      told: new Map(),
    };
    this.nextPlayer += 1;
    this.players.set(player.id, player);
    // Whoever turned up first owns the place, which is the only answer that
    // works when the process itself has no hands.
    if (this.owner === null) this.owner = player.id;

    this.send(player, {
      type: FROM_HOST.WELCOME,
      protocol: PROTOCOL,
      you: player.id,
      owner: this.owner,
      authority: this.authority,
      tick: this.session.tick,
      // The saved vehicle list would be the world as it was written down; what
      // a joiner needs is the fleet as it stands.
      world: worldJSON({ ...this.session.world, vehicles: [] }),
      vehicles: this.session.fleet.list().map((m) => vehicleWire(m, this.session)),
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name })),
    });
    this.broadcast({ type: FROM_HOST.JOINED, player: { id: player.id, name: player.name } }, player);
    return player;
  }

  leave(player) {
    if (!this.players.has(player.id)) return;
    // Whatever they were driving coasts to a stop rather than carrying on
    // under the last keys they happened to be holding when the line dropped.
    if (player.driving) {
      const was = player.driving;
      player.driving = null;
      this.session.fleet.control(null);
      this.broadcast({ type: FROM_HOST.FLEET, driving: { player: player.id, id: null, was } });
    }
    this.players.delete(player.id);
    if (this.owner === player.id) this.owner = this.players.keys().next().value ?? null;
    this.broadcast({ type: FROM_HOST.LEFT, player: { id: player.id } });
  }

  // ------------------------------------------------------------------ traffic

  send(player, message) {
    if (player.socket.readyState !== 1) return;
    player.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  broadcast(message, except = null) {
    const text = JSON.stringify(message);
    for (const player of this.players.values()) {
      if (player === except) continue;
      this.send(player, text);
    }
  }

  deny(player, why) {
    this.send(player, { type: FROM_HOST.DENIED, reason: why });
  }

  /**
   * Everything that arrives from a player. Nothing in here trusts what it is
   * given: a message is a stranger's data exactly as a level or a world is.
   */
  handle(player, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    switch (message?.type) {
      case FROM_CLIENT.INPUT:
        player.keys.take(message);
        break;

      case FROM_CLIENT.PING:
        // Straight back, with their own clock reading untouched: the round
        // trip is theirs to measure and the two clocks are never compared.
        this.send(player, { type: FROM_HOST.PONG, at: message.at });
        break;

      case FROM_CLIENT.FOCUS: {
        const at = message.at;
        if (Array.isArray(at) && at.length === 3 && at.every(Number.isFinite)) {
          player.focus = at;
        }
        break;
      }

      case FROM_CLIENT.CONTROL: {
        const id = message.id ? String(message.id) : null;
        if (id && [...this.players.values()].some((p) => p !== player && p.driving === id)) {
          this.deny(player, 'Somebody else is driving that');
          return;
        }
        player.driving = id && this.session.fleet.get(id) ? id : null;
        this.session.fleet.control(player.driving, player.keys);
        this.broadcast({ type: FROM_HOST.FLEET, driving: { player: player.id, id: player.driving } });
        break;
      }

      case FROM_CLIENT.DEPLOY: {
        if (!this.mayBuild(player)) {
          this.deny(player, 'Only the owner can put machines down in this world');
          return;
        }
        let blueprint;
        try {
          blueprint = Blueprint.fromJSON(message.blueprint);
        } catch {
          this.deny(player, 'That machine did not arrive in one piece');
          return;
        }
        const at = Array.isArray(message.at) && message.at.length === 3 ? message.at : [0, 2, 0];
        const put = this.session.deploy({
          blueprint,
          at,
          yaw: Number(message.yaw) || 0,
          name: message.name,
          owner: player.id,
        });
        if (!put.ok) {
          this.deny(player, put.reason);
          return;
        }
        this.broadcast({
          type: FROM_HOST.FLEET,
          added: [vehicleWire(put.member, this.session)],
        });
        break;
      }

      case FROM_CLIENT.REMOVE: {
        if (!this.mayBuild(player)) {
          this.deny(player, 'Only the owner can take machines out of this world');
          return;
        }
        const member = this.session.fleet.get(String(message.id));
        if (!member) return;
        const num = member.num;
        this.session.remove(member.id);
        for (const other of this.players.values()) {
          if (other.driving === member.id) other.driving = null;
        }
        this.broadcast({ type: FROM_HOST.FLEET, removed: [num] });
        break;
      }

      case FROM_CLIENT.AUTHORITY: {
        // Not `mayBuild`: this is the one thing only the owner decides, or an
        // open world could never be closed again by the person who opened it.
        if (this.owner !== player.id) {
          this.deny(player, 'Only the owner decides who may build here');
          return;
        }
        const wanted = message.authority === 'open' ? 'open' : 'owner';
        this.session.world.online = { authority: wanted };
        this.broadcast({ type: FROM_HOST.WORLD, authority: wanted, owner: this.owner });
        break;
      }

      case FROM_CLIENT.EDIT: {
        if (!this.mayBuild(player)) {
          this.deny(player, 'Only the owner can build in this world');
          return;
        }
        const done = this.edit(message.ops);
        if (done.length) this.broadcast({ type: FROM_HOST.EDITS, ops: done });
        break;
      }

      default:
        break;
    }
  }

  /**
   * Block edits, applied here and then told to everybody — including whoever
   * asked. A client that has already drawn its own edit sees the same edit
   * come back and nothing changes; one whose edit the world refused sees it
   * not come back, which is how it finds out.
   */
  edit(ops) {
    if (!Array.isArray(ops)) return [];
    const done = [];
    for (const op of ops.slice(0, 4096)) {
      if (!Array.isArray(op) || op.length !== 4) continue;
      const [x, y, z, material] = op.map((n) => Math.round(Number(n)));
      if (![x, y, z, material].every(Number.isFinite)) continue;
      if (material < 0 || material > WORLD_LIMITS.materials) continue;
      if (this.session.world.blocks.set(x, y, z, material)) done.push([x, y, z, material]);
    }
    return done;
  }

  // --------------------------------------------------------------------- loop

  /**
   * What is worth telling this player about right now.
   *
   * Anything moving near them, plus anything at all that has not been
   * described to them for a second. The second half is what makes the first
   * half safe: a machine that stops, or that they have only just come within
   * range of, is put right within a second instead of never.
   */
  visibleTo(player) {
    const out = [];
    for (const member of this.session.fleet.list()) {
      const due = this.tick - (player.told.get(member.num) ?? -RESTATE) >= RESTATE;
      const awake = member.machine.bodies.some((body) => !body.isSleeping());
      if (!awake && !due) continue;
      if (player.focus && !due) {
        const at = member.machine.bodies[0].translation();
        const far = Math.hypot(
          at.x - player.focus[0], at.y - player.focus[1], at.z - player.focus[2],
        );
        if (far > INTEREST) continue;
      }
      player.told.set(member.num, this.tick);
      out.push(member);
    }
    return out;
  }

  step() {
    this.session.step();
    for (const player of this.players.values()) player.keys.endFrame();
    this.tick += 1;
    if (this.tick % SNAPSHOT_EVERY !== 0) return;
    for (const player of this.players.values()) {
      if (player.socket.readyState !== 1) continue;
      const only = this.visibleTo(player);
      // Nothing has moved and nothing is due: the cheapest snapshot is the one
      // that is not sent.
      if (only.length === 0) continue;
      player.socket.send(
        Buffer.from(encodeSnapshot(snapshotOf(this.session, { only }))),
        { binary: true },
      );
    }
  }

  /**
   * Wall-clock time turned into whole ticks, catching up a little but not
   * without limit: a host that tries to make up a lost second in one go stops
   * the world for everybody while it does.
   */
  pump(now) {
    const due = Math.floor((now - this.started) / TICK_MS) - this.tick;
    if (due <= 0) return 0;
    const run = Math.min(due, MAX_CATCHUP);
    if (due > run) {
      this.behind += (due - run) * STEP;
      this.started += (due - run) * TICK_MS;
    }
    for (let i = 0; i < run; i += 1) this.step();
    return run;
  }
}

/**
 * Wires one connection to the host.
 *
 * Kept separate from the socket server so that the lag harness can drive the
 * same code over a fake link. If joining were written twice, the version
 * being measured would not be the version being played.
 */
export function attach(host, socket, log = () => {}) {
  let player = null;
  socket.on('message', (data, binary) => {
    if (binary) return;
    const text = data.toString();
    if (!player) {
      let hello;
      try {
        hello = JSON.parse(text);
      } catch {
        socket.close();
        return;
      }
      if (hello?.type !== FROM_CLIENT.HELLO) {
        socket.close();
        return;
      }
      player = host.join(socket, hello.name);
      log(`${player.name} joined (${host.players.size} here)`);
      return;
    }
    host.handle(player, text);
  });
  socket.on('close', () => {
    if (!player) return;
    host.leave(player);
    log(`${player.name} left (${host.players.size} here)`);
  });
  socket.on('error', () => socket.close());
  return () => player;
}

// ------------------------------------------------------------ serving the game

function mimeOf(path) {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function staticHandler(root) {
  return async (request, response) => {
    const asked = decodeURIComponent((request.url ?? '/').split('?')[0]);
    // Anything that climbs out of the served folder is not a file it may have.
    const wanted = normalize(asked).replace(/^(\.\.[/\\])+/, '');
    const path = join(root, wanted.endsWith('/') ? `${wanted}index.html` : wanted);
    // Read before answering. Writing the head and then failing to read leaves
    // no way to say so: the second `writeHead` throws inside a request
    // handler, and an unhandled throw there takes the whole host down. It did,
    // the first time this was run with no build in place.
    let body = await readFile(path).catch(() => null);
    let type = mimeOf(path);
    if (!body) {
      // A single page, so anything that is not a file on disk is the page.
      body = await readFile(join(root, 'index.html')).catch(() => null);
      type = TYPES['.html'];
    }
    if (!body) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Nothing to serve here. Run `npm run build` first.');
      return;
    }
    response.writeHead(200, { 'content-type': type });
    response.end(body);
  };
}

/** Reads a world from a file: either a share code or the plain document. */
export async function worldFromFile(path) {
  const text = await readFile(path, 'utf8');
  const trimmed = text.trim();
  if (trimmed.startsWith('CTPW')) {
    const result = await fromWorldCode(trimmed);
    if (!result.ok) throw new Error(result.reason);
    return result.world;
  }
  return sanitiseWorld(JSON.parse(trimmed));
}

export async function startHost({
  port = 7777,
  world = null,
  serve = 'dist',
  save = null,
  log = () => {},
} = {}) {
  await RAPIER.init();
  const session = new WorldSession({
    RAPIER, world: world ?? blankWorld(), headless: true,
  });
  const host = new Host({ session, name: session.world.name });

  const server = createServer(staticHandler(serve));
  const sockets = new WebSocketServer({ server });

  sockets.on('connection', (socket) => attach(host, socket, log));

  await new Promise((resolve) => server.listen(port, resolve));

  const timer = setInterval(() => host.pump(performance.now()), TICK_MS);
  let keeper = null;
  if (save) {
    keeper = setInterval(async () => {
      await writeFile(save, JSON.stringify(worldJSON(session.snapshot()), null, 0));
    }, 30000);
  }

  return {
    host,
    session,
    port: server.address().port,
    async close() {
      clearInterval(timer);
      if (keeper) clearInterval(keeper);
      if (save) await writeFile(save, JSON.stringify(worldJSON(session.snapshot()), null, 0));
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      await new Promise((resolve) => server.close(resolve));
      session.dispose();
    },
  };
}

// ------------------------------------------------------------------ the script

function argOf(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

async function main() {
  const port = Number(argOf('port', 7777));
  const file = argOf('world');
  const world = file ? await worldFromFile(file) : blankWorld();
  const running = await startHost({
    port,
    world,
    serve: argOf('serve', fileURLToPath(new URL('../dist', import.meta.url))),
    save: argOf('save', file),
    log: (line) => process.stdout.write(`${line}\n`),
  });
  process.stdout.write(
    `Contraption host: ${running.session.world.name}\n`
    + `  play at  http://localhost:${running.port}/\n`
    + `  join at  ws://localhost:${running.port}/\n`
    + `  ${running.session.counts().blocks} blocks, `
    + `${running.session.counts().vehicles} machines, `
    + `${running.host.authority} to build in\n`,
  );
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      process.stdout.write('\nSaving and stopping.\n');
      await running.close();
      process.exit(0);
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Could not start: ${error.message}\n`);
    process.exit(1);
  });
}
