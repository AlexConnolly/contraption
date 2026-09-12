import { describe, it, expect } from 'vitest';
import { getLevel } from '../src/challenges/levels.js';

// Two walls that meet exactly on a plane are not a gap between them.
const EPS = 1e-6;
const STEP = 0.5;
const HALF = 45;
const CELLS = Math.round((HALF * 2) / STEP);
const at = (i) => -HALF + i * STEP;

/**
 * A floor plan of a level. `walls` means the pieces stop you; `floor` means
 * the pieces are all there is to stand on and everywhere else is a drop.
 */
function plan(level, kind) {
  const open = [];
  for (let ix = 0; ix < CELLS; ix += 1) {
    open.push(new Uint8Array(CELLS));
    for (let iz = 0; iz < CELLS; iz += 1) {
      const x = at(ix);
      const z = at(iz);
      let on = false;
      for (const p of level.pieces) {
        if (Math.abs(x - p.pos[0]) <= p.size[0] / 2 + EPS
          && Math.abs(z - p.pos[2]) <= p.size[2] / 2 + EPS) { on = true; break; }
      }
      open[ix][iz] = (kind === 'floor' ? on : !on) ? 1 : 0;
    }
  }
  return open;
}

function survey(level, zoneId, kind) {
  const goal = level.zones.find((z) => z.id === zoneId);
  const open = plan(level, kind);
  const sx = Math.round((level.spawn[0] + HALF) / STEP);
  const sz = Math.round((level.spawn[2] + HALF) / STEP);

  const dist = new Float64Array(CELLS * CELLS).fill(Infinity);
  dist[sx * CELLS + sz] = 0;
  let queue = [[sx, sz]];
  let reached = 0;
  let route = Infinity;
  while (queue.length) {
    const next = [];
    for (const [ix, iz] of queue) {
      reached += 1;
      const d = dist[ix * CELLS + iz];
      if (Math.abs(at(ix) - goal.pos[0]) <= goal.size[0] / 2
        && Math.abs(at(iz) - goal.pos[2]) <= goal.size[2] / 2) route = Math.min(route, d);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = ix + dx;
        const b = iz + dz;
        if (a < 0 || b < 0 || a >= CELLS || b >= CELLS) continue;
        if (!open[a][b] || dist[a * CELLS + b] !== Infinity) continue;
        dist[a * CELLS + b] = d + STEP;
        next.push([a, b]);
      }
    }
    queue = next;
  }
  return {
    roam: reached * STEP * STEP,
    route,
    line: Math.hypot(level.spawn[0] - goal.pos[0], level.spawn[2] - goal.pos[2]),
  };
}

// Widest machine that still gets from the spawn to the goal.
function widest(level, zoneId, kind) {
  const goal = level.zones.find((z) => z.id === zoneId);
  const open = plan(level, kind);
  const fits = (ix, iz, pad) => {
    const r = Math.round(pad / STEP);
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        const a = ix + dx;
        const b = iz + dz;
        if (a < 0 || b < 0 || a >= CELLS || b >= CELLS || !open[a][b]) return false;
      }
    }
    return true;
  };
  const reaches = (width) => {
    const pad = width / 2;
    const sx = Math.round((level.spawn[0] + HALF) / STEP);
    const sz = Math.round((level.spawn[2] + HALF) / STEP);
    if (!fits(sx, sz, pad)) return false;
    const seen = new Set([sx * CELLS + sz]);
    const queue = [[sx, sz]];
    while (queue.length) {
      const [ix, iz] = queue.pop();
      if (Math.abs(at(ix) - goal.pos[0]) <= goal.size[0] / 2
        && Math.abs(at(iz) - goal.pos[2]) <= goal.size[2] / 2) return true;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = ix + dx;
        const b = iz + dz;
        const key = a * CELLS + b;
        if (seen.has(key) || a < 0 || b < 0 || a >= CELLS || b >= CELLS) continue;
        if (!fits(a, b, pad)) continue;
        seen.add(key);
        queue.push([a, b]);
      }
    }
    return false;
  };
  let best = 0;
  for (let w = 0.5; w <= 12; w += 0.5) {
    if (reaches(w)) best = w; else break;
  }
  return best;
}

/**
 * A course built round an obstacle has to be built round it on every side.
 * Walls standing loose on an open plain are scenery: you drive round the end
 * of them, and the problem the level is about never comes up. Every one of
 * these was exactly that before it was closed in, so the check is how much
 * ground the machine can cover at all — a sealed course is a small number.
 */
describe('a course you cannot simply drive round', () => {
  const enclosed = [
    ['removals', 'out', 'the corridor and turning room'],
    ['roadworks', 'goal', 'the road with the rubble across it'],
    ['letterbox', 'goal', 'the yard either side of the slot'],
    ['maze', 'centre', 'the maze'],
  ];

  for (const [id, zone, what] of enclosed) {
    it(`keeps you inside ${what}`, () => {
      const out = survey(getLevel(id), zone, 'walls');
      expect(out.roam, `${id} lets the machine roam ${Math.round(out.roam)} m²`)
        .toBeLessThan(1200);
    });
  }
});

describe('the maze', () => {
  it('has a way through wide enough to drive', () => {
    expect(widest(getLevel('maze'), 'centre', 'walls')).toBeGreaterThanOrEqual(3);
  });

  it('is a long way round rather than a short way through', () => {
    const out = survey(getLevel('maze'), 'centre', 'walls');
    expect(out.route / out.line).toBeGreaterThan(1.5);
  });

  // Every corridor on the same measure, so nothing comes down to threading a
  // slot that no machine fits through.
  it('has no opening too narrow to mean anything', () => {
    const level = getLevel('maze');
    for (const piece of level.pieces) {
      expect(piece.size[1], 'walls you can see over').toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the ledge runner', () => {
  it('cannot be taken in a straight line', () => {
    const out = survey(getLevel('ledge-runner'), 'pad', 'floor');
    expect(out.route / out.line).toBeGreaterThan(1.3);
  });

  it('is narrow enough to need a machine built for it', () => {
    const width = widest(getLevel('ledge-runner'), 'pad', 'floor');
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(2.5);
  });
});
