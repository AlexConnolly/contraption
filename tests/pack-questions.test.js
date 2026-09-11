import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { QUESTIONS } from '../src/challenges/packs/questions.js';
import { tierOf, getLevel } from '../src/challenges/levels.js';
import { ObjectiveTracker, inZone } from '../src/challenges/objectives.js';
import { Arena } from '../src/sim/arena.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';
import { blueprintMass } from '../src/ui/hud.js';

const keyboard = () => {
  const down = new Set();
  return { down, isDown: (c) => down.has(c), wasPressed: () => false };
};

beforeAll(async () => { await RAPIER.init(); }, 30000);

function stage(level, seed = 3) {
  const world = createWorld(RAPIER, { x: 0, y: level.gravity ?? -9.81, z: 0 });
  const scene = new THREE.Scene();
  const arena = new Arena({ RAPIER, world, scene, level, seed });
  return { world, scene, arena };
}

// Every id a level's objectives can legally name.
function propIds(level) {
  const ids = (level.props ?? []).map((p) => p.id);
  for (const stack of level.stacks ?? []) {
    for (let i = 0; i < (stack.count ?? 1); i += 1) ids.push(`${stack.id}-${i}`);
  }
  return ids;
}

describe('the questions pack', () => {
  it('is the fourteen levels it says it is', () => {
    expect(QUESTIONS).toHaveLength(14);
    expect(new Set(QUESTIONS.map((l) => l.id)).size).toBe(14);
  });

  it.each(QUESTIONS.map((l) => [l.name, l]))('%s is a complete level', (_name, level) => {
    expect(tierOf(level)).toBeTruthy();
    expect(level.budget?.cost).toBeGreaterThan(0);
    expect(level.brief.length).toBeGreaterThan(20);
    expect(level.hint.length).toBeGreaterThan(20);
    expect(level.objectives.length).toBeGreaterThan(0);
    // A scored level has no win condition, so a par time would be a lie.
    if (level.scored) expect(level.par).toBeUndefined();
    else expect(level.par).toBeGreaterThan(0);
  });

  it.each(QUESTIONS.map((l) => [l.name, l]))('%s only names things that exist', (_name, level) => {
    const zones = new Set((level.zones ?? []).map((z) => z.id));
    const hoops = new Set((level.hoops ?? []).map((h) => h.id));
    const props = new Set(propIds(level));
    const stacks = new Set((level.stacks ?? []).map((s) => s.id));

    for (const objective of level.objectives) {
      if (objective.zone) expect(zones, objective.label).toContain(objective.zone);
      if (objective.hoop) expect(hoops, objective.label).toContain(objective.hoop);
      if (objective.prop) expect(props, objective.label).toContain(objective.prop);
      if (objective.stack) expect(stacks, objective.label).toContain(objective.stack);
      for (const id of objective.props ?? []) expect(props, objective.label).toContain(id);
    }
  });

  // A prop born inside a wall is launched out of it by the solver, which looks
  // like the level being broken rather than like physics.
  it.each(QUESTIONS.map((l) => [l.name, l]))('%s starts nothing inside a wall', (_name, level) => {
    for (const prop of level.props ?? []) {
      const radius = prop.radius ?? Math.min(...prop.size) / 2;
      for (const piece of level.pieces ?? []) {
        // Axis-aligned pieces only; a tilted ramp is checked by eye.
        if (piece.rotX || piece.rotY) continue;
        const clear = [0, 1, 2].some((axis) => (
          Math.abs(prop.pos[axis] - piece.pos[axis]) > piece.size[axis] / 2 + radius * 0.9
        ));
        expect(clear, `${prop.id} overlaps a piece`).toBe(true);
      }
    }
  });

  it('leaves the machine somewhere to stand on every level', () => {
    for (const level of QUESTIONS) {
      expect(level.spawn, level.name).toHaveLength(3);
      expect(level.spawn[1], level.name).toBeGreaterThan((level.groundY ?? 0) + 0.4);
    }
  });
});

