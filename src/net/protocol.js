/**
 * What goes down the wire.
 *
 * Two kinds of traffic, and they want opposite things.
 *
 * **Control** — joining, deploying a machine, taking the controls, editing a
 * block — is rare, varied, and changes shape every time a feature lands. It
 * goes as JSON, because a byte saved on a message sent once is a byte nobody
 * ever needed and a format nobody can read when it goes wrong.
 *
 * **The snapshot** is the opposite: one message, one fixed shape, sent twenty
 * times a second to everybody at once. A world of forty machines is several
 * hundred bodies, and as JSON that is tens of kilobytes a tick of quoted field
 * names. So it is a packed buffer, and it is the only thing here that is.
 *
 * Positions are full floats for now. Quantising them to a centimetre and
 * sending only what changed is the next thing to do and does not change the
 * shape of any of this.
 */

export const PROTOCOL = 2;

/** Sent by whoever joined. */
export const FROM_CLIENT = {
  HELLO: 'hello',
  INPUT: 'input',
  CONTROL: 'control',
  DEPLOY: 'deploy',
  REMOVE: 'remove',
  EDIT: 'edit',
  // Who may build here. Only the owner is allowed to change it.
  AUTHORITY: 'authority',
  // How long the round trip is, and where this player is looking. The first
  // decides how far forward a snapshot is carried; the second decides what is
  // worth sending them at all.
  PING: 'ping',
  FOCUS: 'focus',
};

/** Sent by whoever is in charge. */
export const FROM_HOST = {
  WELCOME: 'welcome',
  JOINED: 'joined',
  LEFT: 'left',
  FLEET: 'fleet',
  EDITS: 'edits',
  DENIED: 'denied',
  PONG: 'pong',
  /** The world's own settings changed — at the moment, only who may build. */
  WORLD: 'world',
};

/** Snapshots go out this often. Everything that leads a body forward uses it. */
export const SNAPSHOT_PERIOD = 3 / 60;

const SNAPSHOT_TAG = 1;
// tag, protocol, tick, elapsed, vehicle count.
const HEADER = 1 + 1 + 4 + 4 + 2;
// number, body count.
const VEHICLE = 2 + 1;
// Where it is, which way up it is, and how it is moving. See below for why
// the first is the only one still sent as plain floats.
const BODY = 12 + 7 + 6 + 6;

/**
 * How a quaternion is packed, and why it is the smallest thing here.
 *
 * A unit quaternion has three degrees of freedom, not four: whichever
 * component is largest can always be worked out from the other three, and its
 * sign does not matter because q and -q are the same rotation. So only the
 * three smallest are sent, each of which is at most 1/sqrt(2), plus two bits
 * saying which one was left out.
 *
 * Sixteen bits over that range is about two hundredths of a degree, which is
 * far below what anybody can see, and it turns sixteen bytes into seven.
 */
const SMALLEST = 0.7071067811865476;
const QUAT_SCALE = 32767 / SMALLEST;

/** Velocity to a sixty-fourth of a metre a second, over plus or minus 512. */
const VEL_SCALE = 64;

const clampInt16 = (n) => Math.max(-32768, Math.min(32767, Math.round(n)));

export function packQuat(view, at, q) {
  let largest = 0;
  for (let i = 1; i < 4; i += 1) if (Math.abs(q[i]) > Math.abs(q[largest])) largest = i;
  // Sent as though the largest component were positive, which is free: the
  // rotation is the same either way.
  const flip = q[largest] < 0 ? -1 : 1;
  view.setUint8(at, largest);
  let put = at + 1;
  for (let i = 0; i < 4; i += 1) {
    if (i === largest) continue;
    view.setInt16(put, clampInt16(q[i] * flip * QUAT_SCALE), true);
    put += 2;
  }
}

export function unpackQuat(view, at) {
  const largest = view.getUint8(at) & 3;
  const out = [0, 0, 0, 0];
  let got = at + 1;
  let sum = 0;
  for (let i = 0; i < 4; i += 1) {
    if (i === largest) continue;
    const value = view.getInt16(got, true) / QUAT_SCALE;
    out[i] = value;
    sum += value * value;
    got += 2;
  }
  out[largest] = Math.sqrt(Math.max(0, 1 - sum));
  return out;
}

/**
 * Every machine's every body, as the host currently has it.
 *
 * Bodies are identified by their machine's number and their place in that
 * machine's own list, not by a name of their own. A machine is cut into
 * bodies by `groupBlueprint`, which is a pure function of the blueprint, so
 * two people running the same design get the same bodies in the same order.
 * That is what makes an index enough.
 *
 * Velocity goes with the pose, and it is what buys most of the smoothness.
 * Without it a client watching somebody else drive has no idea the machine is
 * moving, so it stands still and is dragged forward twenty times a second. Fed
 * the velocity, it carries on under its own physics between snapshots and the
 * correction has almost nothing left to do.
 */
