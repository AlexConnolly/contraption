import { CATEGORIES, partsInCategory, getPart } from '../parts/registry.js';
import { BINDING_MODES, bindingLabel, keyLabel, defaultBinding } from '../sim/signals.js';
import { LEVELS } from '../challenges/levels.js';

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

  setMode(mode) {
    const test = mode === 'test';
    this.dom.modeStudio.classList.toggle('active', !test);
    this.dom.modeTest.classList.toggle('active', test);
    this.dom.palette.hidden = test;
    this.dom.inspector.hidden = test;
    this.dom.objectives.hidden = !test;
    this.setHelp(mode);
  }

  setHelp(mode) {
    this.dom.help.innerHTML = '';
    for (const [keys, label] of HELP[mode]) {
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

  renderSensor(body, placed, part) {
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
