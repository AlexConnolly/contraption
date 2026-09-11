import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { Machine } from '../src/sim/machine.js';
import { Arena } from '../src/sim/arena.js';
import { SignalBus } from '../src/sim/signals.js';
import { breached, breachedBy, throughHoop } from '../src/challenges/objectives.js';

const STEP = 1 / 60;
const keyboard = () => ({ down: new Set(), isDown: () => false, wasPressed: () => false });

beforeAll(async () => { await RAPIER.init(); }, 30000);

const KEEPOUT = { id: 'no', pos: [0, 4, 0], size: [10, 8, 10] };

describe('no-go zones', () => {
  it('is clear of a machine well outside it', () => {
    expect(breached({ keepout: [KEEPOUT] }, new THREE.Vector3(20, 1, 0))).toBe(null);
  });

  it('catches a machine that drives into it', () => {
    expect(breached({ keepout: [KEEPOUT] }, new THREE.Vector3(0, 1, 0))).toBe(KEEPOUT);
  });

  // The whole point: stilts and a long arm are the degenerate answer to every
  // "get it up there" problem, so the airspace has to count too.
  it('catches a machine that goes over the top of it', () => {
    expect(breached({ keepout: [KEEPOUT] }, new THREE.Vector3(0, 7, 0))).toBe(KEEPOUT);
  });

  it('lets a machine past above the ceiling of the zone', () => {
    expect(breached({ keepout: [KEEPOUT] }, new THREE.Vector3(0, 9, 0))).toBe(null);
  });

  it('says nothing on a level with no zones at all', () => {
    expect(breached({}, new THREE.Vector3(0, 1, 0))).toBe(null);
  });

  it('names which zone was entered when there are several', () => {
    const second = { id: 'other', pos: [30, 4, 0], size: [6, 8, 6] };
    const level = { keepout: [KEEPOUT, second] };
    expect(breached(level, new THREE.Vector3(30, 2, 0))).toBe(second);
  });
});

describe('hoops', () => {
  const hoop = { id: 'net', pos: [0, 6, 10], radius: 1.4, axis: [0, 0, 1] };

  it('scores a payload at the middle of the ring', () => {
    expect(throughHoop(hoop, new THREE.Vector3(0, 6, 10))).toBe(true);
  });

  it('does not score one sitting beside the ring', () => {
    expect(throughHoop(hoop, new THREE.Vector3(3, 6, 10))).toBe(false);
  });

  it('does not score one that has not reached the plane of the ring', () => {
    expect(throughHoop(hoop, new THREE.Vector3(0, 6, 6))).toBe(false);
  });

  it('scores just inside the rim but not outside it', () => {
    expect(throughHoop(hoop, new THREE.Vector3(1.0, 6, 10))).toBe(true);
    expect(throughHoop(hoop, new THREE.Vector3(1.9, 6, 10))).toBe(false);
  });
});

describe('a hoop in the world', () => {
  function fire(from, velocity) {
    const level = {
      spawn: [0, 1, -6],
      groundSize: 60,
      pieces: [],
      hoops: [{ id: 'net', pos: [0, 2, 0], radius: 1.2, axis: [0, 0, 1] }],
      props: [{ id: 'ball', pos: from, radius: 0.35, mass: 2, colour: 0xffaa33 }],
      zones: [],
      objectives: [],
    };
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = STEP;
    const arena = new Arena({ RAPIER, world, scene: new THREE.Scene(), level, seed: 1 });
    arena.props.get('ball').body.setLinvel(
      { x: velocity[0], y: velocity[1], z: velocity[2] }, true,
    );
    for (let i = 0; i < 90; i += 1) { arena.step(STEP); world.step(); }
    return arena.propPosition('ball');
  }

  // A ring you can shove a payload through sideways is not a hoop, it is a
  // marker. The rim has to be real.
  it('stops a payload thrown at the rim', () => {
    const at = fire([0, 3.2, -4], [0, 0, 7]);
    expect(at.z).toBeLessThan(0);
  });

  it('lets one through the middle', () => {
    const at = fire([0, 2, -4], [0, 0, 7]);
    expect(at.z).toBeGreaterThan(2);
  });
});

/**
 * A keep-out that only looks at the core is not a keep-out. Park just outside
 * the line, reach in with a long arm, and every "get it up there" problem
 * falls over to the answer the zone exists to prevent — which is exactly what
 * a player will try first.
 */
describe('a keep-out covers the whole machine', () => {
  function reachingMachine(coreCell, armCells) {
    const bp = new Blueprint();
    bp.place('core', coreCell);
    for (const cell of armCells) bp.place('beam', cell);
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = STEP;
    const machine = new Machine({
      RAPIER,
      world,
      scene: new THREE.Scene(),
      blueprint: bp,
      spawn: new THREE.Vector3(0, 1, -7),
      level: { keepout: [KEEPOUT] },
    });
    return machine;
  }

  it('is clear when the whole machine is outside', () => {
    const machine = reachingMachine([0, 0, 0], [[0, 0, -2], [0, 0, -4]]);
    expect(breachedBy({ keepout: [KEEPOUT] }, machine)).toBe(null);
  });

  it('catches an arm reaching in while the core stays legal', () => {
    // Core back outside the line, a boom running forward into the zone.
    const machine = reachingMachine([0, 0, 0], [[0, 0, 4], [0, 0, 8], [0, 0, 12], [0, 0, 16], [0, 0, 20]]);
    expect(breached({ keepout: [KEEPOUT] }, machine.corePosition())).toBe(null);
    expect(breachedBy({ keepout: [KEEPOUT] }, machine)).toBe(KEEPOUT);
  });

  it('says nothing on a level with no zones', () => {
    const machine = reachingMachine([0, 0, 0], [[0, 0, 4]]);
    expect(breachedBy({}, machine)).toBe(null);
  });
});
