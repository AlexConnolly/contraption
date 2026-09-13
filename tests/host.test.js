import {
  describe, it, expect, beforeAll, afterEach,
} from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import RAPIER from '@dimforge/rapier3d-compat';

import { startHost } from '../server/host.js';
import { NetClient } from '../src/net/client.js';
import { WorldSession } from '../src/world/session.js';
import { blankWorld } from '../src/world/format.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * Two people in one world.
 *
 * Everything below this point has been proved with both ends in the same
 * process. This is the first thing that is not: a real host process, real
 * sockets, and two clients that know nothing about each other except what the
 * host tells them.
 *
 * What is being proved is the thing the whole design rests on — that one
 * machine is the authority and the others are told. So the assertions are
 * mostly about agreement: that a machine driven on one screen moves on the
 * other, that a block placed by one appears for both, and that a world nobody
 * is allowed to build in refuses rather than quietly diverging.
 */

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
});

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Waits for something to become true, rather than for a guessed delay. */
async function until(check, { within = 5000, every = 25 } = {}) {
  const stop = Date.now() + within;
  while (Date.now() < stop) {
    const answer = await check();
    if (answer) return answer;
    await wait(every);
  }
  throw new Error('Gave up waiting');
}

const open = [];
const folders = [];

/**
 * A little site on disk for the host to serve, made fresh each time. The real
 * one is `dist`, which does not exist until `npm run build` has run — and the
 * tests run first.
 */
async function siteFolder() {
  const root = await mkdtemp(join(tmpdir(), 'contraption-site-'));
  folders.push(root);
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Contraption</title>');
  await writeFile(join(root, 'assets', 'app.js'), '// the game would be here');
  return root;
}

function connect(port, name) {
  const client = new NetClient({
    url: `ws://127.0.0.1:${port}/`,
    name,
    WebSocketImpl: WebSocket,
    make: (world) => new WorldSession({ RAPIER, world, headless: true }),
  });
  open.push(client);
  return client;
}

async function host(options = {}) {
  const running = await startHost({ port: 0, serve: 'does-not-exist', ...options });
  open.push(running);
  return running;
}

afterEach(async () => {
  for (const thing of open.splice(0).reverse()) {
    if (thing.close) await thing.close();
    else thing.dispose();
  }
  for (const folder of folders.splice(0)) {
    await rm(folder, { recursive: true, force: true });
    await rm(join(folder, '..', 'secret.txt'), { force: true });
  }
});

describe('joining a hosted world', () => {
  it('hands the joiner the world and the machines standing in it', async () => {
    const world = blankWorld();
    world.name = 'Harbour';
    for (let x = 0; x < 12; x += 1) world.blocks.set(x, 0, 0, 4);
    const running = await host({ world });
    running.session.deploy({ blueprint: rover('Digger'), at: [3, 1.2, 6] });

    const client = connect(running.port, 'Ada');
    const session = await client.connect();

    expect(client.you).toBe('p1');
    expect(session.world.name).toBe('Harbour');
    expect(session.counts().blocks).toBe(12);
    expect(session.counts().vehicles).toBe(1);
    expect(session.fleet.list()[0].name).toBe('Digger');
    // Same number at both ends, or a snapshot names a machine nobody has.
    expect(session.fleet.list()[0].num).toBe(running.session.fleet.list()[0].num);
  }, 30000);

  it('tells everybody already there that somebody arrived', async () => {
    const running = await host();
    const first = connect(running.port, 'Ada');
    await first.connect();
    const second = connect(running.port, 'Grace');
    await second.connect();

    await until(() => first.players.size === 2);
    expect([...first.players.values()].map((p) => p.name).sort()).toEqual(['Ada', 'Grace']);
    expect(second.players.size).toBe(2);
    expect(second.owner).toBe('p1');
  }, 30000);

  it('keeps sending the world after nobody has done anything', async () => {
    const running = await host();
    running.session.deploy({ blueprint: rover(), at: [0, 4, 0] });
    const client = connect(running.port, 'Ada');
    await client.connect();
    await until(() => client.snapshots > 4);
    expect(client.quiet).toBe(false);
  }, 30000);
});

