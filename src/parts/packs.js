import { toBase64Url, fromBase64Url, squeeze } from '../challenges/format.js';
import { CATEGORIES, PART_LOOKS } from './registry.js';

/**
 * Parts somebody else made.
 *
 * Every part the game ships is a lump of data plus one of eight behaviours,
 * and the behaviours are the only part of it written in code. So a pack that
 * picks from those eight and supplies its own numbers can build anything
 * already in the game — a heavier wheel, a longer ram, a servo that holds
 * twice the load — without a line of code running anywhere.
 *
 * That is the whole security position, and it is why this file is a list of
 * what is allowed rather than a list of what is forbidden. A pack is data
 * that arrived from a stranger: every field is copied across one at a time,
 * every number is pulled into a range the engine survives, and anything not
 * named here is dropped. Nothing from a pack is ever evaluated.
 */

export const PACK_FORMAT = 1;
const PREFIX = 'CTPK1';

export const PACK_LIMITS = {
  parts: 40,
  chars: 24000,
  name: 48,
  blurb: 160,
  ports: 8,
};

/**
 * The behaviours a pack may ask for. These are the `case` labels the machine
 * already handles; a pack chooses among them and cannot add to them, because
 * adding one means running its code inside the physics step.
 */
export const ACTUATOR_KINDS = [
  'motor', 'servo', 'position', 'spin', 'linear', 'thrust', 'grab', 'release',
];

const JOINTS = ['revolute', 'prismatic', 'fixed'];
const SHAPES = ['box', 'wedge'];
const PORT_KINDS = ['number', 'bool', 'vec3'];
const SIGNALS = ['axis', 'hold', 'toggle', 'drive', 'flight', 'sensor', 'always'];
const BINDING_MODES = SIGNALS;

const clamp = (value, lo, hi, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

const text = (value, max) => (typeof value === 'string'
  ? [...value].filter((ch) => {
    const code = ch.codePointAt(0);
    return code > 31 && code !== 127;
  }).join('').trim().slice(0, max)
  : '');

// An id has to survive being a key, a file name and a CSS class.
const slug = (value, fallback) => {
  const out = text(value, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || fallback;
};

function axis(value, fallback = [0, 1, 0]) {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const out = value.map((n) => Math.max(-1, Math.min(1, Math.round(Number(n) || 0))));
  return out.some(Boolean) ? out : fallback;
}

function faces(value) {
  if (!Array.isArray(value)) return null;
  const out = value.slice(0, 6).map((v) => axis(v, null)).filter(Boolean);
  return out.length ? out : null;
}

function range(value, lo, hi, fallback) {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  const a = clamp(value[0], lo, hi, fallback[0]);
  const b = clamp(value[1], lo, hi, fallback[1]);
  return a < b ? [a, b] : fallback;
}

function ports(raw) {
  const side = (list) => (Array.isArray(list) ? list : []).slice(0, PACK_LIMITS.ports)
    .map((port) => {
      const out = {
        id: slug(port?.id, 'value'),
        name: text(port?.name, 32) || 'Value',
        kind: PORT_KINDS.includes(port?.kind) ? port.kind : 'number',
      };
      // What the editor draws the slider between, and what it clamps a wire
      // to. Only meaningful on a number.
      if (out.kind === 'number' && port?.min !== undefined) out.min = clamp(port.min, -1000, 1000, -1);
      if (out.kind === 'number' && port?.max !== undefined) out.max = clamp(port.max, -1000, 1000, 1);
      return out;
    })
    .filter((port) => port.id);
  const out = {};
  const inputs = side(raw?.in);
  const outputs = side(raw?.out);
  if (inputs.length) out.in = inputs;
  if (outputs.length) out.out = outputs;
  return (out.in || out.out) ? out : null;
}

function binding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mode = BINDING_MODES.includes(raw.mode) ? raw.mode : 'hold';
  const key = (value) => (typeof value === 'string' && /^[A-Za-z0-9]{1,20}$/.test(value)
    ? value : null);
  const out = { mode };
  for (const slot of ['pos', 'neg', 'left', 'right']) {
    const code = key(raw[slot]);
    if (code) out[slot] = code;
  }
  return out;
}

function actuator(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!ACTUATOR_KINDS.includes(raw.kind)) return null;
  const out = { kind: raw.kind };
  if (raw.port) out.port = slug(raw.port, 'target');
  if (SIGNALS.includes(raw.signal)) out.signal = raw.signal;
  // Every one of these is a force or a speed the solver has to live with, so
  // each is pulled into what the shipped parts already use, give or take.
  const caps = {
    maxSpeed: [0.1, 40, 8],
    maxForce: [1, 4000, 60],
    stiffness: [0, 20000, 200],
    damping: [0, 2000, 40],
    range: [0.05, Math.PI, 1.55],
  };
  for (const [key, [lo, hi, fallback]] of Object.entries(caps)) {
    if (raw[key] !== undefined) out[key] = clamp(raw[key], lo, hi, fallback);
  }
  const bound = binding(raw.defaultBinding);
  if (bound) out.defaultBinding = bound;
  return out;
}

