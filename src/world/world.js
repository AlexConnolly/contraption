import { WORLD_LIMITS, CHUNK, chunkKey } from './format.js';

/**
 * The blocks a world is made of.
 *
 * A level stores scenery as a list of boxes, each with its own position, size
 * and colour, and caps that list at 250. That is right for a hand-built
 * obstacle course and hopeless for a town: a flat square of ground forty
 * metres across is already sixteen hundred blocks.
 *
 * So blocks live on a grid and are filed into chunks of sixteen cubed. A chunk
 * is the unit of everything expensive — one mesh, one collider, one entry in a
 * save — so editing a block rebuilds that chunk and nothing else, and a world
 * of fifty thousand blocks costs the same per block as a world of five.
 *
 * A block is a palette index, not an object: 0 is air and anything else is a
 * material. Saving runs them out as `[index, howMany]` pairs in a fixed order,
 * which costs a flat floor almost nothing.
 */

const inBox = (x, y, z) => Math.abs(x) <= WORLD_LIMITS.reach
  && Math.abs(z) <= WORLD_LIMITS.reach
  && y >= WORLD_LIMITS.floor && y <= WORLD_LIMITS.ceiling;

// Where a cell sits inside its own chunk, and where that chunk sits.
const chunkOf = (n) => Math.floor(n / CHUNK);
const within = (n) => ((n % CHUNK) + CHUNK) % CHUNK;
const at = (x, y, z) => (within(y) * CHUNK + within(z)) * CHUNK + within(x);

export class World {
  constructor({ cap = WORLD_LIMITS.blocks } = {}) {
    this.cap = cap;
    this.chunks = new Map();
    this.dirty = new Set();
    this.blocks = 0;
  }

  count() {
    return this.blocks;
  }

  get(x, y, z) {
    const chunk = this.chunks.get(chunkKey(chunkOf(x), chunkOf(y), chunkOf(z)));
    return chunk ? chunk.cells[at(x, y, z)] : 0;
  }

  /**
   * Puts a block down, or takes one away with material 0. Returns whether
   * anything changed, so a caller can tell a refused edit from a no-op.
   */
  set(x, y, z, material) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return false;
    if (!inBox(x, y, z)) return false;
    const kind = Math.max(0, Math.min(WORLD_LIMITS.materials, Math.round(material) || 0));
    const key = chunkKey(chunkOf(x), chunkOf(y), chunkOf(z));
    let chunk = this.chunks.get(key);

    if (!chunk) {
      if (kind === 0) return false;
      if (this.blocks >= this.cap) return false;
      chunk = { key, cells: new Uint8Array(CHUNK ** 3), filled: 0 };
      this.chunks.set(key, chunk);
    }
    const index = at(x, y, z);
    const was = chunk.cells[index];
    if (was === kind) return false;
    if (was === 0 && this.blocks >= this.cap) return false;

    chunk.cells[index] = kind;
    chunk.filled += (kind ? 1 : 0) - (was ? 1 : 0);
    this.blocks += (kind ? 1 : 0) - (was ? 1 : 0);
    this.dirty.add(key);
    // A chunk with nothing in it is a mesh and a collider nobody needs.
    if (chunk.filled === 0) this.chunks.delete(key);
    return true;
  }

  /** The chunks that have changed since the last time anything looked. */
  touched() {
    return [...this.dirty];
  }

  clean() {
    this.dirty.clear();
  }

  /** Every block in a chunk, as [x, y, z, material] in world cells. */
  cellsOf(key) {
    const chunk = this.chunks.get(key);
    const out = [];
    if (!chunk) return out;
    const [cx, cy, cz] = key.split(',').map(Number);
    for (let y = 0; y < CHUNK; y += 1) {
      for (let z = 0; z < CHUNK; z += 1) {
        for (let x = 0; x < CHUNK; x += 1) {
          const kind = chunk.cells[(y * CHUNK + z) * CHUNK + x];
          if (kind) out.push([cx * CHUNK + x, cy * CHUNK + y, cz * CHUNK + z, kind]);
        }
      }
    }
    return out;
  }

  toJSON() {
    const chunks = {};
    for (const [key, chunk] of this.chunks) chunks[key] = runsOf(chunk.cells);
    return chunks;
  }

  static fromJSON(chunks, options = {}) {
    const world = new World(options);
    for (const [key, runs] of Object.entries(chunks ?? {})) {
      const cells = cellsFrom(runs);
      if (!cells) continue;
      let filled = 0;
      for (const cell of cells) if (cell) filled += 1;
      if (filled === 0) continue;
      if (world.blocks + filled > world.cap) {
        // Trim rather than refuse: a world that arrived too big should still
        // open, with as much of it as the cap allows.
        break;
      }
      world.chunks.set(key, { key, cells, filled });
      world.dirty.add(key);
      world.blocks += filled;
    }
    return world;
  }
}

/** Run-length pairs, which is what makes a flat floor nearly free to store. */
export function runsOf(cells) {
  const runs = [];
  let kind = cells[0];
  let run = 1;
  for (let i = 1; i < cells.length; i += 1) {
    if (cells[i] === kind) {
      run += 1;
    } else {
      runs.push([kind, run]);
      kind = cells[i];
      run = 1;
    }
  }
  runs.push([kind, run]);
  return runs;
}

export function cellsFrom(runs) {
  if (!Array.isArray(runs)) return null;
  const cells = new Uint8Array(CHUNK ** 3);
  let i = 0;
  for (const run of runs) {
    if (!Array.isArray(run) || run.length !== 2) return null;
    const kind = Math.max(0, Math.min(WORLD_LIMITS.materials, Math.round(Number(run[0])) || 0));
    const many = Math.max(0, Math.min(cells.length, Math.round(Number(run[1])) || 0));
    if (kind) cells.fill(kind, i, Math.min(cells.length, i + many));
    i += many;
    if (i >= cells.length) break;
  }
  return cells;
}