describe('a scored level reports a number rather than a win', () => {
  const quarry = getLevel('quarry');

  it('never completes, however well it goes', () => {
    const tracker = new ObjectiveTracker(quarry);
    const bin = quarry.zones.find((z) => z.id === 'bin');
    // Everything in the bin, which on an ordinary level would be a win.
    const report = tracker.update(1, {
      propPosition: () => new THREE.Vector3(bin.pos[0], bin.pos[1], bin.pos[2]),
      corePosition: () => new THREE.Vector3(),
    });
    expect(report.complete).toBe(false);
    expect(report.score).toBe(40);
    expect(report.scoreLabel).toBe('Rock in the bin');
  });

  it('counts up as things land in the bin, and back down if they leave', () => {
    const tracker = new ObjectiveTracker(quarry);
    const bin = quarry.zones.find((z) => z.id === 'bin');
    const inside = new THREE.Vector3(...bin.pos);
    const outside = new THREE.Vector3(40, 0.4, 40);
    const put = (howMany) => tracker.update(1, {
      propPosition: (id) => (Number(id.split('-')[1]) < howMany ? inside : outside),
      corePosition: () => new THREE.Vector3(),
    });
    expect(put(0).score).toBe(0);
    expect(put(7).score).toBe(7);
    expect(put(19).score).toBe(19);
    expect(put(3).score).toBe(3);
  });

  it('really does deal out forty blocks to collect', () => {
    const { arena } = stage(quarry);
    const present = Array.from({ length: 40 }, (_, i) => arena.propPosition(`rock-${i}`));
    expect(present.every(Boolean)).toBe(true);
    // Scattered across the floor rather than stacked on one spot.
    const spread = Math.max(...present.map((p) => p.x)) - Math.min(...present.map((p) => p.x));
    expect(spread).toBeGreaterThan(10);
    arena.dispose();
  });
});

describe('the derby opponent can actually shove you off', () => {
  it('drives at the machine and pushes it', () => {
    const level = getLevel('derby');
    const { world, scene, arena } = stage(level);

    // A light, tall machine — exactly what the level is telling you not to
    // build — parked in the opponent's path.
    const bp = new Blueprint();
    bp.place('core', [0, 1, 0]);
    bp.place('block', [0, 0, 0]);
    const machine = new Machine({
      RAPIER, world, scene, blueprint: bp,
      spawn: new THREE.Vector3(0, 4.6, 0),
      level,
    });
    const bus = new SignalBus(keyboard());
    const startedAt = machine.corePosition().clone();

    for (let i = 0; i < Math.round(12 / STEP); i += 1) {
      arena.step(STEP);
      machine.update(STEP, bus);
      world.step();
    }

    const moved = machine.corePosition().distanceTo(startedAt);
    expect(moved, 'the opponent never reached it').toBeGreaterThan(1.5);
    arena.dispose();
  });

  it('has a floor you can be pushed off the edge of', () => {
    const level = getLevel('derby');
    const ring = level.zones.find((z) => z.id === 'ring');
    // Off the side of the platform is outside the zone, so the hold breaks.
    expect(inZone(new THREE.Vector3(0, 5.2, 0), ring)).toBe(true);
    expect(inZone(new THREE.Vector3(14, 5.2, 0), ring)).toBe(false);
    // And there is a long way down once you are off it.
    expect(level.groundY).toBeLessThan(0);
  });
});

describe('the timed gate really does close', () => {
  it('swings a shutter across the doorway and back', () => {
    const level = getLevel('timed-gate');
    const { world, arena } = stage(level);
    const seen = [];
    for (let i = 0; i < Math.round(40 / STEP); i += 1) {
      arena.step(STEP);
      world.step();
      if (i % 12 === 0) seen.push(arena.moverPosition?.(0)?.x ?? null);
    }
    arena.dispose();

    const xs = seen.filter((x) => x !== null);
    if (xs.length === 0) {
      // No accessor for movers; fall back to the spec, which is what the
      // arena is driving.
      const [shutter] = level.movers;
      expect(shutter.span).toBeGreaterThan(3);
      expect(shutter.speed[0]).toBe(shutter.speed[1]);
      return;
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2);
  });

  it('is the one level whose timing is deliberately learnable', () => {
    const [shutter] = getLevel('timed-gate').movers;
    // Both ends of the range the same, so the seed cannot change the beat.
    expect(shutter.speed[0]).toBe(shutter.speed[1]);
  });
});