describe('one machine, two screens', () => {
  it('moves on the other screen when it is driven on this one', async () => {
    const running = await host();
    running.session.deploy({ blueprint: rover('Shared'), at: [0, 1.2, -10] });

    const driver = connect(running.port, 'Ada');
    const watcher = connect(running.port, 'Grace');
    const driving = await driver.connect();
    const watching = await watcher.connect();

    const id = driving.fleet.list()[0].id;
    const parked = watching.fleet.list()[0].machine.corePosition().clone();

    driver.askToControl(id);
    await until(() => driver.driving === id);

    // Two seconds of the accelerator, sent as the keys sixty times a second.
    const held = keys('KeyW');
    const stop = Date.now() + 2000;
    while (Date.now() < stop) {
      driver.sendInput(held);
      await wait(16);
    }
    driver.sendInput(keys());

    const moved = await until(() => {
      const now = watching.fleet.list()[0].machine.corePosition();
      return now.distanceTo(parked) > 2 ? now.clone() : false;
    });
    expect(moved.z).toBeGreaterThan(parked.z + 1.5);
    // And the host agrees with the watcher, which is the whole point of it.
    const truth = running.session.fleet.list()[0].machine.corePosition();
    expect(moved.distanceTo(truth)).toBeLessThan(2);
  }, 40000);

  it('refuses to hand the same machine to two people', async () => {
    const running = await host();
    running.session.deploy({ blueprint: rover(), at: [0, 1.2, 0] });
    const first = connect(running.port, 'Ada');
    const second = connect(running.port, 'Grace');
    await first.connect();
    await second.connect();

    let refused = null;
    second.h.onDenied = (why) => { refused = why; };

    first.askToControl('v1');
    await until(() => first.driving === 'v1');
    second.askToControl('v1');
    await until(() => refused !== null);
    expect(refused).toMatch(/already|somebody else/i);
    expect(second.driving).toBe(null);
  }, 30000);

  it('lets go of what somebody was driving when they disappear', async () => {
    const running = await host();
    running.session.deploy({ blueprint: rover(), at: [0, 1.2, 0] });
    const client = connect(running.port, 'Ada');
    await client.connect();
    client.askToControl('v1');
    await until(() => client.driving === 'v1');
    expect(running.session.controlled()?.id).toBe('v1');

    client.dispose();
    await until(() => running.host.players.size === 0);
    expect(running.session.controlled()).toBe(null);
  }, 30000);
});

describe('building together', () => {
  it('shows a block one person placed to everybody', async () => {
    const running = await host();
    const builder = connect(running.port, 'Ada');
    const watcher = connect(running.port, 'Grace');
    await builder.connect();
    await watcher.connect();

    builder.askToEdit([[2, 0, 3, 7], [2, 1, 3, 7]]);
    await until(() => watcher.session.counts().blocks === 2);
    expect(watcher.session.world.blocks.get(2, 1, 3)).toBe(7);
    expect(running.session.world.blocks.get(2, 0, 3)).toBe(7);
    expect(builder.session.counts().blocks).toBe(2);
  }, 30000);

  it('shows a machine one person put down to everybody', async () => {
    const running = await host();
    const builder = connect(running.port, 'Ada');
    const watcher = connect(running.port, 'Grace');
    await builder.connect();
    await watcher.connect();

    builder.askToDeploy({ blueprint: rover('Crane'), at: [5, 1.2, 5], name: 'Crane' });
    await until(() => watcher.session.counts().vehicles === 1);
    expect(watcher.session.fleet.list()[0].name).toBe('Crane');
    expect(running.session.counts().vehicles).toBe(1);

    const num = watcher.session.fleet.list()[0].num;
    builder.askToRemove(`v${num}`);
    await until(() => watcher.session.counts().vehicles === 0);
    expect(running.session.counts().vehicles).toBe(0);
  }, 30000);

  it('refuses a guest in a world only its owner may build in', async () => {
    const world = blankWorld();
    world.online = { authority: 'owner' };
    const running = await host({ world });
    const owner = connect(running.port, 'Ada');
    const guest = connect(running.port, 'Grace');
    await owner.connect();
    await guest.connect();

    let refused = null;
    guest.h.onDenied = (why) => { refused = why; };
    guest.askToEdit([[0, 0, 0, 3]]);
    await until(() => refused !== null);
    expect(refused).toMatch(/owner/i);
    expect(running.session.counts().blocks).toBe(0);

    // And the owner is still free to build.
    owner.askToEdit([[0, 0, 0, 3]]);
    await until(() => running.session.counts().blocks === 1);
    expect(guest.mayBuild).toBe(false);
    expect(owner.mayBuild).toBe(true);
  }, 30000);

  it('lets anyone build in a world that says so', async () => {
    const world = blankWorld();
    world.online = { authority: 'open' };
    const running = await host({ world });
    const owner = connect(running.port, 'Ada');
    const guest = connect(running.port, 'Grace');
    await owner.connect();
    await guest.connect();

    guest.askToEdit([[4, 0, 4, 3]]);
    await until(() => running.session.counts().blocks === 1);
    expect(guest.mayBuild).toBe(true);
  }, 30000);
});

