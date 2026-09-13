import {
  describe, it, expect, beforeAll,
} from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';

import {
  PROTOCOL, encodeSnapshot, decodeSnapshot, snapshotOf,
  isSnapshot, inputWire, keyboardFrom, vehicleWire, packQuat, unpackQuat,
} from '../src/net/protocol.js';
import { correct } from '../src/net/correction.js';
import { wsAddress, DEFAULT_PORT } from '../src/net/client.js';
import { WorldSession } from '../src/world/session.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * What goes down the wire.
 *
 * The snapshot is the one message sent twenty times a second to everybody, so
 * it is the one that is packed rather than written out as JSON. Packing is
 * exactly the kind of code that works on the case you wrote it for and reads
 * past the end of the buffer on the case you did not, so the interesting half
 * of this is the rubbish.
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

const open = () => new WorldSession({ RAPIER, headless: true });

const snap = (vehicles) => ({ tick: 900, elapsed: 15, vehicles });

describe('packing a snapshot', () => {
  it('comes back as what went in', () => {
    const sent = snap([{
      num: 3,
      bodies: [
        { p: [1.5, 2.25, -3.5], q: [0, 0, 0, 1], v: [2.5, 0, -1.25], w: [0, 4, 0] },
        { p: [-40, 0, 12], q: [1, 0, 0, 0], v: [0, 0, 0], w: [0, 0, 0] },
      ],
    }]);
    const back = decodeSnapshot(new Uint8Array(encodeSnapshot(sent)));
    expect(back.tick).toBe(900);
    expect(back.elapsed).toBeCloseTo(15, 5);
    expect(back.vehicles).toHaveLength(1);
    expect(back.vehicles[0].num).toBe(3);
    expect(back.vehicles[0].bodies[0].p).toEqual([1.5, 2.25, -3.5]);
    expect(back.vehicles[0].bodies[0].v).toEqual([2.5, 0, -1.25]);
    expect(back.vehicles[0].bodies[0].w).toEqual([0, 4, 0]);
    // A quaternion is packed as its three smallest parts, so it comes back
    // very close rather than exactly -- and q and -q are the same rotation.
    expect(Math.abs(back.vehicles[0].bodies[1].q[0])).toBeCloseTo(1, 4);
  });

  it('carries an empty world without complaining', () => {
    const back = decodeSnapshot(new Uint8Array(encodeSnapshot(snap([]))));
    expect(back.vehicles).toEqual([]);
  });

  it('is small enough to send at twenty a second', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      num: i + 1,
      bodies: Array.from({ length: 6 }, () => ({
        p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0],
      })),
    }));
    const bytes = encodeSnapshot(snap(many)).byteLength;
    // Forty machines of six bodies each is the worst case the sixth stage has
    // to hold up, and it only happens when all forty are moving at once. At
    // 7.6 KB a tick, twenty times a second, that is 152 KB/s to each player;
    // a city standing still costs almost nothing, because a machine that is
    // asleep is not sent.
    expect(bytes).toBeLessThan(8000);
    expect(bytes).toBe(12 + 40 * 3 + 40 * 6 * 31);
  });

  it('knows a snapshot from a message', () => {
    expect(isSnapshot(new Uint8Array(encodeSnapshot(snap([]))))).toBe(true);
    expect(isSnapshot('{"type":"hello"}')).toBe(false);
  });
});

