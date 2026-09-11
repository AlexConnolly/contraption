import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { createWorld } from '../src/sim/world.js';

const STEP = 1 / 60;

beforeAll(async () => { await RAPIER.init(); }, 30000);

function arenaFor(level, seed = 4) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  return { world, scene, arena: new Arena({ RAPIER, world, scene, level, seed }) };
}

function run(arena, world, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    world.step();
  }
}

const FLOOR = { spawn: [0, 1, 0], groundSize: 200, objectives: [] };

/**
 * A ball big enough to be the whole problem. Everything here is about it
 * behaving like a ball rather than like a bug: it has to roll, it has to be
 * heavy enough to need a real machine, and at speed it must not pass through
 * the floor.
 */
describe('a giant ball', () => {
  const ball = {
    id: 'ball', pos: [0, 2.2, 0], radius: 2, mass: 40, colour: 0xd0574f, ccd: true,
  };

  it('settles on the ground instead of sinking through it', () => {
    const { world, arena } = arenaFor({ ...FLOOR, props: [ball] });
    run(arena, world, 2.5);
    const at = arena.propPosition('ball');
    expect(at.y).toBeGreaterThan(1.6);
    expect(at.y).toBeLessThan(2.4);
  });

  it('rolls when it is shoved rather than sliding', () => {
    const { world, arena } = arenaFor({ ...FLOOR, props: [ball] });
    run(arena, world, 1);
    const body = arena.props.get('ball').body;
    body.setLinvel({ x: 0, y: 0, z: 6 }, true);
    run(arena, world, 1.5);
    const spin = body.angvel();
    // Rolling about the x axis is what moving along +z looks like.
    expect(Math.abs(spin.x)).toBeGreaterThan(1);
    expect(arena.propPosition('ball').z).toBeGreaterThan(3);
  });

  it('weighs what the level says it weighs', () => {
    const { arena } = arenaFor({ ...FLOOR, props: [ball] });
    expect(arena.props.get('ball').body.mass()).toBeCloseTo(40, 0);
  });

  // A fast heavy ball is exactly the thing that tunnels out of the world: at
  // this speed it covers several metres between steps, which is more than the
  // ground is thick. Continuous collision is what stops it.
  it('stays in the world when it is moving fast', () => {
    const { world, arena } = arenaFor({
      ...FLOOR,
      props: [{ ...ball, pos: [0, 40, 0] }],
    });
    arena.props.get('ball').body.setLinvel({ x: 0, y: -420, z: 0 }, true);
    run(arena, world, 2);
    expect(arena.propPosition('ball').y).toBeGreaterThan(0);
  });

  it('is allowed to skip that cost when it does not need it', () => {
    const { arena } = arenaFor({ ...FLOOR, props: [{ ...ball, ccd: false }] });
    expect(arena.props.get('ball').body.isCcdEnabled()).toBe(false);
  });
});

/**
 * A heap of loose blocks. One `stack` entry has to become many bodies, so a
 * level can say "forty blocks across the road" without writing forty props.
 */
