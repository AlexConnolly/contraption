import * as THREE from 'three';
import { Arena } from '../sim/arena.js';
import {
  sanitiseLevel, levelProblems, toShareCode, fromShareCode, LIMITS,
} from '../challenges/format.js';
import { blankLevel } from '../challenges/custom.js';

/**
 * The level builder.
 *
 * The draft is a plain level object and nothing else — the same shape the game
 * plays and `format.js` ships. Every edit rewrites that object and the course
 * is rebuilt from it through the ordinary `Arena`, so what you are looking at
 * while you build is the thing that will run when you press play. There is no
 * second representation to drift out of step with the first.
 *
 * Picking works the way the studio's does: raycast, snap, place. Handles are a
 * separate wireframe layer rather than the arena's own meshes, so selecting
 * something does not mean reaching inside the renderer.
 */

const SNAP = 0.5;
const GRID = 0.25;
// The menu background, so fog reads as distance rather than as a grey wall.
const FOG_COLOUR = 0x0b0f14;

/** What you can put down, and what it starts out as. */
export const TOOLS = [
  {
    id: 'ground',
    kind: 'pieces',
    name: 'Ground',
    note: 'Ramps, walls, ledges — anything solid.',
    make: (at) => ({ pos: at, size: [4, 1, 4], colour: 0x6b7480 }),
  },
  {
    id: 'crate',
    kind: 'props',
    name: 'Crate',
    note: 'Something to move.',
    make: (at) => ({ pos: at, size: [1.1, 1.1, 1.1], mass: 8, colour: 0xc98b4b }),
  },
  {
    id: 'ball',
    kind: 'props',
    name: 'Ball',
    note: 'Rolls. Make it big and it is a problem on its own.',
    make: (at) => ({ pos: at, radius: 0.6, mass: 6, colour: 0xd0574f, ccd: true }),
  },
  {
    id: 'zone',
    kind: 'zones',
    name: 'Goal',
    note: 'Where something has to end up.',
    make: (at) => ({ pos: at, size: [4, 2.4, 4], colour: 0x4ade80 }),
  },
  {
    id: 'keepout',
    kind: 'keepout',
    name: 'No-go',
    note: 'Somewhere the machine may not be, airspace included.',
    make: (at) => ({ pos: at, size: [6, 8, 6] }),
  },
  {
    id: 'spawn',
    kind: 'spawn',
    name: 'Start',
    note: 'Where the machine appears.',
  },
];

const HANDLE_COLOUR = { pieces: 0x6b7480, props: 0xc98b4b, zones: 0x4ade80, keepout: 0xf06a5d };

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function snap(value) {
  return Math.round(value / SNAP) * SNAP;
}

function halfHeight(item) {
  if (item.radius !== undefined) return item.radius;
  return (item.size?.[1] ?? 1) / 2;
}

