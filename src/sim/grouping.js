import { getPart } from '../parts/registry.js';
import { findConnections } from './connectivity.js';

class UnionFind {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]));
  }

  find(id) {
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let walk = id;
    while (this.parent.get(walk) !== root) {
      const next = this.parent.get(walk);
      this.parent.set(walk, root);
      walk = next;
    }
    return root;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

/**
 * Splits a blueprint into rigid bodies. Parts bolted together become one body;
 * an articulated part starts a new body and records the joint back to its host.
 */
export function groupBlueprint(blueprint) {
  const ids = blueprint.list().map((p) => p.id);
  const uf = new UnionFind(ids);
  const connections = findConnections(blueprint);
  const jointEdges = [];

  for (const c of connections) {
    if (c.roleA === 'host' || c.roleB === 'host') {
      const childId = c.roleA === 'host' ? c.a : c.b;
      const hostId = c.roleA === 'host' ? c.b : c.a;
      const dir = c.roleA === 'host' ? c.dir : [-c.dir[0], -c.dir[1], -c.dir[2]];
      jointEdges.push({ childId, hostId, dir, cell: c.cell });
      continue;
    }
    uf.union(c.a, c.b);
  }

  const groups = new Map();
  for (const id of ids) {
    const root = uf.find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }

  const bodies = [...groups.entries()].map(([root, members], index) => ({
    index,
    root,
    members,
    isRoot: false,
  }));
  const bodyOfPart = new Map();
  for (const body of bodies) {
    for (const id of body.members) bodyOfPart.set(id, body.index);
  }

  // One joint per articulated part: the first host connection wins.
  const joints = [];
  const jointed = new Set();
  for (const edge of jointEdges) {
    if (jointed.has(edge.childId)) continue;
    const childBody = bodyOfPart.get(edge.childId);
    const hostBody = bodyOfPart.get(edge.hostId);
    if (childBody === hostBody) continue;
    jointed.add(edge.childId);
    joints.push({
      partId: edge.childId,
      type: getPart(blueprint.get(edge.childId).type).joint,
      childBody,
      hostBody,
      dir: edge.dir,
      cell: edge.cell,
    });
  }

  const core = blueprint.list().find((p) => p.type === 'core');
  const rootBody = core ? bodyOfPart.get(core.id) : bodies[0]?.index ?? null;
  if (rootBody !== null && bodies[rootBody]) bodies[rootBody].isRoot = true;

  return {
    bodies,
    joints,
    bodyOfPart,
    rootBody,
    connections,
    disconnected: findDisconnected(bodies, joints, rootBody),
  };
}

function findDisconnected(bodies, joints, rootBody) {
  if (rootBody === null || rootBody === undefined) {
    return bodies.flatMap((b) => b.members);
  }
  const adjacency = new Map(bodies.map((b) => [b.index, []]));
  for (const j of joints) {
    adjacency.get(j.childBody)?.push(j.hostBody);
    adjacency.get(j.hostBody)?.push(j.childBody);
  }
  const seen = new Set([rootBody]);
  const queue = [rootBody];
  while (queue.length) {
    const current = queue.pop();
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return bodies.filter((b) => !seen.has(b.index)).flatMap((b) => b.members);
}
