import { applyOrientation, IDENTITY_ORIENTATION } from './orientation.js';
import { getPart } from '../parts/registry.js';

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
  }

  get size() {
    return this.parts.size;
  }

  cost() {
    let total = 0;
    for (const placed of this.parts.values()) total += getPart(placed.type).cost;
    return total;
  }

  canPlace(typeId, cell, rot = IDENTITY_ORIENTATION, ignoreId = null) {
    const part = getPart(typeId);
    if (part.unique) {
      for (const placed of this.parts.values()) {
        if (placed.type === typeId && placed.id !== ignoreId) {
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
      if (occupant && occupant !== ignoreId) {
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

  setConfig(id, config) {
    const placed = this.parts.get(id);
    if (!placed) return false;
    placed.config = { ...placed.config, ...config };
    return true;
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
      })),
    };
  }

  clone() {
    return Blueprint.fromJSON(this.toJSON(), { bounds: this.bounds });
  }

  static fromJSON(data, options = {}) {
    const bp = new Blueprint({ name: data.name, bounds: options.bounds });
    for (const p of data.parts ?? []) {
      const cells = occupiedCells(p.type, p.cell, p.rot);
      const placed = {
        id: p.id,
        type: p.type,
        cell: [...p.cell],
        rot: p.rot,
        config: { ...(p.config ?? {}) },
      };
      bp.parts.set(p.id, placed);
      for (const c of cells) bp.occupancy.set(key(c), p.id);
      const numeric = Number.parseInt(String(p.id).replace(/\D/g, ''), 10);
      if (Number.isFinite(numeric) && numeric >= nextId) nextId = numeric + 1;
    }
    return bp;
  }
}