/** A fresh id for a prop or zone, unique within the draft. */
function freshId(draft, kind, stem) {
  const taken = new Set([
    ...draft.props.map((p) => p.id),
    ...draft.zones.map((z) => z.id),
    ...draft.keepout.map((k) => k.id),
  ]);
  for (let n = 1; ; n += 1) {
    const id = `${stem}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Fog is a distance you can see, so a zero is how you say there is none — the
 * format carries either a fog or no fog and has no flag for off. The near edge
 * is kept inside the far one, because fog that clears before it starts is an
 * argument the renderer has to settle rather than a level.
 */
export function fogFrom(current, { near, far }) {
  const now = current ?? { near: 0, far: 0, colour: FOG_COLOUR };
  const next = {
    ...now,
    ...(near === undefined ? {} : { near }),
    ...(far === undefined ? {} : { far }),
  };
  if (!(next.far > 0)) return null;
  return { ...next, near: Math.max(0, Math.min(next.near, next.far - 1)) };
}

export class Builder {
  constructor({ RAPIER, world, scene, camera, handlers }) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.scene = scene;
    this.camera = camera;
    this.h = handlers ?? {};

    this.draft = blankLevel();
    this.tool = TOOLS[0];
    this.selected = null;
    this.open_ = false;
    this.savedId = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-2, -2);

    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);
    this.buildHelpers();
    this.buildPanel();
  }

  get isOpen() {
    return this.open_;
  }

  // ------------------------------------------------------------- 3D helpers

  buildHelpers() {
    // What the cursor lands on when it is not over anything you have placed.
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.group.add(this.floor);

    this.grid = new THREE.GridHelper(120, 120, 0x35d0e0, 0x26323f);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.25;
    this.group.add(this.grid);

    this.handles = new THREE.Group();
    this.group.add(this.handles);

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xf0a825, wireframe: true, transparent: true, opacity: 0.9 }),
    );
    this.ghost.visible = false;
    this.group.add(this.ghost);

    this.marker = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 2.4, 10),
      new THREE.MeshBasicMaterial({ color: 0x35d0e0 }),
    );
    post.position.y = 1.2;
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.6, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x35d0e0 }),
    );
    flag.position.set(0.55, 2.1, 0);
    this.marker.add(post, flag);
    this.group.add(this.marker);

    this.outline = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }),
    );
    this.outline.visible = false;
    this.group.add(this.outline);
  }

  /** Rebuilds the course and the handles from the draft. */
  refresh({ rebuildArena = true } = {}) {
    this.draft = sanitiseLevel(this.draft, { id: this.draft.id });

    if (rebuildArena) {
      this.arena?.dispose();
      this.arena = new Arena({
        RAPIER: this.RAPIER, world: this.world, scene: this.scene, level: this.draft, seed: 1,
      });
      this.arena.sync();
    }

    for (const child of [...this.handles.children]) {
      child.geometry.dispose();
      child.material.dispose();
      this.handles.remove(child);
    }

    for (const kind of ['pieces', 'props', 'zones', 'keepout']) {
      this.draft[kind].forEach((item, index) => {
        const s = item.radius !== undefined
          ? [item.radius * 2, item.radius * 2, item.radius * 2]
          : item.size;
        const handle = new THREE.Mesh(
          new THREE.BoxGeometry(s[0], s[1], s[2]),
          new THREE.MeshBasicMaterial({
            color: HANDLE_COLOUR[kind],
            wireframe: true,
            transparent: true,
            opacity: kind === 'pieces' ? 0.18 : 0.5,
          }),
        );
        handle.position.set(...item.pos);
        handle.userData = { kind, index };
        this.handles.add(handle);
      });
    }

    this.grid.position.y = this.draft.groundY + 0.02;
    this.floor.position.y = this.draft.groundY;
    this.marker.position.set(...this.draft.spawn);
    this.showSelection();
    this.renderPanel();
  }

  showSelection() {
    const item = this.selectedItem();
    if (!item) {
      this.outline.visible = false;
      return;
    }
    const s = item.radius !== undefined
      ? [item.radius * 2.1, item.radius * 2.1, item.radius * 2.1]
      : item.size.map((n) => n * 1.04);
    this.outline.geometry.dispose();
    this.outline.geometry = new THREE.BoxGeometry(s[0], s[1], s[2]);
    this.outline.position.set(...item.pos);
    this.outline.visible = true;
  }

  selectedItem() {
    if (!this.selected) return null;
    return this.draft[this.selected.kind]?.[this.selected.index] ?? null;
  }

  // ------------------------------------------------------------- interaction

  setPointer(x, y) {
    this.pointer.set(x, y);
  }

  /** Where the cursor is pointing, snapped, and what it is over. */
  pick() {
    // Three only refreshes world matrices while rendering, so without this a
    // pick taken before the first frame — or in a tab the browser has stopped
    // drawing — traces against a floor that is still standing on its edge.
    this.group.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const onHandle = this.raycaster.intersectObjects(this.handles.children, false)[0];
    const onFloor = this.raycaster.intersectObject(this.floor, false)[0];
    return {
      handle: onHandle?.object.userData ?? null,
      at: onFloor ? [snap(onFloor.point.x), this.draft.groundY, snap(onFloor.point.z)] : null,
    };
  }

  update() {
    if (!this.open_) return;
    const { at } = this.pick();
    if (!at || this.tool.kind === 'select') {
      this.ghost.visible = false;
      return;
    }
    if (this.tool.kind === 'spawn') {
      this.ghost.visible = false;
      return;
    }
    const sample = this.tool.make(at);
    const s = sample.radius !== undefined
      ? [sample.radius * 2, sample.radius * 2, sample.radius * 2]
      : sample.size;
    this.ghost.geometry.dispose();
    this.ghost.geometry = new THREE.BoxGeometry(s[0], s[1], s[2]);
    this.ghost.position.set(at[0], at[1] + halfHeight(sample), at[2]);
    this.ghost.visible = true;
  }

  click() {
    if (!this.open_) return;
    const { handle, at } = this.pick();

    if (this.tool.kind === 'select') {
      this.selected = handle;
      this.showSelection();
      this.renderPanel();
      return;
    }

    if (this.tool.kind === 'spawn') {
      if (at) {
        this.draft.spawn = [at[0], at[1] + 1, at[2]];
        this.refresh({ rebuildArena: false });
      }
      return;
    }

    if (!at) return;
    const kind = this.tool.kind;
    if (this.draft[kind].length >= LIMITS[kind]) {
      this.h.onToast?.(`That is as many ${kind} as a level can hold`, true);
      return;
    }
    const item = this.tool.make([at[0], at[1], at[2]]);
    item.pos = [at[0], at[1] + halfHeight(item), at[2]];
    if (kind !== 'pieces') item.id = freshId(this.draft, kind, this.tool.id);
    this.draft[kind].push(item);
    this.selected = { kind, index: this.draft[kind].length - 1 };
    this.refresh();
  }

  removeSelected() {
    if (!this.selected) return;
    const { kind, index } = this.selected;
    const gone = this.draft[kind][index];
    this.draft[kind].splice(index, 1);
    // An objective pointing at what just went would be dropped silently by the
    // format. Better to take it away here, where it can be said out loud.
    if (gone?.id) {
      const before = this.draft.objectives.length;
      this.draft.objectives = this.draft.objectives.filter(
        (o) => o.prop !== gone.id && o.zone !== gone.id,
      );
      const lost = before - this.draft.objectives.length;
      if (lost > 0) this.h.onToast?.(`${lost} objective(s) needed that, and went with it`);
    }
    this.selected = null;
    this.refresh();
  }

  // -------------------------------------------------------------- lifecycle

  open(level) {
    this.draft = sanitiseLevel(level ?? blankLevel(), { id: level?.id ?? 'custom' });
    this.savedId = level?.id && level.id !== 'custom' ? level.id : null;
    this.selected = null;
    this.tool = TOOLS[0];
    this.open_ = true;
    this.group.visible = true;
    this.root.hidden = false;
    this.refresh();
  }

  close() {
    this.open_ = false;
    this.group.visible = false;
    this.root.hidden = true;
    this.ghost.visible = false;
    this.arena?.dispose();
    this.arena = null;
  }

  /** Hides the editor's own furniture without tearing the draft down. */
  setChromeVisible(visible) {
    this.root.hidden = !visible;
    this.group.visible = visible;
    if (!visible) this.ghost.visible = false;
  }

  // ------------------------------------------------------------------ panel

  buildPanel() {
    this.root = el('div', 'build-root');
    this.root.hidden = true;

    this.bar = el('div', 'build-bar');
    this.tools = el('div', 'build-side');
    this.props = el('div', 'build-props');
    this.root.append(this.bar, this.tools, this.props);
    document.body.append(this.root);
  }

  renderPanel() {
    this.renderBar();
    this.renderTools();
    this.renderProps();
  }

  renderBar() {
    this.bar.innerHTML = '';
    const title = el('div', 'build-title', 'Level builder');

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'build-name';
    name.value = this.draft.name;
    name.maxLength = LIMITS.name;
    name.addEventListener('input', () => {
      this.draft.name = name.value;
    });

    const problems = levelProblems(this.draft);
    const state = el(
      'div',
      `build-state${problems.length ? ' bad' : ''}`,
      problems.length ? problems[0] : 'Ready to play',
    );
    if (problems.length > 1) state.title = problems.join('\n');

    const actions = el('div', 'build-actions');
    const add = (label, className, go) => {
      const button = el('button', className, label);
      button.addEventListener('click', go);
      actions.append(button);
      return button;
    };
    add('Paste code', null, () => this.importCode());
    add('Copy code', null, () => this.exportCode());
    add('Save', null, () => this.save());
    add('Test play', 'primary', () => this.testPlay());
    add('Done', null, () => this.h.onDone?.());

    this.bar.append(title, name, el('span', 'spacer'), state, actions);
  }

  renderTools() {
    this.tools.innerHTML = '';
    this.tools.append(el('div', 'panel-title', 'Place'));

    const list = el('div', 'build-tools');
    for (const tool of [...TOOLS, { id: 'select', kind: 'select', name: 'Select', note: 'Pick something to change or remove it.' }]) {
      const button = el('button', `build-tool${this.tool.id === tool.id ? ' active' : ''}`, `<b>${tool.name}</b><span>${tool.note ?? ''}</span>`);
      button.addEventListener('click', () => {
        this.tool = tool;
        this.renderTools();
      });
      list.append(button);
    }
    this.tools.append(list);

    const counts = el('div', 'build-counts');
    for (const kind of ['pieces', 'props', 'zones', 'keepout']) {
      counts.append(el('div', null, `<span>${kind}</span><b>${this.draft[kind].length} / ${LIMITS[kind]}</b>`));
    }
    this.tools.append(el('div', 'panel-title', 'In this level'), counts);
  }

  renderProps() {
    this.props.innerHTML = '';
    const item = this.selectedItem();

    if (item) {
      this.props.append(el('div', 'panel-title', `Selected · ${this.selected.kind}`));
      const box = el('div', 'build-fields');
      const axes = ['x', 'y', 'z'];
      this.numbers(box, 'Position', item.pos, axes, (i, value) => { item.pos[i] = value; });
      if (item.radius !== undefined) {
        this.number(box, 'Radius', item.radius, 0.1, 20, (value) => { item.radius = value; });
      } else {
        this.numbers(box, 'Size', item.size, axes, (i, value) => { item.size[i] = value; }, 0.1);
      }
      if (item.mass !== undefined) {
        this.number(box, 'Mass (kg)', item.mass, 0.1, 5000, (value) => { item.mass = value; });
      }
      this.props.append(box);
      const remove = el('button', 'build-remove danger', 'Remove this');
      remove.addEventListener('click', () => this.removeSelected());
      this.props.append(remove);
    } else {
      this.props.append(el('div', 'panel-title', 'The problem'));
      const brief = document.createElement('textarea');
      brief.className = 'build-brief';
      brief.value = this.draft.brief;
      brief.maxLength = LIMITS.brief;
      brief.rows = 3;
      brief.addEventListener('input', () => { this.draft.brief = brief.value; });
      this.props.append(brief);
    }

    this.props.append(el('div', 'panel-title', 'Objectives'));
    this.props.append(this.objectiveList());

    this.props.append(el('div', 'panel-title', 'Rules'));
    const rules = el('div', 'build-fields');
    this.number(rules, 'Budget', this.draft.budget.cost, 1, 2000, (v) => { this.draft.budget.cost = v; });
    this.number(rules, 'Par (s)', this.draft.par, 5, 3600, (v) => { this.draft.par = v; });
    // Zero for no hard clock at all, which is what most levels want.
    this.number(rules, 'Time limit (s)', this.draft.deadline ?? 0, 0, 3600, (v) => {
      if (v > 0) this.draft.deadline = v; else delete this.draft.deadline;
    });
    this.number(rules, 'Gravity', this.draft.gravity ?? -9.81, -40, 0, (v) => { this.draft.gravity = v; }, 0.01);
    this.number(rules, 'Ground grip', this.draft.friction ?? 1, 0, 4, (v) => { this.draft.friction = v; }, 0.01);
    this.number(rules, 'Mass cap', this.draft.massCap ?? 0, 0, 5000, (v) => {
      if (v <= 0) delete this.draft.massCap; else this.draft.massCap = v;
    });
    this.number(rules, 'Fog from', this.draft.fog?.near ?? 0, 0, 400, (v) => this.setFog({ near: v }), 1);
    this.number(rules, 'Fog out at', this.draft.fog?.far ?? 0, 0, 800, (v) => this.setFog({ far: v }), 1);
    this.props.append(rules);

    const bans = el('div', 'build-bans');
    for (const ban of ['flight', 'wheels', 'grabber']) {
      const on = this.draft.bans.includes(ban);
      const button = el('button', `build-ban${on ? ' on' : ''}`, `No ${ban}`);
      button.addEventListener('click', () => {
        this.draft.bans = on
          ? this.draft.bans.filter((b) => b !== ban)
          : [...this.draft.bans, ban];
        this.refresh({ rebuildArena: false });
      });
      bans.append(button);
    }
    // The three switches that change what a run is rather than what is in it.
    // Hands-off is the one that moves the level's skill level, because a
    // problem the machine has to solve on its own is a different problem.
    for (const [flag, label] of [
      ['handsOff', 'No input'],
      ['noContact', 'No touching'],
      ['noBumps', 'No bumps'],
      ['noRespawn', 'One go'],
    ]) {
      const on = Boolean(this.draft[flag]);
      const button = el('button', `build-ban${on ? ' on' : ''}`, label);
      button.addEventListener('click', () => {
        if (on) delete this.draft[flag];
        else this.draft[flag] = true;
        this.refresh({ rebuildArena: false });
      });
      bans.append(button);
    }
    this.props.append(bans);
  }

  setFog(change) {
    const next = fogFrom(this.draft.fog, change);
    if (next) this.draft.fog = next;
    else delete this.draft.fog;
  }

  objectiveList() {
    const box = el('div', 'build-objectives');
    const targets = [...this.draft.props.map((p) => p.id)];
    const zones = this.draft.zones.map((z) => z.id);

    this.draft.objectives.forEach((objective, index) => {
      const row = el('div', 'build-objective');
      const label = document.createElement('input');
      label.type = 'text';
      label.value = objective.label;
      label.maxLength = 80;
      label.addEventListener('input', () => { objective.label = label.value; });

      const what = this.pickList(
        objective.type === 'coreInZone' ? ['the machine', ...targets] : targets,
        objective.type === 'coreInZone' ? 'the machine' : objective.prop,
        (value) => {
          if (value === 'the machine') {
            objective.type = 'coreInZone';
            delete objective.prop;
          } else {
            objective.type = 'propInZone';
            objective.prop = value;
          }
          this.refresh({ rebuildArena: false });
        },
      );
      const where = this.pickList(zones, objective.zone, (value) => {
        objective.zone = value;
        this.refresh({ rebuildArena: false });
      });

      const hold = document.createElement('input');
      hold.type = 'number';
      hold.className = 'build-hold';
      hold.value = String(objective.hold ?? 0);
      hold.min = '0';
      hold.max = '30';
      hold.title = 'Seconds it has to stay there';
      hold.addEventListener('change', () => {
        objective.hold = Number(hold.value);
        this.refresh({ rebuildArena: false });
      });

      const remove = el('button', 'build-mini danger', '×');
      remove.addEventListener('click', () => {
        this.draft.objectives.splice(index, 1);
        this.refresh({ rebuildArena: false });
      });

      row.append(label, what, where, hold, remove);
      box.append(row);
    });

    const add = el('button', 'build-mini', '+ Objective');
    add.addEventListener('click', () => {
      if (this.draft.objectives.length >= LIMITS.objectives) return;
      if (zones.length === 0) {
        this.h.onToast?.('Put a goal down first — an objective needs somewhere to end up', true);
        return;
      }
      this.draft.objectives.push({
        type: targets.length ? 'propInZone' : 'coreInZone',
        label: 'Get it there',
        hold: 3,
        ...(targets.length ? { prop: targets[0] } : {}),
        zone: zones[0],
      });
      this.refresh({ rebuildArena: false });
    });
    box.append(add);
    return box;
  }

  pickList(options, value, onPick) {
    const select = document.createElement('select');
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option;
      node.textContent = option;
      node.selected = option === value;
      select.append(node);
    }
    select.addEventListener('change', () => onPick(select.value));
    return select;
  }

  number(box, label, value, low, high, onSet, step = GRID) {
    const row = el('div', 'build-field');
    row.append(el('label', null, label));
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(value);
    input.min = String(low);
    input.max = String(high);
    input.step = String(step);
    input.addEventListener('change', () => {
      onSet(Number(input.value));
      this.refresh();
    });
    row.append(input);
    box.append(row);
  }

  numbers(box, label, values, axes, onSet, step = GRID) {
    const row = el('div', 'build-field wide');
    row.append(el('label', null, label));
    const group = el('div', 'build-triple');
    axes.forEach((axis, i) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.value = String(values[i]);
      input.step = String(step);
      input.title = axis;
      input.addEventListener('change', () => {
        onSet(i, Number(input.value));
        this.refresh();
      });
      group.append(input);
    });
    row.append(group);
    box.append(row);
  }

  // ------------------------------------------------------------------ doing

  save() {
    const saved = this.h.onSave?.(this.draft, this.savedId);
    if (saved) this.savedId = saved.id;
    this.h.onToast?.(`Saved "${this.draft.name}"`);
    this.renderBar();
  }

  testPlay() {
    const problems = levelProblems(this.draft);
    if (problems.length) {
      this.h.onToast?.(problems[0], true);
      return;
    }
    this.h.onTestPlay?.(sanitiseLevel(this.draft, { id: this.draft.id }));
  }

  async exportCode() {
    const code = await toShareCode(this.draft);
    try {
      await navigator.clipboard.writeText(code);
      this.h.onToast?.('Share code copied — paste it to anybody');
    } catch {
      // Clipboard access is not always given, and a code you cannot get at is
      // no use at all.
      this.h.onShowCode?.(code);
    }
  }

  async importCode() {
    const code = prompt('Paste a level code');
    if (!code) return;
    const result = await fromShareCode(code);
    if (!result.ok) {
      this.h.onToast?.(result.reason, true);
      return;
    }
    this.draft = result.level;
    this.savedId = null;
    this.selected = null;
    this.refresh();
    this.h.onToast?.(`Loaded "${this.draft.name}"`);
  }
}
