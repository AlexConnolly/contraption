import { describe, it, expect } from 'vitest';
import { Blueprint, occupiedCells } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';

describe('blueprint', () => {
  it('claims every cell a multi-cell part covers', () => {
    const bp = new Blueprint();
    const result = bp.place('beam', [0, 1, 0], IDENTITY_ORIENTATION);
    expect(result.ok).toBe(true);
    expect(bp.occupancy.size).toBe(3);
    expect(bp.partAt([-1, 1, 0]).id).toBe(result.id);
    expect(bp.partAt([1, 1, 0]).id).toBe(result.id);
  });

  it('rotates a footprint with the part', () => {
    const rot = yawStep(IDENTITY_ORIENTATION);
    const cells = occupiedCells('beam', [0, 0, 0], rot);
    const zs = cells.map((c) => c[2]).sort();
    expect(zs).toEqual([-1, 0, 1]);
    expect(cells.every((c) => c[0] === 0)).toBe(true);
  });

  it('refuses overlapping placements', () => {
    const bp = new Blueprint();
    bp.place('block', [0, 0, 0]);
    const clash = bp.place('beam', [0, 0, 0]);
    expect(clash.ok).toBe(false);
    expect(clash.reason).toMatch(/already/i);
    expect(bp.size).toBe(1);
  });

  it('refuses placements outside the build area', () => {
    const bp = new Blueprint();
    const out = bp.place('block', [0, -1, 0]);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/build area/i);
  });

  it('allows only one core', () => {
    const bp = new Blueprint();
    expect(bp.place('core', [0, 0, 0]).ok).toBe(true);
    const second = bp.place('core', [2, 0, 0]);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/only one/i);
  });

  it('frees every cell on removal', () => {
    const bp = new Blueprint();
    const { id } = bp.place('panel', [0, 2, 0]);
    expect(bp.occupancy.size).toBe(9);
    expect(bp.remove(id)).toBe(true);
    expect(bp.occupancy.size).toBe(0);
    expect(bp.place('panel', [0, 2, 0]).ok).toBe(true);
  });

  it('round-trips through JSON without loss', () => {
    const bp = new Blueprint({ name: 'Hauler' });
    bp.place('core', [0, 1, 0]);
    bp.place('beam', [0, 0, 0], yawStep(IDENTITY_ORIENTATION));
    bp.place('wheel', [2, 0, 0], IDENTITY_ORIENTATION, { binding: { mode: 'hold', pos: 'KeyW' } });

    const copy = Blueprint.fromJSON(bp.toJSON());
    expect(copy.name).toBe('Hauler');
    expect(copy.size).toBe(3);
    expect(copy.occupancy.size).toBe(bp.occupancy.size);
    expect(copy.toJSON()).toEqual(bp.toJSON());
  });

  it('reports cost and the lowest occupied cell', () => {
    const bp = new Blueprint();
    bp.place('core', [0, 3, 0]);
    bp.place('ballast', [0, 1, 0]);
    expect(bp.cost()).toBe(2);
    expect(bp.lowestCell()).toBe(1);
  });
});
