import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { Arena } from '../src/sim/arena.js';
import { SignalBus } from '../src/sim/signals.js';
import { ObjectiveTracker, withinBudget } from '../src/challenges/objectives.js';
import { getLevel } from '../src/challenges/levels.js';
import { autoDrone } from '../src/studio/presets.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';
import { validateProgram } from '../src/sim/program.js';
import { createWorld } from '../src/sim/world.js';

const STEP = 1 / 60;

// Nothing is ever pressed. Every one of these runs is the machine on its own.
const NO_INPUT = { isDown: () => false, wasPressed: () => false };

function bare(level) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  if (level) return { world, scene, arena: new Arena({ RAPIER, world, scene, level }) };
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(400, 1, 400).setFriction(1).setCollisionGroups(GROUP_WORLD),
    ground,
  );
  return { world, scene, arena: null };
}

function boot(blueprint, level, spawn) {
  const { world, scene, arena } = bare(level);
  const machine = new Machine({
    RAPIER, world, scene, blueprint, level,
    spawn: new THREE.Vector3(...(spawn ?? level?.spawn ?? [0, 1.2, 0])),
  });
  const bus = new SignalBus(NO_INPUT);
  const run = (seconds) => {
    const steps = Math.round(seconds / STEP);
    for (let i = 0; i < steps; i += 1) {
      machine.update(STEP, bus);
      world.step();
    }
  };
  return { world, arena, machine, bus, run };
}

beforeAll(async () => {
  await RAPIER.init();
}, 30000);

describe('a machine with a computer on it', () => {
  it('finds the computer and starts it in the first state', () => {
    const { machine } = boot(autoDrone(), getLevel('hands-off'));
    expect(machine.computers).toHaveLength(1);
    expect(machine.computers[0].stateId).toBe('climb');
  });

  it('has a program that passes validation against the machine it is on', () => {
    const { machine } = boot(autoDrone(), getLevel('hands-off'));
    const computer = machine.computers[0];
    expect(validateProgram(computer.runner.program, computer.context())).toEqual([]);
  });

  it('reads real values off its own modules', () => {
    const blueprint = autoDrone();
    const { machine, run } = boot(blueprint, getLevel('hands-off'));
    run(2);
    const gps = blueprint.list().find((p) => p.type === 'gps');
    const computer = machine.computers[0];

    const position = computer.readPort(gps.id, 'position');
    expect(position.y).toBeCloseTo(machine.partWorldPoint(gps).y, 3);
    expect(computer.readPort(gps.id, 'altitude')).toBeCloseTo(position.y, 3);
    expect(Number.isFinite(computer.readPort(gps.id, 'heading'))).toBe(true);
    expect(computer.readPort(gps.id, 'speed')).toBeGreaterThanOrEqual(0);
  });

  it('clamps a write to the range the port allows', () => {
    const blueprint = autoDrone();
    const { machine } = boot(blueprint, getLevel('hands-off'));
    const rotor = blueprint.list().find((p) => p.type === 'propeller');
    const computer = machine.computers[0];
    computer.writePort(rotor.id, 'throttle', 5);
    expect(computer.value(rotor.id, 'throttle')).toBe(1);
    computer.writePort(rotor.id, 'throttle', -5);
    expect(computer.value(rotor.id, 'throttle')).toBe(0);
  });
});

describe('the hands-off challenge', () => {
  it('is solvable with nothing touched, by the program alone', () => {
    const level = getLevel('hands-off');
    const blueprint = autoDrone();
    const { arena, machine, bus, run } = boot(blueprint, level);
    const tracker = new ObjectiveTracker(level);

    let report = tracker.report();
    const steps = Math.round(70 / STEP);
    for (let i = 0; i < steps && !report.complete; i += 1) {
      machine.update(STEP, bus);
      machine.world.step();
      report = tracker.update(STEP, {
        propPosition: (id) => arena.propPosition(id),
        corePosition: () => machine.corePosition(),
      });
    }

    expect(machine.isUpsideDown()).toBe(false);
    expect(report.complete).toBe(true);
    expect(report.elapsed).toBeLessThan(level.par);
    void run;
  });

  it('works through its states in order and settles in the last one', () => {
    const level = getLevel('hands-off');
    const { machine, run } = boot(autoDrone(), level);
    const computer = machine.computers[0];
    const seen = [computer.stateId];

    for (let i = 0; i < 140; i += 1) {
      run(0.5);
      if (seen[seen.length - 1] !== computer.stateId) seen.push(computer.stateId);
      if (computer.stateId === 'hold') break;
    }
    expect(seen).toEqual(['climb', 'cruise', 'hold']);
    run(5);
    expect(computer.stateId).toBe('hold');
    expect(computer.errors).toEqual([]);
  });

  it('keeps the auto drone inside the budget', () => {
    expect(withinBudget(autoDrone(), getLevel('hands-off')).ok).toBe(true);
  });
});

