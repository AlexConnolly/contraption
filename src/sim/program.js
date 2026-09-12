import * as THREE from 'three';

export const KINDS = ['number', 'bool', 'vec3'];

const ZERO = () => new THREE.Vector3();

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function bool(value) {
  return value === true || (typeof value === 'number' && value > 0.5);
}

function vec(value) {
  return value instanceof THREE.Vector3 ? value : ZERO();
}

export function defaultValue(kind) {
  if (kind === 'vec3') return ZERO();
  if (kind === 'bool') return false;
  return 0;
}

const MATH_OPS = {
  add: (a, b) => a + b,
  subtract: (a, b) => a - b,
  multiply: (a, b) => a * b,
  divide: (a, b) => (Math.abs(b) < 1e-9 ? 0 : a / b),
  min: Math.min,
  max: Math.max,
  abs: (a) => Math.abs(a),
  clamp: (a, b) => Math.max(-Math.abs(b), Math.min(Math.abs(b), a)),
  // Shortest way round from heading a to heading b, in degrees, so steering
  // toward a bearing does not take the long way at the wrap point.
  angleDelta: (a, b) => ((((b - a) % 360) + 540) % 360) - 180,
};

const COMPARE_OPS = {
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  eq: (a, b) => Math.abs(a - b) < 1e-6,
  neq: (a, b) => Math.abs(a - b) >= 1e-6,
};

const LOGIC_OPS = {
  and: (a, b) => a && b,
  or: (a, b) => a || b,
  not: (a) => !a,
};

/**
 * Every node kind the editor can place. `inputs` and `outputs` are the sockets
 * a node shows; `evaluate` turns the values arriving at its inputs into the
 * values leaving its outputs.
 *
 * `read`, `write`, `waypoint` and `timer` are the nodes that touch the world,
 * and they go through the context the runtime hands in rather than reaching
 * for anything themselves, which is what keeps this file testable on its own.
 */
