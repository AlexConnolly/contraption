import {
  CATEGORIES, partsInCategory, getPart, findPart, pistonStroke, separationPush, workingAxis,
  jointTension, springStiffness, springDamping, springTravel,
  servoAngleA, servoAngleB, servoSpeed, turntableRecentres, padMode, padDamping,
  turntableSpin, turntableTorque, CELL, CELL_VOLUME,
} from '../parts/registry.js';
import { BINDING_MODES, bindingLabel, keyLabel, defaultBinding } from '../sim/signals.js';
import { estimateGains, firstController, controllerOf } from '../sim/flight.js';
import { renderPart, renderMachine } from './thumbnails.js';
import { store } from './progress.js';
import { bannedParts, banFor } from '../challenges/bans.js';
import { envelopeOf } from '../studio/envelope.js';
import { DIRECTIONS, aimableDirections, aimNamed } from '../core/aim.js';
import { partCost } from '../parts/registry.js';

// Said instead of a best time when the machine has pack parts on it.
/** What each of the three turn keys does, for the button that does it too. */
const TURN_NAMES = {
  yaw: 'Turn it round',
  pitch: 'Tip it forward',
  roll: 'Roll it onto its side',
};

const MODDED = '<span>Pack parts &middot; <strong>not on the board</strong></span>';
// A time set with the rules off is not a time, and the card has to say so
// rather than quietly not recording it.
const FUN = '<span>Fun mode &middot; <strong>nothing recorded</strong></span>';

