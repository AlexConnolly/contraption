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

export const PROTOCOL = 1;

/** Sent by whoever joined. */
export const FROM_CLIENT = {
  HELLO: 'hello',
  INPUT: 'input',
  CONTROL: 'control',
  DEPLOY: 'deploy',
  REMOVE: 'remove',
  EDIT: 'edit',
};

/** Sent by whoever is in charge. */
export const FROM_HOST = {
  WELCOME: 'welcome',
  JOINED: 'joined',
  LEFT: 'left',
  FLEET: 'fleet',
  EDITS: 'edits',
  DENIED: 'denied',
};

const SNAPSHOT_TAG = 1;
// tag, protocol, tick, elapsed, vehicle count.
const HEADER = 1 + 1 + 4 + 4 + 2;
// number, body count.
const VEHICLE = 2 + 1;
// Three for where it is, four for which way up.
const BODY = 7 * 4;

/**
 * Every machine's every body, as the host currently has it.
 *
 * Bodies are identified by their machine's number and their place in that
 * machine's own list, not by a name of their own. A machine is cut into
 * bodies by `groupBlueprint`, which is a pure function of the blueprint, so
 * two people running the same design get the same bodies in the same order.
 * That is what makes an index enough.
 */
export function snapshotOf(session) {
  return {
    tick: session.tick,
    elapsed: session.elapsed,
    vehicles: session.fleet.list().map((member) => ({
      num: member.num,
      bodies: member.machine.bodies.map((body) => {
        const t = body.translation();
        const r = body.rotation();
        return { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] };
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
      for (let i = 0; i < 4; i += 1) view.setFloat32(at + 12 + i * 4, body.q[i], true);
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
        q: [
          view.getFloat32(at + 12, true), view.getFloat32(at + 16, true),
          view.getFloat32(at + 20, true), view.getFloat32(at + 24, true),
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

/**
 * Puts a snapshot onto a world.
 *
 * Stage three is honest about the lag rather than hiding it: what the host
 * says is where things are, full stop. Everything a client simulates between
 * snapshots is thrown away every fiftieth of a second, which looks exactly as
 * rough as it is — and that is the point, because the next stage is the one
 * that makes it feel instant, and it should be obvious what it bought.
 */
export function applySnapshot(session, snap) {
  let moved = 0;
  for (const vehicle of snap.vehicles) {
    const member = session.fleet.get(`v${vehicle.num}`);
    if (!member) continue;
    const bodies = member.machine.bodies;
    if (bodies.length !== vehicle.bodies.length) continue;
    for (let i = 0; i < bodies.length; i += 1) {
      const { p, q } = vehicle.bodies[i];
      bodies[i].setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
      bodies[i].setRotation({
        x: q[0], y: q[1], z: q[2], w: q[3],
      }, true);
      moved += 1;
    }
  }
  session.elapsed = snap.elapsed;
  session.tick = snap.tick;
  return moved;
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
