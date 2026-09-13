/**
 * The portable form of a level.
 *
 * This is the one file in the project that has to be got right the first time.
 * The moment somebody shares a level with somebody else, the format is public:
 * changing its meaning breaks levels that are already out there, and there is
 * no going back and editing them. So it is versioned, it is validated on the
 * way in, and it is deliberately small — a level is data, never behaviour.
 *
 * A shared level is untrusted input. Everything that comes in is checked
 * against the shape below, every number is clamped to something the engine can
 * survive, every list is capped, and anything not named here is dropped rather
 * than passed through. A level someone mailed you cannot carry a field we did
 * not ask for, cannot reference a part that does not exist, and cannot be a
 * hundred megabytes of geometry.
 */

export const LEVEL_FORMAT = 1;

/** Caps, so a shared level can never be a denial of service. */
export const LIMITS = {
  name: 60,
  brief: 300,
  hint: 300,
  pieces: 250,
  props: 60,
  zones: 12,
  keepout: 12,
  plates: 12,
  launchers: 8,
  objectives: 8,
  chars: 64 * 1024,
  bytes: 512 * 1024,
};

const BANS = ['flight', 'wheels', 'grabber', 'coupling'];
const OBJECTIVE_TYPES = [
  'propInZone', 'coreInZone', 'propsInZone', 'propThroughHoop', 'platePressed',
  'propsStacked', 'survived',
];

// The world is a box. Nothing a level describes may sit outside it, however
// enthusiastic the person who built it was.
const REACH = 200;
const HIGH = 120;

// A direction, guaranteed to point somewhere. Not normalised — the launcher
// scales it by its own speed — but never all zeroes.
function unitish(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  const out = value.map((n) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
  });
  return out.some((n) => n !== 0) ? out : [...fallback];
}

function clamp(value, low, high, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(high, Math.max(low, n));
}

function text(value, max) {
  if (typeof value !== 'string') return '';
  // Control characters out: a level name is one line of plain text.
  return [...value].filter((ch) => { const code = ch.codePointAt(0); return code > 31 && code !== 127; }).join('').trim().slice(0, max);
}

function slug(value) {
  const s = typeof value === 'string' ? value : '';
  return s.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
}

function vec(value, fallback = [0, 0, 0]) {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  return [
    clamp(value[0], -REACH, REACH),
    clamp(value[1], -HIGH, HIGH),
    clamp(value[2], -REACH, REACH),
  ];
}

function size(value, fallback = [1, 1, 1]) {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  return [
    clamp(value[0], 0.1, REACH, fallback[0]),
    clamp(value[1], 0.1, HIGH, fallback[1]),
    clamp(value[2], 0.1, REACH, fallback[2]),
  ];
}

function colour(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 0xffffff) return fallback;
  return n;
}

function list(value, max) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

/**
 * Cleans a level into exactly the shape the engine accepts, dropping anything
 * unrecognised. Always returns something playable, which is the point: a
 * mangled share code should give you an odd level, not a broken game.
 */
