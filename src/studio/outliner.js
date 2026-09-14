import { getPart } from '../parts/registry.js';

/**
 * The machine as a list you can act on, rather than a thing you have to hunt
 * around the plate with a cursor.
 *
 * The obvious outliner is every part in a flat list, and it is useless: a
 * hundred rows reading "Block" tells you nothing you could not see, and
 * finding the one you want in it is worse than clicking the model.
 *
 * So it is grouped the way the machine is actually put together. The top level
 * is rigid bodies — what is welded to what, which is the thing that decides
 * how the machine behaves and the thing you cannot see by looking. Underneath
 * each body the parts are gathered by type with a count, because "the wheels"
 * is the unit anybody means: forty rollers on a conveyor are one decision, not
 * forty, and selecting them as one is the entire point of the panel.
 *
 * Bodies are named after the joint that carries them. "On the piston" says
 * where a group of parts is and what will move it, which an index number does
 * not. The body holding the core is the chassis, and anything the chassis
 * cannot reach is called out as not attached — the studio already tints those
 * orange on the plate, and this is the same warning in words.
 */

/** A body with no joint above it and no core in it is floating free. */
const CHASSIS = 'Chassis';

function typeRows(blueprint, ids) {
  const byType = new Map();
  for (const id of ids) {
    const placed = blueprint.get(id);
    if (!placed) continue;
    if (!byType.has(placed.type)) byType.set(placed.type, []);
    byType.get(placed.type).push(id);
  }
  return [...byType.entries()]
    .map(([type, members]) => ({
      type,
      name: getPart(type)?.name ?? type,
      count: members.length,
      ids: members,
    }))
    // Most of a thing first: the row you want to act on is usually the big one.
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * The tree the panel draws.
 *
 * Pure, so what it says can be checked without a browser: given a blueprint
 * and the grouping already worked out for the meshes, this is the whole of
 * what the panel knows.
 */
export function outlineOf(blueprint, grouping) {
  if (!blueprint || !grouping) return { bodies: [], loose: null, parts: 0 };

  const loose = new Set(grouping.disconnected ?? []);
  const jointFor = new Map();
  for (const joint of grouping.joints ?? []) jointFor.set(joint.childBody, joint);

  const found = [];
  for (const body of grouping.bodies ?? []) {
    // Parts the chassis cannot reach are listed together at the bottom rather
    // than as their own little bodies, because "not attached" is one problem
    // however many islands it happens to be in.
    const attached = body.members.filter((id) => !loose.has(id));
    if (attached.length === 0) continue;

    const joint = jointFor.get(body.index);
    const carrier = joint ? blueprint.get(joint.partId) : null;
    const isRoot = body.index === grouping.rootBody;
    const types = typeRows(blueprint, attached);
    found.push({
      index: body.index,
      isRoot,
      carrier,
      count: attached.length,
      ids: attached,
      types,
      // Bodies built the same way are the same kind of thing, so they can be
      // said once. Forty rollers on a conveyor are forty separate bodies and
      // an outliner that lists them separately is the wall of identical rows
      // this panel exists to avoid.
      shape: types.map((t) => `${t.type}:${t.count}`).join('+'),
    });
  }

  const bodies = [];
  const root = found.find((b) => b.isRoot);
  if (root) {
    bodies.push({
      ...root,
      name: CHASSIS,
      bodies: 1,
      // One kind of part in the whole body is already said by the body row.
      types: root.types.length > 1 ? root.types : [],
    });
  }

  const buckets = new Map();
  for (const body of found) {
    if (body.isRoot) continue;
    if (!buckets.has(body.shape)) buckets.set(body.shape, []);
    buckets.get(body.shape).push(body);
  }
  for (const alike of buckets.values()) {
    const first = alike[0];
    const ids = alike.flatMap((b) => b.ids);
    // A body that is just its own joint is named for the part; anything else
    // is named for what carries it, because that is where it is on the machine.
    const single = first.count === 1 && first.carrier
      && first.ids[0] === first.carrier.id;
    const base = first.carrier
      ? (single ? getPart(first.carrier.type).name : `On the ${getPart(first.carrier.type).name}`)
      : 'Loose group';
    bodies.push({
      index: first.index,
      isRoot: false,
      name: alike.length > 1 ? `${base} ×${alike.length}` : base,
      via: first.carrier?.id ?? null,
      bodies: alike.length,
      count: ids.length,
      ids,
      types: first.types.length > 1 ? typeRows(blueprint, ids) : [],
    });
  }

  const looseIds = [...loose].filter((id) => blueprint.get(id));
  return {
    bodies,
    loose: looseIds.length
      ? { count: looseIds.length, ids: looseIds, types: typeRows(blueprint, looseIds) }
      : null,
    parts: blueprint.list().length,
  };
}

/** Every id a row stands for, so clicking one selects exactly what it says. */
export function idsOfRow(outline, { body = null, type = null, loose = false } = {}) {
  if (loose) {
    if (!outline.loose) return [];
    if (!type) return [...outline.loose.ids];
    return outline.loose.types.find((t) => t.type === type)?.ids ?? [];
  }
  const found = outline.bodies.find((b) => b.index === body);
  if (!found) return [];
  if (!type) return [...found.ids];
  return found.types.find((t) => t.type === type)?.ids ?? [];
}