export const NODE_TYPES = {
  constant: {
    name: 'Constant',
    group: 'value',
    inputs: () => [],
    outputs: (node) => [{ id: 'value', name: 'Value', kind: node.config.kind ?? 'number' }],
    evaluate: (node) => {
      const kind = node.config.kind ?? 'number';
      if (kind === 'vec3') {
        const v = node.config.vector ?? [0, 0, 0];
        return { value: new THREE.Vector3(v[0], v[1], v[2]) };
      }
      if (kind === 'bool') return { value: Boolean(node.config.value) };
      return { value: num(node.config.value) };
    },
  },

  read: {
    name: 'Read module',
    group: 'module',
    inputs: () => [],
    outputs: (node, ctx) => {
      const port = ctx.port(node.config.partId, 'out', node.config.port);
      return [{ id: 'value', name: port?.name ?? 'Value', kind: port?.kind ?? 'number' }];
    },
    evaluate: (node, _inputs, ctx) => ({
      value: ctx.readPort(node.config.partId, node.config.port),
    }),
  },

  write: {
    name: 'Write module',
    group: 'module',
    inputs: (node, ctx) => {
      const port = ctx.port(node.config.partId, 'in', node.config.port);
      return [{ id: 'value', name: port?.name ?? 'Value', kind: port?.kind ?? 'number' }];
    },
    outputs: () => [],
    evaluate: (node, inputs, ctx) => {
      ctx.writePort(node.config.partId, node.config.port, inputs.value);
      return {};
    },
  },

  waypoint: {
    name: 'Waypoint',
    group: 'value',
    inputs: () => [],
    outputs: () => [{ id: 'position', name: 'Position', kind: 'vec3' }],
    evaluate: (node, _inputs, ctx) => ({ position: ctx.waypoint(node.config.zone) }),
  },

  vector: {
    name: 'Vector',
    group: 'maths',
    inputs: () => [
      { id: 'x', name: 'X', kind: 'number' },
      { id: 'y', name: 'Y', kind: 'number' },
      { id: 'z', name: 'Z', kind: 'number' },
    ],
    outputs: () => [{ id: 'v', name: 'Vector', kind: 'vec3' }],
    evaluate: (_node, inputs) => ({
      v: new THREE.Vector3(num(inputs.x), num(inputs.y), num(inputs.z)),
    }),
  },

  split: {
    name: 'Split vector',
    group: 'maths',
    inputs: () => [{ id: 'v', name: 'Vector', kind: 'vec3' }],
    outputs: () => [
      { id: 'x', name: 'X', kind: 'number' },
      { id: 'y', name: 'Y', kind: 'number' },
      { id: 'z', name: 'Z', kind: 'number' },
    ],
    evaluate: (_node, inputs) => {
      const v = vec(inputs.v);
      return { x: v.x, y: v.y, z: v.z };
    },
  },

  distance: {
    name: 'Distance',
    group: 'maths',
    inputs: () => [
      { id: 'a', name: 'From', kind: 'vec3' },
      { id: 'b', name: 'To', kind: 'vec3' },
    ],
    outputs: () => [
      { id: 'd', name: 'Distance', kind: 'number' },
      { id: 'flat', name: 'Flat distance', kind: 'number' },
    ],
    evaluate: (_node, inputs) => {
      const a = vec(inputs.a);
      const b = vec(inputs.b);
      return {
        d: a.distanceTo(b),
        flat: Math.hypot(b.x - a.x, b.z - a.z),
      };
    },
  },

  closing: {
    name: 'Closing speed',
    group: 'maths',
    inputs: () => [
      { id: 'velocity', name: 'Velocity', kind: 'vec3' },
      { id: 'from', name: 'From', kind: 'vec3' },
      { id: 'to', name: 'To', kind: 'vec3' },
    ],
    outputs: () => [{ id: 'speed', name: 'Closing speed', kind: 'number' }],
    // Signed: positive while getting nearer, negative while getting further
    // away. Plain speed is a magnitude and cannot tell the difference, which
    // makes it useless for holding an approach.
    evaluate: (_node, inputs) => {
      const direction = vec(inputs.to).clone().sub(vec(inputs.from));
      if (direction.lengthSq() < 1e-9) return { speed: 0 };
      return { speed: vec(inputs.velocity).dot(direction.normalize()) };
    },
  },

  bearing: {
    name: 'Bearing',
    group: 'maths',
    inputs: () => [
      { id: 'a', name: 'From', kind: 'vec3' },
      { id: 'b', name: 'To', kind: 'vec3' },
    ],
    outputs: () => [{ id: 'deg', name: 'Bearing', kind: 'number' }],
    evaluate: (_node, inputs) => {
      const a = vec(inputs.a);
      const b = vec(inputs.b);
      return { deg: (Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI };
    },
  },

  maths: {
    name: 'Maths',
    group: 'maths',
    ops: Object.keys(MATH_OPS),
    inputs: () => [
      { id: 'a', name: 'A', kind: 'number' },
      { id: 'b', name: 'B', kind: 'number' },
    ],
    outputs: () => [{ id: 'r', name: 'Result', kind: 'number' }],
    evaluate: (node, inputs) => {
      const op = MATH_OPS[node.config.op] ?? MATH_OPS.add;
      return { r: num(op(num(inputs.a), num(inputs.b))) };
    },
  },

  compare: {
    name: 'Compare',
    group: 'logic',
    ops: Object.keys(COMPARE_OPS),
    inputs: () => [
      { id: 'a', name: 'A', kind: 'number' },
      { id: 'b', name: 'B', kind: 'number' },
    ],
    outputs: () => [{ id: 'r', name: 'Result', kind: 'bool' }],
    evaluate: (node, inputs) => {
      const op = COMPARE_OPS[node.config.op] ?? COMPARE_OPS.lt;
      return { r: op(num(inputs.a), num(inputs.b)) };
    },
  },

  logic: {
    name: 'Logic',
    group: 'logic',
    ops: Object.keys(LOGIC_OPS),
    // `not` has one operand. Showing it a second socket that is silently
    // ignored is an invitation to wire something into nothing.
    inputs: (node) => (node.config.op === 'not'
      ? [{ id: 'a', name: 'Value', kind: 'bool' }]
      : [
        { id: 'a', name: 'A', kind: 'bool' },
        { id: 'b', name: 'B', kind: 'bool' },
      ]),
    outputs: () => [{ id: 'r', name: 'Result', kind: 'bool' }],
    evaluate: (node, inputs) => {
      const op = LOGIC_OPS[node.config.op] ?? LOGIC_OPS.and;
      return { r: Boolean(op(bool(inputs.a), bool(inputs.b))) };
    },
  },

  select: {
    name: 'Select',
    group: 'logic',
    inputs: () => [
      { id: 'when', name: 'When', kind: 'bool' },
      { id: 'a', name: 'Then', kind: 'number' },
      { id: 'b', name: 'Else', kind: 'number' },
    ],
    outputs: () => [{ id: 'r', name: 'Result', kind: 'number' }],
    evaluate: (_node, inputs) => ({
      r: bool(inputs.when) ? num(inputs.a) : num(inputs.b),
    }),
  },

  timer: {
    name: 'Timer',
    group: 'value',
    inputs: () => [],
    outputs: () => [{ id: 'seconds', name: 'Seconds in state', kind: 'number' }],
    evaluate: (_node, _inputs, ctx) => ({ seconds: ctx.stateSeconds() }),
  },

  goto: {
    name: 'Go to state',
    group: 'flow',
    inputs: () => [{ id: 'when', name: 'When', kind: 'bool' }],
    outputs: () => [],
    evaluate: (node, inputs, ctx) => {
      if (bool(inputs.when)) ctx.requestState(node.config.state);
      return {};
    },
  },
};

export function nodeInputs(node, ctx) {
  return NODE_TYPES[node.type]?.inputs(node, ctx) ?? [];
}

export function nodeOutputs(node, ctx) {
  return NODE_TYPES[node.type]?.outputs(node, ctx) ?? [];
}

export function emptyProgram() {
  const id = 'state1';
  return {
    version: 1,
    start: id,
    states: [{ id, name: 'Start', nodes: [], links: [] }],
  };
}

let nextId = 1;
export function makeId(prefix) {
  nextId += 1;
  return `${prefix}${nextId}`;
}

/**
 * Orders a state's nodes so that every node is evaluated after the nodes
 * feeding it. Anything caught in a cycle is reported rather than evaluated,
 * so a loop shows up as an error the player can see instead of a value that
 * is quietly one tick stale.
 */
export function sortNodes(state) {
  const byId = new Map(state.nodes.map((node) => [node.id, node]));
  const feeders = new Map(state.nodes.map((node) => [node.id, new Set()]));
  for (const link of state.links) {
    if (byId.has(link.to.node) && byId.has(link.from.node)) {
      feeders.get(link.to.node).add(link.from.node);
    }
  }

  const order = [];
  const settled = new Set();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const node of state.nodes) {
      if (settled.has(node.id)) continue;
      const waiting = [...feeders.get(node.id)].some((id) => !settled.has(id));
      if (waiting) continue;
      settled.add(node.id);
      order.push(node);
      progressed = true;
    }
  }
  const cyclic = state.nodes.filter((node) => !settled.has(node.id)).map((n) => n.id);
  return { order, cyclic };
}