describe('packing which way up a thing is', () => {
  const roundTrip = (q) => {
    const view = new DataView(new ArrayBuffer(7));
    packQuat(view, 0, q);
    return unpackQuat(view, 0);
  };

  /** The angle between two rotations, which is the only error that matters. */
  const apart = (a, b) => {
    const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    return 2 * Math.acos(Math.min(1, dot));
  };

  it('fits a rotation into seven bytes instead of sixteen', () => {
    const view = new DataView(new ArrayBuffer(7));
    expect(() => packQuat(view, 0, [0, 0, 0, 1])).not.toThrow();
  });

  it('comes back within a fiftieth of a degree, whichever way it points', () => {
    // Spread over the whole sphere rather than round one axis, because the
    // component that is dropped is whichever is largest and every one of the
    // four has to be droppable.
    const angles = [0, 0.4, 1.1, 2.2, 3.0, -0.7, -2.5];
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [1, -2, 0.5]];
    let worst = 0;
    for (const a of angles) {
      for (const axis of axes) {
        // Normalised first. What comes out of this is always a unit
        // quaternion, so feeding it one that is not makes the comparison
        // measure the difference in length rather than the packing.
        const n = Math.hypot(...axis);
        const half = a / 2;
        const s = Math.sin(half) / n;
        const q = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
        worst = Math.max(worst, apart(q, roundTrip(q)));
      }
    }
    // Measured: 0.00007 radians, which is four thousandths of a degree.
    expect(worst).toBeLessThan(0.0004);
  });

  it('treats a rotation and its negative as the same, because they are', () => {
    const q = [0.5, -0.5, 0.5, 0.5];
    const flipped = q.map((n) => -n);
    expect(apart(roundTrip(q), roundTrip(flipped))).toBeLessThan(1e-6);
  });

  it('always comes back as a unit quaternion', () => {
    for (const q of [[0, 0, 0, 1], [1, 0, 0, 0], [0.5, 0.5, 0.5, 0.5]]) {
      const back = roundTrip(q);
      expect(Math.hypot(...back)).toBeCloseTo(1, 4);
    }
  });
});

describe('a snapshot that arrived damaged', () => {
  const good = () => new Uint8Array(encodeSnapshot(snap([{
    num: 1, bodies: [{ p: [0, 1, 2], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0] }],
  }])));

  it('is refused when it is cut short', () => {
    expect(decodeSnapshot(good().slice(0, 20))).toBe(null);
    expect(decodeSnapshot(new Uint8Array(3))).toBe(null);
  });

  it('is refused when it claims more machines than it carries', () => {
    const bytes = good();
    new DataView(bytes.buffer).setUint16(10, 900, true);
    expect(decodeSnapshot(bytes)).toBe(null);
  });

  it('is refused when it is not a snapshot at all', () => {
    const bytes = good();
    bytes[0] = 99;
    expect(decodeSnapshot(bytes)).toBe(null);
  });

  it('is refused when it speaks another version of the protocol', () => {
    const bytes = good();
    bytes[1] = PROTOCOL + 1;
    expect(decodeSnapshot(bytes)).toBe(null);
  });
});

describe('a snapshot put onto a world', () => {
  it('moves the machine it names to where the host has it', () => {
    const host = open();
    const client = open();
    const at = [6, 1.2, -4];
    host.deploy({ blueprint: rover(), at });
    client.deploy({ blueprint: rover(), at });
    for (let i = 0; i < 120; i += 1) host.step();

    const before = client.fleet.list()[0].machine.corePosition().clone();
    const { moved } = correct(client, decodeSnapshot(
      new Uint8Array(encodeSnapshot(snapshotOf(host))),
    ), { blend: 1, adopt: 1, still: 0 });
    const after = client.fleet.list()[0].machine.corePosition();

    expect(moved).toBe(host.fleet.list()[0].machine.bodies.length);
    expect(after.distanceTo(host.fleet.list()[0].machine.corePosition())).toBeLessThan(0.01);
    expect(client.tick).toBe(host.tick);
    expect(before.y).not.toBeCloseTo(after.y, 3);
    host.dispose();
    client.dispose();
  }, 60000);

  it('leaves alone a machine it has never heard of', () => {
    const host = open();
    const client = open();
    host.deploy({ blueprint: rover(), at: [0, 1.2, 0] });
    client.deploy({ blueprint: rover(), at: [0, 1.2, 0] });
    client.deploy({ blueprint: rover('Local'), at: [20, 1.2, 0] });
    const spare = client.fleet.list()[1].machine.corePosition().clone();
    correct(client, snapshotOf(host), { blend: 1 });
    expect(client.fleet.list()[1].machine.corePosition().distanceTo(spare)).toBe(0);
    host.dispose();
    client.dispose();
  }, 60000);

  it('skips a machine whose shape does not match, rather than scrambling it', () => {
    const host = open();
    const client = open();
    host.deploy({ blueprint: rover(), at: [0, 1.2, 0] });
    const other = new Blueprint({ name: 'Different' });
    other.place('core', [0, 0, 0]);
    client.deploy({ blueprint: other, at: [0, 1.2, 0] });
    expect(correct(client, snapshotOf(host), { blend: 1 }).moved).toBe(0);
    host.dispose();
    client.dispose();
  }, 60000);
});

