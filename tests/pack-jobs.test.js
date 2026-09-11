import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { JOBS } from '../src/challenges/packs/jobs.js';
import { LEVELS, tierOf, TIERS } from '../src/challenges/levels.js';
import { Arena } from '../src/sim/arena.js';
import { createWorld } from '../src/sim/world.js';

const STEP = 1 / 60;
const RANKS = TIERS.map((t) => t.id);

beforeAll(async () => { await RAPIER.init(); }, 30000);

function arenaFor(level, seed = 5) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  return { world, arena: new Arena({ RAPIER, world, scene, level, seed }) };
}

function run(arena, world, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    world.step();
  }
}

const level = (id) => JOBS.find((entry) => entry.id === id);

/** Whether a point sits inside an axis-aligned piece, with a little margin. */
function insidePiece(point, piece, margin = 0) {
  const [hx, hy, hz] = piece.size.map((n) => n / 2 + margin);
  return (
    Math.abs(point[0] - piece.pos[0]) < hx &&
    Math.abs(point[1] - piece.pos[1]) < hy &&
    Math.abs(point[2] - piece.pos[2]) < hz
  );
}

describe('the jobs pack', () => {
  it('is the eight levels it says it is, each with its own id', () => {
    expect(JOBS).toHaveLength(8);
    const ids = JOBS.map((l) => l.id);
    expect(new Set(ids).size).toBe(8);
  });

  it('does not collide with any id already in the campaign', () => {
    const others = LEVELS.filter((l) => !JOBS.includes(l)).map((l) => l.id);
    for (const entry of JOBS) expect(others, entry.id).not.toContain(entry.id);
  });

  it('reaches the campaign', () => {
    for (const entry of JOBS) expect(LEVELS).toContain(entry);
  });

  it.each(JOBS.map((l) => [l.name, l]))('%s is a complete level', (_name, entry) => {
    expect(RANKS).toContain(tierOf(entry));
    expect(entry.budget?.cost).toBeGreaterThan(0);
    expect(entry.par).toBeGreaterThan(0);
    expect(entry.objectives.length).toBeGreaterThan(0);
    expect(entry.brief).toBeTruthy();
    expect(entry.hint).toBeTruthy();
    expect(entry.spawn).toHaveLength(3);
  });

  it.each(JOBS.map((l) => [l.name, l]))('%s only asks for things that exist', (_name, entry) => {
    const props = new Set((entry.props ?? []).map((p) => p.id));
    for (const stack of entry.stacks ?? []) {
      for (let i = 0; i < stack.count; i += 1) props.add(`${stack.id}-${i}`);
    }
    const zones = new Set((entry.zones ?? []).map((z) => z.id));

    for (const objective of entry.objectives) {
      if (objective.zone) expect(zones, objective.zone).toContain(objective.zone);
      if (objective.prop) expect(props, objective.prop).toContain(objective.prop);
      for (const id of objective.props ?? []) expect(props, id).toContain(id);
      if (objective.stack) {
        expect((entry.stacks ?? []).some((s) => s.id === objective.stack)).toBe(true);
      }
    }
  });

  // A prop that starts buried in a wall is launched out of it on the first
  // step, which looks like the physics being broken rather than the level
  // being wrong. Rotated pieces are skipped: their axis-aligned box is not
  // where they actually are.
  it.each(JOBS.map((l) => [l.name, l]))('%s starts nothing inside a wall', (_name, entry) => {
    const flat = (entry.pieces ?? []).filter((p) => !p.rotX && !p.rotY);
    for (const prop of entry.props ?? []) {
      for (const piece of flat) {
        expect(insidePiece(prop.pos, piece), `${prop.id} in a piece`).toBe(false);
      }
    }
    for (const piece of flat) {
      expect(insidePiece(entry.spawn, piece), 'spawn in a piece').toBe(false);
    }
  });

  it('bans flight everywhere, because none of these are interesting from the air', () => {
    for (const entry of JOBS) expect(entry.bans).toContain('flight');
  });

  it('every level builds a world without falling over', () => {
    for (const entry of JOBS) {
      const { world, arena } = arenaFor(entry);
      run(arena, world, 0.5);
      arena.dispose();
      expect(arena.props.size).toBe(0);
    }
  });
});

/**
 * The claim Removals rests on: the beam is longer than the corner is wide, so
 * carrying it round end-on is not a thing you can do however hard you push.
 * Without this the level is a corridor with a long crate in it.
 */
describe('Removals really has a corner in it', () => {
  it('will not let the beam round end-on', () => {
    const { world, arena } = arenaFor(level('removals'));
    const beam = arena.props.get('beam').body;
    // Sat in the turning room, still lying the way it came in — along z.
    beam.setTranslation({ x: 0, y: 0.4, z: 2.8 }, true);
    beam.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);

    // Shoved hard down the far corridor, over and over, for five seconds.
    for (let i = 0; i < Math.round(5 / STEP); i += 1) {
      const v = beam.linvel();
      beam.setLinvel({ x: 6, y: v.y, z: v.z }, true);
      arena.step(STEP);
      world.step();
    }

    // The corridor mouth is at x = 3. A beam still lying across it cannot be
    // anywhere near the far end.
    expect(arena.propPosition('beam').x).toBeLessThan(6);
    arena.dispose();
  });

  it('lets it through once it has been turned', () => {
    const { world, arena } = arenaFor(level('removals'));
    const beam = arena.props.get('beam').body;
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    beam.setTranslation({ x: 3, y: 0.4, z: 3 }, true);
    beam.setRotation({ x: turned.x, y: turned.y, z: turned.z, w: turned.w }, true);

    for (let i = 0; i < Math.round(5 / STEP); i += 1) {
      const v = beam.linvel();
      beam.setLinvel({ x: 6, y: v.y, z: v.z }, true);
      arena.step(STEP);
      world.step();
    }

    expect(arena.propPosition('beam').x).toBeGreaterThan(10);
    arena.dispose();
  });
});

