import './menu.css';
import { LEVELS, tierOf, tier } from '../challenges/levels.js';
import { store } from './progress.js';
import { levelThumb, renderMachine } from './thumbnails.js';
import { Blueprint } from '../core/blueprint.js';

const SVG = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  garage: '<path d="M3 20V11l9-6 9 6v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 20h18M8 20v-5h8v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  cog: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  exit: '<path d="M16 17l5-5-5-5M21 12H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  tick: '<path d="M4 12.5 9.5 18 20 6.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${SVG[name]}</svg>`;
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function seconds(value) {
  return `${value.toFixed(1)}s`;
}

/**
 * The front end: a title screen with the live scene behind it, and the three
 * screens it leads to. The game itself is hidden while any of these is up.
 */
export class FrontEnd {
  constructor({ RAPIER, handlers }) {
    this.RAPIER = RAPIER;
    this.h = handlers;
    this.screen = null;

    this.root = el('div', 'fe');
    this.root.hidden = true;
    this.scan = el('div', 'fe-scan');
    this.scan.hidden = true;
    this.scanOn = true;

    this.top = el('header', 'fe-top');
    this.body = el('div', 'fe-body');
    this.root.append(this.top, this.body);
    document.body.append(this.scan, this.root);

    addEventListener('keydown', (event) => {
      if (this.root.hidden || event.key !== 'Escape') return;
      if (this.screen === 'title') return;
      event.preventDefault();
      this.show('title');
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open(screen = 'title') {
    this.root.hidden = false;
    this.scan.hidden = !this.scanOn;
    this.show(screen);
  }

  setScanlines(on) {
    this.scanOn = on;
    this.scan.hidden = !on || !this.isOpen;
  }

  close() {
    this.root.hidden = true;
    this.scan.hidden = true;
    this.screen = null;
  }

  show(screen) {
    this.screen = screen;
    this.root.classList.toggle('title', screen === 'title');
    this.root.classList.toggle('solid', screen !== 'title');
    this.top.innerHTML = '';
    this.body.innerHTML = '';

    if (screen === 'title') this.renderTitle();
    if (screen === 'challenges') this.renderChallenges();
    if (screen === 'garage') this.renderGarage();
    if (screen === 'settings') this.renderSettings();
  }

  backBar(label) {
    const back = el('button', 'fe-back', `${icon('back', 15)} Back`);
    back.addEventListener('click', () => this.show('title'));
    const title = el('div', 'fe-pill', `<b>${label}</b>`);
    this.top.append(back, title, el('span', 'fe-spacer'));
  }

  // ------------------------------------------------------------------ title

  renderTitle() {
    const campaign = LEVELS.filter((l) => l.id !== 'sandbox');
    const solved = store.solvedCount(campaign.map((l) => l.id));
    const next = campaign.find((l) => !store.solved(l.id)) ?? campaign[campaign.length - 1];

    this.top.append(
      el('span', 'fe-spacer'),
      el('div', 'fe-pill', `SOLVED <b>${solved} / ${campaign.length}</b>`),
    );

    const hero = el('div', 'fe-hero');
    hero.append(
      el('div', 'fe-kicker', '<span class="fe-mark"><i></i></span><span>Build it · Drive it · Fix it</span>'),
      el('div', null, '<h1 class="fe-logo">Contrap<i>tion</i></h1><div class="fe-rule"></div>'),
    );

    const menu = el('nav', 'fe-menu');
    menu.setAttribute('aria-label', 'Main menu');

    const items = [
      {
        label: 'Challenges',
        glyph: 'play',
        lead: true,
        meta: solved >= campaign.length
          ? '<b>All solved</b>'
          : `<b>${solved} / ${campaign.length}</b> &nbsp;Next · ${next.name.split('—')[0].trim()}`,
        go: () => this.show('challenges'),
      },
      {
        label: 'Garage',
        glyph: 'garage',
        meta: `${store.machines().length} saved`,
        go: () => this.show('garage'),
      },
      { label: 'Settings', glyph: 'cog', meta: 'Camera · Graphics', go: () => this.show('settings') },
      { label: 'Exit', glyph: 'exit', meta: '', exit: true, go: () => this.h.onExit() },
    ];

    for (const item of items) {
      const button = el(
        'button',
        `fe-item${item.lead ? ' lead' : ''}${item.exit ? ' exit' : ''}`,
        `<span class="g">${icon(item.glyph, item.exit ? 14 : 17)}</span>`
        + `<span>${item.label}</span>`
        + `<span class="m">${item.meta}</span>`,
      );
      button.addEventListener('click', item.go);
      menu.append(button);
    }

    hero.append(menu);
    this.body.append(hero);
    menu.querySelector('.fe-item')?.focus();
  }

  // ------------------------------------------------------------- challenges

  renderChallenges() {
    const campaign = LEVELS.filter((l) => l.id !== 'sandbox');
    const solved = store.solvedCount(campaign.map((l) => l.id));
    this.backBar('Challenges');
    this.top.append(el('div', 'fe-pill', `SOLVED <b>${solved} / ${campaign.length}</b>`));

    const sheet = el('div', 'fe-sheet');
    sheet.append(el('div', 'fe-head', '<h2>Challenges</h2><p>Pick a problem. The parts budget and the rules are set by the brief.</p>'));

    const grid = el('div', 'fe-grid');
    for (const level of LEVELS) grid.append(this.challengeCard(level));
    sheet.append(grid);
    this.body.append(sheet);
  }

  challengeCard(level) {
    const result = store.result(level.id);
    const done = Boolean(result?.best);
    const number = level.name.includes('—') ? level.name.split('—')[0].trim() : '';
    const name = level.name.includes('—') ? level.name.split('—')[1].trim() : level.name;

    const card = el('button', `fe-card${done ? ' done' : ''}`);
    const shot = el('div', 'fe-shot');

    // Drawn from the level itself, so it can never show the wrong course.
    const image = new Image();
    image.alt = '';
    image.decoding = 'async';
    try {
      image.src = levelThumb(this.RAPIER, level);
    } catch {
      shot.style.background = 'linear-gradient(135deg,#101823,#0b1018)';
    }
    shot.append(image);

    if (number) shot.append(el('span', 'num', number));
    if (done) shot.append(el('span', 'tick', icon('tick', 15)));

    const skill = tierOf(level);
    if (skill) {
      const badge = el('span', `fe-skill ${skill}`, tier(skill).name);
      badge.title = tier(skill).note;
      shot.append(badge);
    }

    const rules = el('div', 'rules');
    if (level.handsOff) rules.append(el('span', 'fe-tag rule', 'No input'));
    if (level.noContact) rules.append(el('span', 'fe-tag rule', 'No collisions'));
    if (!level.objectives.length) rules.append(el('span', 'fe-tag free', 'Free play'));
    shot.append(rules);

    const facts = el('div', 'fe-facts');
    facts.append(el('span', null, level.budget ? `Budget <b>${level.budget.cost}</b>` : 'Budget <b>—</b>'));
    facts.append(el('span', null, level.par ? `Par <b>${level.par}s</b>` : 'Par <b>—</b>'));
    if (done) facts.append(el('span', 'best', `Best <b>${seconds(result.best)}</b>`));

    const meat = el('div', 'fe-meat');
    meat.append(el('h3', null, name), el('p', null, level.brief), facts);

    card.append(shot, meat);
    card.addEventListener('click', () => this.h.onPlay(level.id));
    return card;
  }

  // ----------------------------------------------------------------- garage

  renderGarage() {
    this.backBar('Garage');
    const machines = store.machines();
    this.top.append(el('div', 'fe-pill', `<b>${machines.length}</b> machines`));

    const sheet = el('div', 'fe-sheet');
    sheet.append(el('div', 'fe-head', '<h2>Garage</h2><p>Machines you have saved. Any of them can be taken into any challenge.</p>'));

    const grid = el('div', 'fe-grid');

    const add = el('button', 'fe-card add', `${icon('plus', 26)}<span>Save what you are building</span>`);
    add.addEventListener('click', () => {
      const name = prompt('Name this machine', this.h.suggestName());
      if (!name) return;
      this.h.onSaveMachine(name.slice(0, 28));
      this.show('garage');
    });
    grid.append(add);

    for (const machine of machines) grid.append(this.machineCard(machine));
    sheet.append(grid);

    if (machines.length === 0) {
      sheet.append(el('p', 'fe-empty', 'Nothing saved yet. Build something and save it here.'));
    }
    this.body.append(sheet);
  }

  machineCard(machine) {
    const blueprint = Blueprint.fromJSON(machine.blueprint);
    const card = el('button', 'fe-card');
    const shot = el('div', 'fe-shot');
    const image = new Image();
    image.alt = '';
    image.src = machine.thumb ?? renderMachine(blueprint);
    shot.append(image);

    const facts = el('div', 'fe-facts');
    facts.append(
      el('span', null, `Parts <b>${blueprint.size}</b>`),
      el('span', null, `Cost <b>${blueprint.cost()}</b>`),
    );

    const meat = el('div', 'fe-meat');
    meat.append(el('h3', null, machine.name), facts);

    const row = el('div', 'fe-row');
    const open = el('button', 'fe-mini', 'Open');
    open.addEventListener('click', (event) => {
      event.stopPropagation();
      this.h.onLoadMachine(machine.id);
    });
    const rename = el('button', 'fe-mini', 'Rename');
    rename.addEventListener('click', (event) => {
      event.stopPropagation();
      const name = prompt('Rename machine', machine.name);
      if (name) {
        store.renameMachine(machine.id, name.slice(0, 28));
        this.show('garage');
      }
    });
    const remove = el('button', 'fe-mini danger', 'Delete');
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      store.deleteMachine(machine.id);
      this.show('garage');
    });
    row.append(open, rename, remove);
    meat.append(row);

    card.append(shot, meat);
    card.addEventListener('click', () => this.h.onLoadMachine(machine.id));
    return card;
  }

  // --------------------------------------------------------------- settings

  renderSettings() {
    this.backBar('Settings');
    const sheet = el('div', 'fe-sheet');
    sheet.append(el('div', 'fe-head', '<h2>Settings</h2><p>Everything here applies straight away.</p>'));

    const list = el('div', 'fe-settings');
    const current = this.h.getSettings();

    const rows = [
      {
        key: 'camera',
        title: 'Camera in test',
        note: 'Chase follows the machine. Orbit lets you fly the camera yourself.',
        options: [['chase', 'Chase'], ['orbit', 'Orbit']],
      },
      {
        key: 'shadows',
        title: 'Shadows',
        note: 'The most expensive thing on screen. Turn them off on a slower machine.',
        options: [['on', 'On'], ['off', 'Off']],
      },
      {
        key: 'scanlines',
        title: 'Screen effect',
        note: 'The scanline and vignette pass over the menus.',
        options: [['on', 'On'], ['off', 'Off']],
      },
      {
        key: 'volume',
        title: 'Sound',
        note: 'Motors, rotors and the interface.',
        options: [['full', 'Full'], ['low', 'Low'], ['off', 'Off']],
      },
    ];

    for (const row of rows) {
      const item = el('div', 'fe-set');
      item.append(el('div', null, `<h4>${row.title}</h4><p>${row.note}</p>`));
      const choice = el('div', 'fe-choice');
      for (const [value, label] of row.options) {
        const button = el('button', null, label);
        button.setAttribute('aria-pressed', String(current[row.key] === value));
        button.addEventListener('click', () => {
          this.h.onSetting(row.key, value);
          this.show('settings');
        });
        choice.append(button);
      }
      item.append(choice);
      list.append(item);
    }

    sheet.append(list);
    this.body.append(sheet);
  }
}