describe('loose stacks', () => {
  const heap = {
    id: 'rubble',
    count: 12,
    pos: [0, 0.5, 0],
    spread: [3, 2, 3],
    size: [0.6, 0.6, 0.6],
    mass: 2,
    colour: 0x9a8b72,
  };

  it('becomes one body per block', () => {
    const { arena } = arenaFor({ ...FLOOR, stacks: [heap] });
    expect(arena.props.size).toBe(12);
  });

  it('gives every block its own id, so an objective can name one', () => {
    const { arena } = arenaFor({ ...FLOOR, stacks: [heap] });
    const ids = [...arena.props.keys()];
    expect(new Set(ids).size).toBe(12);
    expect(ids.every((id) => id.startsWith('rubble'))).toBe(true);
  });

  it('scatters them rather than stacking them all on one spot', () => {
    const { arena } = arenaFor({ ...FLOOR, stacks: [heap] });
    const xs = [...arena.props.keys()].map((id) => arena.propPosition(id).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1);
  });

  it('deals the same heap twice for the same seed', () => {
    const a = arenaFor({ ...FLOOR, stacks: [heap] }, 11);
    const b = arenaFor({ ...FLOOR, stacks: [heap] }, 11);
    const at = (rig) => [...rig.arena.props.keys()].map((id) => rig.arena.propPosition(id).x);
    expect(at(a)).toEqual(at(b));
  });

  it('deals a different heap for a different seed', () => {
    const a = arenaFor({ ...FLOOR, stacks: [heap] }, 11);
    const b = arenaFor({ ...FLOOR, stacks: [heap] }, 12);
    const at = (rig) => [...rig.arena.props.keys()].map((id) => rig.arena.propPosition(id).x);
    expect(at(a)).not.toEqual(at(b));
  });

  it('settles into a pile that stays put', () => {
    const { world, arena } = arenaFor({ ...FLOOR, stacks: [heap] });
    run(arena, world, 3);
    const ids = [...arena.props.keys()];
    for (const id of ids) {
      const at = arena.propPosition(id);
      expect(at.y, id).toBeGreaterThan(0);
      expect(Number.isFinite(at.x + at.y + at.z), id).toBe(true);
    }
  });

  // Loose, not scenery: a blade pushed through a heap has to move it. Tested
  // on a heap of one, because a block buried under five others correctly
  // refuses to go anywhere.
  it('can be shoved, because the blocks are loose', () => {
    const { world, arena } = arenaFor({
      ...FLOOR,
      stacks: [{ ...heap, count: 1, spread: [0, 0, 0] }],
    });
    run(arena, world, 1.5);
    const id = [...arena.props.keys()][0];
    const before = arena.propPosition(id).z;
    arena.props.get(id).body.setLinvel({ x: 0, y: 0, z: 6 }, true);
    run(arena, world, 1);
    expect(arena.propPosition(id).z).toBeGreaterThan(before + 1);
  });
});

/**
 * A machine that is not yours, driving a route of its own. It has to be a real
 * body: something you can be shoved by and can shove back.
 */
describe('an opponent', () => {
  const rival = {
    id: 'rival',
    pos: [0, 0.6, -6],
    size: [2, 1.2, 3],
    mass: 120,
    speed: 3,
    route: [[0, 0.6, -6], [0, 0.6, 6]],
    colour: 0xd6544a,
  };

  it('drives its route', () => {
    const { world, arena } = arenaFor({ ...FLOOR, opponents: [rival] });
    run(arena, world, 2);
    expect(arena.opponentPosition('rival').z).toBeGreaterThan(-5);
  });

  it('gets there at about the speed it was given', () => {
    const { world, arena } = arenaFor({ ...FLOOR, opponents: [rival] });
    run(arena, world, 2);
    const travelled = arena.opponentPosition('rival').z + 6;
    expect(travelled).toBeGreaterThan(2 * 3 * 0.7);
    expect(travelled).toBeLessThan(2 * 3 * 1.3);
  });

  it('turns round at the end and comes back', () => {
    const { world, arena } = arenaFor({ ...FLOOR, opponents: [rival] });
    run(arena, world, 4.5);
    const far = arena.opponentPosition('rival').z;
    run(arena, world, 3);
    expect(arena.opponentPosition('rival').z).toBeLessThan(far);
  });

  // The whole point of a derby is being shoved, so it has to be solid.
  it('is something a machine can be pushed by', () => {
    const { world, arena } = arenaFor({
      ...FLOOR,
      opponents: [rival],
      props: [{ id: 'crate', pos: [0, 0.6, 0], size: [1, 1, 1], mass: 4, colour: 0xc98b4b }],
    });
    run(arena, world, 3.5);
    // The opponent drives up the +z line and the crate is sitting on it.
    expect(arena.propPosition('crate').z).toBeGreaterThan(0.4);
  });

  it('goes back to its start when the run is reset', () => {
    const { world, arena } = arenaFor({ ...FLOOR, opponents: [rival] });
    run(arena, world, 2);
    arena.reset();
    expect(arena.opponentPosition('rival').z).toBeCloseTo(-6, 1);
  });
});