/**
 * Runs a program: one state at a time, its graph evaluated once per tick in
 * dependency order. A `Go to` node whose condition holds hands over to another
 * state, and the first one to fire wins.
 */
export class ProgramRunner {
  constructor(program) {
    this.program = program;
    this.reset();
  }

  reset() {
    this.stateId = this.program.start ?? this.program.states[0]?.id ?? null;
    this.elapsed = 0;
    this.values = new Map();
    this.errors = [];
  }

  state() {
    return this.program.states.find((s) => s.id === this.stateId)
      ?? this.program.states[0]
      ?? null;
  }

  tick(dt, ctx) {
    const state = this.state();
    this.errors = [];
    if (!state) return { state: null, errors: ['No states in the program'] };
    this.elapsed += dt;

    let requested = null;
    const inner = {
      ...ctx,
      stateSeconds: () => this.elapsed,
      requestState: (id) => {
        if (requested === null && id && id !== this.stateId) requested = id;
      },
    };

    const { order, cyclic } = sortNodes(state);
    if (cyclic.length > 0) {
      this.errors.push(`${cyclic.length} node(s) are wired in a loop and were skipped`);
    }

    const values = new Map();
    for (const node of order) {
      const type = NODE_TYPES[node.type];
      if (!type) continue;
      const inputs = {};
      for (const socket of type.inputs(node, ctx)) {
        const link = state.links.find(
          (l) => l.to.node === node.id && l.to.port === socket.id,
        );
        inputs[socket.id] = link
          ? values.get(`${link.from.node}:${link.from.port}`) ?? defaultValue(socket.kind)
          : defaultValue(socket.kind);
      }
      const outputs = type.evaluate(node, inputs, inner) ?? {};
      for (const [port, value] of Object.entries(outputs)) {
        values.set(`${node.id}:${port}`, value);
      }
    }
    this.values = values;

    if (requested) {
      this.stateId = requested;
      this.elapsed = 0;
    }
    return { state: state.id, next: requested, errors: this.errors };
  }
}