describe('who may build here', () => {
  it("is the owner's to change, and everybody is told", async () => {
    const world = blankWorld();
    world.online = { authority: 'owner' };
    const running = await host({ world });
    const owner = connect(running.port, 'Ada');
    const guest = connect(running.port, 'Grace');
    await owner.connect();
    await guest.connect();
    expect(guest.mayBuild).toBe(false);

    owner.askToSetAuthority('open');
    await until(() => guest.mayBuild);
    expect(running.session.world.online.authority).toBe('open');
    expect(guest.session.world.online.authority).toBe('open');

    // And a guest who could not build a moment ago now can.
    guest.askToEdit([[1, 0, 1, 4]]);
    await until(() => running.session.counts().blocks === 1);
  }, 30000);

  it('closes again, which is the half that has to work', async () => {
    const world = blankWorld();
    world.online = { authority: 'open' };
    const running = await host({ world });
    const owner = connect(running.port, 'Ada');
    const guest = connect(running.port, 'Grace');
    await owner.connect();
    await guest.connect();
    expect(guest.mayBuild).toBe(true);

    owner.askToSetAuthority('owner');
    await until(() => !guest.mayBuild);

    let refused = null;
    guest.h.onDenied = (why) => { refused = why; };
    guest.askToEdit([[1, 0, 1, 4]]);
    await until(() => refused !== null);
    expect(running.session.counts().blocks).toBe(0);
  }, 30000);

  it("is not a guest's to change, even in a world they may build in", async () => {
    const world = blankWorld();
    world.online = { authority: 'open' };
    const running = await host({ world });
    const owner = connect(running.port, 'Ada');
    const guest = connect(running.port, 'Grace');
    await owner.connect();
    await guest.connect();

    let refused = null;
    guest.h.onDenied = (why) => { refused = why; };
    guest.askToSetAuthority('owner');
    await until(() => refused !== null);
    expect(refused).toMatch(/owner/i);
    expect(running.session.world.online.authority).toBe('open');
  }, 30000);
});

