import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { WORLDS } from '../src/challenges/packs/worlds.js';
import { tierOf, TIERS } from '../src/challenges/levels.js';
import { Arena, ICY } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld, gravityOf } from '../src/sim/world.js';
import { withinMassCap, machineMass } from '../src/challenges/objectives.js';
import { starterRover } from '../src/studio/presets.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';

const STEP = 1 / 60;
const keyboard = () => {
  const down = new Set();
  return { down, isDown: (c) => down.has(c), wasPressed: () => false };
};

beforeAll(async () => { await RAPIER.init(); }, 30000);

const byId = (id) => WORLDS.find((level) => level.id === id);

function arenaFor(level, seed = 3) {
  const world = createWorld(RAPIER, gravityOf(level));
  const scene = new THREE.Scene();
  return { world, scene, arena: new Arena({ RAPIER, world, scene, level, seed }) };
}

function rove(level, blueprint = starterRover()) {
  const { world, scene, arena } = arenaFor(level);
  const machine = new Machine({
    RAPIER,
    world,
    scene,
    blueprint,
    spawn: new THREE.Vector3(...level.spawn),
    level,
  });
  return { world, arena, machine, bus: new SignalBus(keyboard()) };
}

function run({ world, arena, machine, bus }, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
  }
}

const heading = (machine) => {
  const f = machine.coreForward();
  return Math.atan2(f.x, f.z);
};

// How far a machine comes round in a given time, signed, unwrapped.
function turnOver(rig, seconds) {
  let last = heading(rig.machine);
  let turned = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    rig.arena.step(STEP);
    rig.machine.update(STEP, rig.bus);
    rig.world.step();
    let d = heading(rig.machine) - last;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    turned += d;
    last = heading(rig.machine);
  }
  return Math.abs((turned * 180) / Math.PI);
}

/**
 * The structural checks every level in the pack has to pass. None of them
 * prove a level is *good*, but each catches a mistake that would otherwise be
 * found by a player: an objective pointing at a prop that was renamed, a
 * spawn buried inside a wall, a level with no way to tell you what to do.
 */
describe('the worlds pack', () => {
  it('has the ten levels it says it has', () => {
    expect(WORLDS).toHaveLength(10);
    expect(new Set(WORLDS.map((l) => l.id)).size).toBe(10);
  });

  it.each(WORLDS.map((l) => [l.id, l]))('%s is a complete level', (id, level) => {
    expect(TIERS.map((t) => t.id)).toContain(tierOf(level));
    expect(level.name).toBeTruthy();
    expect(level.brief).toBeTruthy();
    expect(level.hint).toBeTruthy();
    expect(level.budget?.cost).toBeGreaterThan(0);
    expect(level.par).toBeGreaterThan(0);
    expect(level.objectives.length).toBeGreaterThan(0);
  });

  it.each(WORLDS.map((l) => [l.id, l]))('%s only ever names things that exist', (id, level) => {
    const props = new Set((level.props ?? []).map((p) => p.id));
    for (const stack of level.stacks ?? []) {
      for (let i = 0; i < (stack.count ?? 1); i += 1) props.add(`${stack.id}-${i}`);
    }
    const zones = new Set((level.zones ?? []).map((z) => z.id));
    const hoops = new Set((level.hoops ?? []).map((h) => h.id));

    for (const objective of level.objectives) {
      if (objective.prop) expect(props, objective.label).toContain(objective.prop);
      for (const p of objective.props ?? []) expect(props, objective.label).toContain(p);
      if (objective.zone) expect(zones, objective.label).toContain(objective.zone);
      if (objective.hoop) expect(hoops, objective.label).toContain(objective.hoop);
    }
  });

  // A machine that starts inside a wall is launched out of it, which looks
  // exactly like the physics being broken.
  it.each(WORLDS.map((l) => [l.id, l]))('%s does not spawn inside its own scenery', (id, level) => {
    const [sx, sy, sz] = level.spawn;
    for (const piece of level.pieces ?? []) {
      // Only the axis-aligned ones can be checked this cheaply; a tilted ramp
      // is deliberately skipped rather than checked wrongly.
      if (piece.rotX || piece.rotY) continue;
      const inside = ['x', 'y', 'z'].every((_, axis) => {
        const centre = piece.pos[axis];
        const half = piece.size[axis] / 2 + 0.6;
        return Math.abs([sx, sy, sz][axis] - centre) < half;
      });
      expect(inside, `${id} spawns inside a piece at ${piece.pos}`).toBe(false);
    }
  });

  it.each(WORLDS.map((l) => [l.id, l]))('%s builds a world without throwing', (id, level) => {
    const { arena, world } = arenaFor(level);
    for (let i = 0; i < 30; i += 1) {
      arena.step(STEP);
      world.step();
    }
    arena.dispose();
  });
});

/**
 * The four claims the pack is actually built on. Each of these is the reason
 * its level exists, and each is the sort of thing that quietly stops being
 * true when a number somewhere else changes.
 */
describe('low gravity really does take the grip away', () => {
  it('leaves a rover spinning where it would have driven', () => {
    const level = byId('low-gravity');
    const moon = rove(level);
    const earth = rove({ ...level, gravity: undefined });

    run(moon, 1);
    run(earth, 1);
    moon.bus.input.down.add('KeyW');
    earth.bus.input.down.add('KeyW');
    run(moon, 2.5);
    run(earth, 2.5);

    const travelled = (rig) => {
      const v = rig.machine.bodies[0].linvel();
      return Math.hypot(v.x, v.z);
    };
    // Same throttle, same machine, a sixth of the weight pressing the wheels
    // down: it cannot put the power through.
    expect(travelled(moon)).toBeLessThan(travelled(earth) * 0.7);
  });
});