export function snapshotOf(session, { only = null } = {}) {
  const members = only ?? session.fleet.list();
  return {
    tick: session.tick,
    elapsed: session.elapsed,
    vehicles: members.map((member) => ({
      num: member.num,
      bodies: member.machine.bodies.map((body) => {
        const t = body.translation();
        const r = body.rotation();
        const v = body.linvel();
        const w = body.angvel();
        return {
          p: [t.x, t.y, t.z],
          q: [r.x, r.y, r.z, r.w],
          v: [v.x, v.y, v.z],
          w: [w.x, w.y, w.z],
        };
      }),
    })),
  };
}

export function encodeSnapshot(snap) {
  let bytes = HEADER;
  for (const vehicle of snap.vehicles) bytes += VEHICLE + vehicle.bodies.length * BODY;
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);

  view.setUint8(0, SNAPSHOT_TAG);
  view.setUint8(1, PROTOCOL);
  view.setUint32(2, snap.tick, true);
  view.setFloat32(6, snap.elapsed, true);
  view.setUint16(10, snap.vehicles.length, true);

  let at = HEADER;
  for (const vehicle of snap.vehicles) {
    view.setUint16(at, vehicle.num, true);
    view.setUint8(at + 2, vehicle.bodies.length);
    at += VEHICLE;
    for (const body of vehicle.bodies) {
      for (let i = 0; i < 3; i += 1) view.setFloat32(at + i * 4, body.p[i], true);
      packQuat(view, at + 12, body.q);
      for (let i = 0; i < 3; i += 1) {
        view.setInt16(at + 19 + i * 2, clampInt16((body.v?.[i] ?? 0) * VEL_SCALE), true);
        view.setInt16(at + 25 + i * 2, clampInt16((body.w?.[i] ?? 0) * VEL_SCALE), true);
      }
      at += BODY;
    }
  }
  return buffer;
}

/** The other direction, which refuses rubbish rather than reading past the end. */
export function decodeSnapshot(buffer) {
  const view = new DataView(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.byteLength);
  if (view.byteLength < HEADER) return null;
  if (view.getUint8(0) !== SNAPSHOT_TAG) return null;
  if (view.getUint8(1) !== PROTOCOL) return null;

  const snap = {
    tick: view.getUint32(2, true),
    elapsed: view.getFloat32(6, true),
    vehicles: [],
  };
  const count = view.getUint16(10, true);
  let at = HEADER;
  for (let v = 0; v < count; v += 1) {
    if (at + VEHICLE > view.byteLength) return null;
    const num = view.getUint16(at, true);
    const bodies = view.getUint8(at + 2);
    at += VEHICLE;
    if (at + bodies * BODY > view.byteLength) return null;
    const out = [];
    for (let b = 0; b < bodies; b += 1) {
      out.push({
        p: [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)],
        q: unpackQuat(view, at + 12),
        v: [
          view.getInt16(at + 19, true) / VEL_SCALE,
          view.getInt16(at + 21, true) / VEL_SCALE,
          view.getInt16(at + 23, true) / VEL_SCALE,
        ],
        w: [
          view.getInt16(at + 25, true) / VEL_SCALE,
          view.getInt16(at + 27, true) / VEL_SCALE,
          view.getInt16(at + 29, true) / VEL_SCALE,
        ],
      });
      at += BODY;
    }
    snap.vehicles.push({ num, bodies: out });
  }
  return snap;
}

export function isSnapshot(data) {
  const bytes = data?.buffer ?? data;
  if (!bytes || typeof bytes === 'string') return false;
  return new Uint8Array(bytes, data.byteOffset ?? 0, 1)[0] === SNAPSHOT_TAG;
}

/** A machine on the wire: enough to build the same one at the other end. */
export function vehicleWire(member, session) {
  return {
    num: member.num,
    name: member.name,
    owner: member.owner,
    ...session.poseOf(member),
    blueprint: member.machine.blueprint.toJSON(),
  };
}

/**
 * What a keyboard looks like when it has to travel.
 *
 * Every key held, not a fixed list of the ones the game happens to use: a
 * parts pack can bind anything, and a key that works offline and does nothing
 * online would be a very hard bug to find.
 */
export function inputWire(input) {
  if (!input || input.enabled === false) return { down: [], pressed: [] };
  return { down: [...input.down], pressed: [...input.pressed] };
}

/** The other end of `inputWire`: a keyboard a machine can read. */
export function keyboardFrom(snapshot) {
  const down = new Set(snapshot?.down ?? []);
  const pressed = new Set(snapshot?.pressed ?? []);
  return {
    isDown: (code) => down.has(code),
    wasPressed: (code) => pressed.has(code),
    down,
    pressed,
  };
}
