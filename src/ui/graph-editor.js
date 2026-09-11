import { getPart, findPort, portsOf } from '../parts/registry.js';
import {
  NODE_TYPES, nodeInputs, nodeOutputs, makeId, validateProgram, emptyProgram, tidyLayout,
} from '../sim/program.js';

const NODE_WIDTH = 196;
const HEADER = 26;
const ROW = 22;
const PAD = 6;

const GROUP_LABEL = {
  module: 'Modules',
  value: 'Values',
  maths: 'Maths',
  logic: 'Logic',
  flow: 'Flow',
};

const OP_LABEL = {
  add: '+', subtract: '−', multiply: '×', divide: '÷',
  min: 'min', max: 'max', abs: '|a|', clamp: 'clamp', angleDelta: 'angle to',
  lt: '<', lte: '≤', gt: '>', gte: '≥', eq: '=', neq: '≠',
  and: 'and', or: 'or', not: 'not',
};

const KIND_COLOUR = { number: '#4ea1ff', bool: '#4ade80', vec3: '#ffb347' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function socketY(index) {
  return HEADER + PAD + index * ROW + ROW / 2;
}

/**
 * The node editor for a computer's program: one canvas per state, nodes you
 * drag about, and links you pull from an output socket to an input socket.
 *
 * Node geometry is fixed rather than measured, so a link's endpoints can be
 * worked out from the node position and the socket index alone and never go
 * out of step with what is on screen.
 */
export class GraphEditor {
  constructor({ onChange, onClose }) {
    this.onChange = onChange ?? (() => {});
    this.onClose = onClose ?? (() => {});
    this.view = { x: 40, y: 40, scale: 1 };
    this.selected = null;
    this.pending = null;
    this.build();
  }

  build() {
    this.root = el('div', 'graph-root');
    this.root.hidden = true;

    const bar = el('div', 'graph-bar');
    this.title = el('div', 'graph-title', 'Program');
    this.problems = el('div', 'graph-problems');
    const tidy = el('button', 'ghost', 'Tidy');
    tidy.title = 'Lay this state out in columns';
    tidy.addEventListener('click', () => {
      tidyLayout(this.state());
      this.changed();
    });
    const close = el('button', 'primary', 'Done');
    close.addEventListener('click', () => this.close());
    bar.append(this.title, el('div', 'spacer'), this.problems, tidy, close);

    this.stateList = el('div', 'graph-states');
    this.paletteEl = el('div', 'graph-palette');

    this.canvas = el('div', 'graph-canvas');
    this.content = el('div', 'graph-content');
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'graph-links');
    this.nodeLayer = el('div', 'graph-nodes');
    this.content.append(this.svg, this.nodeLayer);
    this.canvas.append(this.content);

    const side = el('aside', 'graph-side');
    side.append(el('div', 'panel-title', 'States'), this.stateList,
      el('div', 'panel-title', 'Add node'), this.paletteEl);

    this.root.append(bar, side, this.canvas);
    document.body.append(this.root);
    this.wireCanvas();
  }

  // ------------------------------------------------------------- open / close

  open({ program, blueprint, level, name }) {
    this.blueprint = blueprint;
    this.level = level;
    this.program = program ?? emptyProgram();
    this.stateId = this.program.start ?? this.program.states[0]?.id;
    this.title.textContent = name ?? 'Program';
    this.root.hidden = false;
    this.buildPalette();
    this.render();
  }

  close() {
    this.root.hidden = true;
    this.onClose();
  }

  get isOpen() {
    return !this.root.hidden;
  }

  state() {
    return this.program.states.find((s) => s.id === this.stateId) ?? this.program.states[0];
  }

  context() {
    return {
      port: (partId, direction, id) => {
        const placed = this.blueprint.get(partId);
        return placed ? findPort(getPart(placed.type), direction, id) : null;
      },
      hasPart: (partId) => Boolean(this.blueprint.get(partId)),
      readPort: () => 0,
      writePort: () => {},
      waypoint: () => null,
    };
  }

  changed() {
    this.onChange(this.program);
    this.render();
  }

  // --------------------------------------------------------------- canvas move

  wireCanvas() {
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.target !== this.canvas && event.target !== this.content) return;
      this.select(null);
      this.startPan(event);
    });

    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.max(0.35, Math.min(2, this.view.scale * factor));
      const ratio = next / this.view.scale;
      this.view.x = px - (px - this.view.x) * ratio;
      this.view.y = py - (py - this.view.y) * ratio;
      this.view.scale = next;
      this.applyView();
    }, { passive: false });
  }

  startPan(event) {
    const origin = { x: event.clientX, y: event.clientY, vx: this.view.x, vy: this.view.y };
    const move = (e) => {
      this.view.x = origin.vx + (e.clientX - origin.x);
      this.view.y = origin.vy + (e.clientY - origin.y);
      this.applyView();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  applyView() {
    const { x, y, scale } = this.view;
    this.content.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  toContent(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - this.view.x) / this.view.scale,
      y: (event.clientY - rect.top - this.view.y) / this.view.scale,
    };
  }

  // ------------------------------------------------------------------ palette

  buildPalette() {
    this.paletteEl.innerHTML = '';
    const groups = new Map();
    for (const [id, type] of Object.entries(NODE_TYPES)) {
      if (!groups.has(type.group)) groups.set(type.group, []);
      groups.get(type.group).push({ id, type });
    }
    for (const [group, items] of groups) {
      this.paletteEl.append(el('div', 'graph-group', GROUP_LABEL[group] ?? group));
      for (const { id, type } of items) {
        const button = el('button', 'graph-add', type.name);
        button.addEventListener('click', () => this.addNode(id));
        this.paletteEl.append(button);
      }
    }
  }

  addNode(type) {
    const state = this.state();
    const node = {
      id: makeId('n'),
      type,
      config: this.defaultsFor(type),
      x: Math.round((-this.view.x + 260) / this.view.scale),
      y: Math.round((-this.view.y + 140) / this.view.scale),
    };
    state.nodes.push(node);
    this.select(node.id);
    this.changed();
  }

  defaultsFor(type) {
    if (type === 'constant') return { kind: 'number', value: 0, vector: [0, 0, 0] };
    if (type === 'maths') return { op: 'add' };
    if (type === 'compare') return { op: 'lt' };
    if (type === 'logic') return { op: 'and' };
    if (type === 'goto') return { state: this.program.states.find((s) => s.id !== this.stateId)?.id };
    if (type === 'waypoint') return { zone: this.level?.zones?.[0]?.id };
    if (type === 'read') {
      const first = this.modulesWith('out')[0];
      return { partId: first?.id, port: portsOf(getPart(first?.type ?? 'gps'), 'out')[0]?.id };
    }
    if (type === 'write') {
      const first = this.modulesWith('in')[0];
      return { partId: first?.id, port: portsOf(getPart(first?.type ?? 'wheel'), 'in')[0]?.id };
    }
    return {};
  }

  modulesWith(direction) {
    return this.blueprint.list().filter((p) => portsOf(getPart(p.type), direction).length > 0);
  }

  moduleLabel(placed) {
    const part = getPart(placed.type);
    const same = this.blueprint.list().filter((p) => p.type === placed.type);
    const index = same.indexOf(placed) + 1;
    return same.length > 1 ? `${part.name} ${index}` : part.name;
  }

  // ------------------------------------------------------------------- states

  renderStates() {
    this.stateList.innerHTML = '';
    for (const state of this.program.states) {
      const row = el('div', 'graph-state');
      if (state.id === this.stateId) row.classList.add('active');
      if (state.id === this.program.start) row.classList.add('start');

      const open = el('button', 'graph-state-name', state.name);
      open.addEventListener('click', () => {
        this.stateId = state.id;
        this.select(null);
        this.render();
      });
      open.addEventListener('dblclick', () => {
        const name = prompt('State name', state.name);
        if (name) {
          state.name = name.slice(0, 24);
          this.changed();
        }
      });

      const start = el('button', 'graph-icon', '▶');
      start.title = 'Start in this state';
      start.addEventListener('click', () => {
        this.program.start = state.id;
        this.changed();
      });

      const remove = el('button', 'graph-icon', '✕');
      remove.title = 'Delete state';
      remove.addEventListener('click', () => this.deleteState(state.id));

      row.append(open, start, remove);
      this.stateList.append(row);
    }

    const add = el('button', 'graph-add', '+ New state');
    add.addEventListener('click', () => {
      const id = makeId('s');
      this.program.states.push({
        id, name: `State ${this.program.states.length + 1}`, nodes: [], links: [],
      });
      this.stateId = id;
      this.changed();
    });
    this.stateList.append(add);
  }

  deleteState(id) {
    if (this.program.states.length <= 1) return;
    this.program.states = this.program.states.filter((s) => s.id !== id);
    if (this.program.start === id) this.program.start = this.program.states[0].id;
    if (this.stateId === id) this.stateId = this.program.states[0].id;
    this.changed();
  }

  // -------------------------------------------------------------------- nodes

  select(id) {
    this.selected = id;
    for (const node of this.nodeLayer.children) {
      node.classList.toggle('selected', node.dataset.id === id);
    }
  }

  deleteNode(id) {
    const state = this.state();
    state.nodes = state.nodes.filter((n) => n.id !== id);
    state.links = state.links.filter((l) => l.from.node !== id && l.to.node !== id);
    if (this.selected === id) this.selected = null;
    this.changed();
  }

  // Links whose socket has gone — because a module node was pointed somewhere
  // else — are dropped rather than left dangling.
  pruneLinks() {
    const state = this.state();
    const ctx = this.context();
    const byId = new Map(state.nodes.map((n) => [n.id, n]));
    state.links = state.links.filter((link) => {
      const from = byId.get(link.from.node);
      const to = byId.get(link.to.node);
      if (!from || !to) return false;
      const out = nodeOutputs(from, ctx).some((p) => p.id === link.from.port);
      const into = nodeInputs(to, ctx).some((p) => p.id === link.to.port);
      return out && into;
    });
  }

  render() {
    this.pruneLinks();
    this.renderStates();
    this.renderNodes();
    this.renderLinks();
    this.applyView();
    const problems = validateProgram(this.program, this.context());
    this.problems.textContent = problems.length
      ? `${problems.length} problem${problems.length === 1 ? '' : 's'}: ${problems[0]}`
      : '';
    this.problems.classList.toggle('bad', problems.length > 0);
  }

  renderNodes() {
    const ctx = this.context();
    this.nodeLayer.innerHTML = '';
    for (const node of this.state().nodes) {
      const type = NODE_TYPES[node.type];
      if (!type) continue;
      const inputs = type.inputs(node, ctx);
      const outputs = type.outputs(node, ctx);

      const box = el('div', 'graph-node');
      box.dataset.id = node.id;
      box.style.left = `${node.x}px`;
      box.style.top = `${node.y}px`;
      box.style.width = `${NODE_WIDTH}px`;
      if (node.id === this.selected) box.classList.add('selected');

      const head = el('div', 'graph-node-head', this.headingFor(node, type));
      head.addEventListener('pointerdown', (event) => this.dragNode(event, node));
      box.append(head);

      const rows = el('div', 'graph-rows');
      inputs.forEach((port, index) => rows.append(this.socketRow(node, port, index, 'in')));
      outputs.forEach((port, index) => {
        rows.append(this.socketRow(node, port, inputs.length + index, 'out'));
      });
      box.append(rows);

      const config = this.configFor(node);
      if (config) box.append(config);

      const remove = el('button', 'graph-node-x', '✕');
      remove.addEventListener('click', () => this.deleteNode(node.id));
      box.append(remove);

      box.addEventListener('pointerdown', () => this.select(node.id));
      this.nodeLayer.append(box);
    }
  }

  headingFor(node, type) {
    if (node.type === 'read' || node.type === 'write') {
      const placed = this.blueprint.get(node.config.partId);
      return placed ? `${node.type === 'read' ? 'Read' : 'Write'} ${this.moduleLabel(placed)}` : type.name;
    }
    if (node.config.op) return `${type.name} ${OP_LABEL[node.config.op] ?? node.config.op}`;
    return type.name;
  }

  socketRow(node, port, index, direction) {
    const row = el('div', `graph-row ${direction}`);
    row.style.height = `${ROW}px`;
    const dot = el('span', 'graph-socket');
    dot.style.background = KIND_COLOUR[port.kind] ?? '#8d99a6';
    dot.title = port.kind;
    dot.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      this.startLink(event, node, port, direction);
    });
    dot.addEventListener('pointerup', (event) => {
      event.stopPropagation();
      this.finishLink(node, port, direction);
    });
    const label = el('span', 'graph-port', port.name);
    if (direction === 'in') row.append(dot, label);
    else row.append(label, dot);
    void index;
    return row;
  }

  configFor(node) {
    const wrap = el('div', 'graph-config');
    const set = (patch) => {
      Object.assign(node.config, patch);
      this.changed();
    };

    if (node.type === 'constant') {
      const kind = el('select', null);
      for (const option of ['number', 'bool', 'vec3']) {
        const item = el('option', null, option);
        item.value = option;
        kind.append(item);
      }
      kind.value = node.config.kind ?? 'number';
      kind.addEventListener('change', () => set({ kind: kind.value }));
      wrap.append(kind);

      if ((node.config.kind ?? 'number') === 'number') {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = node.config.value ?? 0;
        input.addEventListener('change', () => set({ value: Number(input.value) }));
        wrap.append(input);
      } else if (node.config.kind === 'bool') {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(node.config.value);
        input.addEventListener('change', () => set({ value: input.checked }));
        wrap.append(input);
      } else {
        const vector = [...(node.config.vector ?? [0, 0, 0])];
        for (let axis = 0; axis < 3; axis += 1) {
          const input = document.createElement('input');
          input.type = 'number';
          input.step = 'any';
          input.className = 'narrow';
          input.value = vector[axis];
          input.addEventListener('change', () => {
            vector[axis] = Number(input.value);
            set({ vector: [...vector] });
          });
          wrap.append(input);
        }
      }
      return wrap;
    }

    if (node.type === 'read' || node.type === 'write') {
      const direction = node.type === 'read' ? 'out' : 'in';
      const modules = this.modulesWith(direction);
      const part = this.select_(modules.map((p) => [p.id, this.moduleLabel(p)]),
        node.config.partId, (value) => {
          const placed = this.blueprint.get(value);
          set({ partId: value, port: portsOf(getPart(placed.type), direction)[0]?.id });
        });
      wrap.append(part);
      const placed = this.blueprint.get(node.config.partId);
      if (placed) {
        const ports = portsOf(getPart(placed.type), direction);
        wrap.append(this.select_(ports.map((p) => [p.id, p.name]), node.config.port,
          (value) => set({ port: value })));
      }
      return wrap;
    }

    if (node.type === 'waypoint') {
      const zones = this.level?.zones ?? [];
      if (zones.length === 0) return el('div', 'graph-config note', 'No markers in this level');
      wrap.append(this.select_(zones.map((z) => [z.id, z.id]), node.config.zone,
        (value) => set({ zone: value })));
      return wrap;
    }

    if (node.type === 'goto') {
      const others = this.program.states.filter((s) => s.id !== node.id);
      wrap.append(this.select_(others.map((s) => [s.id, s.name]), node.config.state,
        (value) => set({ state: value })));
      return wrap;
    }

    const ops = NODE_TYPES[node.type]?.ops;
    if (ops) {
      wrap.append(this.select_(ops.map((op) => [op, OP_LABEL[op] ?? op]), node.config.op,
        (value) => set({ op: value })));
      return wrap;
    }
    return null;
  }

  select_(options, value, onChange) {
    const select = document.createElement('select');
    for (const [id, label] of options) {
      const option = el('option', null, label);
      option.value = id;
      select.append(option);
    }
    select.value = value ?? options[0]?.[0] ?? '';
    select.addEventListener('change', () => onChange(select.value));
    select.addEventListener('pointerdown', (event) => event.stopPropagation());
    return select;
  }

  dragNode(event, node) {
    event.stopPropagation();
    this.select(node.id);
    const origin = { x: event.clientX, y: event.clientY, nx: node.x, ny: node.y };
    const box = this.nodeLayer.querySelector(`[data-id="${node.id}"]`);
    const move = (e) => {
      node.x = Math.round(origin.nx + (e.clientX - origin.x) / this.view.scale);
      node.y = Math.round(origin.ny + (e.clientY - origin.y) / this.view.scale);
      box.style.left = `${node.x}px`;
      box.style.top = `${node.y}px`;
      this.renderLinks();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.onChange(this.program);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // -------------------------------------------------------------------- links

  startLink(event, node, port, direction) {
    this.pending = { node, port, direction };
    const move = (e) => {
      this.pointer = this.toContent(e);
      this.renderLinks();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.pending = null;
      this.pointer = null;
      this.renderLinks();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  finishLink(node, port, direction) {
    const start = this.pending;
    if (!start || start.direction === direction) return;
    if (start.port.kind !== port.kind) return;
    const from = start.direction === 'out' ? start : { node, port };
    const to = start.direction === 'out' ? { node, port } : start;
    const state = this.state();
    // An input takes one link; wiring a new one replaces whatever was there.
    state.links = state.links.filter(
      (l) => !(l.to.node === to.node.id && l.to.port === to.port.id),
    );
    state.links.push({
      from: { node: from.node.id, port: from.port.id },
      to: { node: to.node.id, port: to.port.id },
    });
    this.pending = null;
    this.changed();
  }

  socketPoint(nodeId, portId, direction) {
    const ctx = this.context();
    const node = this.state().nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    const inputs = nodeInputs(node, ctx);
    const outputs = nodeOutputs(node, ctx);
    const index = direction === 'in'
      ? inputs.findIndex((p) => p.id === portId)
      : inputs.length + outputs.findIndex((p) => p.id === portId);
    if (index < 0) return null;
    return {
      x: node.x + (direction === 'in' ? 0 : NODE_WIDTH),
      y: node.y + socketY(index),
    };
  }

  renderLinks() {
    const state = this.state();
    const bounds = { w: 4000, h: 3000 };
    for (const node of state.nodes) {
      bounds.w = Math.max(bounds.w, node.x + 600);
      bounds.h = Math.max(bounds.h, node.y + 600);
    }
    this.svg.setAttribute('width', bounds.w);
    this.svg.setAttribute('height', bounds.h);
    this.svg.innerHTML = '';

    const ctx = this.context();
    for (const link of state.links) {
      const a = this.socketPoint(link.from.node, link.from.port, 'out');
      const b = this.socketPoint(link.to.node, link.to.port, 'in');
      if (!a || !b) continue;
      const source = state.nodes.find((n) => n.id === link.from.node);
      const kind = nodeOutputs(source, ctx).find((p) => p.id === link.from.port)?.kind;
      const path = this.curve(a, b, KIND_COLOUR[kind] ?? '#8d99a6');
      path.addEventListener('click', () => {
        state.links = state.links.filter((l) => l !== link);
        this.changed();
      });
      this.svg.append(path);
    }

    if (this.pending && this.pointer) {
      const anchor = this.socketPoint(
        this.pending.node.id, this.pending.port.id, this.pending.direction,
      );
      if (anchor) {
        const from = this.pending.direction === 'out' ? anchor : this.pointer;
        const to = this.pending.direction === 'out' ? this.pointer : anchor;
        this.svg.append(this.curve(from, to, '#ffd166', true));
      }
    }
  }

  curve(a, b, colour, dashed = false) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const bend = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    path.setAttribute('d', `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`);
    path.setAttribute('stroke', colour);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', '2');
    if (dashed) path.setAttribute('stroke-dasharray', '5 4');
    path.setAttribute('class', 'graph-link');
    return path;
  }
}