const HELP = {
  studio: [
    ['Left click', 'place'],
    ['Right drag', 'orbit'],
    ['Middle drag', 'pan'],
    ['R / T / Y', 'turn · tip · roll'],
    ['Shift', 'the other way'],
    ['1 2 3', 'place / select / delete'],
    ['X', 'delete hovered'],
    ['Ctrl+Z / Ctrl+Y', 'undo / redo'],
    ['Tab', 'test'],
  ],
  view: [
    ['Left drag', 'orbit the course'],
    ['Middle drag', 'pan'],
    ['Wheel', 'zoom'],
    ['Tab', 'back to studio'],
  ],
  test: [
    ['Your bindings', 'drive the machine'],
    ['K', 'respawn'],
    ['C', 'camera mode'],
    ['Right drag', 'look'],
    ['Tab', 'back to studio'],
  ],
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * What a blueprint will weigh once it is built, worked out the same way the
 * physics does it: part mass is given per grid cell and turned into a density,
 * and each collider's own volume decides the rest. A wheel is a cylinder and a
 * wedge is half a box, so neither weighs what its cell count suggests.
 */
export function partMass(part) {
  const density = part.mass / CELL_VOLUME;
  if (part.radius) return density * Math.PI * part.radius * part.radius * part.width;
  const box = part.size.reduce((a, n) => a * n * CELL, 1);
  return density * (part.shape === 'wedge' ? box / 2 : box);
}

export function blueprintMass(blueprint) {
  let total = 0;
  for (const placed of blueprint.list()) total += partMass(getPart(placed.type));
  return total;
}

/**
 * Where the weight of a machine actually sits, in metres, measured against the
 * machine rather than against the world: across and along from the middle of
 * the box it fills, and up from the bottom of it.
 *
 * Those are the three numbers that decide how it behaves. Weight off to one
 * side steers itself; weight at one end lifts the other over a bump; and
 * weight carried high is what turns a corner into a roll, which is the one
 * players never think to check until it happens.
 */
export function centreOfMass(blueprint) {
  let total = 0;
  const sum = [0, 0, 0];
  for (const placed of blueprint.list()) {
    const kg = partMass(getPart(placed.type));
    total += kg;
    for (let axis = 0; axis < 3; axis += 1) sum[axis] += placed.cell[axis] * CELL * kg;
  }
  if (total <= 0) return null;
  const at = sum.map((n) => n / total);
  const { min, max } = blueprint.extent();
  const middle = [0, 1, 2].map((axis) => ((min[axis] + max[axis]) / 2) * CELL);
  return {
    mass: total,
    right: at[0] - middle[0],
    forward: at[2] - middle[2],
    above: at[1] - min[1] * CELL,
    height: (max[1] - min[1] + 1) * CELL,
    width: (max[0] - min[0] + 1) * CELL,
    depth: (max[2] - min[2] + 1) * CELL,
  };
}

export class Hud {
  constructor(handlers) {
    this.h = handlers;
    this.dom = {
      rail: document.getElementById('rail'),
      picker: document.getElementById('picker'),
      pickerGrid: document.getElementById('picker-grid'),
      modal: document.getElementById('modal'),
      modalTitle: document.getElementById('modal-title'),
      modalBody: document.getElementById('modal-body'),
      modalOk: document.getElementById('modal-ok'),
      modalCancel: document.getElementById('modal-cancel'),
      modeStudio: document.getElementById('mode-studio'),
      modeView: document.getElementById('mode-view'),
      modeTest: document.getElementById('mode-test'),
      viewbar: document.getElementById('viewbar'),
      viewGoal: document.getElementById('view-goal'),
      budget: document.getElementById('budget'),
      paletteList: document.getElementById('palette-list'),
      palette: document.getElementById('palette'),
      inspector: document.getElementById('inspector'),
      inspectorBody: document.getElementById('inspector-body'),
      briefTitle: document.getElementById('brief-title'),
      briefText: document.getElementById('brief-text'),
      briefHint: document.getElementById('brief-hint'),
      objectives: document.getElementById('objectives'),
      objectiveList: document.getElementById('objective-list'),
      clock: document.getElementById('run-clock'),
      testControls: document.querySelector('.test-controls'),
      help: document.getElementById('help'),
      toast: document.getElementById('toast'),
      win: document.getElementById('win'),
      winKicker: document.getElementById('win-kicker'),
      winTitle: document.getElementById('win-title'),
      winStats: document.getElementById('win-stats'),
      winClock: document.getElementById('win-clock'),
      winRig: document.getElementById('win-rig'),
      winParts: document.getElementById('win-parts'),
      winNext: document.getElementById('win-next'),
      loading: document.getElementById('loading'),
      survey: document.getElementById('survey'),
      surveyStep: document.getElementById('survey-step'),
      surveyCaption: document.getElementById('survey-caption'),
    };
    this.wire();
    this.buildPalette();
  }

  wire() {
    const { h, dom } = this;
    document.getElementById('btn-challenges').addEventListener('click', async () => {
      // Where this actually goes depends on how you got here, and the question
      // has to say so — testing a level you are building goes back to the
      // builder, not out to the challenge list.
      const toBuilder = h.isTestingDraft?.();
      const leave = await this.confirm({
        title: toBuilder ? 'Back to the builder?' : 'Back to challenges?',
        body: toBuilder
          ? 'Your level is exactly as you left it. The run you are on now ends.'
          : 'Your machine is saved against this challenge, so it will be '
            + 'here when you come back. The run you are on now ends.',
        ok: toBuilder ? 'Back to building' : 'Leave challenge',
        cancel: 'Stay here',
      });
      if (leave) h.onLeaveChallenge();
    });
    document.getElementById('btn-preset').addEventListener('click', () => this.openPicker());
    document.getElementById('picker-cancel').addEventListener('click', () => this.closePicker());
    dom.picker.addEventListener('mousedown', (event) => {
      if (event.target === dom.picker) this.closePicker();
    });
    dom.modeStudio.addEventListener('click', () => h.onModeChange('studio'));
    dom.modeView.addEventListener('click', () => h.onModeChange('view'));
    dom.modeTest.addEventListener('click', () => h.onModeChange(this.mode === 'test' ? 'studio' : 'test'));
    document.getElementById('btn-save').addEventListener('click', () => h.onSave());
    document.getElementById('btn-load').addEventListener('click', () => h.onLoad());
    document.getElementById('btn-clear').addEventListener('click', () => h.onClear());
    document.getElementById('survey-skip').addEventListener('click', () => h.onSkipCourse());
    document.getElementById('view-tour').addEventListener('click', () => h.onShowCourse());
    document.getElementById('view-build').addEventListener('click', () => h.onModeChange('studio'));
    document.getElementById('btn-respawn').addEventListener('click', () => h.onRespawn());
    document.getElementById('btn-back').addEventListener('click', () => h.onModeChange('studio'));
    document.getElementById('win-again').addEventListener('click', () => {
      this.hideWin();
      h.onRespawn();
    });
    document.getElementById('win-studio').addEventListener('click', () => {
      this.hideWin();
      h.onModeChange('studio');
    });
    dom.winNext.addEventListener('click', () => {
      this.hideWin();
      h.onNextChallenge();
    });
    for (const button of document.querySelectorAll('.tool')) {
      button.addEventListener('click', () => h.onSelectTool(button.dataset.tool));
    }
  }

  buildPalette() {
    const list = this.dom.paletteList;
    list.innerHTML = '';
    this.partButtons = new Map();
    for (const category of CATEGORIES) {
      const parts = partsInCategory(category.id);
      if (parts.length === 0) continue;
      list.append(el('div', 'cat-title', category.name));
      const grid = el('div', 'part-grid');
      for (const part of parts) {
        const button = el('button', 'part-btn');
        const shot = el('div', 'part-shot');
        const image = document.createElement('img');
        image.src = renderPart(part.id);
        image.alt = '';
        shot.append(image);
        if (part.cost > 0) shot.append(el('span', 'part-cost', String(part.cost)));
        button.append(shot, el('span', 'part-name', part.name));
        button.title = part.blurb;
        button.addEventListener('click', () => this.h.onSelectPart(part.id));
        grid.append(button);
        this.partButtons.set(part.id, button);
      }
      list.append(grid);
    }
  }

  setActivePart(id) {
    for (const [partId, button] of this.partButtons) {
      button.classList.toggle('active', partId === id);
    }
  }

  setActiveTool(tool) {
    for (const button of document.querySelectorAll('.tool')) {
      button.classList.toggle('active', button.dataset.tool === tool);
    }
  }

  // The menu owns the screen while it is up, so the game's panels step aside.
  setChromeVisible(visible) {
    this.chromeHidden = !visible;
    for (const node of [
      document.getElementById('topbar'),
      document.getElementById('brief'),
      document.getElementById('help'),
      this.dom.palette,
      this.dom.inspector,
      this.dom.objectives,
    ]) {
      if (node) node.style.display = visible ? '' : 'none';
    }
  }

  setMode(mode, flightKeys = null) {
    this.mode = mode;
    this.flightKeys = flightKeys;
    const test = mode === 'test';
    for (const [name, node] of [
      ['studio', this.dom.modeStudio],
      ['view', this.dom.modeView],
    ]) {
      node.classList.toggle('active', mode === name);
    }
    // Building tools in the studio, the run panel in test, and in view just
    // the course and what it is asking of you.
    this.dom.palette.hidden = mode !== 'studio';
    this.dom.inspector.hidden = mode !== 'studio';
    this.dom.objectives.hidden = mode === 'studio';
    this.dom.viewbar.hidden = mode !== 'view';
    this.dom.rail.hidden = mode === 'view';
    // In view there is no run, so no clock and nothing to respawn.
    this.dom.clock.hidden = mode !== 'test';
    this.dom.testControls.hidden = mode !== 'test';
    // Play is the same button whichever mode you are in; in a run it stops.
    this.dom.modeTest.classList.toggle('running', test);
    this.dom.modeTest.textContent = test ? 'Stop' : 'Play';
    this.setHelp(mode);
  }

  setHelp(mode) {
    this.dom.help.innerHTML = '';
    const rows = [...HELP[mode]];
    if (mode === 'test' && this.flightKeys) {
      const k = this.flightKeys;
      rows.splice(1, 0,
        [`${keyLabel(k.forward)} ${keyLabel(k.left)} ${keyLabel(k.back)} ${keyLabel(k.right)}`, 'fly'],
        [`${keyLabel(k.up)} ${keyLabel(k.down)}`, 'climb / descend'],
      );
    }
    for (const [keys, label] of rows) {
      const span = el('span');
      for (const key of keys.split(' ')) {
        if (/^(click|drag)$/i.test(key)) {
          span.append(` ${key} `);
        } else {
          span.append(el('kbd', null, key), ' ');
        }
      }
      span.append(label);
      this.dom.help.append(span);
    }
  }

  /**
   * Greys out whatever this level forbids. The part stays on the rack so you
   * can see it exists and see that it is off the table, which reads better
   * than a shorter list of parts with no explanation.
   */
  applyBans(level) {
    const forbidden = bannedParts(level);
    for (const [partId, button] of this.partButtons ?? []) {
      const ban = forbidden.has(partId) ? banFor(level, partId) : null;
      button.classList.toggle('banned', Boolean(ban));
      button.disabled = Boolean(ban);
      button.title = ban ? `${ban.name} — ${ban.note}` : getPart(partId).blurb;
    }
  }

  setLevel(level) {
    this.applyBans(level);
    this.dom.viewGoal.textContent = level.brief;
    this.dom.briefTitle.textContent = level.name;
    // Said on the brief, not only on the menu you came through. Half an hour
    // later, wondering why the clock is not running, this is where you look.
    if (level.fun) {
      const tag = el('span', 'brief-fun', 'Fun mode');
      this.dom.briefTitle.append(tag);
    }
    this.dom.briefText.textContent = level.brief;
    this.dom.briefHint.textContent = level.hint ?? '';
  }

  /**
   * Parts, cost, and — where a level caps it — weight.
   *
   * The mass cap used to be invisible until the run started, which is the one
   * place it is no use: by then you have finished building. It reads the same
   * way the budget does, so being over is something you see while you can
   * still do something about it.
   */
  setBudget(cost, budget, partCount, blueprint, massCap, heightCap) {
    let over = Boolean(budget && cost > budget);
    this.dom.budget.classList.toggle('over', over);

    const parts = [`${partCount} parts`];
    parts.push(budget
      ? `cost <strong>${cost}</strong> / ${budget}`
      : `cost <strong>${cost}</strong>`);

    if (massCap && blueprint) {
      const kg = blueprintMass(blueprint);
      parts.push(`mass <strong>${kg.toFixed(0)}</strong> / ${massCap} kg`);
      over = over || kg > massCap;
    }
    // Counted as it is built, so it is something you can see going wrong while
    // there is still time to do something about it.
    if (heightCap && blueprint) {
      const tall = blueprint.height();
      parts.push(`height <strong>${tall}</strong> / ${heightCap}`);
      over = over || tall > heightCap;
    }
    this.dom.budget.classList.toggle('over', over);
    this.dom.budget.innerHTML = parts.join(' · ');
  }

  clearInspector(message) {
    this.dom.inspectorBody.className = 'empty';
    this.dom.inspectorBody.textContent = message;
  }

  /**
   * What this part's range comes to, in words, next to the picture of it.
   *
   * The studio draws the arc, the circle or the line on the plate, which is
   * the half that answers "will it clear the load". This is the other half:
   * the same envelope as a sentence, so the number the sliders are setting is
   * stated somewhere rather than only implied by a shape on screen.
   */
  renderRange(body, placed, blueprint) {
    if (!blueprint) return;
    const envelope = envelopeOf(blueprint, placed);
    if (!envelope) return;
    const row = el('div', 'insp-range');
    row.append(el('span', 'insp-range-mark'), el('span', null, envelope.label));
    body.append(row);
  }

  renderInspector(placed, blueprint) {
    const body = this.dom.inspectorBody;
    body.className = '';
    body.innerHTML = '';
    if (!placed) {
      this.clearInspector('Select a part with the Select tool to set its controls.');
      return;
    }
    const part = getPart(placed.type);
    const head = el('div', 'insp-head');
    const swatch = el('span', 'part-swatch');
    swatch.style.background = `#${part.colour.toString(16).padStart(6, '0')}`;
    head.append(swatch, el('h3', null, part.name));
    body.append(head, el('p', 'insp-blurb', part.blurb));

    this.renderFacing(body, placed, part);
    this.renderRange(body, placed, blueprint);
    if (part.computer) this.renderComputer(body, placed);
    if (part.flight) this.renderController(body, placed, part, blueprint);
    if (part.actuator) this.renderBinding(body, placed, part, blueprint);
    if (part.sensor) this.renderSensor(body, placed, part);
    // A motor has two numbers and they are different questions: speed is how
    // fast it will go, torque is whether it will go at all with something
    // heavy in the way. A nozzle has one.
    if (part.actuator?.kind === 'motor' && part.powerRange) {
      this.renderSlider(
        body, 'Speed', placed.config.power ?? 1,
        part.powerRange[0], part.powerRange[1], 0.1,
        (value) => this.h.onConfigChange(placed.id, { power: value }),
      );
      this.renderSlider(
        body, 'Torque', placed.config.torque ?? 1,
        part.torqueRange[0], part.torqueRange[1], 0.1,
        (value) => this.h.onConfigChange(placed.id, { torque: value }),
      );
      this.renderWound(body, placed, part);
    } else if (part.actuator?.kind === 'thrust' && part.powerRange) {
      this.renderSlider(
        body, 'Power', placed.config.power ?? 1,
        part.powerRange[0], part.powerRange[1], 0.1,
        (value) => this.h.onConfigChange(placed.id, { power: value }),
      );
      this.renderWound(body, placed, part);
    } else if (part.actuator && (part.actuator.kind === 'motor' || part.actuator.kind === 'thrust')) {
      this.renderSlider(body, 'Power', placed.config.power ?? 1, 0.1, 1, 0.05, (value) => {
        this.h.onConfigChange(placed.id, { power: value });
      });
    }
    if (part.flippable) this.renderFlip(body, placed, part);
    if (part.tensionRange) this.renderTension(body, placed, part);
    if (part.strokeRange) this.renderStroke(body, placed, part);
    if (part.separationRange) this.renderSeparation(body, placed, part);
    if (part.positions) this.renderPositions(body, placed, part);
    if (part.spring) this.renderSpring(body, placed, part);
    if (part.spinRange) this.renderTurntable(body, placed, part);
    if (part.id === 'dolly') {
      this.renderSlider(
        body, 'Speed', placed.config.speed ?? part.speed,
        part.speedRange[0], part.speedRange[1], 0.2,
        (value) => this.h.onConfigChange(placed.id, { speed: value }),
      );
    }
    if (part.id === 'pressure') this.renderPad(body, placed, part);

    const remove = el('button', 'danger', 'Delete part');
    remove.style.width = '100%';
    remove.style.marginTop = '6px';
    remove.addEventListener('click', () => this.h.onDeleteSelected());
    body.append(remove);
  }

  /**
   * Turning a part after it is down. Placing one the wrong way round is the
   * commonest mistake there is, and the fix used to be deleting it and
   * starting again, which threw away its bindings with it.
   */
  /**
   * Which way a part faces, said two ways.
   *
   * The three turns are one per axis, because a cube has three and offering
   * two of them is what made rotating things feel like guesswork -- from
   * square on, two keys took three presses on average and five at worst to
   * reach a given rotation. Three with a reverse is 1.92 and three.
   *
   * Better still, most parts only care about one direction, so for those the
   * six buttons say it outright and the rotation is worked out. Pointing a
   * thruster down should not be a puzzle.
   */
  /**
   * What a wound-up part is now making, and what it now costs.
   *
   * Power is torque times speed, and so is the price, so the two are shown
   * together: wind it up and watch the budget go with it. Without this the
   * sliders are two numbers with no consequence attached, which is how you end
   * up over budget with no idea which part did it.
   */
  renderWound(body, placed, part) {
    const cost = partCost(placed, part);
    if (cost === part.cost) return;
    const row = el('div', 'insp-wound');
    const what = part.actuator.kind === 'motor'
      ? `${(part.actuator.maxSpeed * (placed.config.power ?? 1)).toFixed(0)} rad/s`
        + ` · ${(part.actuator.maxForce * (placed.config.torque ?? 1)).toFixed(0)} Nm`
      : `${(part.thruster.maxThrust * (placed.config.power ?? 1)).toFixed(0)} N`;
    row.append(
      el('span', null, what),
      el('span', 'insp-wound-cost', `costs ${cost}, not ${part.cost}`),
    );
    body.append(row);
  }

  renderFacing(body, placed, part) {
    const row = el('div', 'row');
    row.append(el('label', null, 'Turn'));
    const buttons = el('div', 'keybind');
    for (const [how, label] of [['yaw', 'R'], ['pitch', 'T'], ['roll', 'Y']]) {
      const button = el('button', null, label);
      button.title = `${TURN_NAMES[how]} — hold Shift for the other way`;
      button.addEventListener('click', (event) => {
        this.h.onTurnPart(placed.id, how, event.shiftKey ? -1 : 1);
      });
      buttons.append(button);
    }
    row.append(buttons);
    body.append(row);

    const can = aimableDirections(part);
    if (can.length === 0) return;
    const now = aimNamed(part, placed.rot);
    const aim = el('div', 'row');
    aim.append(el('label', null, 'Point it'));
    const pad = el('div', 'insp-aim');
    for (const direction of DIRECTIONS) {
      const button = el('button', direction.id === now ? 'on' : null, direction.name);
      button.disabled = !can.includes(direction.id);
      button.addEventListener('click', () => this.h.onAimPart(placed.id, direction.dir));
      pad.append(button);
    }
    aim.append(pad);
    body.append(aim);
  }

  renderBinding(body, placed, part, blueprint) {
    const binding = { ...(placed.config.binding ?? defaultBinding(part)) };
    const modeRow = el('div', 'row');
    modeRow.append(el('label', null, 'Control'));
    const select = document.createElement('select');
    for (const mode of BINDING_MODES) {
      const option = el('option', null, mode.name);
      option.value = mode.id;
      select.append(option);
    }
    select.value = binding.mode;
    select.addEventListener('change', () => {
      this.h.onBindingChange(placed.id, { ...binding, mode: select.value });
    });
    modeRow.append(select);
    body.append(modeRow);

    const spec = BINDING_MODES.find((m) => m.id === binding.mode);
    if (spec?.keys.length) {
      const row = el('div', 'keybind');
      for (const slot of spec.keys) {
        const button = el('button', null, `${slot === 'pos' ? '▲' : '▼'} ${keyLabel(binding[slot])}`);
        button.addEventListener('click', () => {
          button.classList.add('listening');
          button.textContent = 'press a key…';
          this.h.onCaptureKey((code) => {
            this.h.onBindingChange(placed.id, { ...binding, [slot]: code });
          });
        });
        row.append(button);
      }
      body.append(row);
    }

    if (binding.mode === 'flight') {
      const controllers = blueprint.list().filter((p) => getPart(p.type).flight);
      if (controllers.length === 0) {
        body.append(el('p', 'insp-blurb', 'No flight controller on this machine yet.'));
      } else {
        this.renderSource(body, placed, binding, controllers, 'Controller', 'Controller');
        this.renderGains(body, placed, blueprint);
      }
    }

    if (binding.mode === 'sensor') {
      const sensors = blueprint.list().filter((p) => getPart(p.type).sensor);
      const row = el('div', 'row');
      row.append(el('label', null, 'Source'));
      const sourceSelect = document.createElement('select');
      if (sensors.length === 0) {
        const option = el('option', null, 'no sensors placed');
        option.value = '';
        sourceSelect.append(option);
        sourceSelect.disabled = true;
      }
      sensors.forEach((sensor, index) => {
        const option = el('option', null, `Sensor ${index + 1}`);
        option.value = sensor.id;
        sourceSelect.append(option);
      });
      sourceSelect.value = binding.source ?? sensors[0]?.id ?? '';
      sourceSelect.addEventListener('change', () => {
        this.h.onBindingChange(placed.id, { ...binding, source: sourceSelect.value });
      });
      row.append(sourceSelect);
      body.append(row);

      const invertRow = el('div', 'row');
      invertRow.append(el('label', null, 'Invert'));
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(binding.invert);
      checkbox.addEventListener('change', () => {
        this.h.onBindingChange(placed.id, { ...binding, invert: checkbox.checked });
      });
      invertRow.append(checkbox);
      body.append(invertRow);
    }

    body.append(el('p', 'insp-blurb', `Currently: ${bindingLabel(binding)}`));
  }

  renderSource(body, placed, binding, sources, label, prefix) {
    const row = el('div', 'row');
    row.append(el('label', null, label));
    const select = document.createElement('select');
    sources.forEach((source, index) => {
      const option = el('option', null, `${prefix} ${index + 1}`);
      option.value = source.id;
      select.append(option);
    });
    select.value = binding.source ?? sources[0].id;
    select.addEventListener('change', () => {
      this.h.onBindingChange(placed.id, { ...binding, source: select.value });
    });
    row.append(select);
    body.append(row);
  }

  // How much of each control channel this thruster is asked to provide. The
  // derived figures come from where it sits and which way it points; anything
  // the player drags here overrides that one channel and leaves the rest.
  renderGains(body, placed, blueprint) {
    const controllerId = controllerOf(blueprint, placed);
    const derived = estimateGains(blueprint, controllerId).get(placed.id)
      ?? { climb: 0, pitch: 0, yaw: 0, roll: 0 };
    const custom = placed.config.gains ?? {};
    const overridden = Object.keys(custom).length > 0;

    body.append(el('div', 'panel-title', overridden ? 'Influence (edited)' : 'Influence (auto)'));
    for (const channel of ['climb', 'pitch', 'yaw', 'roll']) {
      const value = custom[channel] ?? derived[channel];
      const min = channel === 'climb' ? 0 : -1;
      this.renderSlider(body, channel, value, min, 1, 0.05, (next) => {
        this.h.onConfigChange(placed.id, {
          gains: { ...(placed.config.gains ?? {}), [channel]: next },
        });
      });
    }
    if (overridden) {
      const reset = el('button', null, 'Back to derived values');
      reset.style.width = '100%';
      reset.addEventListener('click', () => {
        this.h.onConfigChange(placed.id, { gains: null });
        this.h.onReselect();
      });
      body.append(reset);
    }
  }

  renderComputer(body, placed) {
    const program = placed.config.program;
    const states = program?.states?.length ?? 0;
    const nodes = program?.states?.reduce((sum, s) => sum + s.nodes.length, 0) ?? 0;
    body.append(el('p', 'insp-blurb',
      states ? `${states} state${states === 1 ? '' : 's'}, ${nodes} node${nodes === 1 ? '' : 's'}.`
        : 'No program yet.'));
    const open = el('button', 'primary', 'Open program');
    open.style.width = '100%';
    open.style.marginBottom = '10px';
    open.addEventListener('click', () => this.h.onOpenProgram(placed.id));
    body.append(open);
  }

  renderController(body, placed, part, blueprint) {
    const keys = { ...part.flight.defaultKeys, ...(placed.config.keys ?? {}) };
    const linked = blueprint.list().filter(
      (p) => getPart(p.type).thruster && controllerOf(blueprint, p) === placed.id,
    ).length;
    const total = blueprint.list().filter((p) => getPart(p.type).thruster).length;

    body.append(el('p', 'insp-blurb',
      `Flying ${linked} of ${total} thruster${total === 1 ? '' : 's'}. `
      + 'Forward is the way its arrow points.'));

    if (linked < total) {
      const link = el('button', 'primary', `Link the other ${total - linked}`);
      link.style.width = '100%';
      link.style.marginBottom = '10px';
      link.addEventListener('click', () => this.h.onLinkThrusters(placed.id));
      body.append(link);
    }

    body.append(el('div', 'panel-title', 'Flight keys'));
    const rows = [
      ['forward', 'back'],
      ['left', 'right'],
      ['up', 'down'],
    ];
    for (const pair of rows) {
      const row = el('div', 'keybind');
      for (const slot of pair) {
        const button = el('button', null, `${slot} ${keyLabel(keys[slot])}`);
        button.addEventListener('click', () => {
          button.classList.add('listening');
          button.textContent = 'press a key…';
          this.h.onCaptureKey((code) => {
            this.h.onConfigChange(placed.id, { keys: { ...keys, [slot]: code } });
          });
        });
        row.append(button);
      }
      body.append(row);
    }
    body.append(el('p', 'insp-blurb', 'Let go of everything and it holds the height it is at.'));
  }

  renderSensor(body, placed, part) {
    this.renderSlider(
      body, 'Aim', placed.config.yaw ?? 0, -90, 90, 5,
      (value) => this.h.onConfigChange(placed.id, { yaw: value }),
    );
    body.append(el('p', 'insp-blurb',
      'Degrees off its mounting, swept round the machine. Whiskers either side '
      + 'of a forward beam tell you which way is clearer.'));
    this.renderSlider(
      body, 'Trip point',
      placed.config.threshold ?? part.config.threshold,
      0.05, 0.95, 0.05,
      (value) => this.h.onConfigChange(placed.id, { threshold: value }),
    );
    const metres = (1 - (placed.config.threshold ?? part.config.threshold)) * part.sensor.range;
    body.append(el('p', 'insp-blurb', `Trips within ${metres.toFixed(1)} m.`));
  }

  /**
   * Mirrors which way the joint turns. The jaws of a grabber are mirror
   * images of one another, so one key has to close them both; before this the
   * only way to get that was to mount one of the pair backwards, which threw
   * away its sensible facing to buy a minus sign.
   */
  renderFlip(body, placed, part) {
    const row = el('div', 'row');
    row.append(el('label', null, 'Direction'));
    const button = el('button');
    button.style.width = '100%';
    const note = el('p', 'insp-blurb');
    // Setting a config does not rebuild the inspector, so the control says
    // what it now is rather than waiting to be redrawn.
    const say = (flipped) => {
      button.textContent = flipped ? 'Mirrored' : 'Normal';
      button.classList.toggle('on', flipped);
      note.textContent = flipped
        ? 'Turns the opposite way to an unmirrored one on the same key.'
        : 'Mirror this to make a facing pair close together on one key.';
    };
    button.addEventListener('click', () => {
      const flipped = !placed.config.flip;
      this.h.onConfigChange(placed.id, { flip: flipped });
      say(flipped);
    });
    say(Boolean(placed.config.flip));
    row.append(button);
    body.append(row, note);
  }

  /**
   * How hard a joint fights to keep the angle it was given. Slack lets it give
   * under load, which is sometimes what you want; tight holds its line. All
   * the way down switches the motor off and leaves a free pivot, which is the
   * only way to build a swing, a pendulum or a trailing arm.
   */
  renderTension(body, placed, part) {
    const [min, max] = part.tensionRange;
    const note = el('p', 'insp-blurb');
    const say = (value) => {
      if (value <= 0) {
        note.textContent = 'Free to turn. No drive at all — this is how a swing is made.';
      } else if (value < 0.5) {
        note.textContent = 'Slack. Gives under load and settles slowly.';
      } else if (value <= 1.5) {
        note.textContent = 'Normal. Holds a fair load without fighting itself.';
      } else if (value < 5) {
        note.textContent = 'Firm. Keeps its line under a heavy arm.';
      } else {
        note.textContent = 'Rigid. Takes about all you can hang on it.';
      }
    };
    this.renderSlider(body, 'Tension', jointTension(placed, part), min, max, 0.25, (value) => {
      this.h.onConfigChange(placed.id, { tension: value });
      say(value);
    });
    say(jointTension(placed, part));
    body.append(note);
  }

  // How far this piston reaches. Set per part, so a short jab and a long lift
  // can sit on the same machine.
  renderStroke(body, placed, part) {
    const [min, max] = part.strokeRange;
    const note = el('p', 'insp-blurb');
    const say = (value) => { note.textContent = `Reaches ${value.toFixed(2)} m when held.`; };
    this.renderSlider(body, 'Reach', pistonStroke(placed, part), min, max, 0.1, (value) => {
      this.h.onConfigChange(placed.id, { stroke: value });
      say(value);
    });
    say(pistonStroke(placed, part));
    body.append(note);
  }

  // A turntable is set up twice over: how fast it goes round, and how hard it
  // is allowed to push to get there. The second is what takes it from moving
  // a flap to swinging a loaded boom.
  renderTurntable(body, placed, part) {
    const [slow, fast] = part.spinRange;
    const [weak, strong] = part.torqueRange;
    const speedNote = el('p', 'insp-blurb');
    const saySpeed = (v) => { speedNote.textContent = `${v.toFixed(1)} rad/s — about ${(v / (Math.PI * 2)).toFixed(1)} turns a second.`; };
    this.renderSlider(body, 'Speed', turntableSpin(placed, part), slow, fast, 0.5, (value) => {
      this.h.onConfigChange(placed.id, { spin: value });
      saySpeed(value);
    });
    saySpeed(turntableSpin(placed, part));
    body.append(speedNote);

    const torqueNote = el('p', 'insp-blurb');
    const sayTorque = (v) => {
      const heft = v < 60 ? 'Light work only' : v < 250 ? 'Moves a modest arm' : v < 800 ? 'Swings a loaded boom' : 'Shifts almost anything';
      torqueNote.textContent = `${Math.round(v)} Nm — ${heft}.`;
    };
    this.renderSlider(body, 'Torque', turntableTorque(placed, part), weak, strong, 4, (value) => {
      this.h.onConfigChange(placed.id, { torque: value });
      sayTorque(value);
    });
    sayTorque(turntableTorque(placed, part));
    body.append(torqueNote);

    // A velocity motor stops where it is left. That is right for a crane and
    // wrong for a steering head or a turret that has to face front again.
    const row = el('div', 'row');
    row.append(el('label', null, 'On release'));
    const button = el('button');
    button.style.width = '100%';
    const note = el('p', 'insp-blurb');
    const say = (on) => {
      button.textContent = on ? 'Back to centre' : 'Stay put';
      button.classList.toggle('on', on);
      note.textContent = on
        ? 'Winds back to where it was built, the short way round.'
        : 'Holds wherever you stopped turning it.';
    };
    button.addEventListener('click', () => {
      const on = !turntableRecentres(placed, part);
      this.h.onConfigChange(placed.id, { recentre: on });
      say(on);
    });
    say(turntableRecentres(placed, part));
    row.append(button);
    body.append(row, note);
  }

  /**
   * The two places a servo goes and how fast it gets between them. Shown in
   * degrees because that is how anyone thinks about an angle, and with the
   * shorter of the two ways round spelled out, since that is the one it takes.
   */
  renderPositions(body, placed, part) {
    const [lo, hi] = part.angleRange;
    const note = el('p', 'insp-blurb');
    const say = () => {
      const a = servoAngleA(placed, part);
      const b = servoAngleB(placed, part);
      const turn = Math.abs(((((b - a) % 360) + 540) % 360) - 180);
      note.textContent = `${Math.round(turn)}° apart, the short way round`
        + ` — about ${(turn / servoSpeed(placed, part)).toFixed(2)}s to swap.`;
    };
    this.renderSlider(body, 'Angle A', servoAngleA(placed, part), lo, hi, 5, (value) => {
      this.h.onConfigChange(placed.id, { angleA: value });
      say();
    });
    this.renderSlider(body, 'Angle B', servoAngleB(placed, part), lo, hi, 5, (value) => {
      this.h.onConfigChange(placed.id, { angleB: value });
      say();
    });
    this.renderSlider(
      body, 'Speed', servoSpeed(placed, part),
      part.speedRange[0], part.speedRange[1], 10,
      (value) => { this.h.onConfigChange(placed.id, { speed: value }); say(); },
    );
    say();
    body.append(note);
  }

  /**
   * A strut is set up three ways: how hard it pushes back, how quickly it
   * stops moving afterwards, and how far it is allowed to move at all. Stiff
   * and short is a go-kart, soft and long is something that climbs.
   */
  /**
   * A pressure pad's two settings, which between them decide what a program
   * downstream of it can sensibly do.
   */
  renderPad(body, placed, part) {
    const row = el('div', 'row');
    row.append(el('label', null, 'Fires'));
    const button = el('button');
    button.style.width = '100%';
    const note = el('p', 'insp-blurb');
    const say = (mode) => {
      const once = mode === 'once';
      button.textContent = once ? 'One shot' : 'While pressed';
      button.classList.toggle('on', once);
      note.textContent = once
        ? 'A single pulse the moment something lands. What anything that toggles wants — fed a steady signal, a toggle flips every frame.'
        : 'On for as long as something is on it. What anything you want held open wants.';
    };
    button.addEventListener('click', () => {
      const mode = padMode(placed, part) === 'once' ? 'while' : 'once';
      this.h.onConfigChange(placed.id, { mode });
      say(mode);
    });
    say(padMode(placed, part));
    row.append(button);
    body.append(row, note);

    const dampNote = el('p', 'insp-blurb');
    const sayDamp = (v) => {
      dampNote.textContent = v < 0.05
        ? 'No damping. A load that bounces will read as several separate landings.'
        : `${v.toFixed(2)} s — rides out a bounce, and holds a one-shot pulse open that long.`;
    };
    this.renderSlider(
      body, 'Damping', padDamping(placed, part),
      part.dampingRange[0], part.dampingRange[1], 0.05,
      (value) => { this.h.onConfigChange(placed.id, { damping: value }); sayDamp(value); },
    );
    sayDamp(padDamping(placed, part));
    body.append(dampNote);
  }

  renderSpring(body, placed, part) {
    const stiffNote = el('p', 'insp-blurb');
    const sayStiff = (v) => {
      const feel = v < 600 ? 'Soft — sinks onto its load'
        : v < 1800 ? 'Road springs — gives over a kerb'
          : v < 3600 ? 'Firm — stays level under weight'
            : 'Race stiff — barely moves at all';
      stiffNote.textContent = `${Math.round(v)} N/m — ${feel}.`;
    };
    this.renderSlider(
      body, 'Stiffness', springStiffness(placed, part),
      part.stiffnessRange[0], part.stiffnessRange[1], 50,
      (value) => { this.h.onConfigChange(placed.id, { stiffness: value }); sayStiff(value); },
    );
    sayStiff(springStiffness(placed, part));
    body.append(stiffNote);

    const dampNote = el('p', 'insp-blurb');
    const sayDamp = (v) => {
      dampNote.textContent = v < 20
        ? 'No damping at all. It will pogo.'
        : `${Math.round(v)} — settles ${v < 120 ? 'slowly' : v < 320 ? 'in a bounce or two' : 'almost at once'}.`;
    };
    this.renderSlider(
      body, 'Damping', springDamping(placed, part),
      part.dampingRange[0], part.dampingRange[1], 10,
      (value) => { this.h.onConfigChange(placed.id, { damping: value }); sayDamp(value); },
    );
    sayDamp(springDamping(placed, part));
    body.append(dampNote);

    const travelNote = el('p', 'insp-blurb');
    const sayTravel = (v) => {
      travelNote.textContent = `${v.toFixed(2)} m of movement, ${(v / 2).toFixed(2)} m either way from where you built it.`;
    };
    this.renderSlider(
      body, 'Travel', springTravel(placed, part),
      part.travelRange[0], part.travelRange[1], 0.02,
      (value) => { this.h.onConfigChange(placed.id, { travel: value }); sayTravel(value); },
    );
    sayTravel(springTravel(placed, part));
    body.append(travelNote);
  }

  // How hard the coupling throws, including not at all — somebody with their
  // own thruster or piston on the stage wants it to do nothing but let go.
  renderSeparation(body, placed, part) {
    const [min, max] = part.separationRange;
    const note = el('p', 'insp-blurb');
    const say = (value) => {
      note.textContent = value <= 0
        ? 'Lets go and nothing more. Push it apart yourself.'
        : `Throws the halves apart at ${value.toFixed(1)} m/s.`;
    };
    this.renderSlider(body, 'Push', separationPush(placed, part), min, max, 0.2, (value) => {
      this.h.onConfigChange(placed.id, { separation: value });
      say(value);
    });
    say(separationPush(placed, part));
    body.append(note);
  }

  renderSlider(body, label, value, min, max, step, onInput) {
    const row = el('div', 'row');
    row.append(el('label', null, label));
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;
    const readout = el('span', 'value', Number(value).toFixed(2));
    slider.addEventListener('input', () => {
      readout.textContent = Number(slider.value).toFixed(2);
      onInput(Number(slider.value));
    });
    row.append(slider, readout);
    body.append(row);
  }

  // Built once per run; the per-frame update only touches the dot and the bar.
  buildObjectives(report) {
    const list = this.dom.objectiveList;
    list.innerHTML = '';
    this.objectiveRows = [];
    if (report.objectives.length === 0) {
      list.append(el('li', null, 'No objectives on this one. Go and break something.'));
      return;
    }
    for (const objective of report.objectives) {
      const item = el('li');
      const row = el('div', 'obj-row');
      const dot = el('span', 'obj-dot');
      row.append(dot, el('span', null, objective.label));
      const bar = el('div', 'obj-bar');
      const fill = el('div');
      bar.append(fill);
      item.append(row, bar);
      list.append(item);
      this.objectiveRows.push({ dot, fill });
    }
  }

  renderObjectives(report, level) {
    if (!this.objectiveRows || this.objectiveRows.length !== report.objectives.length) {
      this.buildObjectives(report);
    }
    report.objectives.forEach((objective, index) => {
      const row = this.objectiveRows[index];
      if (!row) return;
      row.dot.classList.toggle('done', objective.done);
      row.fill.style.width = `${Math.round(objective.progress * 100)}%`;
    });
    const rule = level.noContact ? ' · <strong>no contact</strong>'
      : level.noBumps ? ' · <strong>no bumps</strong>' : '';
    // On a level with a hard clock the number that matters is what is left,
    // not what has gone.
    if (level.deadline) {
      const left = Math.max(0, level.deadline - report.elapsed);
      this.dom.clock.classList.toggle('urgent', left <= level.deadline / 3);
      this.dom.clock.innerHTML =
        `<strong>${left.toFixed(1)}s</strong> left of ${level.deadline}s${rule}`;
      return;
    }
    const par = level.par ? ` · par ${level.par}s` : '';
    this.dom.clock.innerHTML =
      `Run time <strong>${report.elapsed.toFixed(1)}s</strong>${par}${rule}`;
  }

  /**
   * The time is the headline, because that is the bragging right; under it,
   * the machine that set it. A run is only worth anything next to what it was
   * done with, so the card names every part you spent.
   */
  /**
   * A scored level ends with a number rather than a time, and bigger is
   * better. Same card, because it is the same moment — you are being told how
   * you did and offered the next thing.
   */
  showScore(level, report, cost, blueprint, next, { modded = false, fun = false } = {}) {
    const dom = this.dom;
    dom.winKicker.textContent = 'Time up';
    dom.winTitle.textContent = level.name;
    dom.winClock.textContent = String(report.score ?? 0);
    const best = store.result(level.id)?.bestScore;
    const record = !modded && !fun && (best === undefined || (report.score ?? 0) >= best);
    dom.winClock.classList.toggle('beat', record);
    dom.winStats.innerHTML = [
      `<span>${report.scoreLabel ?? 'Score'}</span>`,
      `<span>Cost <strong>${cost}</strong></span>`,
      fun ? FUN : (modded ? MODDED
        : (record ? '<span class="beat"><strong>Personal best</strong></span>'
          : `<span>Best <strong>${best}</strong></span>`)),
    ].join('');
    this.renderRig(blueprint);
    dom.winNext.textContent = next ? 'Play next challenge' : 'Back to challenges';
    dom.win.hidden = false;
    dom.winNext.focus();
  }

  showWin(level, report, cost, blueprint, next, { modded = false, fun = false } = {}) {
    const dom = this.dom;
    dom.winTitle.textContent = level.name;

    const beatPar = level.par && report.elapsed <= level.par;
    dom.winClock.textContent = `${report.elapsed.toFixed(1)}s`;
    dom.winClock.classList.toggle('beat', Boolean(beatPar));

    const best = store.result(level.id)?.best;
    const record = !modded && !fun && best !== undefined && report.elapsed <= best + 1e-6;
    dom.winStats.innerHTML = [
      level.par ? `<span${beatPar ? ' class="beat"' : ''}>Par <strong>${level.par}s</strong></span>` : '',
      `<span>Cost <strong>${cost}</strong></span>`,
      `<span>Parts <strong>${blueprint?.size ?? 0}</strong></span>`,
      fun ? FUN : (modded ? MODDED
        : (record ? '<span class="beat"><strong>Personal best</strong></span>'
          : (best !== undefined ? `<span>Best <strong>${best.toFixed(1)}s</strong></span>` : ''))),
    ].filter(Boolean).join('');

    this.renderRig(blueprint);

    dom.winNext.textContent = next ? 'Play next challenge' : 'Back to challenges';
    dom.win.hidden = false;
    dom.winNext.focus();
  }

  // Every part that went into the winning machine, most-used first.
  renderRig(blueprint) {
    const list = this.dom.winParts;
    list.innerHTML = '';
    const counts = new Map();
    for (const placed of blueprint?.list() ?? []) {
      counts.set(placed.type, (counts.get(placed.type) ?? 0) + 1);
    }
    this.dom.winRig.hidden = counts.size === 0;
    const ordered = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [type, count] of ordered) {
      const part = findPart(type);
      list.append(el('li', null, `${count} x ${part?.name ?? 'a part you no longer have'}`));
    }
  }

  showFailure(level, report, reason) {
    this.dom.win.classList.add('failed');
    this.dom.winKicker.textContent = 'Run failed';
    this.dom.winTitle.textContent = reason;
    this.dom.winClock.textContent = `${report.elapsed.toFixed(1)}s`;
    this.dom.winClock.classList.remove('beat');
    this.dom.winStats.innerHTML = `<span>${level.name}</span>`;
    this.dom.winRig.hidden = true;
    this.dom.winNext.textContent = 'Back to challenges';
    this.dom.win.hidden = false;
  }

  hideWin() {
    this.dom.win.hidden = true;
    this.dom.win.classList.remove('failed');
    this.dom.winKicker.textContent = 'Challenge complete';
  }

  get winIsOpen() {
    return !this.dom.win.hidden;
  }

  // ------------------------------------------------------- machine picker

  /**
   * Two machines to start from and whatever you have saved, each shown as
   * what it actually is. A dropdown of names told you nothing: the whole
   * point of the garage is that you recognise your own machines by sight.
   */
  openPicker() {
    const grid = this.dom.pickerGrid;
    grid.innerHTML = '';

    const add = (title) => grid.append(el('div', 'picker-head', title));
    const card = (name, note, blueprint, go) => {
      const button = el('button', 'pick');
      const shot = el('div', 'pick-shot');
      const image = document.createElement('img');
      image.alt = '';
      try {
        image.src = renderMachine(blueprint);
      } catch {
        shot.style.background = 'linear-gradient(135deg,#141c27,#0b1018)';
      }
      shot.append(image);
      const meat = el('div', 'pick-meat');
      meat.append(el('b', null, name), el('span', null, note));
      button.append(shot, meat);
      button.addEventListener('click', () => {
        this.closePicker();
        go();
      });
      grid.append(button);
    };

    add('Start from');
    for (const preset of this.h.presets()) {
      card(
        preset.name,
        `${preset.blueprint.size} parts · cost ${preset.blueprint.cost()}`,
        preset.blueprint,
        () => this.h.onPreset(preset.id),
      );
    }

    add('Your machines');
    const saved = store.machines();
    if (saved.length === 0) {
      grid.append(el('div', 'picker-empty', 'Nothing saved yet. Press Save while you are building and it will be here.'));
    }
    for (const machine of saved) {
      const blueprint = this.h.blueprintOf(machine);
      if (!blueprint) continue;
      card(
        machine.name,
        `${blueprint.size} parts · cost ${blueprint.cost()}`,
        blueprint,
        () => this.h.onLoadMachine(machine.id),
      );
    }

    this.dom.picker.hidden = false;
  }

  closePicker() {
    this.dom.picker.hidden = true;
  }

  get pickerIsOpen() {
    return !this.dom.picker.hidden;
  }

  // --------------------------------------------------------- course tour

  setSurvey(caption, step, of) {
    this.dom.survey.hidden = false;
    this.dom.surveyStep.textContent = `${step} / ${of}`;
    this.dom.surveyCaption.textContent = caption;
  }

  hideSurvey() {
    this.dom.survey.hidden = true;
  }

  /**
   * A yes-or-no question, resolving to what was chosen. Escape and the
   * backdrop both count as no, so there is no way to leave by accident.
   */
  confirm({ title, body, ok = 'Yes', cancel = 'Cancel' }) {
    const dom = this.dom;
    dom.modalTitle.textContent = title;
    dom.modalBody.textContent = body;
    dom.modalOk.textContent = ok;
    dom.modalCancel.textContent = cancel;
    dom.modal.hidden = false;
    dom.modalOk.focus();

    return new Promise((resolve) => {
      const finish = (answer) => {
        dom.modal.hidden = true;
        dom.modalOk.removeEventListener('click', yes);
        dom.modalCancel.removeEventListener('click', no);
        dom.modal.removeEventListener('mousedown', backdrop);
        removeEventListener('keydown', key, true);
        resolve(answer);
      };
      const yes = () => finish(true);
      const no = () => finish(false);
      const backdrop = (event) => { if (event.target === dom.modal) finish(false); };
      const key = (event) => {
        if (event.key !== 'Escape' && event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        finish(event.key === 'Enter');
      };
      dom.modalOk.addEventListener('click', yes);
      dom.modalCancel.addEventListener('click', no);
      dom.modal.addEventListener('mousedown', backdrop);
      addEventListener('keydown', key, true);
    });
  }

  get modalIsOpen() {
    return !this.dom.modal.hidden;
  }

  toast(message, bad = false) {
    const node = this.dom.toast;
    node.textContent = message;
    node.classList.toggle('bad', bad);
    node.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
  }

  ready() {
    this.dom.loading.classList.add('done');
  }
}
