import { CATEGORIES, partsInCategory, getPart, pistonStroke, workingAxis } from '../parts/registry.js';
import { BINDING_MODES, bindingLabel, keyLabel, defaultBinding } from '../sim/signals.js';
import { estimateGains, firstController, controllerOf } from '../sim/flight.js';
import { renderPart } from './thumbnails.js';
import { store } from './progress.js';

const HELP = {
  studio: [
    ['Left click', 'place'],
    ['Right drag', 'orbit'],
    ['Middle drag', 'pan'],
    ['R / T', 'rotate part'],
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

export class Hud {
  constructor(handlers) {
    this.h = handlers;
    this.dom = {
      crumbLevel: document.getElementById('crumb-level'),
      modal: document.getElementById('modal'),
      modalTitle: document.getElementById('modal-title'),
      modalBody: document.getElementById('modal-body'),
      modalOk: document.getElementById('modal-ok'),
      modalCancel: document.getElementById('modal-cancel'),
      presetSelect: document.getElementById('preset-select'),
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
      const leave = await this.confirm({
        title: 'Back to challenges?',
        body: 'Your machine is saved against this challenge, so it will be '
          + 'here when you come back. The run you are on now ends.',
        ok: 'Leave challenge',
        cancel: 'Stay here',
      });
      if (leave) h.onLeaveChallenge();
    });
    dom.presetSelect.addEventListener('change', (e) => {
      if (!e.target.value) return;
      h.onPreset(e.target.value);
      e.target.value = '';
    });
    dom.modeStudio.addEventListener('click', () => h.onModeChange('studio'));
    dom.modeView.addEventListener('click', () => h.onModeChange('view'));
    dom.modeTest.addEventListener('click', () => h.onModeChange('test'));
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
    this.flightKeys = flightKeys;
    for (const [name, node] of [
      ['studio', this.dom.modeStudio],
      ['view', this.dom.modeView],
      ['test', this.dom.modeTest],
    ]) {
      node.classList.toggle('active', mode === name);
    }
    // Building tools in the studio, the run panel in test, and in view just
    // the course and what it is asking of you.
    this.dom.palette.hidden = mode !== 'studio';
    this.dom.inspector.hidden = mode !== 'studio';
    this.dom.objectives.hidden = mode === 'studio';
    this.dom.viewbar.hidden = mode !== 'view';
    // In view there is no run, so no clock and nothing to respawn.
    this.dom.clock.hidden = mode !== 'test';
    this.dom.testControls.hidden = mode !== 'test';
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

  setLevel(level) {
    this.dom.crumbLevel.textContent = level.name;
    this.dom.viewGoal.textContent = level.brief;
    this.dom.briefTitle.textContent = level.name;
    this.dom.briefText.textContent = level.brief;
    this.dom.briefHint.textContent = level.hint ?? '';
  }

  setBudget(cost, budget, partCount) {
    const over = budget && cost > budget;
    this.dom.budget.classList.toggle('over', Boolean(over));
    this.dom.budget.innerHTML = budget
      ? `${partCount} parts · cost <strong>${cost}</strong> / ${budget}`
      : `${partCount} parts · cost <strong>${cost}</strong>`;
  }

  clearInspector(message) {
    this.dom.inspectorBody.className = 'empty';
    this.dom.inspectorBody.textContent = message;
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
    if (part.computer) this.renderComputer(body, placed);
    if (part.flight) this.renderController(body, placed, part, blueprint);
    if (part.actuator) this.renderBinding(body, placed, part, blueprint);
    if (part.sensor) this.renderSensor(body, placed, part);
    if (part.actuator && (part.actuator.kind === 'motor' || part.actuator.kind === 'thrust')) {
      this.renderSlider(body, 'Power', placed.config.power ?? 1, 0.1, 1, 0.05, (value) => {
        this.h.onConfigChange(placed.id, { power: value });
      });
    }
    if (part.strokeRange) this.renderStroke(body, placed, part);

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
  renderFacing(body, placed, part) {
    const row = el('div', 'row');
    row.append(el('label', null, 'Facing'));
    const buttons = el('div', 'keybind');
    for (const [how, label] of [['yaw', 'Turn R'], ['pitch', 'Tip T']]) {
      const button = el('button', null, label);
      button.addEventListener('click', () => this.h.onTurnPart(placed.id, how));
      buttons.append(button);
    }
    row.append(buttons);
    body.append(row);
    if (workingAxis(part)) {
      body.append(el('p', 'insp-blurb', 'The arrow on it shows which way it faces.'));
    }
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
      list.append(el('li', null, 'Sandbox — no objectives. Go and break something.'));
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
    const par = level.par ? ` · par ${level.par}s` : '';
    const rule = level.noContact ? ' · <strong>no contact</strong>' : '';
    this.dom.clock.innerHTML =
      `Run time <strong>${report.elapsed.toFixed(1)}s</strong>${par}${rule}`;
  }

  /**
   * The time is the headline, because that is the bragging right; under it,
   * the machine that set it. A run is only worth anything next to what it was
   * done with, so the card names every part you spent.
   */
  showWin(level, report, cost, blueprint, next) {
    const dom = this.dom;
    dom.winTitle.textContent = level.name;

    const beatPar = level.par && report.elapsed <= level.par;
    dom.winClock.textContent = `${report.elapsed.toFixed(1)}s`;
    dom.winClock.classList.toggle('beat', Boolean(beatPar));

    const best = store.result(level.id)?.best;
    const record = best !== undefined && report.elapsed <= best + 1e-6;
    dom.winStats.innerHTML = [
      level.par ? `<span${beatPar ? ' class="beat"' : ''}>Par <strong>${level.par}s</strong></span>` : '',
      `<span>Cost <strong>${cost}</strong></span>`,
      `<span>Parts <strong>${blueprint?.size ?? 0}</strong></span>`,
      record ? '<span class="beat"><strong>Personal best</strong></span>'
        : (best !== undefined ? `<span>Best <strong>${best.toFixed(1)}s</strong></span>` : ''),
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
      const part = getPart(type);
      list.append(el('li', null, `${count} x ${part.name}`));
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
