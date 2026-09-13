import { WORLD_LIMITS } from './format.js';
import { BLOCK } from './terrain.js';

/**
 * Building the world itself.
 *
 * The machine studio picks a cell by casting a ray at a build plate and at the
 * parts already down. This is the same idea against the ground plane and the
 * blocks already placed, and it deliberately has far fewer rules: a world is
 * not a machine, so blocks need not touch anything, need not connect to a
 * core, and are not inside a build box. The only limits are how far a world
 * reaches and how many blocks it may hold.
 *
 * The walk is a plain stepped march along the ray rather than a proper voxel
 * traversal. At a quarter of a block a step it cannot miss anything a metre
 * across, and it keeps the whole of picking down to something that fits on a
 * screen and is easy to be sure of.
 */

const STEP = BLOCK / 4;
const REACH = 120;

const cellOf = (p) => [Math.floor(p.x / BLOCK), Math.floor(p.y / BLOCK), Math.floor(p.z / BLOCK)];

const inWorld = ([x, y, z]) => Math.abs(x) <= WORLD_LIMITS.reach
  && Math.abs(z) <= WORLD_LIMITS.reach
  && y >= WORLD_LIMITS.floor && y <= WORLD_LIMITS.ceiling;

export class WorldEditor {
  constructor({ blocks, material = 1, reach = REACH }) {
    this.blocks = blocks;
    this.material = material;
    this.reach = reach;
  }

  /**
   * What the player is looking at: the block under the pointer, and the empty
   * cell in front of it where the next one would go.
   *
   * Looking at nothing but ground gives the cell on the ground; looking at a
   * block gives the cell against the face being looked at, which is the only
   * way to build upwards.
   */
  aim({ origin, dir }) {
    let last = null;
    for (let t = 0; t <= this.reach; t += STEP) {
      const at = {
        x: origin.x + dir.x * t,
        y: origin.y + dir.y * t,
        z: origin.z + dir.z * t,
      };
      const cell = cellOf(at);
      if (last && cell[0] === last[0] && cell[1] === last[1] && cell[2] === last[2]) continue;

      if (this.blocks.get(cell[0], cell[1], cell[2])) {
        // The cell the ray was in the step before is the face it came through.
        return last && inWorld(last) ? { cell: last, hit: cell } : null;
      }
      // The ground plane is everything at or below y = 0, and it is solid.
      if (at.y <= 0) {
        const on = [cell[0], 0, cell[2]];
        return inWorld(on) ? { cell: on, hit: null } : null;
      }
      last = cell;
    }
    return null;
  }

  /** Puts a block where the player is looking. */
  place(ray) {
    const aim = this.aim(ray);
    if (!aim) return false;
    return this.blocks.set(aim.cell[0], aim.cell[1], aim.cell[2], this.material);
  }

  /** Takes away the block the player is looking at, rather than the air in front of it. */
  remove(ray) {
    const aim = this.aim(ray);
    if (!aim || !aim.hit) return false;
    return this.blocks.set(aim.hit[0], aim.hit[1], aim.hit[2], 0);
  }

  /** A straight run of blocks, for laying a road or a wall in one drag. */
  line(from, to) {
    const span = [0, 1, 2].map((i) => to[i] - from[i]);
    const steps = Math.max(...span.map(Math.abs));
    let put = 0;
    for (let i = 0; i <= steps; i += 1) {
      const at = [0, 1, 2].map((k) => Math.round(from[k] + (span[k] * i) / (steps || 1)));
      if (this.blocks.set(at[0], at[1], at[2], this.material)) put += 1;
    }
    return put;
  }

  /** A solid rectangle between two corners, for a floor or a slab. */
  fill(from, to) {
    const lo = [0, 1, 2].map((i) => Math.min(from[i], to[i]));
    const hi = [0, 1, 2].map((i) => Math.max(from[i], to[i]));
    let put = 0;
    for (let x = lo[0]; x <= hi[0]; x += 1) {
      for (let y = lo[1]; y <= hi[1]; y += 1) {
        for (let z = lo[2]; z <= hi[2]; z += 1) {
          if (this.blocks.set(x, y, z, this.material)) put += 1;
        }
      }
    }
    return put;
  }
}