/**
 * One part, copied across field by field.
 *
 * `id` is prefixed with the pack's own name so two packs that both call
 * something "wheel" do not fight, and so a part from a pack can never shadow
 * one the game ships.
 */
export function sanitisePart(raw, { pack = 'pack' } = {}) {
  // Sanitising is done again every time a pack is read back out of storage,
  // so an id that already carries its prefix must come out the same rather
  // than gathering another one.
  const given = typeof raw?.id === 'string' && raw.id.startsWith(`${pack}:`)
    ? raw.id.slice(pack.length + 1)
    : raw?.id;
  const local = slug(given, 'part');
  const part = {
    id: `${pack}:${local}`,
    name: text(raw?.name, PACK_LIMITS.name) || 'Part',
    category: CATEGORIES.some((c) => c.id === raw?.category) ? raw.category : 'structure',
    blurb: text(raw?.blurb, PACK_LIMITS.blurb),
    // Cost and mass are what a level's budget is spent against, so they are
    // the two a pack has most reason to lie about.
    cost: Math.round(clamp(raw?.cost, 0, 200, 3)),
    mass: clamp(raw?.mass, 0.05, 60, 1),
    colour: Math.round(clamp(raw?.colour, 0, 0xffffff, 0x9aa7b4)),
    size: Array.isArray(raw?.size) && raw.size.length === 3
      ? raw.size.map((n) => Math.round(clamp(n, 1, 5, 1)))
      : [1, 1, 1],
    custom: true,
    pack,
  };

  if (SHAPES.includes(raw?.shape) && raw.shape !== 'box') part.shape = raw.shape;
  // Which of the shipped meshes to draw it with. Not a mesh of its own: a mesh
  // is code, and no code comes out of a pack.
  if (PART_LOOKS.includes(raw?.look)) part.look = raw.look;
  if (raw?.unique) part.unique = true;
  if (raw?.emits) part.emits = true;

  // A wheel is a rim on a revolute joint. Anything with a radius rolls, and
  // the no-wheels ban reads exactly that, so a pack cannot smuggle one past.
  if (raw?.radius !== undefined) {
    part.radius = clamp(raw.radius, 0.1, 1.2, 0.42);
    part.width = clamp(raw.width, 0.05, 1, 0.28);
  }
  if (raw?.friction !== undefined) part.friction = clamp(raw.friction, 0, 4, 1);

  if (raw?.articulated) {
    part.articulated = true;
    part.joint = JOINTS.includes(raw.joint) ? raw.joint : 'revolute';
    part.axis = axis(raw.axis);
    const attach = faces(raw.attach);
    const carry = faces(raw.carry);
    if (attach) part.attach = attach;
    if (carry) part.carry = carry;
    if (Array.isArray(raw.limits) && raw.limits.length === 2) {
      part.limits = range(raw.limits, -Math.PI, Math.PI, [-1.55, 1.55]);
    }
    if (raw.flippable) part.flippable = true;
  }

  const drive = actuator(raw?.actuator);
  if (drive) part.actuator = drive;

  // A thruster pushes, and the no-flight ban reads that too.
  if (raw?.thruster && typeof raw.thruster === 'object') {
    part.thruster = {
      axis: axis(raw.thruster.axis, [0, 1, 0]),
      maxThrust: clamp(raw.thruster.maxThrust, 1, 400, 40),
      spin: clamp(raw.thruster.spin, 0, 80, 0),
      reaction: clamp(raw.thruster.reaction, 0, 40, 0),
    };
  }

  if (raw?.sensor && typeof raw.sensor === 'object') {
    part.sensor = {
      range: clamp(raw.sensor.range, 0.5, 30, 9),
      axis: axis(raw.sensor.axis, [0, 0, 1]),
    };
    part.config = {
      threshold: clamp(raw?.config?.threshold, 0.05, 0.95, 0.5),
      invert: Boolean(raw?.config?.invert),
    };
  }

  if (raw?.grabber && typeof raw.grabber === 'object') {
    part.grabber = { reach: clamp(raw.grabber.reach, 0.2, 6, 1.4) };
  }

  if (raw?.spring) {
    part.spring = true;
    part.travel = clamp(raw.travel, 0.05, 2, 0.36);
    part.travelRange = range(raw.travelRange, 0.05, 2, [0.12, 0.9]);
    part.stiffness = clamp(raw.stiffness, 50, 20000, 1400);
    part.stiffnessRange = range(raw.stiffnessRange, 50, 20000, [200, 6000]);
    part.damping = clamp(raw.damping, 0, 2000, 90);
    part.dampingRange = range(raw.dampingRange, 0, 2000, [0, 500]);
  }

  // The settings a player can turn on the part once it is placed. Each one is
  // a value and the range the slider runs over.
  const tunables = [
    ['tension', 'tensionRange', 0, 20, 1, [0, 8]],
    ['stroke', 'strokeRange', 0.05, 6, 1.2, [0.4, 2.4]],
    ['spin', 'spinRange', 0.1, 40, 6, [0.5, 14]],
    ['torque', 'torqueRange', 1, 4000, 240, [12, 1800]],
    ['separation', 'separationRange', 0, 30, 2.6, [0, 8]],
    ['speed', 'speedRange', 5, 1440, 180, [20, 720]],
  ];
  for (const [key, rangeKey, lo, hi, value, span] of tunables) {
    if (raw?.[key] === undefined && raw?.[rangeKey] === undefined) continue;
    part[key] = clamp(raw[key], lo, hi, value);
    part[rangeKey] = range(raw[rangeKey], lo, hi, span);
  }
  if (raw?.positions) {
    part.positions = true;
    part.angleA = clamp(raw.angleA, -180, 180, -60);
    part.angleB = clamp(raw.angleB, -180, 180, 60);
    part.angleRange = range(raw.angleRange, -180, 180, [-180, 180]);
  }
  if (raw?.recentre) part.recentre = true;

  const sockets = ports(raw?.ports);
  if (sockets) part.ports = sockets;
  return part;
}

