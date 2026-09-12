import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync } from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { allParts, getPart } from '../src/parts/registry.js';
import { voicesFor, SERVO } from '../src/sim/audio-mix.js';
import { Blueprint } from '../src/core/blueprint.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';

function keyboard(...codes) {
  const down = new Set(codes);
  return { down, isDown: (c) => down.has(c), wasPressed: () => false };
}

beforeAll(async () => { await RAPIER.init(); }, 30000);

// Every part that does something to the world, as against the ones that only
// read it. If a part turns up here with nothing to make a noise about, the
// player is driving something silent.
const COMMANDED = allParts().filter((p) => p.actuator || p.thruster || p.spring);

/**
 * Which voice each commanded part speaks through. Wheels, rotors and jets had
 * one from the start; the six below did not, and the reason was that the sim
 * never told the audio layer they existed.
 */
const VOICE = {
  wheel: 'drive',
  propeller: 'rotor',
  thruster: 'jet',
  hinge: 'servo',
  positioner: 'servo',
  turntable: 'servo',
  piston: 'servo',
  grabber: 'latch',
  coupling: 'separate',
  suspension: 'thunk',
};

describe('every commanded part has a voice', () => {
  it('accounts for all of them', () => {
    for (const part of COMMANDED) {
      expect(VOICE[part.id], `${part.id} has no sound mapped to it`).toBeTruthy();
    }
  });

  it('plays a file that is actually shipped', () => {
    const shipped = new Set(readdirSync('public/audio').filter((f) => f.endsWith('.ogg')));
    const files = {
      drive: 'loop-drive.ogg',
      rotor: 'loop-rotor.ogg',
      jet: 'loop-jet.ogg',
      servo: 'loop-servo.ogg',
      latch: 'grab-latch.ogg',
      separate: 'separate.ogg',
      thunk: 'thunk.ogg',
    };
    for (const part of COMMANDED) {
      expect(shipped.has(files[VOICE[part.id]]), `${part.id} -> ${VOICE[part.id]}`).toBe(true);
    }
  });
});

describe('the servo voice', () => {
  it('is silent when no joint is moving', () => {
    expect(voicesFor({ servos: [], servoRate: 0 }).servo.gain).toBe(0);
  });

  it('rises with how fast the joint is turning', () => {
    const slow = voicesFor({ servos: [1], servoRate: 0.5 }).servo.freq;
    const quick = voicesFor({ servos: [1], servoRate: 3 }).servo.freq;
    expect(quick).toBeGreaterThan(slow);
  });

  it('never lets the whine run away', () => {
    expect(voicesFor({ servos: [1], servoRate: 500 }).servo.freq).toBeLessThanOrEqual(SERVO.top);
  });

  it('sounds the same whichever way the joint goes', () => {
    const forward = voicesFor({ servos: [1], servoRate: 2 });
    const back = voicesFor({ servos: [1], servoRate: -2 });
    expect(forward.servo.freq).toBeCloseTo(back.servo.freq, 6);
  });

  it('is one voice for many joints rather than one each', () => {
    const one = voicesFor({ servos: [1], servoRate: 2 }).servo.gain;
    const six = voicesFor({ servos: [1, 1, 1, 1, 1, 1], servoRate: 2 }).servo.gain;
    expect(six).toBeGreaterThan(one);
    expect(six).toBeLessThan(one * 6);
  });
});

/**
 * The sim reporting it is the half that was missing: the audio layer could
 * always play a clip, but nothing on a machine could tell it to.
 */