describe('who is driving what', () => {
  it("says so on everybody else's list, by name", async () => {
    const running = await host();
    running.session.deploy({ blueprint: rover(), at: [0, 1.2, 0] });
    const driver = connect(running.port, 'Ada');
    const watcher = connect(running.port, 'Grace');
    await driver.connect();
    await watcher.connect();

    driver.askToControl('v1');
    await until(() => watcher.driverOf('v1') === 'Ada');
    expect(driver.driverOf('v1')).toBe('you');
    expect(watcher.driverOf('v1')).toBe('Ada');
  }, 30000);

  it('forgets it when they let go', async () => {
    const running = await host();
    running.session.deploy({ blueprint: rover(), at: [0, 1.2, 0] });
    const driver = connect(running.port, 'Ada');
    const watcher = connect(running.port, 'Grace');
    await driver.connect();
    await watcher.connect();

    driver.askToControl('v1');
    await until(() => watcher.driverOf('v1') === 'Ada');
    driver.askToControl(null);
    await until(() => watcher.driverOf('v1') === null);
  }, 30000);

  it('forgets it when they disappear without letting go', async () => {
    const running = await host();
    running.session.deploy({ blueprint: rover(), at: [0, 1.2, 0] });
    const driver = connect(running.port, 'Ada');
    const watcher = connect(running.port, 'Grace');
    await driver.connect();
    await watcher.connect();

    driver.askToControl('v1');
    await until(() => watcher.driverOf('v1') === 'Ada');
    driver.dispose();
    await until(() => watcher.driverOf('v1') === null);

    // And the machine is free for somebody else to pick up.
    watcher.askToControl('v1');
    await until(() => watcher.driving === 'v1');
  }, 30000);
});

describe('the host also serves the game', () => {
  it('answers rather than falling over when there is no build to serve', async () => {
    const running = await host({ serve: 'no-such-folder' });
    const answer = await fetch(`http://127.0.0.1:${running.port}/`);
    expect(answer.status).toBe(404);
    expect(await answer.text()).toMatch(/npm run build/);
    // The point of the test: it is still up. Writing the head and then
    // failing to read threw inside the request handler and killed the host.
    const client = connect(running.port, 'Ada');
    await client.connect();
    expect(client.you).toBe('p1');
  }, 30000);

  it('hands out the page and its assets when there is one', async () => {
    // A folder made here rather than `dist`: the tests run before the build
    // does, so anything that reads the build output passes on this machine
    // and fails in CI, which is exactly what happened.
    const root = await siteFolder();
    const running = await host({ serve: root });

    const page = await fetch(`http://127.0.0.1:${running.port}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    expect(await page.text()).toMatch(/Contraption/);

    const asset = await fetch(`http://127.0.0.1:${running.port}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toMatch(/javascript/);
    expect(await asset.text()).toMatch(/the game/);
  }, 30000);

  it('answers anything that is not a file with the page, because it is one page', async () => {
    const root = await siteFolder();
    const running = await host({ serve: root });
    const deep = await fetch(`http://127.0.0.1:${running.port}/worlds/harbour`);
    expect(deep.status).toBe(200);
    expect(await deep.text()).toMatch(/Contraption/);
  }, 30000);

  it('refuses to hand out anything above the folder it was given', async () => {
    const root = await siteFolder();
    await writeFile(join(root, '..', 'secret.txt'), 'not for the wire');
    const running = await host({ serve: root });
    const answer = await fetch(`http://127.0.0.1:${running.port}/../secret.txt`);
    // Either refused outright or answered with the page; never the file.
    expect(await answer.text()).not.toMatch(/not for the wire/);
  }, 30000);
});

describe('a host that is not going to work', () => {
  it('says so when it speaks another version of the game', async () => {
    const running = await host();
    // A host one version along: everything else works, and the snapshots are
    // unreadable. Better to be told at the door than to join a world that
    // never moves.
    const real = running.host.send.bind(running.host);
    running.host.send = (player, message) => {
      if (message && message.type === 'welcome') real(player, { ...message, protocol: 99 });
      else real(player, message);
    };
    const client = connect(running.port, 'Ada');
    await expect(client.connect()).rejects.toThrow(/different version/);
  }, 30000);

  it('says so rather than hanging when there is nothing listening', async () => {
    const client = new NetClient({
      url: 'ws://127.0.0.1:1/',
      WebSocketImpl: WebSocket,
      make: () => null,
    });
    await expect(client.connect()).rejects.toThrow();
  }, 30000);

  it('hangs up on anything that is not a greeting', async () => {
    const running = await host();
    const raw = new WebSocket(`ws://127.0.0.1:${running.port}/`);
    await new Promise((resolve) => raw.on('open', resolve));
    raw.send('not json at all');
    await new Promise((resolve) => raw.on('close', resolve));
    expect(running.host.players.size).toBe(0);
  }, 30000);
});