describe('a program driving parts directly', () => {
  // No flight controller anywhere: the graph sets rotor throttles itself.
  function directDrone() {
    const bp = new Blueprint({ name: 'direct' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    const gps = bp.place('gps', [0, 1, 1]);
    const computer = bp.place('computer', [0, 2, 0]);
    const rotors = [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1]]
      .map((cell) => bp.place('propeller', cell, IDENTITY_ORIENTATION, {
        binding: { mode: 'hold', pos: 'KeyNone' },
      }));

    const nodes = [];
    const links = [];
    let n = 0;
    const add = (type, config) => {
      const id = `d${n += 1}`;
      nodes.push({ id, type, config, x: n * 140, y: 0 });
      return id;
    };
    const wire = (from, fromPort, to, toPort) => links.push({
      from: { node: from, port: fromPort }, to: { node: to, port: toPort },
    });

    // Hold 4 m by hand, with the maths nodes doing the work a flight
    // controller would otherwise do: hover thrust, plus a push for height
    // error, minus a pull for how fast it is already moving.
    const altitude = add('read', { partId: gps.id, port: 'altitude' });
    const target = add('constant', { kind: 'number', value: 4 });
    const error = add('maths', { op: 'subtract' });
    wire(target, 'value', error, 'a');
    wire(altitude, 'value', error, 'b');

    const lift = add('constant', { kind: 'number', value: 0.09 });
    const push = add('maths', { op: 'multiply' });
    wire(error, 'r', push, 'a');
    wire(lift, 'value', push, 'b');

    const velocity = add('read', { partId: gps.id, port: 'velocity' });
    const parts3 = add('split', {});
    wire(velocity, 'value', parts3, 'v');
    const damping = add('constant', { kind: 'number', value: 0.06 });
    const pull = add('maths', { op: 'multiply' });
    wire(parts3, 'y', pull, 'a');
    wire(damping, 'value', pull, 'b');

    const hover = add('constant', { kind: 'number', value: 0.27 });
    const withPush = add('maths', { op: 'add' });
    wire(hover, 'value', withPush, 'a');
    wire(push, 'r', withPush, 'b');
    const throttle = add('maths', { op: 'subtract' });
    wire(withPush, 'r', throttle, 'a');
    wire(pull, 'r', throttle, 'b');
    for (const rotor of rotors) {
      const write = add('write', { partId: rotor.id, port: 'throttle' });
      wire(throttle, 'r', write, 'value');
    }

    bp.setConfig(computer.id, {
      program: { version: 1, start: 's', states: [{ id: 's', name: 'Hover', nodes, links }] },
    });
    return bp;
  }

  it('holds a height with no flight controller involved at all', () => {
    const { machine, run } = boot(directDrone(), null, [0, 1, 0]);
    expect(machine.controllers).toHaveLength(0);
    run(6);
    const settled = machine.corePosition().y;
    expect(settled).toBeGreaterThan(2.5);
    run(5);
    expect(Math.abs(machine.corePosition().y - settled)).toBeLessThan(1.5);
  });
});

describe('a program driving a ground machine', () => {
  it('drives a rover forward and stops it on a sensor', () => {
    const bp = new Blueprint({ name: 'auto rover' });
    const facingLeft = yawStep(yawStep(IDENTITY_ORIENTATION));
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    const sensor = bp.place('sensor', [0, 1, 1]);
    const computer = bp.place('computer', [0, 2, 0]);
    const wheels = [
      bp.place('wheel', [2, 0, 1]),
      bp.place('wheel', [2, 0, -1]),
      bp.place('wheel', [-2, 0, 1], facingLeft),
      bp.place('wheel', [-2, 0, -1], facingLeft),
    ];

    const nodes = [];
    const links = [];
    let n = 0;
    const add = (type, config) => {
      const id = `r${n += 1}`;
      nodes.push({ id, type, config, x: n * 140, y: 0 });
      return id;
    };
    const wire = (from, fromPort, to, toPort) => links.push({
      from: { node: from, port: fromPort }, to: { node: to, port: toPort },
    });

    const tripped = add('read', { partId: sensor.id, port: 'tripped' });
    const stop = add('constant', { kind: 'number', value: 0 });
    const go = add('constant', { kind: 'number', value: 0.8 });
    const throttle = add('select', {});
    wire(tripped, 'value', throttle, 'when');
    wire(stop, 'value', throttle, 'a');
    wire(go, 'value', throttle, 'b');
    for (const wheel of wheels) {
      const write = add('write', { partId: wheel.id, port: 'throttle' });
      wire(throttle, 'r', write, 'value');
    }
    bp.setConfig(computer.id, {
      program: { version: 1, start: 's', states: [{ id: 's', name: 'Run', nodes, links }] },
    });

    const { world, machine, run } = boot(bp, null, [0, 1.2, 0]);
    const wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1, 14));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(6, 2, 0.4).setCollisionGroups(GROUP_WORLD),
      wall,
    );

    run(1);
    const start = machine.corePosition().z;
    run(4);
    const moved = machine.corePosition().z;
    expect(moved - start).toBeGreaterThan(3);

    run(8);
    const stopped = machine.corePosition().z;
    expect(stopped).toBeLessThan(13.6);
    run(3);
    expect(Math.abs(machine.corePosition().z - stopped)).toBeLessThan(0.6);
  });
});