export function sanitiseLevel(input, { id } = {}) {
  const raw = input && typeof input === 'object' ? input : {};

  const props = list(raw.props, LIMITS.props).map((p, i) => {
    const out = {
      id: slug(p?.id) || `prop-${i}`,
      pos: vec(p?.pos, [0, 1, 0]),
      mass: clamp(p?.mass, 0.1, 5000, 5),
      colour: colour(p?.colour, 0xc98b4b),
    };
    if (Number.isFinite(Number(p?.radius))) out.radius = clamp(p.radius, 0.1, 20, 0.5);
    else out.size = size(p?.size, [1, 1, 1]);
    if (p?.ccd) out.ccd = true;
    // Loads that take hold of each other where they meet, so a tower is a
    // question about reach rather than about placement accuracy.
    if (p?.magnetic) out.magnetic = true;
    if (Number.isFinite(Number(p?.friction))) out.friction = clamp(p.friction, 0, 4, 0.85);
    if (Number.isInteger(Number(p?.tag))) out.tag = clamp(p.tag, 0, 9, 0);
    return out;
  });

  // A plate is a slab of floor that wants something standing on it. Tag 0 --
  // or no tag at all -- is the neutral one, which takes anything.
  const plates = list(raw.plates, LIMITS.plates).map((p, i) => ({
    id: slug(p?.id) || `plate-${i}`,
    pos: vec(p?.pos, [0, 0.15, 0]),
    size: size(p?.size, [2, 0.3, 2]),
    tag: Number.isInteger(Number(p?.tag)) ? clamp(p.tag, 0, 9, 0) : 0,
  }));

  /**
   * Cannons. A launcher owns its own barrel and its own schedule: where it
   * sits, which way it points, how hard it throws, which loads it has in it
   * and when each one goes.
   */
  const propIds = new Set(props.map((p) => p.id));
  const launchers = list(raw.launchers, LIMITS.launchers).map((l, i) => ({
    id: slug(l?.id) || `launcher-${i}`,
    pos: vec(l?.pos, [0, 1.5, 10]),
    // A launcher pointed nowhere would drop its load on its own foot.
    aim: unitish(l?.aim, [0, 0.5, -1]),
    speed: clamp(l?.speed, 1, 60, 12),
    // Ammunition it has not got would leave the level unwinnable and nothing
    // on screen to say why.
    balls: list(l?.balls, LIMITS.props).map((b) => slug(b)).filter((b) => propIds.has(b)),
    first: clamp(l?.first, 0, 600, 3),
    gap: clamp(l?.gap, 0.2, 120, 3),
    colour: colour(l?.colour, 0x555f6b),
  }));

  const zones = list(raw.zones, LIMITS.zones).map((z, i) => ({
    id: slug(z?.id) || `zone-${i}`,
    pos: vec(z?.pos, [0, 1, 0]),
    size: size(z?.size, [3, 2, 3]),
    colour: colour(z?.colour, 0x4ade80),
  }));

  const known = new Set([...props.map((p) => p.id), ...zones.map((z) => z.id)]);
  const plateIds = new Set(plates.map((p) => p.id));

  // Nothing puts anything in these yet. They are named rather than assumed so
  // that when stacks and hoops do travel, the objective check already covers
  // them instead of being remembered about.
  const stacks = new Set();
  const hoops = new Set();

  // An objective that points at nothing is worse than no objective: the level
  // simply cannot be completed and there is no way for the player to tell.
  const objectives = list(raw.objectives, LIMITS.objectives)
    .filter((o) => OBJECTIVE_TYPES.includes(o?.type))
    .filter((o) => (o.prop ? known.has(slug(o.prop)) : true))
    .filter((o) => (o.zone ? known.has(slug(o.zone)) : true))
    .filter((o) => (o.type === 'platePressed' ? plateIds.has(slug(o.plate)) : true))
    // Same rule for the two that name a stack or a hoop. The format carries
    // neither yet, so an objective asking for one can never be scored — it
    // would sanitise cleanly and produce a level nobody can finish, which is
    // the exact failure the existence check exists to prevent.
    .filter((o) => !o.stack || stacks.has(slug(o.stack)))
    .filter((o) => !o.hoop || hoops.has(slug(o.hoop)))
    .map((o) => {
      const out = {
        type: o.type,
        label: text(o.label, 80) || 'Finish the job',
        hold: clamp(o.hold, 0, 30, 0),
      };
      if (o.prop) out.prop = slug(o.prop);
      if (o.zone) out.zone = slug(o.zone);
      if (o.stack) out.stack = slug(o.stack);
      if (o.hoop) out.hoop = slug(o.hoop);
      if (o.plate) out.plate = slug(o.plate);
      if (o.count !== undefined) out.count = Math.round(clamp(o.count, 1, 40, 3));
      if (o.rise !== undefined) out.rise = clamp(o.rise, 0.2, 5, 1);
      if (o.seconds !== undefined) out.seconds = clamp(o.seconds, 1, 900, 30);
      return out;
    });

  const level = {
    id: id ?? (slug(raw.id) || 'custom'),
    name: text(raw.name, LIMITS.name) || 'Untitled problem',
    brief: text(raw.brief, LIMITS.brief) || 'No brief.',
    custom: true,
    spawn: vec(raw.spawn, [0, 1, -8]),
    groundSize: clamp(raw.groundSize, 20, 400, 120),
    groundY: clamp(raw.groundY, -HIGH, HIGH, 0),
    pieces: list(raw.pieces, LIMITS.pieces).map((piece) => {
      const out = {
        pos: vec(piece?.pos, [0, 0, 0]),
        size: size(piece?.size, [2, 1, 2]),
        colour: colour(piece?.colour, 0x6b7480),
      };
      if (Number.isFinite(Number(piece?.friction))) out.friction = clamp(piece.friction, 0, 4, 0.95);
      return out;
    }),
    props,
    plates,
    launchers,
    zones,
    keepout: list(raw.keepout, LIMITS.keepout).map((k, i) => ({
      id: slug(k?.id) || `keepout-${i}`,
      pos: vec(k?.pos, [0, 4, 0]),
      size: size(k?.size, [6, 8, 6]),
    })),
    objectives,
    demands: {
      steps: clamp(raw.demands?.steps, 1, 6, 1),
      flies: Boolean(raw.demands?.flies),
      autonomous: Boolean(raw.handsOff),
      ...(raw.demands?.bansBite === false ? { bansBite: false } : {}),
    },
    bans: [...new Set(list(raw.bans, BANS.length).filter((b) => BANS.includes(b)))],
    budget: { cost: clamp(raw.budget?.cost, 1, 2000, 120) },
    par: clamp(raw.par, 5, 3600, 120),
  };

  if (raw.hint) level.hint = text(raw.hint, LIMITS.hint);
  if (raw.handsOff) level.handsOff = true;
  if (raw.noContact) level.noContact = true;
  // Touch nothing but the ground. A driving level cannot use noContact,
  // because a machine with wheels on it is touching something by definition.
  if (raw.noBumps) level.noBumps = true;
  // Worked out from the scenery when it is not given, so a course over a
  // drop does not have to remember to say so.
  if (Number.isFinite(Number(raw.fallBelow))) level.fallBelow = clamp(raw.fallBelow, -500, 500, 0);
  if (raw.noRespawn) level.noRespawn = true;
  // A hard clock, as against par, which is only a target. Run out of it and
  // the run is failed, so the answer has to be quick as well as correct.
  if (Number.isFinite(Number(raw.deadline))) level.deadline = clamp(raw.deadline, 1, 3600, 60);
  // The machine starts on the scenery rather than beside it, which is the
  // one case where there is deliberately no clear ground at the spawn.
  if (raw.mounted) level.mounted = true;
  if (Number.isFinite(Number(raw.catchFloor))) {
    level.catchFloor = clamp(raw.catchFloor, 0, 40, 0.6);
  }
  if (Number.isFinite(Number(raw.massCap))) level.massCap = clamp(raw.massCap, 1, 5000, 50);
  // In cells, because that is what a player counts as they build.
  if (Number.isFinite(Number(raw.heightCap))) {
    level.heightCap = Math.round(clamp(raw.heightCap, 1, 40, 4));
  }
  if (Number.isFinite(Number(raw.gravity))) level.gravity = clamp(raw.gravity, -40, 0, -9.81);
  if (Number.isFinite(Number(raw.friction))) level.friction = clamp(raw.friction, 0, 4, 1);
  if (raw.fog) {
    level.fog = {
      near: clamp(raw.fog.near, 0, 400, 1),
      far: clamp(raw.fog.far, 1, 800, 40),
      colour: colour(raw.fog.colour, 0x0b0f14),
    };
  }

  return level;
}