/** A whole pack: a name, and the parts in it. */
export function sanitisePack(raw) {
  const pack = slug(raw?.id ?? raw?.name, 'pack');
  return {
    version: PACK_FORMAT,
    id: pack,
    name: text(raw?.name, PACK_LIMITS.name) || 'Parts pack',
    author: text(raw?.author, PACK_LIMITS.name),
    parts: (Array.isArray(raw?.parts) ? raw.parts : [])
      .slice(0, PACK_LIMITS.parts)
      .map((part) => sanitisePart(part, { pack })),
  };
}

/**
 * What is wrong with a pack, in words its author can act on. Separate from the
 * sanitiser, which silently makes a pack safe; this says what it changed.
 */
export function packProblems(pack) {
  const problems = [];
  if (pack.parts.length === 0) problems.push('The pack has no parts in it');
  const seen = new Set();
  for (const part of pack.parts) {
    if (seen.has(part.id)) problems.push(`Two parts are both called ${part.name}`);
    seen.add(part.id);
    if (part.articulated && part.actuator && !part.attach) {
      problems.push(`${part.name} is driven but says nothing about which face it bolts to`);
    }
    if (part.actuator && !part.articulated && !part.thruster) {
      problems.push(`${part.name} has a motor but no joint for it to turn`);
    }
  }
  return problems;
}

