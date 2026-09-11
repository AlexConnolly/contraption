import { CATEGORIES, partsInCategory, getPart } from '../parts/registry.js';
import { BINDING_MODES, bindingLabel, keyLabel, defaultBinding } from '../sim/signals.js';
import { LEVELS } from '../challenges/levels.js';
import { estimateGains, firstController, controllerOf } from '../sim/flight.js';

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
      levelSelect: document.getElementById('level-select'),
      presetSelect: document.getElementById('preset-select'),
      modeStudio: document.getElementById('mode-studio'),
      modeTest: document.getElementById('mode-test'),
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
      help: document.getElementById('help'),
      toast: document.getElementById('toast'),
      win: document.getElementById('win'),
      winTitle: document.getElementById('win-title'),
      winStats: document.getElementById('win-stats'),
      loading: document.getElementById('loading'),
    };
    this.wire();
    this.buildLevelSelect();
    this.buildPalette();
  }

  wire() {
    const { h, dom } = this;
    dom.levelSelect.addEventListener('change', (e) => h.onLevelChange(e.target.value));
    dom.presetSelect.addEventListener('change', (e) => {
      if (!e.target.value) return;
      h.onPreset(e.target.value);
      e.target.value = '';
    });
    dom.modeStudio.addEventListener('click', () => h.onModeChange('studio'));
    dom.modeTest.addEventListener('click', () => h.onModeChange('test'));
    document.getElementById('btn-save').addEventListener('click', () => h.onSave());
    document.getElementById('btn-load').addEventListener('click', () => h.onLoad());
    document.getElementById('btn-clear').addEventListener('click', () => h.onClear());
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
    for (const button of document.querySelectorAll('.tool')) {
      button.addEventListener('click', () => h.onSelectTool(button.dataset.tool));
    }
  }

  buildLevelSelect() {
    for (const level of LEVELS) {
      const option = el('option', null, level.name);
      option.value = level.id;
      this.dom.levelSelect.append(option);
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
      for (const part of parts) {
        const button = el('button', 'part-btn');
        const swatch = el('span', 'part-swatch');
        swatch.style.background = `#${part.colour.toString(16).padStart(6, '0')}`;
        button.append(swatch, el('span', 'part-name', part.name));
        if (part.cost > 0) button.append(el('span', 'part-cost', String(part.cost)));
        button.title = part.blurb;
        button.addEventListener('click', () => this.h.onSelectPart(part.id));
        list.append(button);
        this.partButtons.set(part.id, button);
      }
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

  setMode(mode, flightKeys = null) {
    const test = mode === 'test';
    this.flightKeys = flightKeys;
    this.dom.modeStudio.classList.toggle('active', !test);
    this.dom.modeTest.classList.toggle('active', test);
    this.dom.palette.hidden = test;
    this.dom.inspector.hidden = test;
    this.dom.objectives.hidden = !test;
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
    this.dom.levelSelect.value = level.id;
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

    if (part.computer) this.renderComputer(body, placed);
    if (part.flight) this.renderController(body, placed, part, blueprint);
    if (part.actuator) this.renderBinding(body, placed, part, blueprint);
    if (part.sensor) this.renderSensor(body, placed, part);
    if (part.actuator && (part.actuator.kind === 'motor' || part.actuator.kind === 'thrust')) {
      this.renderSlider(body, 'Power', placed.config.power ?? 1, 0.1, 1, 0.05, (value) => {
        this.h.onConfigChange(placed.id, { power: value });
      });
    }

    const remove = el('button', 'danger', 'Delete part');
    remove.style.width = '100%';
    remove.style.marginTop = '6px';
    remove.addEventListener('click', () => this.h.onDeleteSelected());
    body.append(remove);
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
    this.dom.clock.innerHTML = `Run time <strong>${report.elapsed.toFixed(1)}s</strong>${par}`;
  }

  showWin(level, report, cost) {
    this.dom.winTitle.textContent = level.name;
    const beatPar = level.par && report.elapsed <= level.par;
    this.dom.winStats.innerHTML = [
      `Time <strong>${report.elapsed.toFixed(1)}s</strong>`,
      level.par ? `Par <strong>${level.par}s</strong>${beatPar ? ' ✓' : ''}` : '',
      `Cost <strong>${cost}</strong>`,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    this.dom.win.hidden = false;
  }

  hideWin() {
    this.dom.win.hidden = true;
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