/** What a level is missing before it is worth playing. */
/**
 * The height below which a machine has plainly gone over the edge, or null on
 * a course where there is nowhere to fall.
 *
 * Six courses are built over a drop, and the floor of that drop is nine to
 * thirteen metres down. Landing on it used to be no more than an inconvenience:
 * the run carried on, the machine sat at the bottom of the hole, and nothing
 * ever said so. The line is set just under the lowest thing you can stand on,
 * rather than at the floor, so it reads as going over the edge rather than as
 * hitting the bottom.
 */
export function fallLine(level) {
  if (Number.isFinite(Number(level?.fallBelow))) return Number(level.fallBelow);
  if (level?.groundY === undefined || level.groundY === null) return null;
  let lowest = Infinity;
  for (const piece of level.pieces ?? []) {
    lowest = Math.min(lowest, piece.pos[1] - piece.size[1] / 2);
  }
  if (!Number.isFinite(lowest)) return null;
  // Ground a little below the scenery is a kerb, not a drop.
  if (lowest - level.groundY < 4) return null;
  return lowest - 3;
}

/**
 * Whether a run has used up a level's hard clock. Par is a target you can
 * miss and still win; this one ends the run.
 */
export function outOfTime(level, elapsed) {
  return Boolean(level?.deadline) && elapsed >= level.deadline;
}

