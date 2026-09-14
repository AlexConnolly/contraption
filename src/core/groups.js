/**
 * Named groups, made by hand.
 *
 * The studio can already act on several parts at once, but only on whatever is
 * selected at that moment. A group is that selection given a name and kept, so
 * "the crane arm" is a thing you can click once and move, turn, copy or throw
 * away — and still be there tomorrow.
 *
 * **A group is an editing idea, not a weld.** In a scene graph a parent moves
 * its children; here the physics decides what moves with what, and a group
 * spanning a hinge will still bend at that hinge the moment the run starts.
 * Grouping changes what the editor acts on and nothing else. Pretending
 * otherwise would have people group an arm, press Play and watch it fold.
 *
 * Groups nest, because a gantry is a mast and a boom and a hook and you want
 * all three to be one thing as well as three things. Nesting is the only
 * reason the format carries a parent at all — the tree is drawn from it and
 * the parts hang off the leaves.
 */

export const GROUP_LIMITS = {
  name: 40,
  groups: 200,
  depth: 8,
};

let nextGroupId = 1;

export function newGroupId() {
  nextGroupId += 1;
  return `g${nextGroupId.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const clean = (name) => String(name ?? '').trim().slice(0, GROUP_LIMITS.name);

/**
 * Where a group sits in the tree, as a list from the root down.
 *
 * Used to answer "would putting A inside B make a loop", which is the one way
 * a tree of parents can be made nonsense, and which a drag onto the wrong row
 * would otherwise do silently.
 */
export function lineageOf(groups, id) {
  const line = [];
  let at = id;
  const seen = new Set();
  while (at && groups.has(at) && !seen.has(at)) {
    seen.add(at);
    line.unshift(at);
    at = groups.get(at).parent;
  }
  return line;
}

/** Whether `id` is `maybe` or sits somewhere underneath it. */
export function isWithin(groups, id, maybe) {
  return lineageOf(groups, id).includes(maybe);
}

/** Groups directly inside this one, or the top-level ones for null. */
export function childrenOf(groups, parent = null) {
  return [...groups.values()].filter((g) => (g.parent ?? null) === (parent ?? null));
}

/**
 * The parts in a group.
 *
 * `deep` walks the groups inside it as well, which is what every operation
 * wants: moving the gantry moves the boom and the hook with it. The shallow
 * answer is only for drawing a row's own count.
 */
export function partsOfGroup(blueprint, id, { deep = true } = {}) {
  const wanted = new Set([id]);
  if (deep) {
    // Breadth-first rather than recursive: a hand-edited file could name a
    // parent that loops, and a walk with a seen-set cannot hang on it.
    const queue = [id];
    while (queue.length) {
      for (const child of childrenOf(blueprint.groups, queue.shift())) {
        if (wanted.has(child.id)) continue;
        wanted.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return blueprint.list().filter((p) => p.group && wanted.has(p.group)).map((p) => p.id);
}

/** Parts belonging to no group at all. */
export function ungroupedParts(blueprint) {
  return blueprint.list()
    .filter((p) => !p.group || !blueprint.groups.has(p.group))
    .map((p) => p.id);
}

/** How deep a group sits, so nesting can be stopped before it gets silly. */
export function depthOf(groups, id) {
  return lineageOf(groups, id).length;
}

export function createGroup(blueprint, { name = 'Group', parent = null } = {}) {
  if (blueprint.groups.size >= GROUP_LIMITS.groups) {
    return { ok: false, reason: `That is as many groups as one machine can hold (${GROUP_LIMITS.groups})` };
  }
  if (parent && !blueprint.groups.has(parent)) return { ok: false, reason: 'No such group' };
  if (parent && depthOf(blueprint.groups, parent) >= GROUP_LIMITS.depth) {
    return { ok: false, reason: 'Groups are nested as deep as they go' };
  }
  const id = newGroupId();
  blueprint.groups.set(id, { id, name: clean(name) || 'Group', parent: parent ?? null });
  return { ok: true, id, group: blueprint.groups.get(id) };
}

export function renameGroup(blueprint, id, name) {
  const group = blueprint.groups.get(id);
  if (!group) return { ok: false, reason: 'No such group' };
  const wanted = clean(name);
  if (!wanted) return { ok: false, reason: 'A group needs a name' };
  group.name = wanted;
  return { ok: true, group };
}

/**
 * Moves a group under another, or out to the top level.
 *
 * Refuses to put a group inside itself or inside one of its own descendants,
 * which is the drag everybody tries once and which would otherwise detach that
 * whole branch from the tree and lose it.
 */
export function setGroupParent(blueprint, id, parent = null) {
  const group = blueprint.groups.get(id);
  if (!group) return { ok: false, reason: 'No such group' };
  if (parent === id) return { ok: false, reason: 'A group cannot hold itself' };
  if (parent && !blueprint.groups.has(parent)) return { ok: false, reason: 'No such group' };
  if (parent && isWithin(blueprint.groups, parent, id)) {
    return { ok: false, reason: 'That would put a group inside itself' };
  }
  if (parent && depthOf(blueprint.groups, parent) >= GROUP_LIMITS.depth) {
    return { ok: false, reason: 'Groups are nested as deep as they go' };
  }
  group.parent = parent ?? null;
  return { ok: true, group };
}

/**
 * Puts parts in a group, or takes them out of every group when given null.
 *
 * A part is in one group at a time. Belonging to two would mean a move could
 * be asked for twice from different rows and the second would find the part
 * already somewhere else.
 */
export function setGroupOf(blueprint, ids, groupId) {
  if (groupId && !blueprint.groups.has(groupId)) return { ok: false, reason: 'No such group' };
  let moved = 0;
  for (const id of ids ?? []) {
    const placed = blueprint.get(id);
    if (!placed) continue;
    placed.group = groupId ?? null;
    moved += 1;
  }
  return { ok: moved > 0, moved };
}

/**
 * Deletes the group, not the parts.
 *
 * Everything in it is handed to whatever held it, so dissolving a group in the
 * middle of a tree does not drop a branch out to the top level. Deleting the
 * parts is a different action and has its own key.
 */
export function dissolveGroup(blueprint, id) {
  const group = blueprint.groups.get(id);
  if (!group) return { ok: false, reason: 'No such group' };
  const up = group.parent ?? null;
  for (const child of childrenOf(blueprint.groups, id)) child.parent = up;
  for (const placed of blueprint.list()) {
    if (placed.group === id) placed.group = up;
  }
  blueprint.groups.delete(id);
  return { ok: true, into: up };
}

/** The tree, ready to draw: groups in order with their parts hanging off. */
export function groupTree(blueprint) {
  const build = (parent, depth) => childrenOf(blueprint.groups, parent)
    .map((group) => {
      const own = blueprint.list().filter((p) => p.group === group.id).map((p) => p.id);
      const children = depth < GROUP_LIMITS.depth ? build(group.id, depth + 1) : [];
      return {
        id: group.id,
        name: group.name,
        depth,
        parts: own,
        // What a move or a turn would actually take, which is this group and
        // everything nested under it.
        all: partsOfGroup(blueprint, group.id),
        children,
      };
    });
  return { groups: build(null, 0), loose: ungroupedParts(blueprint) };
}

/**
 * Cleans groups off something that arrived from outside — a share code, a
 * saved file, a pack. Loops, missing parents and silly depths are all made
 * harmless rather than refused, on the same reasoning as every other
 * sanitiser here: a mangled machine should be an odd machine, not a broken
 * game.
 */
export function sanitiseGroups(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, GROUP_LIMITS.groups) : [];
  const groups = new Map();
  for (const entry of list) {
    const id = String(entry?.id ?? '').slice(0, 40);
    if (!id || groups.has(id)) continue;
    groups.set(id, {
      id,
      name: clean(entry?.name) || 'Group',
      parent: entry?.parent ? String(entry.parent).slice(0, 40) : null,
    });
  }
  // A parent that is not here, or that leads back round to the group itself,
  // becomes no parent: the group surfaces at the top rather than vanishing.
  for (const group of groups.values()) {
    if (group.parent && !groups.has(group.parent)) group.parent = null;
  }
  for (const group of groups.values()) {
    if (group.parent && isWithin(groups, group.parent, group.id)) group.parent = null;
  }
  return groups;
}
