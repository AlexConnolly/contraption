import { applyOrientation, IDENTITY_ORIENTATION } from './orientation.js';
import { sanitiseGroups } from './groups.js';
import { getPart, findPart, partCost } from '../parts/registry.js';

export const BLUEPRINT_VERSION = 1;

// The build plate is a datum, not a floor. A machine can hang wheels, skids or
// a grabber under it; what it stands on when it spawns is its own lowest cell,
// wherever that turns out to be.
export const DEFAULT_BOUNDS = {
  min: [-14, -12, -14],
  max: [14, 26, 14],
};

export function key(cell) {
  return `${cell[0]},${cell[1]},${cell[2]}`;
}

// Footprints are centred on the origin cell, so every part size must be odd.
export function localOffsets(size) {
  const out = [];
  for (let i = 0; i < size[0]; i += 1) {
    for (let j = 0; j < size[1]; j += 1) {
      for (let k = 0; k < size[2]; k += 1) {
        out.push([
          i - (size[0] - 1) / 2,
          j - (size[1] - 1) / 2,
          k - (size[2] - 1) / 2,
        ]);
      }
    }
  }
  return out;
}

export function occupiedCells(typeId, cell, rot) {
  const part = getPart(typeId);
  return localOffsets(part.size).map((offset) => {
    const r = applyOrientation(rot, offset);
    return [
      cell[0] + Math.round(r[0]),
      cell[1] + Math.round(r[1]),
      cell[2] + Math.round(r[2]),
    ];
  });
}

function inBounds(cell, bounds) {
  return (
    cell[0] >= bounds.min[0] && cell[0] <= bounds.max[0] &&
    cell[1] >= bounds.min[1] && cell[1] <= bounds.max[1] &&
    cell[2] >= bounds.min[2] && cell[2] <= bounds.max[2]
  );
}

let nextId = 1;
function makeId() {
  nextId += 1;
  return `p${nextId}`;
}

export class Blueprint {
  constructor(options = {}) {
    this.name = options.name ?? 'Untitled machine';
    this.bounds = options.bounds ?? DEFAULT_BOUNDS;
    this.parts = new Map();
    this.occupancy = new Map();
    // Named groups the builder made. An editing idea only: the physics still
    // decides what actually moves together. See core/groups.js.
    this.groups = new Map();
    this.missing = [];
  }

  get size() {
    return this.parts.size;
  }

  /**
   * What the machine costs as it is set, not as its parts come off the shelf.
   *
   * A motor wound past what it is rated for costs in proportion to the power
   * it is now making, which is torque times speed. That is what keeps a
   * five-times-faster, ten-times-stronger wheel out of a campaign budget and
   * in fun mode, where there is no budget to keep it out of.
   */
  cost() {
    let total = 0;
    for (const placed of this.parts.values()) total += partCost(placed);
    return total;
  }

  /**
   * Whether a part fits, ignoring one part that is getting out of its own way.
   *
   * `ignore` takes a set as well as a single id, because moving a selection is
   * the same question asked of several parts at once: each one has to clear
   * everything except the others that are moving with it. Passing them one at
   * a time would refuse a block of parts sliding one cell along, where every
   * part lands where its neighbour used to be.
   */
  canPlace(typeId, cell, rot = IDENTITY_ORIENTATION, ignore = null) {
    const ignores = ignore instanceof Set
      ? (id) => ignore.has(id)
      : (id) => id === ignore;
    const part = getPart(typeId);
    if (part.unique) {
      for (const placed of this.parts.values()) {
        if (placed.type === typeId && !ignores(placed.id)) {
          return { ok: false, reason: `Only one ${part.name} allowed` };
        }
      }
    }
    const cells = occupiedCells(typeId, cell, rot);
    for (const c of cells) {
      if (!inBounds(c, this.bounds)) {
        return { ok: false, reason: 'Outside the build area' };
      }
      const occupant = this.occupancy.get(key(c));
      if (occupant && !ignores(occupant)) {
        return { ok: false, reason: 'Something is already there' };
      }
    }
    return { ok: true, cells };
  }

  place(typeId, cell, rot = IDENTITY_ORIENTATION, config = {}) {
    const check = this.canPlace(typeId, cell, rot);
    if (!check.ok) return check;
    const id = makeId();
    const placed = {
      id,
      type: typeId,
      cell: [...cell],
      rot,
      config: { ...config },
    };
    this.parts.set(id, placed);
    for (const c of check.cells) this.occupancy.set(key(c), id);
    return { ok: true, id, part: placed };
  }

  remove(id) {
    const placed = this.parts.get(id);
    if (!placed) return false;
    for (const c of occupiedCells(placed.type, placed.cell, placed.rot)) {
      if (this.occupancy.get(key(c)) === id) this.occupancy.delete(key(c));
    }
    this.parts.delete(id);
    return true;
  }

  /**
   * Throws away parts whose type is no longer installed, and says what went.
   *
   * Everything downstream — the cost, the meshes, the physics — takes it for
   * granted that a placed type can be looked up, so when a pack is removed out
   * from under a machine the parts have to go rather than be tolerated one
   * call site at a time.
   */
  dropMissing() {
    const gone = [];
    for (const placed of this.list()) {
      if (findPart(placed.type)) continue;
      gone.push(placed.type);
      this.parts.delete(placed.id);
      for (const [at, id] of this.occupancy) {
        if (id === placed.id) this.occupancy.delete(at);
      }
    }
    return gone;
  }