export function levelProblems(level) {
  const problems = [];
  if (level.objectives.length === 0) problems.push('No objective — there is nothing to finish');
  if (level.zones.length === 0 && level.objectives.some((o) => o.zone)) {
    problems.push('An objective needs a zone and there are none');
  }
  const inGround = level.spawn[1] < level.groundY;
  if (inGround) problems.push('The spawn point is under the ground');
  for (const objective of level.objectives) {
    if (objective.type === 'propInZone' && !objective.prop) {
      problems.push(`"${objective.label}" does not say which prop`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------- share code

const PREFIX = 'CTP1';

export function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

export async function squeeze(bytes, mode) {
  const Stream = mode === 'deflate' ? CompressionStream : DecompressionStream;
  if (typeof Stream !== 'function') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'));
  const chunks = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    // A small code must not be able to expand into something enormous.
    if (total > LIMITS.bytes) throw new Error('Level is too big');
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * A level as one line of text somebody can paste to a friend.
 *
 * Compressed where the browser will do it, and plainly readable where it will
 * not — the flag says which, so a code made on one machine always opens on
 * another. That matters more than the few bytes saved.
 */
export async function toShareCode(level) {
  const clean = sanitiseLevel(level);
  const json = JSON.stringify({ v: LEVEL_FORMAT, level: clean });
  const bytes = new TextEncoder().encode(json);
  const packed = await squeeze(bytes, 'deflate').catch(() => null);
  return packed && packed.length < bytes.length
    ? `${PREFIX}z${toBase64Url(packed)}`
    : `${PREFIX}j${toBase64Url(bytes)}`;
}

/** The other direction, and it never throws on rubbish — it explains. */
export async function fromShareCode(code) {
  const trimmed = typeof code === 'string' ? code.trim().replace(/\s+/g, '') : '';
  if (!trimmed.startsWith(PREFIX)) {
    return { ok: false, reason: 'That does not look like a level code' };
  }
  if (trimmed.length > LIMITS.chars) {
    return { ok: false, reason: 'That code is too long to be a level' };
  }
  const flag = trimmed[PREFIX.length];
  const body = trimmed.slice(PREFIX.length + 1);
  if (flag !== 'z' && flag !== 'j') {
    return { ok: false, reason: 'That code was made by a newer version of the game' };
  }
  try {
    const bytes = fromBase64Url(body);
    const json = flag === 'z'
      ? new TextDecoder().decode(await squeeze(bytes, 'inflate'))
      : new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (parsed?.v !== LEVEL_FORMAT) {
      return { ok: false, reason: 'That level was made by a different version of the game' };
    }
    return { ok: true, level: sanitiseLevel(parsed.level) };
  } catch {
    return { ok: false, reason: 'That code is damaged' };
  }
}
