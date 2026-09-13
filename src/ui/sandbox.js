import { MATERIALS, BLOCK } from '../world/terrain.js';
import { WORLD_LIMITS } from '../world/format.js';

/**
 * The chrome for an open world.
 *
 * The campaign's HUD is built around a brief, a budget and a list of
 * objectives, none of which a sandbox has. What it has instead is three
 * things to be doing and a list of machines standing in the world, so it gets
 * its own bar rather than a set of exceptions bolted onto the other one.
 *
 * It owns no state of its own beyond what is on screen: every button asks the
 * session a question or tells it to do something, and then the panel is drawn
 * again from what the session says. That is why switching modes, deploying a
 * machine and deleting one all end at the same `refresh`.
 */

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/** What a click does in world-building mode. */
export const WORLD_TOOLS = [
  { id: 'place', name: 'Place', hint: 'Click to put a block against whatever you are looking at.' },
  { id: 'erase', name: 'Erase', hint: 'Click a block to take it away.' },
  { id: 'deploy', name: 'Deploy', hint: 'Click to stand the machine from the garage here. R turns it.' },
];

export const MODE_NAMES = [
  { id: 'world', name: 'World', hint: 'Building the place itself. Blocks only — nothing that moves.' },
  { id: 'garage', name: 'Garage', hint: 'Building a machine. The world carries on running behind you.' },
  { id: 'play', name: 'Play', hint: 'Click a machine to take the controls. Click away to let go.' },
];

/**
 * Where a machine stands when it is put down on a cell.
 *
 * `aim` hands back the empty cell a block would go in, so the floor of that
 * cell is the surface being pointed at. A machine is built upward from its
 * lowest part, which is what its spawn point means, so it goes on that floor
 * and in the middle of the cell rather than on its corner.
 */
export function deployAt(cell) {
  return [
    cell[0] * BLOCK + BLOCK / 2,
    cell[1] * BLOCK + 0.05,
    cell[2] * BLOCK + BLOCK / 2,
  ];
}

/** The materials a player can pick, in palette order. Index 0 is air. */
export function swatches() {
  return MATERIALS
    .map((spec, index) => (spec ? { index, ...spec } : null))
    .filter((spec) => spec && spec.index <= WORLD_LIMITS.materials);
}

