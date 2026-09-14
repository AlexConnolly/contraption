import { getPart } from '../parts/registry.js';
import { groupTree } from '../core/groups.js';

/**
 * The machine as a tree you organise yourself.
 *
 * An earlier version of this grouped parts automatically — by rigid body, then
 * by type — and it was the wrong idea. Automatic grouping tells you the game's
 * view of the machine; what a builder wants is their own. "The crane arm" is
 * not a category the engine can work out, it is a decision somebody made, and
 * once it has a name it can be moved, turned, copied and put away as one thing.
 *
 * So the tree is whatever the builder dragged it into. Parts are listed one by
 * one rather than gathered by type, because forty rollers you have put in a
 * group called Bed are already one row when that group is folded, and gathering
 * them again underneath it would be answering a question nobody asked.
 *
 * One thing is still worked out rather than organised: parts the core cannot
 * reach. That is the commonest way a machine is quietly broken, no amount of
 * tidying reveals it, and it gets a row of its own at the bottom.
 */

/** A part as the panel needs it: what it is called and whether it is adrift. */
function partRow(blueprint, id, loose) {
  const placed = blueprint.get(id);
  if (!placed) return null;
  return {
    id,
    type: placed.type,
    name: getPart(placed.type)?.name ?? placed.type,
    detached: loose.has(id),
  };
}

const rows = (blueprint, ids, loose) => ids
  .map((id) => partRow(blueprint, id, loose))
  .filter(Boolean);

/**
 * The tree the panel draws.
 *
 * Pure, so what it says can be checked without a browser. `grouping` is only
 * consulted for which parts are adrift; everything else is the builder's own
 * arrangement.
 */
export function outlineOf(blueprint, grouping = null) {
  if (!blueprint) return { groups: [], ungrouped: [], detached: 0, parts: 0 };

  const loose = new Set(grouping?.disconnected ?? []);
  const tree = groupTree(blueprint);

  const walk = (nodes) => nodes.map((node) => ({
    id: node.id,
    name: node.name,
    depth: node.depth,
    // What acting on this row would take: the group and everything under it.
    ids: node.all,
    count: node.all.length,
    parts: rows(blueprint, node.parts, loose),
    // A group holding something adrift is worth marking, or the warning is
    // buried at the bottom of a folded tree.
    detached: node.all.some((id) => loose.has(id)),
    children: walk(node.children),
  }));

  return {
    groups: walk(tree.groups),
    ungrouped: rows(blueprint, tree.loose, loose),
    detached: [...loose].filter((id) => blueprint.get(id)).length,
    parts: blueprint.list().length,
  };
}

/** Every row in the tree, flattened, for anything that wants to walk it. */
export function flatten(outline) {
  const out = [];
  const walk = (groups) => {
    for (const group of groups) {
      out.push(group);
      walk(group.children);
    }
  };
  walk(outline.groups);
  return out;
}

/** A group by id, wherever it sits. */
export function findGroup(outline, id) {
  return flatten(outline).find((g) => g.id === id) ?? null;
}