/**
 * Faults a player can see before they run: links that cross value kinds,
 * modules that are no longer on the machine, and `Go to` nodes aimed at a
 * state that has been deleted.
 */
export function validateProgram(program, ctx) {
  const problems = [];
  const stateIds = new Set(program.states.map((s) => s.id));

  for (const state of program.states) {
    const byId = new Map(state.nodes.map((n) => [n.id, n]));
    const { cyclic } = sortNodes(state);
    if (cyclic.length > 0) {
      problems.push(`${state.name}: ${cyclic.length} node(s) wired in a loop`);
    }

    for (const node of state.nodes) {
      if (node.type === 'goto' && !stateIds.has(node.config.state)) {
        problems.push(`${state.name}: a Go to points at a state that no longer exists`);
      }
      if ((node.type === 'read' || node.type === 'write') && !ctx.hasPart(node.config.partId)) {
        problems.push(`${state.name}: a ${NODE_TYPES[node.type].name} points at a part that is gone`);
      }
    }

    for (const link of state.links) {
      const from = byId.get(link.from.node);
      const to = byId.get(link.to.node);
      if (!from || !to) continue;
      const out = nodeOutputs(from, ctx).find((p) => p.id === link.from.port);
      const into = nodeInputs(to, ctx).find((p) => p.id === link.to.port);
      if (out && into && out.kind !== into.kind) {
        problems.push(`${state.name}: a ${out.kind} is wired into a ${into.kind}`);
      }
    }

    // A value that feeds nothing changes nothing. Reading three sensors into a
    // chain of logic and stopping there is the commonest way to write a
    // program that looks finished and does not do anything at all.
    const feeds = new Set(state.links.map((link) => link.from.node));
    for (const node of state.nodes) {
      if (nodeOutputs(node, ctx).length === 0) continue;
      if (feeds.has(node.id)) continue;
      problems.push(`${state.name}: a ${NODE_TYPES[node.type].name} is wired to nothing`);
    }

    // Something has to drive a part or change the state, or the state is a
    // dead stop however much is wired up inside it.
    if (!state.nodes.some((n) => n.type === 'write' || n.type === 'goto')) {
      problems.push(`${state.name}: nothing here drives a part or changes state`);
    }
  }

  // States nothing can ever reach. Adding a state and never wiring a Go to it
  // leaves it sitting there looking like part of the program.
  const reached = new Set([program.start ?? program.states[0]?.id]);
  let growing = true;
  while (growing) {
    growing = false;
    for (const state of program.states) {
      if (!reached.has(state.id)) continue;
      for (const node of state.nodes) {
        if (node.type !== 'goto' || reached.has(node.config.state)) continue;
        if (!stateIds.has(node.config.state)) continue;
        reached.add(node.config.state);
        growing = true;
      }
    }
  }
  for (const state of program.states) {
    if (!reached.has(state.id)) problems.push(`${state.name}: no Go to ever reaches this state`);
  }
  return problems;
}

/**
 * Lays a state out in columns by how far each node is from a source, so
 * values flow left to right and nothing sits on top of anything else. Used
 * both by the editor's tidy button and when a preset program is built.
 */
export function tidyLayout(state, options = {}) {
  const colWidth = options.colWidth ?? 290;
  const rowHeight = options.rowHeight ?? 175;
  const { order, cyclic } = sortNodes(state);

  const depth = new Map();
  for (const node of order) {
    const feeders = state.links
      .filter((link) => link.to.node === node.id)
      .map((link) => depth.get(link.from.node) ?? 0);
    depth.set(node.id, feeders.length ? Math.max(...feeders) + 1 : 0);
  }
  for (const id of cyclic) depth.set(id, 0);

  const filled = new Map();
  for (const node of state.nodes) {
    const column = depth.get(node.id) ?? 0;
    const row = filled.get(column) ?? 0;
    node.x = column * colWidth;
    node.y = row * rowHeight;
    filled.set(column, row + 1);
  }
  return state;
}
