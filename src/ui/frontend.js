import './menu.css';
import { LEVELS, tierOf, tier } from '../challenges/levels.js';
import { bansOn } from '../challenges/bans.js';
import { store } from './progress.js';
import { levelThumb, renderMachine } from './thumbnails.js';
import { Blueprint } from '../core/blueprint.js';
import { customLevels, deleteCustomLevel } from '../challenges/custom.js';
import { toShareCode, fromShareCode } from '../challenges/format.js';

const SVG = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  garage: '<path d="M3 20V11l9-6 9 6v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 20h18M8 20v-5h8v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  cog: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  exit: '<path d="M16 17l5-5-5-5M21 12H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  tick: '<path d="M4 12.5 9.5 18 20 6.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  build: '<path d="M3 20h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5 20V9l5-4 5 4v11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 20v-6h4v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
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

    // Drawing a course costs about 60 ms, nearly all of it the render and the
    // encode to an image. Fifty-odd of those before the grid is shown is four
    // to five seconds of a dead page, so they are drawn only when the card
    // they belong to is actually on screen, one per frame.
    this.thumbQueue = [];
    this.thumbDraining = false;
    this.thumbWatcher = typeof IntersectionObserver === 'undefined' ? null
      : new IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          const draw = entry.target.__drawThumb;
          if (draw) this.thumbQueue.push(draw);
        }
        this.drainThumbs();
      }, { rootMargin: '400px' });

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
    if (screen === 'build') this.renderBuild();
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
      {
        label: 'Build',
        glyph: 'build',
        meta: `${customLevels().length} of your own`,
        go: () => this.show('build'),
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
    // Numbered by where a challenge sits in the campaign rather than by a
    // number baked into its name. The campaign sorts itself by difficulty and
    // there are dozens of levels now, so a hand-written "4 —" stops meaning
    // anything the moment a pack lands either side of it.
    let at = 0;
    for (const level of LEVELS) {
      const number = level.objectives.length > 0 ? String(++at) : '';
      grid.append(this.challengeCard(level, number));
    }
    sheet.append(grid);

    // Levels people made are kept after the campaign and unnumbered. They are
    // not part of its ramp and they do not count toward the tally, so putting
    // them in the run of it would be saying something untrue.
    const mine = customLevels();
    if (mine.length > 0) {
      sheet.append(el('div', 'fe-head sub', '<h2>Made by you</h2><p>Your own problems and any you have been sent.</p>'));
      const own = el('div', 'fe-grid');
      for (const level of mine) own.append(this.challengeCard(level, ''));
      sheet.append(own);
    }
    this.body.append(sheet);
  }

  /**
   * One picture per frame. Enough of them land in a few hundred milliseconds
   * that the grid never looks empty, and no single frame is long enough to
   * feel like a stall.
   */
  drainThumbs() {
    if (this.thumbDraining) return;
    this.thumbDraining = true;
    const step = () => {
      const job = this.thumbQueue.shift();
      if (!job) { this.thumbDraining = false; return; }
      job();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /**
   * Gives a card its picture when it comes into view. Without a watcher to
   * hang it on — an old browser, or a test — it is drawn straight away, which
   * is what used to happen to all of them at once.
   */
  lazyThumb(shot, level) {
    const image = new Image();
    image.alt = '';
    image.decoding = 'async';
    shot.append(image);
    const draw = () => {
      try {
        image.src = levelThumb(this.RAPIER, level);
      } catch {
        shot.style.background = 'linear-gradient(135deg,#101823,#0b1018)';
      }
    };
    if (!this.thumbWatcher) { draw(); return; }
    shot.__drawThumb = draw;
    this.thumbWatcher.observe(shot);
  }

  challengeCard(level, number) {
    const result = store.result(level.id);
    const done = Boolean(result?.best);
    const name = level.name;

    const card = el('button', `fe-card${done ? ' done' : ''}`);
    const shot = el('div', 'fe-shot');

    // Drawn from the level itself, so it can never show the wrong course.
    this.lazyThumb(shot, level);

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
    if (level.deadline) rules.append(el('span', 'fe-tag rule', `${level.deadline}s limit`));
    // In red, because a ban takes something away rather than asking for
    // something extra — and because it is the thing that decides what you
    // build, so it has to be legible from the card.
    for (const ban of bansOn(level)) {
      const tag = el('span', 'fe-tag ban', ban.name);
      tag.title = ban.note;
      rules.append(tag);
    }
    if (!level.objectives.length) rules.append(el('span', 'fe-tag free', 'Free play'));
    if (level.custom) rules.append(el('span', 'fe-tag own', 'Yours'));
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

  // -------------------------------------------------------------------- build

  renderBuild() {
    this.backBar('Build');
    const mine = customLevels();
    this.top.append(el('div', 'fe-pill', `<b>${mine.length}</b> levels`));

    const sheet = el('div', 'fe-sheet');
    sheet.append(el('div', 'fe-head', '<h2>Build</h2><p>Make your own problem. Anything you build can be sent to somebody else as a code.</p>'));

    const grid = el('div', 'fe-grid');

    const add = el('button', 'fe-card add', `${icon('plus', 26)}<span>Start a new problem</span>`);
    add.addEventListener('click', () => this.h.onBuildLevel(null));
    grid.append(add);

    const paste = el('button', 'fe-card add', `${icon('back', 22)}<span>Open a level code</span>`);
    paste.addEventListener('click', async () => {
      const code = prompt('Paste a level code');
      if (!code) return;
      const result = await fromShareCode(code);
      if (!result.ok) {
        this.h.onToast?.(result.reason, true);
        return;
      }
      this.h.onBuildLevel(result.level);
    });
    grid.append(paste);

    for (const level of mine) grid.append(this.customCard(level));
    sheet.append(grid);

    if (mine.length === 0) {
      sheet.append(el('p', 'fe-empty', 'Nothing built yet. Start a new problem and put something in the way.'));
    }
    this.body.append(sheet);
  }

  customCard(level) {
    const card = el('button', 'fe-card');
    const shot = el('div', 'fe-shot');
    this.lazyThumb(shot, level);

    const skill = tierOf(level);
    if (skill) {
      const badge = el('span', `fe-skill ${skill}`, tier(skill).name);
      shot.append(badge);
    }

    const facts = el('div', 'fe-facts');
    facts.append(
      el('span', null, `Budget <b>${level.budget.cost}</b>`),
      el('span', null, `Par <b>${level.par}s</b>`),
    );

    const meat = el('div', 'fe-meat');
    meat.append(el('h3', null, level.name), el('p', null, level.brief), facts);

    const row = el('div', 'fe-row');
    const play = el('button', 'fe-mini', 'Play');
    play.addEventListener('click', (event) => {
      event.stopPropagation();
      this.h.onPlay(level.id);
    });
    const edit = el('button', 'fe-mini', 'Edit');
    edit.addEventListener('click', (event) => {
      event.stopPropagation();
      this.h.onBuildLevel(level);
    });
    const share = el('button', 'fe-mini', 'Share');
    share.addEventListener('click', async (event) => {
      event.stopPropagation();
      const code = await toShareCode(level);
      try {
        await navigator.clipboard.writeText(code);
        this.h.onToast?.('Share code copied');
      } catch {
        prompt('Your level code', code);
      }
    });
    const remove = el('button', 'fe-mini danger', 'Delete');
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteCustomLevel(level.id);
      this.show('build');
    });
    row.append(play, edit, share, remove);
    meat.append(row);

    card.append(shot, meat);
    card.addEventListener('click', () => this.h.onBuildLevel(level));
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
