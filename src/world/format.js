import { toBase64Url, fromBase64Url, squeeze } from '../challenges/format.js';
// A cycle on purpose: world.js wants the limits, and a sanitised world is
// only useful with its blocks already unpacked. Both sides use the other's
// bindings at call time, never while the module is being evaluated.
import { World } from './world.js';

/**
 * The portable shape of a world.
 *
 * A level and a world are different documents and the level format cannot
 * carry one: it caps scenery at 250 pieces, positions at ±200 m and a share
 * code at 64 KB of text, and the whole shipped campaign comes to 235 pieces. A
 * town is thousands of blocks over a much bigger box.
 *
 * So this is its own format with its own limits, reusing the base64url and
 * deflate machinery the level and pack codes already share. Everything that
 * arrives from somebody else goes through `sanitiseWorld` first: a world is a
 * stranger's data exactly as a level or a parts pack is.
 */

export const WORLD_FORMAT = 1;
const PREFIX = 'CTPW1';

/** Sixteen cubed. The unit of one mesh, one collider and one save entry. */
export const CHUNK = 16;

export const WORLD_LIMITS = {
  // Shipped limit. The format and the renderer are chunked so this is a number
  // to raise, not a rewrite.
  blocks: 5000,
  reach: 512,
  floor: -32,
  ceiling: 192,
  materials: 15,
  vehicles: 64,
  name: 48,
  chars: 400 * 1024,
};

export const chunkKey = (cx, cy, cz) => `${cx},${cy},${cz}`;

const AUTHORITY = ['open', 'owner'];

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

// Degrees about the up axis, wrapped into a single turn so a vehicle spun
// round five times saves as the angle it is actually facing.
const turn = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
};

const spot = (value) => {
  const fallback = [0, 2, 0];
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  return [
    clamp(value[0], -WORLD_LIMITS.reach, WORLD_LIMITS.reach, 0),
    clamp(value[1], WORLD_LIMITS.floor, WORLD_LIMITS.ceiling, 2),
    clamp(value[2], -WORLD_LIMITS.reach, WORLD_LIMITS.reach, 0),
  ];
};

// A chunk key is three integers. Anything else names no chunk at all.
const goodKey = (key) => /^-?\d{1,5},-?\d{1,5},-?\d{1,5}$/.test(key);

/**
 * A world made safe. Unknown fields are dropped rather than carried, the block
 * count is capped however many a file claims, and nothing that arrives is
 * trusted to be the right shape.
 */
export function sanitiseWorld(raw) {
  const chunks = {};
  const source = raw?.chunks && typeof raw.chunks === 'object' ? raw.chunks : {};
  for (const [key, runs] of Object.entries(source)) {
    if (!goodKey(key) || !Array.isArray(runs)) continue;
    chunks[key] = runs;
  }

  const vehicles = (Array.isArray(raw?.vehicles) ? raw.vehicles : [])
    .filter((v) => v && typeof v === 'object')
    .slice(0, WORLD_LIMITS.vehicles)
    .map((v, i) => ({
      id: text(v.id, 32) || `v${i}`,
      name: text(v.name, WORLD_LIMITS.name) || 'Machine',
      owner: text(v.owner, 32) || null,
      at: spot(v.at),
      // Which way it is parked, in degrees about the up axis. A machine's own
      // parts are turned in twenty-four fixed steps, because they clip to a
      // grid; a machine standing in a world is not on anybody's grid and is
      // parked facing down whatever street it is on.
      yaw: turn(v.yaw),
      blueprint: v.blueprint && typeof v.blueprint === 'object' ? v.blueprint : null,
    }))
    .filter((v) => v.blueprint);

  return {
    v: WORLD_FORMAT,
    name: text(raw?.name, WORLD_LIMITS.name) || 'Untitled world',
    seed: Math.round(clamp(raw?.seed, 0, 0xffffffff, 1)),
    spawn: spot(raw?.spawn),
    ground: Math.round(clamp(raw?.ground, 0, 4000, 400)),
    online: {
      authority: AUTHORITY.includes(raw?.online?.authority) ? raw.online.authority : 'owner',
    },
    // Unpacked here rather than left as runs, because every caller wants a
    // world it can read a block out of, and the cap has to bite on the way in.
    blocks: World.fromJSON(chunks),
    vehicles,
  };
}

/** A world with nothing in it yet, ready to be built in. */
export function blankWorld() {
  return {
    v: WORLD_FORMAT,
    name: 'Untitled world',
    seed: 1,
    spawn: [0, 2, 0],
    ground: 400,
    online: { authority: 'owner' },
    blocks: new World(),
    vehicles: [],
  };
}

/**
 * A world as plain data. A share code and a saved record are the same document
 * carried two different ways, so both are made from here.
 */
export function worldJSON(world) {
  return {
    v: WORLD_FORMAT,
    name: world.name,
    seed: world.seed,
    spawn: world.spawn,
    ground: world.ground,
    online: world.online,
    chunks: world.blocks ? world.blocks.toJSON() : {},
    vehicles: world.vehicles ?? [],
  };
}

export async function toWorldCode(world) {
  const json = JSON.stringify(worldJSON(world));
  const bytes = new TextEncoder().encode(json);
  const packed = await squeeze(bytes, 'deflate').catch(() => null);
  return packed && packed.length < bytes.length
    ? `${PREFIX}z${toBase64Url(packed)}`
    : `${PREFIX}j${toBase64Url(bytes)}`;
}

/** The other direction, which explains rubbish rather than throwing it. */
export async function fromWorldCode(code) {
  const trimmed = typeof code === 'string' ? code.trim().replace(/\s+/g, '') : '';
  if (!trimmed.startsWith(PREFIX)) {
    return { ok: false, reason: 'That does not look like a world' };
  }
  if (trimmed.length > WORLD_LIMITS.chars) {
    return { ok: false, reason: 'That world is too big to open' };
  }
  const flag = trimmed[PREFIX.length];
  const body = trimmed.slice(PREFIX.length + 1);
  try {
    const bytes = fromBase64Url(body);
    const json = flag === 'z'
      ? new TextDecoder().decode(await squeeze(bytes, 'inflate'))
      : new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (Number(parsed?.v) > WORLD_FORMAT) {
      return { ok: false, reason: 'That world was made by a newer version of the game' };
    }
    return { ok: true, world: sanitiseWorld(parsed) };
  } catch {
    return { ok: false, reason: 'That world code is damaged' };
  }
}
