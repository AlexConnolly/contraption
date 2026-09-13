import './menu.css';
import { LEVELS, tierOf, tier } from '../challenges/levels.js';
import { bansOn } from '../challenges/bans.js';
import { store } from './progress.js';
import { centreOfMass } from './hud.js';
import { levelThumb, renderMachine, renderPart } from './thumbnails.js';
import { Blueprint } from '../core/blueprint.js';
import { customLevels, deleteCustomLevel } from '../challenges/custom.js';
import { toShareCode, fromShareCode } from '../challenges/format.js';
import {
  installPack, installPackCode, removePack, installedPacks,
} from '../parts/installed.js';
import {
  sanitisePack, packProblems, packChanges, toPackCode, blankPack, EXAMPLE_PACK,
  ACTUATOR_KINDS,
} from '../parts/packs.js';

const SVG = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  garage: '<path d="M3 20V11l9-6 9 6v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 20h18M8 20v-5h8v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  cog: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  exit: '<path d="M16 17l5-5-5-5M21 12H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  tick: '<path d="M4 12.5 9.5 18 20 6.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  world: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3c2.6 2.5 4 5.6 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.6-4-9s1.4-6.5 4-9z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  build: '<path d="M3 20h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5 20V9l5-4 5 4v11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 20v-6h4v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
};

/**
 * Whether the open world is offered yet.
 *
 * Off on purpose. Everything behind it works and is tested -- worlds, hosting,
 * joining, the lot -- but it is not good enough to put in front of somebody as
 * a finished thing yet: a new world is an empty plain, and there is nothing
 * shipped to open. Turning this back on is the only change needed; nothing is
 * torn out and nothing is commented away.
 */
export const WORLDS_READY = false;

/** What the Worlds entry on the title screen says and does. */
export function worldsEntry(ready = WORLDS_READY) {
  return ready
    ? { meta: 'Open sandbox', opens: 'worlds' }
    : { meta: 'Coming soon', opens: null };
}

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${SVG[name]}</svg>`;
}

/** How long ago something was saved, in the roughest terms that are still true. */
export function ago(when, now = Date.now()) {
  const seconds = Math.max(0, (now - when) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 36) return `${Math.round(hours)} hr ago`;
  const days = hours / 24;
  if (days < 14) return `${Math.round(days)} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}


/**
 * Where the weight sits, drawn twice: from above for the side-to-side and
 * fore-and-aft of it, and from the side for how high it is carried. Drawn
 * from the blueprint rather than marked on the thumbnail, so it is right for
 * machines saved long before this existed.
 */
