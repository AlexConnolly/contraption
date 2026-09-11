/**
 * What a thing in the world *is*, as a number a sensor can read back.
 *
 * Sorting one crate from another needs the machine to tell them apart, and a
 * colour-sensing part for that would be a whole new thing to build, explain
 * and balance for one job. Instead the distance sensor already pointed at the
 * crate says what it hit, and the level decides what the numbers mean.
 *
 * Kept here rather than on the collider because Rapier's JS colliders carry
 * no room for anything of ours, and here rather than on the arena because the
 * machine does the looking and knows nothing about the arena.
 *
 * Keyed by world as well as by handle. Handles are only unique inside one
 * world and start again from zero in the next, so a single flat map hands the
 * next arena the last one's answers — which is exactly what happened the
 * first time this was written.
 */
const byWorld = new WeakMap();

function tableFor(world, make = false) {
  let table = byWorld.get(world);
  if (!table && make) {
    table = new Map();
    byWorld.set(world, table);
  }
  return table;
}

export function setTag(world, collider, tag) {
  if (!world || !collider) return;
  if (typeof tag !== 'number' || tag === 0) return;
  tableFor(world, true).set(collider.handle, tag);
}

export function tagOf(world, collider) {
  if (!world || !collider) return 0;
  return tableFor(world)?.get(collider.handle) ?? 0;
}

/**
 * Handles are handed out again after a body is removed, so anything that
 * tagged a collider has to untag it when it goes — otherwise the next thing
 * to take that handle inherits a label it was never given.
 */
export function clearTag(world, collider) {
  if (!world || !collider) return;
  tableFor(world)?.delete(collider.handle);
}