describe('what the machine reports', () => {
  function rig(build) {
    const world = createWorld(RAPIER);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(120, 1, 120).setTranslation(0, -1, 0)
        .setFriction(1).setCollisionGroups(GROUP_WORLD),
      world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
    );
    const bp = new Blueprint({ name: 'noise' });
    const put = (type, cell, rot, config) => {
      const out = bp.place(type, cell, rot, config);
      if (!out.ok) throw new Error(`${type} at ${cell}: ${out.reason}`);
    };
    build(put);
    const machine = new Machine({
      RAPIER, world, scene: new THREE.Scene(), blueprint: bp,
      spawn: new THREE.Vector3(0, 0.6, 0),
    });
    return { world, machine, bp };
  }

  function run(rigged, bus, seconds) {
    for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
      rigged.machine.update(STEP, bus);
      rigged.world.step();
    }
  }

  it('says a driven hinge is making a noise, and a still one is not', () => {
    const rigged = rig((put) => {
      put('panel', [0, 0, -1]);
      put('core', [0, 1, -1]);
      for (const y of [2, 3]) put('block', [0, y, -1]);
      put('hinge', [0, 3, 0], 6, { binding: { mode: 'axis', pos: 'KeyR', neg: 'KeyF' } });
      put('block', [0, 3, 1]);
    });

    const idle = new SignalBus(keyboard());
    run(rigged, idle, 1);
    expect(rigged.machine.audioState().servos.length, 'a still hinge').toBe(0);

    const driven = new SignalBus(keyboard('KeyR'));
    let heard = 0;
    for (let i = 0; i < Math.round(0.6 / STEP); i += 1) {
      rigged.machine.update(STEP, driven);
      rigged.world.step();
      heard = Math.max(heard, rigged.machine.audioState().servoRate);
    }
    expect(heard, 'a moving hinge').toBeGreaterThan(0.05);
  });

  it('reports the coupling firing, once', () => {
    const rigged = rig((put) => {
      put('block', [0, 0, 0]);
      put('coupling', [0, 1, 0], undefined, { binding: { mode: 'hold', pos: 'KeyB' } });
      put('core', [0, 2, 0]);
    });
    const bus = new SignalBus(keyboard());
    run(rigged, bus, 0.3);
    expect(rigged.machine.audioState().events).not.toContain('separate');

    bus.input.down.add('KeyB');
    let fired = 0;
    for (let i = 0; i < Math.round(1 / STEP); i += 1) {
      rigged.machine.update(STEP, bus);
      rigged.world.step();
      fired += rigged.machine.audioState().events.filter((e) => e === 'separate').length;
    }
    expect(fired).toBe(1);
  });

  it('clears what happened, so a one-shot is not played every frame after', () => {
    const rigged = rig((put) => {
      put('block', [0, 0, 0]);
      put('coupling', [0, 1, 0], undefined, { binding: { mode: 'hold', pos: 'KeyB' } });
      put('core', [0, 2, 0]);
    });
    const bus = new SignalBus(keyboard('KeyB'));
    run(rigged, bus, 1);
    expect(rigged.machine.audioState().events).toEqual([]);
  });

  it('still reports the parts that always had a voice', () => {
    const rigged = rig((put) => {
      put('panel', [0, 0, 0]);
      put('core', [0, 1, 0]);
      put('wheel', [-2, 0, 0], undefined, {});
      put('wheel', [2, 0, 0], undefined, {});
    });
    const bus = new SignalBus(keyboard('KeyW'));
    run(rigged, bus, 0.5);
    const state = rigged.machine.audioState();
    expect(state.wheels.length).toBe(2);
    expect(Array.isArray(state.events)).toBe(true);
  });
});

describe('nothing is shipped that is never heard', () => {
  it('plays every clip the game downloads', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync('src/ui/audio.js', 'utf8'));
    const named = [...source.matchAll(/'([a-z-]+\.ogg)'/g)].map((m) => m[1]);
    const shipped = readdirSync('public/audio').filter((f) => f.endsWith('.ogg'));
    for (const file of shipped) {
      expect(named, `${file} is downloaded by every player`).toContain(file);
    }
  });

  it('has a call site for every sound it can make', async () => {
    const fs = await import('node:fs');
    const audio = fs.readFileSync('src/ui/audio.js', 'utf8');
    const elsewhere = ['src/main.js', 'src/ui/hud.js', 'src/ui/frontend.js', 'src/ui/builder.js']
      .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    // Everything after the "ui" divider is a named one-shot.
    const methods = [...audio.matchAll(/^ {2}([a-z]+)\(\) \{ this\.play\(/gm)].map((m) => m[1]);
    expect(methods.length).toBeGreaterThan(8);
    for (const method of methods) {
      const called = elsewhere.includes(`.${method}()`)
        || new RegExp(`this\\.${method}\\(\\)`).test(audio);
      expect(called, `audio.${method}() is never called`).toBe(true);
    }
  });
});
