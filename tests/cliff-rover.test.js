import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { validateProgram } from '../src/sim/program.js';
import { getLevel } from '../src/challenges/levels.js';
import { cliffRover } from '../src/studio/cliffrover.js';
import { starterRover } from '../src/studio/presets.js';

const deadKeyboard = () => ({
  asked: [],
  isDown(code) { this.asked.push(code); return false; },
  wasPressed(code) { this.asked.push(code); return false; },
});

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * A bare table over a long drop: twenty-two metres square, no lip, no rail,
 * nothing to bump into. Every course in the game that has a drop also has
 * something to stop you — a kerb, a wall, a corridor — and any of those would
 * hold a machine on the table whether or not it was looking where it was
 * going. Here the only thing between the rover and the floor twelve metres
 * down is the program.
 */
const TABLE = {
  id: 'table',
  name: 'Table',
  spawn: [0, 3.9, -4],
  groundY: -12,
  groundSize: 120,
  budget: { cost: 999 },
  pieces: [{ pos: [0, 3, 0], size: [22, 1.2, 22], colour: 0x6b7480 }],
  props: [],
  zones: [],
  objectives: [],
  demands: { steps: 1, flies: false },
  bans: [],
  par: 600,
};

const EDGE = 11;
const DECK = 2.4;

/**
 * Runs a machine on the table with nothing pressed, and reports what became of
 * it: whether it went off, how far it drove, how far out it dared go, and how
 * long its program spent in each state.
 */
function run(blueprint, seconds) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const arena = new Arena({
    RAPIER, world, scene, level: TABLE, seed: 4,
  });
  const machine = new Machine({
    RAPIER, world, scene, blueprint, level: TABLE, spawn: new THREE.Vector3(...TABLE.spawn),
  });
  const keyboard = deadKeyboard();
  const bus = new SignalBus(keyboard);

  const states = new Map();
  let last = machine.corePosition().clone();
  let travelled = 0;
  let reached = 0;
  let fell = false;
  let lasted = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
    const at = machine.corePosition();
    lasted = i * STEP;
    travelled += at.distanceTo(last);
    last = at.clone();
    reached = Math.max(reached, Math.hypot(at.x, at.z));
    const id = machine.computers[0]?.stateId;
    if (id) states.set(id, (states.get(id) ?? 0) + STEP);
    // Below the deck is over the side; there is nothing else down there.
    if (at.y < DECK) { fell = true; break; }
  }
  return {
    fell, lasted, travelled, reached, states, keyboard,
  };
}

const LONG = 300000;
const seconds = (out, id) => out.states.get(id) ?? 0;

describe('the rover itself', () => {
  it('is a machine you could have built', () => {
    const bp = cliffRover();
    expect(bp.cost()).toBeLessThanOrEqual(getLevel('ledge-runner').budget.cost);
    expect(bp.list().filter((p) => p.type === 'sensor')).toHaveLength(3);
  });

  it('has a program the editor finds nothing wrong with', () => {
    const bp = cliffRover();
    const computer = bp.list().find((p) => p.type === 'computer');
    const ctx = {
      hasPart: (id) => Boolean(bp.get(id)),
      port: (_partId, _direction, id) => ({
        id, name: id, kind: id === 'tripped' ? 'bool' : 'number',
      }),
    };
    expect(validateProgram(computer.config.program, ctx)).toEqual([]);
  });

  /**
   * The reason the decider exists. Neither state that does the work mentions a
   * sensor: they are a pair of throttles. Add a third state tomorrow and it is
   * covered by the same check without being told about it.
   */
  it('keeps the whole check in one place', () => {
    const program = cliffRover().list()
      .find((p) => p.type === 'computer').config.program;
    const decider = program.states.find((s) => s.main);
    expect(decider.nodes.filter((n) => n.type === 'read')).toHaveLength(3);
    for (const state of program.states.filter((s) => !s.main)) {
      expect(state.nodes.some((n) => n.type === 'read'), `${state.name} reads a sensor`)
        .toBe(false);
    }
  });
});

/**
 * If anything overhangs, turn; otherwise drive. That is the whole program.
 *
 * What this shows and does not show is worth being exact about. It shows the
 * machine finding edges it was never told about and turning off them, over and
 * over, for three minutes, where the same machine with the deciding taken out
 * is off the table in thirteen seconds. It does not show a rover that roams
 * the table freely: it covers about thirty metres and spends a good deal of
 * the time pressed against a lip with its wheels turning, because backing away
 * from an edge and turning is not always enough to get clear of one. Not
 * falling off is the claim; touring the table is not.
 */
describe('if anything overhangs, turn — otherwise drive', () => {
  // One run, shared: the physics is deterministic, so driving it again per
  // assertion would only cost three minutes a time.
  let out = null;
  let blind = null;
  beforeAll(() => {
    out = run(cliffRover(), 180);
    blind = run(cliffRover({ blind: true }), 180);
  }, LONG);

  it('never goes over the side', () => {
    expect(out.fell, `went off after ${out.lasted.toFixed(0)}s`).toBe(false);
    expect(out.lasted).toBeGreaterThan(170);
  }, LONG);

  /**
   * Nothing on the machine is bound to a key at all, which is why the run
   * never so much as asks the keyboard a question. There is no input to have
   * left switched on by accident.
   */
  it('has no controls, so nothing but the program is driving it', () => {
    const bound = cliffRover().list().filter((p) => p.config?.binding);
    expect(bound, 'something is on a key').toEqual([]);
    expect(out.keyboard.asked, 'it looked for a keypress').toEqual([]);
  }, LONG);

  // Sitting still would also never fall off, so it has to have gone somewhere.
  it('drives rather than sitting there', () => {
    expect(out.travelled, 'it hardly moved').toBeGreaterThan(25);
  }, LONG);

  // And it has to have met the edges, rather than pottering about in the
  // middle where the question never comes up.
  it('goes out to the edges', () => {
    expect(out.reached, 'never went near an edge').toBeGreaterThan(EDGE * 0.6);
  }, LONG);

  it('turns when it finds one, and drives when it does not', () => {
    const turning = seconds(out, 'right') + seconds(out, 'left');
    expect(seconds(out, 'drive'), 'it never drove').toBeGreaterThan(20);
    expect(turning, 'it never had to turn').toBeGreaterThan(2);
  }, LONG);

  /**
   * The control, and the thing that makes the rest of it mean anything: the
   * same machine, the same beams, the same throttles — with the decider taken
   * out so nothing ever reads them.
   */
  it('is the deciding that saves it, not the machine or the table', () => {
    expect(blind.fell, 'a machine that never looks stayed on somehow').toBe(true);
    expect(blind.lasted, 'it took its time falling off').toBeLessThan(30);
    expect(out.lasted).toBeGreaterThan(blind.lasted * 5);
  }, LONG);
});