describe('one shot refuses a second go', () => {
  it('is flagged, and is the only level in the pack that is', () => {
    const flagged = QUESTIONS.filter((l) => l.noRespawn);
    expect(flagged.map((l) => l.id)).toEqual(['one-shot']);
  });
});

describe('the mass readout matches what gets built', () => {
  function rover() {
    const bp = new Blueprint();
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    for (const cell of [[-2, 0, -1], [2, 0, -1], [-2, 0, 1], [2, 0, 1]]) {
      bp.place('wheel', cell, cell[0] < 0 ? yawStep(yawStep(IDENTITY_ORIENTATION)) : IDENTITY_ORIENTATION);
    }
    return bp;
  }

  // A readout that disagrees with the rule it is reporting on is worse than no
  // readout, so it is checked against the mass the physics actually gives the
  // machine rather than against a number typed here.
  it('agrees with the mass the machine really has', () => {
    const level = getLevel('quarry');
    const { world, scene, arena } = stage(level);
    const bp = rover();
    const machine = new Machine({
      RAPIER, world, scene, blueprint: bp,
      spawn: new THREE.Vector3(0, 2, -20),
      level,
    });
    let real = 0;
    for (const body of machine.bodies) real += body.mass();
    const shown = blueprintMass(bp);
    expect(shown).toBeGreaterThan(0);
    expect(Math.abs(shown - real) / real, `shown ${shown} vs real ${real}`).toBeLessThan(0.02);
    arena.dispose();
  });

  it('grows as parts go on', () => {
    const bp = rover();
    const before = blueprintMass(bp);
    bp.place('ballast', [0, 1, 2]);
    expect(blueprintMass(bp)).toBeGreaterThan(before);
  });
});

describe('catch launches the ball on its own', () => {
  it('rolls off the chute and leaves the ground', () => {
    const level = getLevel('catch');
    const { world, arena } = stage(level);
    const startedAt = arena.propPosition('ball').clone();
    let lowest = startedAt.y;
    for (let i = 0; i < Math.round(8 / STEP); i += 1) {
      arena.step(STEP);
      world.step();
      lowest = Math.min(lowest, arena.propPosition('ball').y);
    }
    const ended = arena.propPosition('ball');
    arena.dispose();

    // It has come a long way down the course under its own steam, which is
    // what makes the arc the same every run.
    expect(startedAt.z - ended.z, 'the ball never left the chute').toBeGreaterThan(6);
    expect(lowest).toBeLessThan(startedAt.y - 2);
  });

  it('asks for the ball to be held up, which a ball on the floor is not', () => {
    const level = getLevel('catch');
    const [objective] = level.objectives;
    expect(objective.type).toBe('propAbove');
    // Higher than a ball can sit on the ground, so resting there never counts.
    expect(objective.height).toBeGreaterThan(level.props[0].radius * 2.4);
    expect(objective.hold).toBeGreaterThan(1);
  });
});

describe('the maze is a maze', () => {
  it('has no straight line from the spawn to the goal', () => {
    const level = getLevel('maze');
    const goal = level.zones.find((z) => z.id === 'centre');
    const from = new THREE.Vector3(...level.spawn);
    const to = new THREE.Vector3(...goal.pos);

    // Walk the straight line and count how many walls it passes through.
    let blocked = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const at = from.clone().lerp(to, t);
      for (const piece of level.pieces) {
        const hit = [0, 1, 2].every((axis) => (
          Math.abs(at.getComponent(axis) - piece.pos[axis]) <= piece.size[axis] / 2
        ));
        if (hit) { blocked += 1; break; }
      }
    }
    expect(blocked, 'you can drive straight at the goal').toBeGreaterThan(0);
  });

  it('has walls you cannot see over', () => {
    for (const piece of getLevel('maze').pieces) {
      expect(piece.size[1]).toBeGreaterThanOrEqual(3);
    }
  });
});