/**
 * The claim Gritter rests on: the step is a wall to anything on wheels, so
 * there is no way up until the player builds one. If a rover can simply drive
 * at it and get up, the level has nothing in it.
 */
describe('the Gritter step really is a wall', () => {
  it('will not let a rover drive up it', async () => {
    const { starterRover } = await import('../src/studio/presets.js');
    const { Machine } = await import('../src/sim/machine.js');
    const { SignalBus } = await import('../src/sim/signals.js');

    const gritter = level('gritter');
    // The step on its own: no hardcore in the way, so the only thing being
    // measured is whether a machine can climb a bare 1.2 m face.
    const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
    const scene = new THREE.Scene();
    const arena = new Arena({
      RAPIER, world, scene, level: { ...gritter, stacks: [], props: [] }, seed: 2,
    });
    const machine = new Machine({
      RAPIER,
      world,
      scene,
      blueprint: starterRover(),
      spawn: new THREE.Vector3(0, 1.2, -6),
      level: gritter,
    });
    const down = new Set(['KeyW']);
    const bus = new SignalBus({ down, isDown: (c) => down.has(c), wasPressed: () => false });

    const resting = machine.corePosition().y;
    let furthest = machine.corePosition().z;
    let highest = resting;
    for (let i = 0; i < Math.round(9 / STEP); i += 1) {
      arena.step(STEP);
      machine.update(STEP, bus);
      world.step();
      furthest = Math.max(furthest, machine.corePosition().z);
      highest = Math.max(highest, machine.corePosition().y);
    }

    // The face is at z = 2. Driving flat out at it for nine seconds leaves
    // the machine stopped against it, not on top of it — so it never gets
    // past the face, and never gains the 1.2 m the step is tall.
    expect(furthest).toBeLessThan(2);
    expect(highest - resting).toBeLessThan(0.6);
    arena.dispose();
  });

  it('has enough hardcore in the bin to build a way up with', () => {
    const { world, arena } = arenaFor(level('gritter'));
    run(arena, world, 1.5);
    const grit = [...arena.props.keys()].filter((id) => id.startsWith('grit-'));
    expect(grit).toHaveLength(45);
    // In the bin at the bottom, well back from the face.
    for (const id of grit) {
      const at = arena.propPosition(id);
      expect(at.y).toBeLessThan(1.6);
      expect(at.z).toBeLessThan(0);
    }
    // And enough of it to fill a 1.2 m step: a slope wants roughly as much
    // material as the face is tall, times the width you mean to drive up.
    const block = level('gritter').stacks[0];
    const volume = block.count * block.size[0] * block.size[1] * block.size[2];
    expect(volume).toBeGreaterThan(1.2 * 2 * 1.2);
    arena.dispose();
  });
});

/**
 * The claim Tow Truck rests on: the dead machine does not coast. Give it a
 * good shove and it stops almost at once, so it has to be dragged the whole
 * way rather than launched at the pad and abandoned.
 */
describe('the Tow Truck wreck really is dead weight', () => {
  it('stops almost the moment it is let go of', () => {
    const { world, arena } = arenaFor(level('tow-truck'));
    run(arena, world, 1);
    const before = arena.propPosition('wreck').clone();
    arena.props.get('wreck').body.setLinvel({ x: 0, y: 0, z: 3 }, true);
    run(arena, world, 4);
    const after = arena.propPosition('wreck');

    expect(after.z - before.z).toBeLessThan(1.5);
    // And nowhere near the pad, which is fourteen metres away.
    expect(after.z).toBeLessThan(6);
    arena.dispose();
  });

  it('weighs appreciably more than the machine sent to fetch it', async () => {
    const { starterRover } = await import('../src/studio/presets.js');
    const { Machine } = await import('../src/sim/machine.js');
    const { machineMass } = await import('../src/challenges/objectives.js');
    const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
    const machine = new Machine({
      RAPIER,
      world,
      scene: new THREE.Scene(),
      blueprint: starterRover(),
      spawn: new THREE.Vector3(0, 1.2, 0),
    });
    const wreck = level('tow-truck').props.find((p) => p.id === 'wreck');
    expect(wreck.mass).toBeGreaterThan(machineMass(machine));
  });
});

/**
 * Roadworks is only a level if the rubble actually blocks the road. A heap
 * that leaves a clear lane down one side is a heap you drive past.
 */
describe('the Roadworks heap really is across the road', () => {
  it('leaves no clear lane to drive round', () => {
    const { world, arena } = arenaFor(level('roadworks'));
    run(arena, world, 2);
    const xs = [...arena.props.keys()]
      .filter((id) => id.startsWith('rubble-'))
      .map((id) => arena.propPosition(id).x);

    expect(xs).toHaveLength(40);
    // The road runs from x = -2.9 to x = 2.9. Rubble on both sides of the
    // middle and spread over most of that width means no way round it.
    expect(Math.min(...xs)).toBeLessThan(-1.5);
    expect(Math.max(...xs)).toBeGreaterThan(1.5);
    arena.dispose();
  });
});