/**
 * What the sanitiser changed, said out loud.
 *
 * A pack is never refused for asking too much — it is answered. Asking for a
 * thrust of ninety thousand gets four hundred, and asking for a behaviour that
 * does not exist gets nothing at all. Both are quiet, and quiet is the worst
 * way for an author to find out, so this is the list to put in front of them.
 */
export function packChanges(raw, clean) {
  const notes = [];
  const parts = (Array.isArray(raw?.parts) ? raw.parts : []).slice(0, PACK_LIMITS.parts);
  parts.forEach((source, i) => {
    const part = clean.parts[i];
    if (!part || !source || typeof source !== 'object') return;
    const say = (note) => notes.push(`${part.name}: ${note}`);

    if (source.actuator?.kind && !part.actuator) {
      say(`"${source.actuator.kind}" is not one of the behaviours, so it does nothing`);
    }
    if (source.look && !part.look) {
      say(`"${source.look}" is not a shape the game draws, so it is a plain block`);
    }
    if (source.category && source.category !== part.category) {
      say(`there is no "${source.category}" shelf, so it is under ${part.category}`);
    }

    const moved = (label, was, now) => {
      if (was === undefined || now === undefined) return;
      if (Number(was) === now) return;
      say(`${label} ${was} became ${now}`);
    };
    moved('cost', source.cost, part.cost);
    moved('mass', source.mass, part.mass);
    moved('thrust', source.thruster?.maxThrust, part.thruster?.maxThrust);
    moved('force', source.actuator?.maxForce, part.actuator?.maxForce);
    moved('speed', source.actuator?.maxSpeed, part.actuator?.maxSpeed);
  });
  if ((raw?.parts?.length ?? 0) > PACK_LIMITS.parts) {
    notes.push(`Only the first ${PACK_LIMITS.parts} parts were kept`);
  }
  return notes;
}

export async function toPackCode(pack) {
  const clean = sanitisePack(pack);
  const json = JSON.stringify({ v: PACK_FORMAT, pack: clean });
  const bytes = new TextEncoder().encode(json);
  const packed = await squeeze(bytes, 'deflate').catch(() => null);
  return packed && packed.length < bytes.length
    ? `${PREFIX}z${toBase64Url(packed)}`
    : `${PREFIX}j${toBase64Url(bytes)}`;
}

/** The other direction, which never throws on rubbish — it explains. */
export async function fromPackCode(code) {
  const trimmed = typeof code === 'string' ? code.trim().replace(/\s+/g, '') : '';
  if (!trimmed.startsWith(PREFIX)) {
    return { ok: false, reason: 'That does not look like a parts pack' };
  }
  if (trimmed.length > PACK_LIMITS.chars) {
    return { ok: false, reason: 'That pack is too big' };
  }
  const flag = trimmed[PREFIX.length];
  const body = trimmed.slice(PREFIX.length + 1);
  try {
    const bytes = fromBase64Url(body);
    const json = flag === 'z'
      ? new TextDecoder().decode(await squeeze(bytes, 'inflate'))
      : new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (Number(parsed?.v) > PACK_FORMAT) {
      return { ok: false, reason: 'That pack was made by a newer version of the game' };
    }
    return { ok: true, pack: sanitisePack(parsed?.pack ?? parsed) };
  } catch {
    return { ok: false, reason: 'That pack code is damaged' };
  }
}

/**
 * A pack that shows what one can do, and the thing a new pack starts from.
 *
 * Four parts, one for each of four different behaviours, all of them beyond
 * what the shipped parts will do: a wheel twice the size with the grip and the
 * weight to match, a ram that reaches across a room, a servo quick enough to
 * flick, and a rotor for something far too heavy to fly. None of it is code.
 */