export class Sandbox {
  constructor({ handlers }) {
    this.h = handlers;
    this.tool = 'place';
    this.material = 1;
    this.yaw = 0;

    this.root = el('div', 'sb');
    this.root.hidden = true;

    this.top = el('header', 'sb-top');
    this.left = el('aside', 'sb-left');
    this.right = el('aside', 'sb-right');
    this.hint = el('div', 'sb-hint');
    this.root.append(this.top, this.left, this.right, this.hint);
    document.body.append(this.root);

    this.buildTop();
    this.buildLeft();
    this.buildRight();
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open() {
    this.root.hidden = false;
    document.body.classList.add('in-sandbox');
    this.refresh();
  }

  close() {
    this.root.hidden = true;
    document.body.classList.remove('in-sandbox');
  }

  // --------------------------------------------------------------------- bar

  buildTop() {
    const leave = el('button', 'back sb-leave', 'Leave');
    leave.title = 'Back to the menu';
    leave.addEventListener('click', () => this.h.onLeave());

    this.modes = el('div', 'mode-switch');
    for (const mode of MODE_NAMES) {
      const button = el('button', null, mode.name);
      button.dataset.mode = mode.id;
      button.title = mode.hint;
      button.addEventListener('click', () => this.h.onMode(mode.id));
      this.modes.append(button);
    }

    this.name = el('input', 'sb-name');
    this.name.maxLength = WORLD_LIMITS.name;
    this.name.spellcheck = false;
    this.name.title = 'What this world is called';
    this.name.addEventListener('change', () => this.h.onRename(this.name.value));

    // Only up when there is somebody else in the world. Offline it would be
    // a permanent reminder of a thing that is not happening.
    this.link = el('div', 'sb-link');
    this.link.hidden = true;

    this.blockCount = el('div', 'readout', 'BLOCKS <strong>0</strong>');
    this.fleetCount = el('div', 'readout', 'MACHINES <strong>0</strong>');

    const actions = el('div', 'actions');
    const save = el('button', null, 'Save');
    save.addEventListener('click', () => this.h.onSave());
    const share = el('button', null, 'Share');
    share.addEventListener('click', () => this.h.onShare());
    actions.append(save, share);

    this.top.append(
      leave, this.modes, this.name, el('span', 'spacer'),
      this.link, this.blockCount, this.fleetCount, actions,
    );
  }

  // ------------------------------------------------------------- world tools

  buildLeft() {
    this.tools = el('div', 'tools');
    for (const tool of WORLD_TOOLS) {
      const button = el('button', 'tool', tool.name);
      button.dataset.tool = tool.id;
      button.title = tool.hint;
      button.addEventListener('click', () => this.setTool(tool.id));
      this.tools.append(button);
    }

    this.mats = el('div', 'sb-mats');
    for (const spec of swatches()) {
      const button = el('button', 'sb-mat');
      button.dataset.material = String(spec.index);
      button.title = spec.name;
      button.style.setProperty('--swatch', `#${spec.colour.toString(16).padStart(6, '0')}`);
      button.append(el('i'), el('span', null, spec.name));
      button.addEventListener('click', () => this.setMaterial(spec.index));
      this.mats.append(button);
    }

    this.left.append(
      el('div', 'panel-title', 'Tools'),
      this.tools,
      el('div', 'panel-title', 'Material'),
      this.mats,
    );
  }

  setTool(id) {
    this.tool = WORLD_TOOLS.some((t) => t.id === id) ? id : 'place';
    this.refresh();
    return this.tool;
  }

  setMaterial(index) {
    this.material = this.h.onMaterial(index);
    this.refresh();
    return this.material;
  }

  /** Turns the machine about to be deployed a quarter turn. */
  turn() {
    this.yaw = (this.yaw + Math.PI / 2) % (Math.PI * 2);
    this.refresh();
    return this.yaw;
  }

  // ----------------------------------------------------------------- machines

  buildRight() {
    this.deployRow = el('div', 'sb-acts deploy');
    const deploy = el('button', 'sb-act lead', 'Deploy this machine');
    deploy.title = 'Go out to the world and click where it should stand';
    deploy.addEventListener('click', () => this.h.onArmDeploy());
    this.deployRow.append(deploy);

    this.fleetList = el('div', 'sb-fleet');
    this.fleetActions = el('div', 'sb-acts');
    this.right.append(
      this.deployRow,
      el('div', 'panel-title', 'Machines'),
      this.fleetList,
      this.fleetActions,
    );
  }

  renderFleet(session) {
    const members = session.fleet.list();
    this.fleetList.innerHTML = '';
    if (members.length === 0) {
      this.fleetList.append(el(
        'p',
        'sb-empty',
        'Nothing standing in this world yet. Build one in the garage, then Deploy it.',
      ));
    }
    for (const member of members) {
      const row = el('button', 'sb-row');
      const driving = session.controlled()?.id === member.id;
      if (member.id === session.selected) row.classList.add('on');
      if (driving) row.classList.add('driving');
      const where = member.machine.corePosition();
      row.append(
        el('span', 'sb-row-name', member.name || member.id),
        el('span', 'sb-row-at', `${Math.round(where.x)}, ${Math.round(where.z)}`),
      );
      row.addEventListener('click', () => this.h.onSelect(member.id));
      this.fleetList.append(row);
    }

    this.fleetActions.innerHTML = '';
    const chosen = session.selected ? session.fleet.get(session.selected) : null;
    if (!chosen) return;
    const driving = session.controlled()?.id === chosen.id;
    const buttons = [
      {
        label: driving ? 'Let go' : 'Control',
        go: () => this.h.onControl(driving ? null : chosen.id),
      },
      { label: 'Look at', go: () => this.h.onFocus(chosen.id) },
      { label: 'Edit in garage', go: () => this.h.onEdit(chosen.id) },
      { label: 'Delete', danger: true, go: () => this.h.onDelete(chosen.id) },
    ];
    for (const spec of buttons) {
      const button = el('button', spec.danger ? 'sb-act danger' : 'sb-act', spec.label);
      button.addEventListener('click', spec.go);
      this.fleetActions.append(button);
    }
  }

  // ------------------------------------------------------------------ drawing

  /** Draws the whole panel from what the session says, after any change. */
  refresh() {
    const session = this.h.session();
    if (!session) return;
    const counts = session.counts();
    this.showLink(this.h.net?.() ?? null);

    for (const button of this.modes.children) {
      button.classList.toggle('active', button.dataset.mode === session.mode);
    }
    for (const button of this.tools.children) {
      button.classList.toggle('active', button.dataset.tool === this.tool);
    }
    for (const button of this.mats.children) {
      button.classList.toggle('active', Number(button.dataset.material) === this.material);
    }

    this.left.hidden = session.mode !== 'world';
    this.deployRow.hidden = session.mode !== 'garage';
    document.body.classList.toggle('garage', session.mode === 'garage');
    if (this.name.value !== session.world.name && document.activeElement !== this.name) {
      this.name.value = session.world.name;
    }
    this.blockCount.innerHTML = `BLOCKS <strong>${counts.blocks}</strong>`;
    this.fleetCount.innerHTML = `MACHINES <strong>${counts.vehicles}</strong>`;
    this.renderFleet(session);
    this.hint.textContent = this.hintFor(session);
  }

  /** Who else is here, and whether the world is still arriving. */
  showLink(net) {
    this.link.hidden = !net;
    if (!net) return;
    const here = net.players.size;
    const who = `${here} HERE`;
    if (!net.connected) {
      this.link.className = 'sb-link bad';
      this.link.innerHTML = '<b>OFFLINE</b>';
      return;
    }
    this.link.className = net.quiet ? 'sb-link bad' : 'sb-link';
    this.link.innerHTML = net.quiet
      ? '<b>NO SIGNAL</b>'
      : `<b>${who}</b>${net.mayBuild ? '' : ' · VISITING'}`;
  }

  hintFor(session) {
    if (session.mode === 'garage') {
      return 'Build a machine, then Deploy to stand it in the world. The world keeps running.';
    }
    if (session.mode === 'play') {
      const driving = session.controlled();
      return driving
        ? `Driving ${driving.name}. Esc or Play again to let go.`
        : 'Click a machine to take the controls.';
    }
    return WORLD_TOOLS.find((t) => t.id === this.tool)?.hint ?? '';
  }
}