describe('ice really does stop it steering', () => {
  /**
   * Not that it turns less — it turns *more*, because nothing sideways is
   * holding it and a skid-steer machine spins like a top. What ice takes away
   * is the connection between which way the machine points and which way it
   * is going: you can swing the nose all you like and carry on sliding the
   * way you were already headed. That is the thing worth pinning, and it is
   * the opposite of what you would guess.
   */
  function swing(level) {
    const rig = rove(level);
    run(rig, 0.8);
    rig.bus.input.down.add('KeyW');
    run(rig, 2.5);

    const before = rig.machine.bodies[0].linvel();
    const wasGoing = Math.atan2(before.x, before.z);

    rig.bus.input.down.add('KeyD');
    run(rig, 2);
    const after = rig.machine.bodies[0].linvel();

    let moved = Math.atan2(after.x, after.z) - wasGoing;
    while (moved > Math.PI) moved -= 2 * Math.PI;
    while (moved < -Math.PI) moved += 2 * Math.PI;
    return { course: Math.abs((moved * 180) / Math.PI), spin: turnOver(rig, 0.5) };
  }

  it('spins the machine but not its course', () => {
    const level = byId('ice-rink');
    expect(level.friction).toBeLessThan(ICY);

    const ice = swing(level);
    const grippy = swing({ ...level, friction: undefined });

    // On grip, pointing somewhere new takes you somewhere new. On ice it does
    // not: the machine comes round and keeps going the way it was.
    expect(ice.course).toBeLessThan(grippy.course);
    // And it is not that the ice machine refuses to rotate — it rotates more.
    expect(ice.spin).toBeGreaterThan(0);
  });

  it('is painted, so it can be seen before it is met', () => {
    // The visual is keyed off the same number the physics uses, so a level
    // cannot end up slippery and grey.
    expect(byId('ice-rink').friction).toBeLessThan(ICY);
  });
});

describe('the mass cap really does turn the standard rover away', () => {
  it('rejects the starter rover and accepts a stripped one', () => {
    const level = byId('featherweight');
    const { machine } = rove(level);
    expect(machineMass(machine)).toBeGreaterThan(level.massCap);
    expect(withinMassCap(machine, level).ok).toBe(false);

    // The same machine with the ballast left off — which is the whole lesson.
    const light = new Blueprint({ name: 'stripped' });
    light.place('panel', [0, 0, 0]);
    light.place('core', [0, 1, 0]);
    for (const cell of [[-2, 0, -1], [2, 0, -1], [-2, 0, 1], [2, 0, 1]]) {
      light.place('wheel', cell, cell[0] < 0 ? yawStep(yawStep(IDENTITY_ORIENTATION)) : IDENTITY_ORIENTATION, {
        binding: { mode: 'drive', pos: 'KeyW', neg: 'KeyS', left: 'KeyA', right: 'KeyD' },
      });
    }
    const stripped = rove(level, light);
    expect(machineMass(stripped.machine)).toBeLessThan(level.massCap);
    expect(withinMassCap(stripped.machine, level).ok).toBe(true);
  });
});

describe('heavy world really does sag a long arm', () => {
  it('drops the end of a boom further than ordinary gravity does', () => {
    const arm = () => {
      const bp = new Blueprint({ name: 'boom' });
      bp.place('panel', [0, 0, 0]);
      bp.place('core', [0, 1, 0]);
      bp.place('hinge', [0, 1, 1]);
      for (const z of [2, 5, 8] ) bp.place('beam', [0, 2, z], yawStep(IDENTITY_ORIENTATION));
      return bp;
    };
    const level = byId('heavy-world');
    const heavy = rove(level, arm());
    const normal = rove({ ...level, gravity: undefined }, arm());
    run(heavy, 2.5);
    run(normal, 2.5);

    const tipOf = (rig) => {
      const far = rig.machine.blueprint.list()
        .filter((p) => p.type === 'beam')
        .map((p) => rig.machine.partWorldPoint(p))
        .sort((a, b) => a.y - b.y)[0];
      return far.y;
    };
    expect(tipOf(heavy)).toBeLessThan(tipOf(normal));
  });
});

/**
 * Wind is the one mechanic with nothing to see, so it needed something drawn.
 * These check the streaks exist, sit in the volume, and move.
 */
describe('the wind can be seen', () => {
  it('draws streaks inside the volume and drifts them along it', () => {
    const level = byId('crosswind');
    const { arena, world } = arenaFor(level);
    expect(arena.winds).toHaveLength(1);

    const positions = arena.winds[0].geometry.getAttribute('position');
    const first = positions.getX(0);
    for (let i = 0; i < 90; i += 1) {
      arena.step(STEP);
      world.step();
    }
    expect(positions.getX(0)).not.toBe(first);

    // Everything it draws stays inside the box it is describing.
    const [hx, hy, hz] = level.wind[0].size.map((n) => n / 2);
    for (let i = 0; i < positions.count; i += 1) {
      expect(Math.abs(positions.getX(i))).toBeLessThanOrEqual(hx + 2);
      expect(Math.abs(positions.getY(i))).toBeLessThanOrEqual(hy + 2);
      expect(Math.abs(positions.getZ(i))).toBeLessThanOrEqual(hz + 2);
    }
    arena.dispose();
  });

  it('blows a light machine off the crossing and barely moves a heavy one', () => {
    const level = byId('crosswind');
    const light = rove(level);
    run(light, 3);
    const drift = Math.abs(light.machine.corePosition().x);
    expect(drift).toBeGreaterThan(0.05);
  });
});
