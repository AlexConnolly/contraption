import { applyOrientationInverse } from '../core/orientation.js';
import { occupiedCells, key } from '../core/blueprint.js';
import { getPart, attachFaces } from '../parts/registry.js';

const DIRECTIONS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

function sameVec(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * How `placed` treats a connection through the given world-space face normal:
 * 'host' bolts it to the body it pivots against, 'rigid' fuses whatever is
 * there into its own body, and 'none' passes straight through. An articulated
 * part only connects on its attach and carry faces — otherwise a hinge that
 * brushed the chassis would weld itself solid.
 */
export function faceRole(placed, worldDir) {
  const part = getPart(placed.type);
  const local = applyOrientationInverse(placed.rot, worldDir).map(Math.round);
  if (attachFaces(part).some((f) => sameVec(f, local))) {
    return part.articulated ? 'host' : 'rigid';
  }
  if (part.carry?.some((f) => sameVec(f, local))) return 'rigid';
  return part.articulated ? 'none' : 'rigid';
}

export function findConnections(blueprint) {
  const connections = [];
  const seen = new Set();
  for (const placed of blueprint.list()) {
    for (const cell of occupiedCells(placed.type, placed.cell, placed.rot)) {
      for (const dir of DIRECTIONS) {
        const neighbourCell = [cell[0] + dir[0], cell[1] + dir[1], cell[2] + dir[2]];
        const otherId = blueprint.occupancy.get(key(neighbourCell));
        if (!otherId || otherId === placed.id) continue;
        const other = blueprint.get(otherId);
        const pairKey = placed.id < otherId
          ? `${placed.id}|${otherId}|${dir}`
          : `${otherId}|${placed.id}|${dir.map((n) => -n)}`;
        if (seen.has(pairKey)) continue;
        const roleA = faceRole(placed, dir);
        const roleB = faceRole(other, [-dir[0], -dir[1], -dir[2]]);
        if (roleA === 'none' || roleB === 'none') continue;
        seen.add(pairKey);
        connections.push({
          a: placed.id,
          b: otherId,
          dir,
          cell,
          roleA,
          roleB,
        });
      }
    }
  }
  return connections;
}
