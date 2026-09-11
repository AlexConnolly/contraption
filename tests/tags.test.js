import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION } from '../src/core/orientation.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { Arena } from '../src/sim/arena.js';
import { SignalBus } from '../src/sim/signals.js';
import { getPart, portsOf } from '../src/parts/registry.js';

const STEP = 1 / 60;
const keyboard = () => ({ down: new Set(), isDown: () => false, wasPressed: () => false });

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * A sensor on a post, looking along +Z at whatever the level puts in front of
 * it. Sorting is impossible unless a machine can tell one crate from another,
 * and a whole colour-sensing part for that would be a lot of new surface for
 * one job — so the beam reports what it hit.
 */
function look(props) {
  const level = {
    spawn: [0, 1, -6],
    groundSize: 80,
    pieces: [],
    props,
    zones: [],
    objectives: [],
  };
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const scene = new THREE.Scene();
  const arena = new Arena({ RAPIER, world, scene, level, seed: 3 });

  const bp = new Blueprint({ name: 'eye' });
  bp.place('panel', [0, 0, 0]);
  bp.place('core', [0, 1, 0]);
  bp.place('sensor', [0, 2, 0], IDENTITY_ORIENTATION);
  const machine = new Machine({
    RAPIER, world, scene, blueprint: bp, level,
    spawn: new THREE.Vector3(0, 1, -6),
  });
  const bus = new SignalBus(keyboard());
  for (let i = 0; i < 30; i += 1) {
    arena.step(STEP);
    machine.update(STEP, bus);
    world.step();
  }
  const sensor = bp.list().find((p) => p.type === 'sensor');
  return { machine, sensorId: sensor.id };
}

describe('what the beam is looking at', () => {
  it('is a port on the sensor already there, not a new part', () => {
    const out = portsOf(getPart('sensor'), 'out').map((p) => p.id);
    expect(out).toContain('tag');
    expect(out).toContain('distance');
  });

  it('reads nothing as zero', () => {
    const { machine, sensorId } = look([]);
    expect(machine.sensorTag(sensorId)).toBe(0);
  });

  it('reads back the tag the level gave the thing it hit', () => {
    const { machine, sensorId } = look([
      { id: 'red', pos: [0, 1, -3], size: [1.2, 2, 1.2], mass: 4, colour: 0xff0000, tag: 1 },
    ]);
    expect(machine.sensorTag(sensorId)).toBe(1);
  });

  it('tells one thing from another', () => {
    const near = look([
      { id: 'a', pos: [0, 1, -3], size: [1.2, 2, 1.2], mass: 4, colour: 0x00ff00, tag: 2 },
    ]);
    const far = look([
      { id: 'b', pos: [0, 1, -3], size: [1.2, 2, 1.2], mass: 4, colour: 0x0000ff, tag: 3 },
    ]);
    expect(near.machine.sensorTag(near.sensorId)).toBe(2);
    expect(far.machine.sensorTag(far.sensorId)).toBe(3);
  });

  it('reads untagged scenery as zero even when it can see it', () => {
    const { machine, sensorId } = look([
      { id: 'plain', pos: [0, 1, -3], size: [1.2, 2, 1.2], mass: 4, colour: 0x888888 },
    ]);
    expect(machine.sensorDistance(sensorId)).toBeLessThan(9);
    expect(machine.sensorTag(sensorId)).toBe(0);
  });
});
