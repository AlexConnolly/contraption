import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { starterRover } from '../src/studio/presets.js';
import { fallLine, sanitiseLevel } from '../src/challenges/format.js';
import { LEVELS, getLevel } from '../src/challenges/levels.js';

function keyboard(...codes) {
  const down = new Set(codes);
  return { down, isDown: (c) => down.has(c), wasPressed: () => false };
}

beforeAll(async () => { await RAPIER.init(); }, 30000);

const overADrop = LEVELS.filter((level) => fallLine(level) !== null);

/**
 * Six courses are built over a drop. Going over the edge used to be nothing at
 * all: the machine landed on a floor nine to thirteen metres down, the clock
 * kept running, and the only way out was the menu.
 */
describe('going over the edge', () => {
  it('finds the courses that have an edge to go over', () => {
    expect(overADrop.length).toBeGreaterThanOrEqual(5);
    expect(overADrop.map((l) => l.id)).toContain('ledge-runner');
  });

  it('leaves flat ground alone, where there is nowhere to fall', () => {
    for (const level of LEVELS) {
      if (level.groundY !== undefined) continue;
      expect(fallLine(level), level.id).toBeNull();
    }
  });

  it('sets the line below the course rather than at the bottom of the drop', () => {
    for (const level of overADrop) {
      const lowest = Math.min(...level.pieces.map((p) => p.pos[1] - p.size[1] / 2));
      const line = fallLine(level);
      expect(line, `${level.id} line is not below the course`).toBeLessThan(lowest);
      expect(line, `${level.id} waits for the floor`).toBeGreaterThan(level.groundY);
    }
  });

  it('is a long way under the machine while it is still on the course', () => {
    for (const level of overADrop) {
      expect(fallLine(level), level.id).toBeLessThan(level.spawn[1] - 2);
    }
  });

  it('can be set outright by a level that wants a different line', () => {
    expect(fallLine({ fallBelow: -1.5, groundY: -20, pieces: [] })).toBe(-1.5);
    expect(sanitiseLevel({ fallBelow: -4 }).fallBelow).toBe(-4);
  });

  it('treats a kerb as a kerb rather than a cliff', () => {
    expect(fallLine({ groundY: -1, pieces: [{ pos: [0, 0.5, 0], size: [4, 1, 4] }] })).toBeNull();
  });
});

describe('a machine that drives off the ledge', () => {
  // Put down beside the course rather than on it, which is where a machine
  // ends up the moment it leaves the edge.
  function driveOff(id, aside, seconds = 9) {
    const level = getLevel(id);
    const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const arena = new Arena({ RAPIER, world, scene, level, seed: 4 });
    const machine = new Machine({
      RAPIER, world, scene, blueprint: starterRover(), level,
      spawn: new THREE.Vector3(level.spawn[0] + aside, level.spawn[1], level.spawn[2]),
    });
    const bus = new SignalBus(keyboard());
    const line = fallLine(level);
    let fellAt = null;
    for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
      arena.step(STEP);
      machine.update(STEP, bus);
      world.step();
      if (fellAt === null && machine.corePosition().y < line) fellAt = i * STEP;
    }
    return { fellAt, low: machine.corePosition().y, line, groundY: level.groundY };
  }

  it('is caught on the way down, not once it has landed', () => {
    const { fellAt, line, groundY } = driveOff('ledge-runner', 12);
    expect(fellAt, 'never crossed the line').not.toBeNull();
    // Caught with most of the drop still to go, rather than at the bottom.
    expect(line - groundY).toBeGreaterThan(4);
  });

  it('catches it on the plank crossing too', () => {
    expect(driveOff('jenga', 14).fellAt).not.toBeNull();
  });
});

describe('staying on the course is not falling off it', () => {
  /**
   * The check runs every step of every run, so a line set too high would end
   * runs that were going perfectly well. Driving the course as intended must
   * never cross it.
   */
  it('never crosses the line while following the gantry', () => {
    const level = getLevel('ledge-runner');
    const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const arena = new Arena({ RAPIER, world, scene, level, seed: 4 });
    const machine = new Machine({
      RAPIER, world, scene, blueprint: starterRover(), level,
      spawn: new THREE.Vector3(...level.spawn),
    });
    const bus = new SignalBus(keyboard());
    const line = fallLine(level);
    let low = Infinity;
    // Sat still on the apron: whatever else happens, this is not a fall.
    for (let i = 0; i < Math.round(4 / STEP); i += 1) {
      arena.step(STEP);
      machine.update(STEP, bus);
      world.step();
      low = Math.min(low, machine.corePosition().y);
    }
    expect(low).toBeGreaterThan(line);
  });
});
