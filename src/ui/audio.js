import { voicesFor, DRIVE, ROTOR } from '../sim/audio-mix.js';

/**
 * Sound. Every file is CC0 — see public/audio/LICENCE.md for what came from
 * where and the exact terms; the short version is that all of it can ship in
 * a paid game with no attribution and no licence screen.
 *
 * The machine voices are looped clips whose playback rate follows the shaft
 * speed the sim is actually turning at, rather than clips triggered on and
 * off. A motor that is spinning up has to sound like it is spinning up.
 * sim/audio-mix.js works out the levels and rates; this file plays them.
 */

const VOLUMES = { off: 0, low: 0.4, full: 1 };

const CLIPS = {
  click: 'ui-click.ogg',
  hover: 'ui-hover.ogg',
  back: 'ui-back.ogg',
  toggle: 'ui-toggle.ogg',
  place: 'part-place.ogg',
  remove: 'part-remove.ogg',
  deny: 'deny.ogg',
  confirm: 'confirm.ogg',
  latch: 'grab-latch.ogg',
  crash: 'crash.ogg',
  win: 'win.ogg',
  fail: 'fail.ogg',
};

const LOOPS = {
  drive: 'loop-drive.ogg',
  rotor: 'loop-rotor.ogg',
  jet: 'loop-jet.ogg',
};

// The pitch each engine clip was recorded at, so the playback rate can be
// worked out as a ratio rather than guessed. Both loops are steady mid-range
// engine tones; these are the shaft speeds they read as.
const RECORDED = {
  drive: DRIVE.base + 3 * DRIVE.perSpeed,
  rotor: ROTOR.base + 12 * ROTOR.perSpin * ROTOR.blades,
};

// Well outside this and a stretched clip stops sounding like a motor and
// starts sounding like a stretched clip.
const RATE = { min: 0.55, max: 2.4 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function makeContext() {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return Ctx ? new Ctx() : null;
}

export class GameAudio {
  // Through the bundler's base, so the clips are still found when the game is
  // served from a subpath rather than from a domain root.
  constructor({ volume = 'full', base = `${import.meta.env?.BASE_URL ?? '/'}audio/` } = {}) {
    this.volume = volume;
    this.base = base;
    this.ctx = null;
    this.started = false;
    this.buffers = new Map();
    this.loops = new Map();
  }

  /**
   * Called from the first click or keypress, because browsers will not let
   * audio start before that. Everything before it is silently a no-op, and a
   * pack that fails to load leaves the game playing without sound rather
   * than breaking it.
   */
  async start() {
    if (this.started) return;
    const ctx = makeContext();
    if (!ctx) return;
    this.ctx = ctx;
    this.started = true;

    this.master = ctx.createGain();
    this.master.gain.value = VOLUMES[this.volume] ?? 1;

    // Keeps a machine with a lot running from turning to mush, and stops one
    // loud event landing on top of everything else.
    const squash = ctx.createDynamicsCompressor();
    squash.threshold.value = -16;
    squash.ratio.value = 5;
    squash.attack.value = 0.005;
    squash.release.value = 0.2;
    this.master.connect(squash).connect(ctx.destination);

    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(this.master);

    if (ctx.state === 'suspended') await ctx.resume();
    await this.load();
  }

  async load() {
    const names = { ...CLIPS, ...LOOPS };
    await Promise.all(Object.entries(names).map(async ([id, file]) => {
      try {
        const response = await fetch(`${this.base}${file}`);
        if (!response.ok) return;
        this.buffers.set(id, await this.ctx.decodeAudioData(await response.arrayBuffer()));
      } catch {
        // A missing clip costs that one sound, not the game.
      }
    }));
    for (const id of Object.keys(LOOPS)) this.startLoop(id);
    this.ready = true;
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.master) {
      this.master.gain.setTargetAtTime(VOLUMES[volume] ?? 1, this.ctx.currentTime, 0.02);
    }
  }

  // --------------------------------------------------------------- machine

  /**
   * One looped source per kind of actuator, running from the moment the pack
   * loads and mixed to nothing when idle. Starting and stopping sources per
   * part would click, and a machine can carry dozens of them.
   */
  startLoop(id) {
    const buffer = this.buffers.get(id);
    if (!buffer) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.bus);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.loops.set(id, { source, gain });
  }

  /** Feeds the running machine's state to the loops. Call it every frame. */
  update(state) {
    if (!this.started || !this.ready) return;
    const now = this.ctx.currentTime;
    const v = voicesFor(state);
    const ramp = (param, value) => param.setTargetAtTime(value, now, 0.06);

    ramp(this.bus.gain, 1);
    this.drive(v.drive.gain, v.drive.freq / RECORDED.drive, 'drive');
    this.drive(v.rotor.gain, v.rotor.freq / RECORDED.rotor, 'rotor');
    // A thruster has no shaft, so it stays at pitch and only opens up.
    this.drive(v.jet.gain, 1, 'jet');
  }

  drive(gain, rate, id) {
    const loop = this.loops.get(id);
    if (!loop) return;
    const now = this.ctx.currentTime;
    loop.gain.gain.setTargetAtTime(gain, now, 0.06);
    loop.source.playbackRate.setTargetAtTime(clamp(rate, RATE.min, RATE.max), now, 0.08);
  }

  /** Cuts the machine loops without stopping them, for the studio and menus. */
  silenceMachine() {
    if (!this.started) return;
    this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.07);
  }

  // -------------------------------------------------------------------- ui

  play(id, { gain = 1, rate = 1 } = {}) {
    if (!this.started) return;
    const buffer = this.buffers.get(id);
    if (!buffer) return;
    const level = this.ctx.createGain();
    level.gain.value = gain;
    level.connect(this.master);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(level);
    source.start();
  }

  // Named for what happened rather than for what it sounds like, so which
  // clip plays can change without touching anything else.
  hover() { this.play('hover', { gain: 0.35 }); }
  click() { this.play('click', { gain: 0.7 }); }
  back() { this.play('back', { gain: 0.7 }); }
  toggle() { this.play('toggle', { gain: 0.7 }); }
  place() { this.play('place', { gain: 0.8 }); }
  remove() { this.play('remove', { gain: 0.7 }); }
  deny() { this.play('deny', { gain: 0.7 }); }
  confirm() { this.play('confirm', { gain: 0.7 }); }
  latch() { this.play('latch', { gain: 0.6 }); }
  release() { this.play('latch', { gain: 0.45, rate: 0.8 }); }
  crash() { this.play('crash', { gain: 0.9 }); }
  win() { this.play('win', { gain: 0.8 }); }
  fail() { this.play('fail', { gain: 0.8 }); }
}