function balanceChart(blueprint) {
  const com = centreOfMass(blueprint);
  if (!com) return null;
  const W = 96;
  const H = 54;
  const pad = 5;
  // The machine's own box, drawn to fit, with the dot placed as a fraction of
  // it so a long machine and a short one read the same way.
  const plan = (across, along) => [
    pad + ((across + 0.5) * (W / 2 - pad * 2)) + (W / 4 - (W / 2 - pad * 2) / 2),
    pad + ((along + 0.5) * (H - pad * 2)),
  ];
  const x = Math.max(-0.48, Math.min(0.48, com.right / (com.width || 1)));
  const z = Math.max(-0.48, Math.min(0.48, -com.forward / (com.depth || 1)));
  const up = Math.max(0.02, Math.min(0.98, com.above / (com.height || 1)));
  const [px, py] = plan(x, z);
  const sideX = W * 0.75;
  const sideY = H - pad - up * (H - pad * 2);

  const say = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`;
  const el2 = el('div', 'fe-balance');
  el2.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <rect x="${pad}" y="${pad}" width="${W / 2 - pad * 2}" height="${H - pad * 2}"/>
      <line x1="${pad + (W / 2 - pad * 2) / 2}" y1="${pad}" x2="${pad + (W / 2 - pad * 2) / 2}" y2="${H - pad}"/>
      <line x1="${pad}" y1="${H / 2}" x2="${W / 2 - pad}" y2="${H / 2}"/>
      <circle cx="${px}" cy="${py}" r="4"/>
      <rect x="${W / 2 + pad}" y="${pad}" width="${W / 2 - pad * 2}" height="${H - pad * 2}"/>
      <line x1="${W / 2 + pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" class="ground"/>
      <circle cx="${sideX}" cy="${sideY}" r="4"/>
    </svg>
    <span>Balance <b>${say(com.right)}</b> across &middot; <b>${say(com.forward)}</b> along
      &middot; <b>${com.above.toFixed(2)}</b> m up</span>`;
  return el2;
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
    // One gate, so there is no second way in when something is switched off.
    if (screen === 'worlds' && !worldsEntry().opens) {
      this.show('title');
      return;
    }
    this.screen = screen;
    this.root.classList.toggle('title', screen === 'title');
    this.root.classList.toggle('solid', screen !== 'title');
    this.top.innerHTML = '';
    this.body.innerHTML = '';

    if (screen === 'title') this.renderTitle();
    if (screen === 'challenges') this.renderChallenges();
    if (screen === 'garage') this.renderGarage();
    if (screen === 'worlds') this.renderWorlds();
    if (screen === 'build') this.renderBuild();
    if (screen === 'parts') this.renderParts();
    if (screen === 'pack') this.renderPackEditor();
    if (screen === 'settings') this.renderSettings();
  }

  /**
   * A small dialog over the menu. The studio's modal belongs to the HUD, which
   * is not up while the menu is, so this is the front end's own.
   */
  notice({ title, body, ok = 'Right you are' }) {
    this.root.querySelector('.fe-notice')?.remove();

    const panel = el('div', 'fe-notice-panel');
    panel.append(el('h2', null, title), el('p', null, body));
    const button = el('button', 'fe-mini lead', ok);
    panel.append(button);

    const shade = el('div', 'fe-notice');
    shade.append(panel);
    const close = () => {
      shade.remove();
      this.root.querySelector('.fe-item')?.focus();
    };
    button.addEventListener('click', close);
    shade.addEventListener('click', (event) => {
      if (event.target === shade) close();
    });
    this.root.append(shade);
    button.focus();
    return close;
  }

  backBar(label) {
    const back = el('button', 'fe-back', `${icon('back', 15)} Back`);
    back.addEventListener('click', () => this.show('title'));
    const title = el('div', 'fe-pill', `<b>${label}</b>`);
    this.top.append(back, title, el('span', 'fe-spacer'));
  }

  // ------------------------------------------------------------------ title

  renderTitle() {
    const worlds = worldsEntry();
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
        label: 'Worlds',
        glyph: 'world',
        meta: worlds.meta,
        soon: !worlds.opens,
        go: () => (worlds.opens ? this.show(worlds.opens) : this.notice({
          title: 'Worlds are not ready yet',
          body: 'An open world you build in, put machines into and leave running, '
            + 'with other people able to join it. It works — it is just not good '
            + 'enough to hand you yet. It will be here.',
        })),
      },
      {
        label: 'Build',
        glyph: 'build',
        meta: `${customLevels().length} of your own`,
        go: () => this.show('build'),
      },
      {
        label: 'Parts',
        glyph: 'cog',
        meta: (() => {
          const packs = installedPacks();
          const parts = packs.reduce((n, pack) => n + pack.parts.length, 0);
          if (!packs.length) return 'Add your own';
          return `${packs.length} pack${packs.length === 1 ? '' : 's'} · ${parts} parts`;
        })(),
        go: () => this.show('parts'),
      },
      { label: 'Settings', glyph: 'cog', meta: 'Camera · Graphics', go: () => this.show('settings') },
      { label: 'Exit', glyph: 'exit', meta: '', exit: true, go: () => this.h.onExit() },
    ];

    for (const item of items) {
      const button = el(
        'button',
        `fe-item${item.lead ? ' lead' : ''}${item.exit ? ' exit' : ''}${item.soon ? ' soon' : ''}`,
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
    if (level.noBumps) rules.append(el('span', 'fe-tag rule', 'No bumps'));
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

  // ---------------------------------------------------------------- worlds

  /**
   * Worlds live in IndexedDB rather than in the one localStorage key, so
   * unlike every other screen here the list arrives later. The screen is
   * drawn once saying so and filled in when it comes, which is honest and
   * keeps the menu from stalling on a disk.
   */
  renderWorlds() {
    this.backBar('Worlds');
    const sheet = el('div', 'fe-sheet');
    sheet.append(el('div', 'fe-head', '<h2>Worlds</h2><p>Build a place, put machines in it, and leave them running. Nothing to win.</p>'));

    const grid = el('div', 'fe-grid');
    const add = el('button', 'fe-card add', `${icon('plus', 26)}<span>Start a new world</span>`);
    add.addEventListener('click', () => this.h.onNewWorld());
    const paste = el('button', 'fe-card add', `${icon('back', 22)}<span>Open a world code</span>`);
    paste.addEventListener('click', async () => {
      const code = prompt('Paste a world code');
      if (!code) return;
      await this.h.onWorldCode(code.trim());
    });
    const join = el('button', 'fe-card add', `${icon('world', 24)}<span>Join somebody's world</span>`);
    join.title = 'Somebody running `npm run host` on your network';
    join.addEventListener('click', async () => {
      const address = prompt(
        'Address of the host — somebody running `npm run host`',
        this.h.suggestHost(),
      );
      if (!address) return;
      await this.h.onJoin(address.trim());
    });
    grid.append(add, paste, join);
    sheet.append(grid);

    sheet.append(el('p', 'fe-note', 'Worlds you build are your own. To play in one together, '
      + 'somebody runs <code>npm run host</code> and everybody else joins their address — '
      + 'their machine runs the world and is the last word on what happens in it.'));

    const listed = el('div', 'fe-grid');
    const waiting = el('p', 'fe-empty', 'Looking for your worlds…');
    sheet.append(listed, waiting);
    this.body.append(sheet);

    this.h.listWorlds().then((cards) => {
      if (this.screen !== 'worlds') return;
      waiting.remove();
      if (cards.length === 0) {
        sheet.append(el('p', 'fe-empty', 'No worlds yet. Start one and put a floor down.'));
        return;
      }
      for (const card of cards) listed.append(this.worldCard(card));
    });
  }

  worldCard(card) {
    const tile = el('button', 'fe-card');
    const shot = el('div', 'fe-shot world', icon('world', 56));

    const facts = el('div', 'fe-facts');
    facts.append(
      el('span', null, `Blocks <b>${card.blocks}</b>`),
      el('span', null, `Machines <b>${card.vehicles}</b>`),
      el('span', null, `Saved <b>${ago(card.saved)}</b>`),
    );

    const meat = el('div', 'fe-meat');
    meat.append(el('h3', null, card.name), facts);

    const row = el('div', 'fe-row');
    const open = el('button', 'fe-mini', 'Open');
    open.addEventListener('click', (event) => {
      event.stopPropagation();
      this.h.onOpenWorld(card);
    });
    const remove = el('button', 'fe-mini danger', 'Delete');
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (await this.h.onDeleteWorld(card)) this.show('worlds');
    });
    row.append(open, remove);
    meat.append(row);

    tile.append(shot, meat);
    tile.addEventListener('click', () => this.h.onOpenWorld(card));
    return tile;
  }

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
    const balance = balanceChart(blueprint);

    const facts = el('div', 'fe-facts');
    facts.append(
      el('span', null, `Parts <b>${blueprint.size}</b>`),
      el('span', null, `Cost <b>${blueprint.cost()}</b>`),
    );

    const meat = el('div', 'fe-meat');
    meat.append(el('h3', null, machine.name), facts);
    if (balance) meat.append(balance);

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

  // ------------------------------------------------------------------ parts

  /**
   * Parts somebody else made.
   *
   * A pack is data — a name, some numbers, and one of the behaviours the game
   * already has. It cannot bring code with it, which is why a pack can be
   * pasted in from a stranger, and why everything here is written as JSON
   * rather than as a language.
   */
  renderParts() {
    this.backBar('Parts');
    const packs = installedPacks();
    const parts = packs.reduce((n, pack) => n + pack.parts.length, 0);
    this.top.append(el('div', 'fe-pill', `<b>${parts}</b> extra parts`));

    const sheet = el('div', 'fe-sheet');
    sheet.append(el('div', 'fe-head', '<h2>Parts packs</h2><p>New parts, written as numbers rather than as code. A pack can build anything the parts in the box are &mdash; a heavier wheel, a longer ram, a rotor that lifts three times as much &mdash; and nothing in one ever runs.</p>'));

    const grid = el('div', 'fe-grid');

    const add = el('button', 'fe-card add', `${icon('plus', 26)}<span>Write a pack</span>`);
    add.addEventListener('click', () => this.editPack(blankPack()));
    grid.append(add);

    const paste = el('button', 'fe-card add', `${icon('back', 22)}<span>Open a pack code</span>`);
    paste.addEventListener('click', async () => {
      const code = prompt('Paste a pack code');
      if (!code) return;
      const result = await installPackCode(code);
      this.h.onToast?.(result.ok ? `${result.pack.name} installed` : result.reason, !result.ok);
      if (!result.ok) return;
      this.h.onPartsChanged?.();
      this.show('parts');
    });
    grid.append(paste);

    const sample = el('button', 'fe-card add', `${icon('build', 22)}<span>Look at the example</span>`);
    sample.addEventListener('click', () => this.editPack(EXAMPLE_PACK));
    grid.append(sample);

    for (const pack of packs) grid.append(this.packCard(pack));
    sheet.append(grid);

    if (packs.length === 0) {
      sheet.append(el('p', 'fe-empty', 'No packs installed. Open the example to see what one looks like, then change the numbers.'));
    }
    this.body.append(sheet);
  }

  packCard(pack) {
    const card = el('div', 'fe-card');
    const strip = el('div', 'fe-strip');
    for (const part of pack.parts.slice(0, 6)) {
      const chip = el('div', 'fe-chip');
      const image = document.createElement('img');
      image.alt = part.name;
      try {
        image.src = renderPart(part.id);
      } catch {
        chip.classList.add('blank');
      }
      chip.append(image, el('span', null, part.name));
      strip.append(chip);
    }
    // The strip is three across; a part-filled last row would otherwise show
    // the gaps between cells as holes in the card.
    while (strip.children.length % 3) strip.append(el('div', 'fe-chip empty'));

    const meat = el('div', 'fe-meat');
    meat.append(
      el('h3', null, pack.name),
      el('p', null, pack.author ? `By ${pack.author}` : 'No author given'),
      el('div', 'fe-facts', `<span>Parts <b>${pack.parts.length}</b></span><span>Id <b>${pack.id}</b></span>`),
    );

    const row = el('div', 'fe-row');
    const edit = el('button', 'fe-mini', 'Edit');
    edit.addEventListener('click', () => this.editPack(pack));
    const share = el('button', 'fe-mini', 'Share');
    share.addEventListener('click', async () => {
      const code = await toPackCode(pack);
      try {
        await navigator.clipboard.writeText(code);
        this.h.onToast?.('Pack code copied');
      } catch {
        prompt('Your pack code', code);
      }
    });
    const use = el('button', 'fe-mini', 'Try it');
    use.addEventListener('click', () => this.h.onPlay('sandbox'));
    const remove = el('button', 'fe-mini danger', 'Remove');
    remove.addEventListener('click', () => {
      removePack(pack.id);
      this.h.onToast?.(`${pack.name} removed`);
      this.h.onPartsChanged?.();
      this.show('parts');
    });
    row.append(edit, share, use, remove);
    meat.append(row);

    card.append(strip, meat);
    return card;
  }

  editPack(pack) {
    this.draft = JSON.stringify(pack, null, 2);
    this.show('pack');
  }

  /**
   * Writing one. The pack goes in on the left as it was written; what the game
   * made of it comes back on the right, with every number as it will actually
   * be used. A pack asking for a thrust of ninety thousand is not refused, it
   * is answered — with four hundred, which is what it is going to get.
   */
  renderPackEditor() {
    const back = el('button', 'fe-back', `${icon('back', 15)} Parts`);
    back.addEventListener('click', () => this.show('parts'));
    this.top.append(back, el('div', 'fe-pill', '<b>Pack</b>'), el('span', 'fe-spacer'));

    const sheet = el('div', 'fe-sheet');
    sheet.append(el('div', 'fe-head', '<h2>Write a pack</h2><p>Each part picks one of the behaviours the game already has and gives it its own numbers. What it will really be is on the right.</p>'));

    const split = el('div', 'fe-split');
    const area = document.createElement('textarea');
    area.className = 'fe-code';
    area.id = 'pack-source';
    area.spellcheck = false;
    area.value = this.draft ?? '';
    const review = el('div', 'fe-review');
    split.append(area, review);
    sheet.append(split);

    const row = el('div', 'fe-row wide');
    const install = el('button', 'fe-mini', 'Install');
    const copy = el('button', 'fe-mini', 'Copy code');
    row.append(install, copy);
    sheet.append(row);
    this.body.append(sheet);

    let clean = null;
    const look = () => {
      this.draft = area.value;
      review.innerHTML = '';
      let parsed;
      try {
        parsed = JSON.parse(area.value);
      } catch (error) {
        clean = null;
        review.append(el('p', 'fe-bad', `That is not valid JSON: ${error.message}`));
        return;
      }
      clean = sanitisePack(parsed);
      const problems = packProblems(clean);
      const changes = packChanges(parsed, clean);
      for (const problem of problems) review.append(el('p', 'fe-bad', problem));
      if (!problems.length) {
        review.append(el('p', 'fe-good', `${clean.name}: ${clean.parts.length} parts, nothing wrong with it.`));
      }
      // What was asked for and not given. Never a refusal, always a number.
      for (const change of changes) review.append(el('p', 'fe-warn', change));
      for (const part of clean.parts) {
        const facts = [
          `cost ${part.cost}`,
          `${part.mass} kg`,
          part.actuator ? part.actuator.kind : 'no behaviour',
          part.look ? `drawn as ${part.look}` : 'plain block',
        ];
        review.append(el(
          'div',
          'fe-line',
          `<b>${part.name}</b><code>${part.id}</code><span>${facts.join(' &middot; ')}</span>`,
        ));
      }
      review.append(el('p', 'fe-note', `Behaviours a part can pick from: ${ACTUATOR_KINDS.join(', ')}.`));
    };

    let pending = null;
    area.addEventListener('input', () => {
      clearTimeout(pending);
      pending = setTimeout(look, 200);
    });
    look();

    install.addEventListener('click', () => {
      if (!clean) {
        this.h.onToast?.('Fix the JSON first', true);
        return;
      }
      const result = installPack(clean);
      this.h.onToast?.(result.ok ? `${result.pack.name} installed` : result.reason, !result.ok);
      if (!result.ok) return;
      this.h.onPartsChanged?.();
      this.show('parts');
    });
    copy.addEventListener('click', async () => {
      if (!clean) return;
      const code = await toPackCode(clean);
      try {
        await navigator.clipboard.writeText(code);
        this.h.onToast?.('Pack code copied');
      } catch {
        prompt('Your pack code', code);
      }
    });
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