describe('a machine described for somebody else to build', () => {
  it('carries where it is, which way it faces and what it is made of', () => {
    const session = open();
    const { member } = session.deploy({
      blueprint: rover('Digger'), at: [4, 1.2, -8], yaw: Math.PI / 2,
    });
    const wire = vehicleWire(member, session);
    expect(wire.num).toBe(member.num);
    expect(wire.name).toBe('Digger');
    expect(wire.at[0]).toBeCloseTo(4, 2);
    expect(wire.yaw).toBeCloseTo(90, 1);
    expect(Blueprint.fromJSON(wire.blueprint).size).toBe(member.machine.blueprint.size);
    session.dispose();
  }, 30000);
});

describe('a keyboard that has to travel', () => {
  const fake = (...codes) => ({
    enabled: true, down: new Set(codes), pressed: new Set(codes.slice(0, 1)),
  });

  it('sends every key held, not a list of the ones we thought of', () => {
    const wire = inputWire(fake('KeyW', 'ShiftLeft', 'F13'));
    expect(wire.down.sort()).toEqual(['F13', 'KeyW', 'ShiftLeft']);
  });

  it('sends nothing at all when the keyboard is switched off', () => {
    const off = { ...fake('KeyW'), enabled: false };
    expect(inputWire(off)).toEqual({ down: [], pressed: [] });
  });

  it('rebuilds into something a machine can read', () => {
    const keys = keyboardFrom(inputWire(fake('KeyW', 'KeyA')));
    expect(keys.isDown('KeyW')).toBe(true);
    expect(keys.isDown('KeyS')).toBe(false);
    expect(keys.wasPressed('KeyW')).toBe(true);
    expect(keys.wasPressed('KeyA')).toBe(false);
  });

  it('reads as an empty keyboard when nothing arrived', () => {
    const keys = keyboardFrom(undefined);
    expect(keys.isDown('KeyW')).toBe(false);
    expect(keys.wasPressed('KeyW')).toBe(false);
  });
});

describe('the sim both ends run', () => {
  it('cuts the same machine into the same bodies, which is what a number means', () => {
    const a = open();
    const b = open();
    const design = rover();
    const one = a.deploy({ blueprint: design, at: [0, 1.2, 0] }).member;
    const two = b.deploy({ blueprint: Blueprint.fromJSON(design.toJSON()), at: [0, 1.2, 0] }).member;
    expect(two.machine.bodies.length).toBe(one.machine.bodies.length);
    // Not only the count: the same part has to land in the same body, or an
    // index means two different things at the two ends.
    for (const placed of design.list()) {
      expect(two.machine.grouping.bodyOfPart.get(placed.id))
        .toBe(one.machine.grouping.bodyOfPart.get(placed.id));
    }
    a.dispose();
    b.dispose();
  }, 30000);
});

describe('the address somebody typed', () => {
  it('fills in the port the host listens on when there is none', () => {
    expect(wsAddress('192.168.1.40')).toBe(`ws://192.168.1.40:${DEFAULT_PORT}/`);
  });

  it('leaves a port alone when one was given', () => {
    expect(wsAddress('desktop.local:9000')).toBe('ws://desktop.local:9000/');
  });

  it('takes a pasted address bar, which is what anybody has to hand', () => {
    expect(wsAddress('http://192.168.1.40:7777/')).toBe('ws://192.168.1.40:7777/');
    expect(wsAddress('https://box:8443/')).toBe('wss://box:8443/');
  });

  it('leaves an address that was already one alone', () => {
    expect(wsAddress('ws://box:7777')).toBe('ws://box:7777/');
  });

  it('ignores the spaces round something pasted out of a chat', () => {
    expect(wsAddress('  localhost:7777  ')).toBe('ws://localhost:7777/');
  });

  it('says no to something that is not an address at all', () => {
    for (const rubbish of ['', '   ', 'who knows', 'ws://', '<script>']) {
      expect(wsAddress(rubbish), JSON.stringify(rubbish)).toBe(null);
    }
  });
});