  partAt(cell) {
    const id = this.occupancy.get(key(cell));
    return id ? this.parts.get(id) : null;
  }

  get(id) {
    return this.parts.get(id) ?? null;
  }

  list() {
    return [...this.parts.values()];
  }

  /**
   * Turns a part that is already down. Getting an orientation wrong is the
   * commonest mistake there is, and deleting and replacing the part to fix it
   * loses whatever was bound to it. The old cells are given up first so a
   * part is never blocked by itself, and put back if the new rotation will
   * not fit.
   */
  setRotation(id, rot) {
    const placed = this.parts.get(id);
    if (!placed) return { ok: false, reason: 'No such part' };

    const held = occupiedCells(placed.type, placed.cell, placed.rot);
    for (const c of held) {
      if (this.occupancy.get(key(c)) === id) this.occupancy.delete(key(c));
    }

    const check = this.canPlace(placed.type, placed.cell, rot, id);
    if (!check.ok) {
      for (const c of held) this.occupancy.set(key(c), id);
      return check;
    }

    placed.rot = rot;
    for (const c of check.cells) this.occupancy.set(key(c), id);
    return { ok: true };
  }

  setConfig(id, config) {
    const placed = this.parts.get(id);
    if (!placed) return false;
    placed.config = { ...placed.config, ...config };
    return true;
  }

  /**
   * The middle of the space the machine occupies, in cells. Not the same as
   * the average of where its parts are: a crane with a heavy body and a long
   * thin arm has most of its parts in the body, so the average sits down at
   * that end and putting the machine down on it lands the whole thing off to
   * one side.
   */
  /**
   * The box the machine fills, in cells: where it starts, where it ends, and
   * how many cells across it is on each axis.
   */
  extent() {
    if (this.parts.size === 0) {
      return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
    }
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const placed of this.parts.values()) {
      for (const cell of occupiedCells(placed.type, placed.cell, placed.rot)) {
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis], cell[axis]);
          max[axis] = Math.max(max[axis], cell[axis]);
        }
      }
    }
    return { min, max, size: [0, 1, 2].map((axis) => max[axis] - min[axis] + 1) };
  }

  /** How many cells tall the machine is, lowest part to highest. */
  height() {
    return this.parts.size === 0 ? 0 : this.extent().size[1];
  }

  extentCentre() {
    if (this.parts.size === 0) return [0, 0, 0];
    const { min, max } = this.extent();
    return [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2);
  }

  centre() {
    if (this.parts.size === 0) return [0, 0, 0];
    let sx = 0; let sy = 0; let sz = 0;
    for (const placed of this.parts.values()) {
      sx += placed.cell[0];
      sy += placed.cell[1];
      sz += placed.cell[2];
    }
    const n = this.parts.size;
    return [sx / n, sy / n, sz / n];
  }

  lowestCell() {
    let low = Infinity;
    for (const placed of this.parts.values()) {
      for (const c of occupiedCells(placed.type, placed.cell, placed.rot)) {
        if (c[1] < low) low = c[1];
      }
    }
    return Number.isFinite(low) ? low : 0;
  }

  toJSON() {
    return {
      version: BLUEPRINT_VERSION,
      name: this.name,
      parts: this.list().map((p) => ({
        id: p.id,
        type: p.type,
        cell: [...p.cell],
        rot: p.rot,
        config: { ...p.config },
        ...(p.group ? { group: p.group } : {}),
      })),
      // Left off entirely when there are none, so nothing already saved grows
      // a field and every older reader carries on ignoring what it cannot use.
      ...(this.groups.size
        ? { groups: [...this.groups.values()].map((g) => ({ ...g })) }
        : {}),
    };
  }

  clone() {
    return Blueprint.fromJSON(this.toJSON(), { bounds: this.bounds });
  }

  static fromJSON(data, options = {}) {
    const bp = new Blueprint({ name: data.name, bounds: options.bounds });
    for (const p of data.parts ?? []) {
      // A machine saved with a pack that has since been removed. Dropping the
      // part is the only thing that can be done with it, but the machine is
      // still worth having, and `missing` lets the builder say what went.
      if (!findPart(p.type)) {
        bp.missing.push(p.type);
        continue;
      }
      const cells = occupiedCells(p.type, p.cell, p.rot);
      const placed = {
        id: p.id,
        type: p.type,
        cell: [...p.cell],
        rot: p.rot,
        config: { ...(p.config ?? {}) },
      };
      if (p.group) placed.group = String(p.group).slice(0, 40);
      bp.parts.set(p.id, placed);
      for (const c of cells) bp.occupancy.set(key(c), p.id);
      const numeric = Number.parseInt(String(p.id).replace(/\D/g, ''), 10);
      if (Number.isFinite(numeric) && numeric >= nextId) nextId = numeric + 1;
    }
    bp.groups = sanitiseGroups(data.groups);
    // A part naming a group that did not survive is simply ungrouped, rather
    // than a part nothing can ever select.
    for (const placed of bp.parts.values()) {
      if (placed.group && !bp.groups.has(placed.group)) delete placed.group;
    }
    return bp;
  }
}