export const EXAMPLE_PACK = {
  id: 'heavy-plant',
  name: 'Heavy Plant',
  author: 'The workshop',
  parts: [
    {
      id: 'tractor-wheel',
      name: 'Tractor Wheel',
      category: 'drive',
      look: 'wheel',
      blurb: 'Twice the wheel, twice the grip, and it weighs what you would expect.',
      cost: 7,
      mass: 3.4,
      colour: 0x3a3f26,
      articulated: true,
      joint: 'revolute',
      axis: [1, 0, 0],
      attach: [[-1, 0, 0]],
      radius: 0.9,
      width: 0.5,
      friction: 2.6,
      ports: {
        in: [{ id: 'throttle', name: 'Throttle', kind: 'number', min: -1, max: 1 }],
        out: [{ id: 'spin', name: 'Spin rate', kind: 'number' }],
      },
      actuator: {
        kind: 'motor',
        port: 'throttle',
        signal: 'axis',
        maxSpeed: 7,
        maxForce: 90,
        defaultBinding: { mode: 'drive', pos: 'KeyW', neg: 'KeyS', left: 'KeyA', right: 'KeyD' },
      },
    },
    {
      id: 'long-ram',
      name: 'Long Ram',
      category: 'manipulator',
      look: 'piston',
      blurb: 'Reaches three metres and pushes all the way.',
      cost: 9,
      mass: 3,
      colour: 0x2f6f8f,
      articulated: true,
      joint: 'prismatic',
      axis: [0, 1, 0],
      attach: [[0, -1, 0]],
      carry: [[0, 1, 0]],
      stroke: 3.2,
      strokeRange: [0.8, 6],
      tension: 2,
      tensionRange: [0, 8],
      ports: {
        in: [{ id: 'target', name: 'Target extension', kind: 'number', min: 0, max: 1 }],
        out: [{ id: 'extension', name: 'Extension', kind: 'number' }],
      },
      actuator: {
        kind: 'linear',
        port: 'target',
        signal: 'hold',
        stiffness: 1600,
        damping: 180,
        defaultBinding: { mode: 'hold', pos: 'KeyE' },
      },
    },
    {
      id: 'snap-servo',
      name: 'Snap Servo',
      category: 'manipulator',
      look: 'positioner',
      blurb: 'Goes between its two angles in a quarter of a second.',
      cost: 8,
      mass: 1.8,
      colour: 0xd06a2f,
      articulated: true,
      joint: 'revolute',
      axis: [1, 0, 0],
      attach: [[0, -1, 0]],
      carry: [[0, 1, 0]],
      positions: true,
      flippable: true,
      angleA: -90,
      angleB: 90,
      angleRange: [-180, 180],
      speed: 720,
      speedRange: [60, 1440],
      ports: {
        in: [{ id: 'pick', name: 'Angle B', kind: 'bool' }],
        out: [{ id: 'angle', name: 'Angle', kind: 'number' }],
      },
      actuator: {
        kind: 'position',
        port: 'pick',
        signal: 'toggle',
        maxForce: 260,
        defaultBinding: { mode: 'toggle', pos: 'KeyC' },
      },
    },
    {
      id: 'heavy-rotor',
      name: 'Heavy Rotor',
      category: 'flight',
      look: 'propeller',
      blurb: 'Lifts three times what the standard rotor will, and fights you for it.',
      cost: 14,
      mass: 2.4,
      colour: 0x8f9a3a,
      thruster: { axis: [0, 1, 0], maxThrust: 300, spin: 60, reaction: 26 },
      ports: {
        in: [{ id: 'throttle', name: 'Throttle', kind: 'number', min: 0, max: 1 }],
      },
      actuator: {
        kind: 'thrust',
        port: 'throttle',
        signal: 'hold',
        defaultBinding: { mode: 'hold', pos: 'Space' },
      },
    },
  ],
};

/** An empty pack with one part in it, for somebody starting from nothing. */
export function blankPack() {
  return {
    id: 'my-pack',
    name: 'My parts',
    author: '',
    parts: [{ ...EXAMPLE_PACK.parts[0], id: 'my-wheel', name: 'My Wheel' }],
  };
}
