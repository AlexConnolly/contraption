import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { Machine } from '../src/sim/machine.js';
import { Arena } from '../src/sim/arena.js';
import { SignalBus } from '../src/sim/signals.js';

const STEP = 1 / 60;
const keyboard = () => ({ down: new Set(), isDown: () => false, wasPressed: () => false });

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * A belt running along +z with something sat on it. Rapier has no conveyor
 * surface, so the arena has to push whatever is touching one every step.
 */
function belted({ speed = 2, withMachine = false, propPos = [0, 1.2, -4] } = {}) {
  const level = {
    spawn: [0, 1.4, -4],
    groundSize: 90,
    pieces: [
      { pos: [0, 0.4, 0], size: [4, 0.8, 16], colour: 0x5a6470, belt: { dir: [0, 0, 1], speed } },
    ],
    props: [
      { id: 'box', pos: propPos, size: [1, 1, 1], mass: 3, colour: 0xc98b4b },
    ],
    zones: [],
    objectives: [],
  };
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const scene = new THREE.Scene();
  const arena = new Arena({ RAPIER, world, scene, level, seed: 1 });

  let machine = null;
  let bus = null;
  if (withMachine) {
    const bp = new Blueprint({ name: 'sitter' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    machine = new Machine({
      RAPIER, world, scene, blueprint: bp, level,
      spawn: new THREE.Vector3(0, 1.4, -4),
    });
    bus = new SignalBus(keyboard());
  }
  return { world, arena, machine, bus };
}

function settle({ world, arena, machine, bus }, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    machine?.update(STEP, bus);
    world.step();
  }
}

describe('conveyor belts', () => {
  it('carries a crate along itself', () => {
    const rig = belted({ speed: 2 });
    settle(rig, 0.6);
    const from = rig.arena.propPosition('box').z;
    settle(rig, 2);
    const to = rig.arena.propPosition('box').z;
    expect(to - from).toBeGreaterThan(1.5);
  });

  it('carries it at roughly the speed the belt is set to', () => {
    const rig = belted({ speed: 2 });
    settle(rig, 1.5);
    const from = rig.arena.propPosition('box').z;
    settle(rig, 2);
    const travelled = rig.arena.propPosition('box').z - from;
    expect(travelled / 2).toBeGreaterThan(1.2);
    expect(travelled / 2).toBeLessThan(3);
  });

  it('runs the other way on a reversed belt', () => {
    const forward = belted({ speed: 2 });
    settle(forward, 2.5);
    const back = belted({ speed: -2 });
    settle(back, 2.5);
    expect(forward.arena.propPosition('box').z).toBeGreaterThan(0);
    expect(back.arena.propPosition('box').z).toBeLessThan(-4);
  });

  it('lets go at the end rather than carrying on forever', () => {
    const rig = belted({ speed: 3 });
    settle(rig, 6);
    const z = rig.arena.propPosition('box').z;
    // The belt runs to z = 8; a crate that fell off the end stops near there
    // rather than sailing on across the ground.
    expect(z).toBeGreaterThan(5);
    expect(z).toBeLessThan(16);
  });

  it('carries a machine standing on it too', () => {
    // The crate is parked well down the belt: spawned on top of the machine
    // the two shove each other off it and neither goes anywhere.
    const rig = belted({ speed: 2, withMachine: true, propPos: [0, 1.2, 6] });
    settle(rig, 0.8);
    const from = rig.machine.corePosition().z;
    settle(rig, 2);
    expect(rig.machine.corePosition().z - from).toBeGreaterThan(1.2);
  });

  it('leaves plain scenery alone', () => {
    const level = {
      spawn: [0, 1.4, -4],
      groundSize: 90,
      pieces: [{ pos: [0, 0.4, 0], size: [4, 0.8, 16], colour: 0x5a6470 }],
      props: [{ id: 'box', pos: [0, 1.2, -4], size: [1, 1, 1], mass: 3, colour: 0xc98b4b }],
      zones: [],
      objectives: [],
    };
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = STEP;
    const arena = new Arena({ RAPIER, world, scene: new THREE.Scene(), level, seed: 1 });
    const from = arena.propPosition('box').z;
    for (let i = 0; i < 150; i += 1) { arena.step(STEP); world.step(); }
    expect(Math.abs(arena.propPosition('box').z - from)).toBeLessThan(0.3);
  });
});
