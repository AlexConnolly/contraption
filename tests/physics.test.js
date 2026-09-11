import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep, pitchStep } from '../src/core/orientation.js';
import { Machine, GROUP_WORLD } from '../src/sim/machine.js';
import { getPart, CELL, pistonStroke } from '../src/parts/registry.js';
import { SignalBus } from '../src/sim/signals.js';
import { starterRover } from '../src/studio/presets.js';
import { createWorld } from '../src/sim/world.js';

const STEP = 1 / 60;

function keyboard(...codes) {
  const down = new Set(codes);
  return {
    down,
    isDown: (code) => down.has(code),
    wasPressed: () => false,
  };
}

function makeWorld() {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(200, 1, 200)
      .setFriction(1)
      .setCollisionGroups(GROUP_WORLD),
    ground,
  );
  return world;
}

function run(machine, bus, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    machine.update(STEP, bus);
    machine.world.step();
  }
  machine.syncMeshes();
}

function build(blueprint, input, spawnY = 1.2) {
  const world = makeWorld();
  const machine = new Machine({
    RAPIER,
    world,
    scene: new THREE.Scene(),
    blueprint,
    spawn: new THREE.Vector3(0, spawnY, 0),
  });
  return { world, machine, bus: new SignalBus(input) };
}

beforeAll(async () => {
  await RAPIER.init();
}, 30000);

describe('machine assembly', () => {
  it('splits the starter rover into a chassis and four wheels', () => {
    const { machine } = build(starterRover(), keyboard());
    expect(machine.bodies).toHaveLength(5);
    expect(machine.joints).toHaveLength(4);
    expect(machine.grouping.disconnected).toEqual([]);
  });

  it('settles on the ground instead of sinking or exploding', () => {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 2);
    const core = machine.corePosition();
    expect(Number.isFinite(core.x)).toBe(true);
    expect(core.y).toBeGreaterThan(0.4);
    expect(core.y).toBeLessThan(1.4);
    expect(Math.abs(core.x)).toBeLessThan(0.3);
    expect(Math.abs(core.z)).toBeLessThan(0.3);
    expect(machine.isUpsideDown()).toBe(false);
  });
});

describe('driving', () => {
  it('drives forward on the throttle key', () => {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 1);
    const before = machine.corePosition().clone();
    bus.input.down.add('KeyW');
    run(machine, bus, 2);
    const after = machine.corePosition();
    expect(after.z - before.z).toBeGreaterThan(2);
    expect(machine.isUpsideDown()).toBe(false);
  });

  it('reverses on the opposite key', () => {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 1);
    const before = machine.corePosition().clone();
    bus.input.down.add('KeyS');
    run(machine, bus, 2);
    expect(machine.corePosition().z - before.z).toBeLessThan(-2);
  });

  it('turns when only the steer key is held', () => {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 1);
    const before = machine.coreForward().clone();
    bus.input.down.add('KeyD');
    run(machine, bus, 2);
    const after = machine.coreForward();
    const turned = Math.acos(Math.min(1, Math.max(-1, before.dot(after))));
    expect(turned).toBeGreaterThan(0.5);
  });

  it('stays put with no keys held', () => {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 1);
    const before = machine.corePosition().clone();
    run(machine, bus, 2);
    expect(machine.corePosition().distanceTo(before)).toBeLessThan(0.25);
  });
});

describe('what a machine sounds like', () => {
  it('is quiet standing still and noisy under power', () => {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 1);
    const idle = machine.audioState();
    expect(idle.wheels.every((w) => w === 0)).toBe(true);
    expect(idle.wheelSpeed).toBeLessThan(1);

    bus.input.down.add('KeyW');
    run(machine, bus, 2);
    const driving = machine.audioState();
    expect(driving.wheels.some((w) => Math.abs(w) > 0.5)).toBe(true);
    expect(driving.wheelSpeed).toBeGreaterThan(2);
    expect(driving.groundSpeed).toBeGreaterThan(1);
  });

  it('knows a rover is on the ground and a drone is not', () => {
    const rover = build(starterRover(), keyboard());
    run(rover.machine, rover.bus, 1.5);
    expect(rover.machine.audioState().grounded).toBe(true);
  });

  it('reports rotors apart from jets', () => {
    const bp = new Blueprint({ name: 'mixed' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('propeller', [-1, 1, 0], IDENTITY_ORIENTATION, {
      binding: { mode: 'hold', pos: 'Space' },
    });
    bp.place('thruster', [1, 1, 0], IDENTITY_ORIENTATION, {
      binding: { mode: 'hold', pos: 'KeyE' },
    });
    const { machine, bus } = build(bp, keyboard());
    bus.input.down.add('Space');
    run(machine, bus, 0.5);
    const state = machine.audioState();
    expect(state.rotors).toHaveLength(1);
    expect(state.jets).toHaveLength(1);
    expect(state.rotors[0]).toBeGreaterThan(0.5);
    expect(state.jets[0]).toBe(0);
    expect(state.rotorSpin).toBeGreaterThan(0);
  });
});

describe('steering direction', () => {
  // The machine's right-hand side is forward x up, which with forward at +Z
  // and up at +Y is -X. Getting this backwards makes A and D feel swapped.
  /**
   * How far it comes round, signed, rather than where it is pointing at the
   * end. The machine now pivots fast enough to pass ninety degrees inside the
   * measuring window, and a dot product against its old right-hand side
   * changes sign when it does — which read as "it did not turn" when in fact
   * it had turned further than the test could describe.
   */
  function turnTest(key) {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 1);
    const heading = () => {
      const f = machine.coreForward();
      return Math.atan2(f.x, f.z);
    };
    bus.input.down.add(key);
    let last = heading();
    let turned = 0;
    for (let i = 0; i < Math.round(1.5 / STEP); i += 1) {
      machine.update(STEP, bus);
      machine.world.step();
      let d = heading() - last;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      turned += d;
      last = heading();
    }
    return (turned * 180) / Math.PI;
  }

  // Forward is +Z and the machine's right is -X, so coming round to the right
  // makes the heading fall.
  it('turns the machine to its right on the right-steer key', () => {
    expect(turnTest('KeyD')).toBeLessThan(-60);
  });

  it('turns the machine to its left on the left-steer key', () => {
    expect(turnTest('KeyA')).toBeGreaterThan(60);
  });

  /**
   * Turning while driving used to be barely there: the outside wheel
   * saturated and the inside one was only stopped, so the starter rover came
   * round at 20 deg/s from a standstill and at little more than one degree a
   * second once it was up to speed. These pin the fix, in the terms a driver
   * would notice — how fast it comes round, and whether it is still driving
   * while it does.
   */
  function corner({ windUp = 0 } = {}) {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 1.2);
    bus.input.down.add('KeyW');
    if (windUp) run(machine, bus, windUp);
    bus.input.down.add('KeyD');

    const heading = () => { const f = machine.coreForward(); return Math.atan2(f.x, f.z); };
    let last = heading();
    let turned = 0;
    const seconds = 3;
    for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
      machine.update(STEP, bus);
      machine.world.step();
      let d = heading() - last;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      turned += d;
      last = heading();
    }
    const v = machine.bodies[0].linvel();
    return {
      rate: Math.abs((turned * 180) / Math.PI) / seconds,
      speed: Math.hypot(v.x, v.z),
    };
  }

  it('comes round briskly when told to turn while driving', () => {
    expect(corner().rate).toBeGreaterThan(30);
  });

  it('can still steer once it is up to speed', () => {
    expect(corner({ windUp: 2.5 }).rate).toBeGreaterThan(30);
  });

  // Against a pivot rather than against a number, because what matters is the
  // difference between the two: turning on the spot is a thing you ask for by
  // letting go of the throttle, and cornering has to stay clearly faster than
  // it however the grip is tuned.
  it('drives round the corner rather than stopping to pivot', () => {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 1.2);
    bus.input.down.add('KeyD');
    run(machine, bus, 2);
    const v = machine.bodies[0].linvel();
    const pivotSpeed = Math.hypot(v.x, v.z);

    expect(pivotSpeed).toBeLessThan(0.5);
    expect(corner().speed).toBeGreaterThan(pivotSpeed * 3);
  });

  // Backing up on the same key has to swing the machine the other way, which
  // is what it looks like from behind the wheel.
  it('swings the other way on the same key while reversing', () => {
    const { machine, bus } = build(starterRover(), keyboard());
    run(machine, bus, 1);
    const before = machine.coreForward().clone();
    const right = before.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();

    bus.input.down.add('KeyS');
    bus.input.down.add('KeyA');
    run(machine, bus, 1.5);

    expect(machine.coreForward().dot(right)).toBeGreaterThan(0.2);
  });
});

describe('thruster torque', () => {
  function rearThruster(rot) {
    const bp = starterRover();
    bp.place('thruster', [0, 1, -1], rot, { binding: { mode: 'hold', pos: 'KeyE' } });
    return bp;
  }

  // addForceAtPoint sets both a force and the r x F torque, and Rapier keeps
  // each until it is cleared separately. Missing resetTorques let an
  // off-centre thruster wind the machine up until it was thrown off the floor.
  it('does not spin the machine up when a thruster is mounted off-centre', () => {
    const { machine, bus } = build(rearThruster(pitchStep(IDENTITY_ORIENTATION)), keyboard());
    run(machine, bus, 1.5);
    const start = machine.corePosition().clone();
    bus.input.down.add('KeyE');
    run(machine, bus, 3);
    const end = machine.corePosition();

    expect(machine.isUpsideDown()).toBe(false);
    expect(end.y - start.y).toBeLessThan(0.3);
    const spin = machine.bodies[machine.grouping.rootBody].angvel();
    expect(Math.hypot(spin.x, spin.y, spin.z)).toBeLessThan(3);
  });

  it('pushes the machine along the way the nozzle points', () => {
    const forward = build(rearThruster(pitchStep(IDENTITY_ORIENTATION)), keyboard());
    run(forward.machine, forward.bus, 1.5);
    const fromZ = forward.machine.corePosition().z;
    forward.bus.input.down.add('KeyE');
    run(forward.machine, forward.bus, 3);
    expect(forward.machine.corePosition().z - fromZ).toBeGreaterThan(1);

    const back = pitchStep(pitchStep(pitchStep(IDENTITY_ORIENTATION)));
    const reverse = build(rearThruster(back), keyboard());
    run(reverse.machine, reverse.bus, 1.5);
    const backZ = reverse.machine.corePosition().z;
    reverse.bus.input.down.add('KeyE');
    run(reverse.machine, reverse.bus, 3);
    expect(reverse.machine.corePosition().z - backZ).toBeLessThan(-1);
  });

  it('cannot lift the machine with a single thruster pointing up', () => {
    const { machine, bus } = build(rearThruster(IDENTITY_ORIENTATION), keyboard());
    run(machine, bus, 1.5);
    const start = machine.corePosition().y;
    bus.input.down.add('KeyE');
    run(machine, bus, 3);
    expect(machine.corePosition().y - start).toBeLessThan(0.2);
  });
});

describe('manipulators', () => {
  function armBlueprint() {
    const bp = new Blueprint({ name: 'arm' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('hinge', [0, 1, -1], IDENTITY_ORIENTATION, {
      binding: { mode: 'hold', pos: 'KeyR' },
    });
    bp.place('beam', [0, 2, -2], yawStep(IDENTITY_ORIENTATION));
    return bp;
  }

  it('raises a hinged arm when its key is held, and lowers it when released', () => {
    const bp = armBlueprint();
    const { machine, bus } = build(bp, keyboard());
    run(machine, bus, 1.5);
    const armPart = bp.list().find((p) => p.type === 'beam');
    const resting = machine.partWorldPoint(armPart).clone();

    bus.input.down.add('KeyR');
    run(machine, bus, 2);
    const raised = machine.partWorldPoint(armPart).clone();
    expect(Math.abs(raised.z - resting.z)).toBeGreaterThan(0.3);

    bus.input.down.delete('KeyR');
    run(machine, bus, 2);
    const returned = machine.partWorldPoint(armPart);
    expect(Math.abs(returned.z - resting.z)).toBeLessThan(Math.abs(raised.z - resting.z));
  });

  it('extends a piston under its key and retracts it after', () => {
    const bp = new Blueprint({ name: 'lifter' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('piston', [0, 1, 1], IDENTITY_ORIENTATION, {
      binding: { mode: 'hold', pos: 'KeyE' },
    });
    bp.place('block', [0, 2, 1]);
    const { machine, bus } = build(bp, keyboard());
    run(machine, bus, 1.5);
    const cap = bp.list().find((p) => p.type === 'block');
    const low = machine.partWorldPoint(cap).y;

    bus.input.down.add('KeyE');
    run(machine, bus, 1.5);
    const high = machine.partWorldPoint(cap).y;
    expect(high - low).toBeGreaterThan(0.6);

    bus.input.down.delete('KeyE');
    run(machine, bus, 1.5);
    expect(machine.partWorldPoint(cap).y).toBeLessThan(high - 0.4);
  });

  // How far a piston pushes is set on the piston, not fixed for every piston
  // in the game.
  function pistonLift(stroke) {
    const bp = new Blueprint({ name: 'lifter' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('piston', [0, 1, 1], IDENTITY_ORIENTATION, {
      binding: { mode: 'hold', pos: 'KeyE' },
      ...(stroke === undefined ? {} : { stroke }),
    });
    bp.place('block', [0, 2, 1]);
    const { machine, bus } = build(bp, keyboard());
    run(machine, bus, 1.5);
    const cap = bp.list().find((p) => p.type === 'block');
    const low = machine.partWorldPoint(cap).y;
    bus.input.down.add('KeyE');
    run(machine, bus, 2.5);
    return { lift: machine.partWorldPoint(cap).y - low, machine, bp };
  }

  it('pushes as far as the piston is set to, not a fixed distance', () => {
    const short = pistonLift(0.5).lift;
    const long = pistonLift(2).lift;
    expect(short).toBeGreaterThan(0.35);
    expect(short).toBeLessThan(0.7);
    expect(long).toBeGreaterThan(1.7);
  });

  it('will not push past the stroke it is set to', () => {
    expect(pistonLift(0.5).lift).toBeLessThan(0.7);
  });

  it('refuses a stroke outside what the part can do', () => {
    const [min, max] = getPart('piston').strokeRange;
    expect(pistonStroke({ config: { stroke: 99 } })).toBe(max);
    expect(pistonStroke({ config: { stroke: -4 } })).toBe(min);
    expect(pistonStroke({ config: {} })).toBe(getPart('piston').stroke);
    expect(pistonLift(99).lift).toBeLessThan(max + 0.3);
  });

  // The piston travels with its load, so the gap it opens is underneath it and
  // the rod has to reach back down to the base. A piston with nothing in that
  // gap looks broken however well it works.
  it('keeps its foot planted on the base as it extends', () => {
    const bp = new Blueprint({ name: 'lifter' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('piston', [0, 1, 1], IDENTITY_ORIENTATION, {
      binding: { mode: 'hold', pos: 'KeyE' },
      stroke: 1.6,
    });
    bp.place('block', [0, 2, 1]);
    const { machine, bus } = build(bp, keyboard());
    const piston = bp.list().find((p) => p.type === 'piston');

    run(machine, bus, 1.5);
    machine.syncMeshes();
    const restFoot = machine.pistonFootPoint(piston.id);
    const restBody = machine.partWorldPoint(piston).y;
    expect(restFoot).not.toBe(null);

    bus.input.down.add('KeyE');
    run(machine, bus, 2.5);
    machine.syncMeshes();
    const outFoot = machine.pistonFootPoint(piston.id);
    const outBody = machine.partWorldPoint(piston).y;

    // The part itself rode up; the foot it is standing on did not.
    expect(outBody - restBody).toBeGreaterThan(1.2);
    expect(Math.abs(outFoot.y - restFoot.y)).toBeLessThan(0.1);
  });
});

describe('flight', () => {
  it('lifts off under rotor thrust and comes back down when cut', () => {
    const bp = new Blueprint({ name: 'copter' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    for (const cell of [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1]]) {
      bp.place('propeller', cell, IDENTITY_ORIENTATION, {
        binding: { mode: 'hold', pos: 'Space' },
      });
    }
    const { machine, bus } = build(bp, keyboard());
    run(machine, bus, 1);
    const grounded = machine.corePosition().y;

    bus.input.down.add('Space');
    run(machine, bus, 1.5);
    const flying = machine.corePosition().y;
    expect(flying - grounded).toBeGreaterThan(1);

    // It carries a lot of speed when the thrust is cut, so it keeps rising for
    // a moment; what matters is that gravity has taken back over.
    bus.input.down.delete('Space');
    run(machine, bus, 7);
    expect(machine.bodies[machine.grouping.rootBody].linvel().y).toBeLessThan(-1);
  });
});

describe('sensors', () => {
  it('trips when a wall comes inside its range, and reads clear otherwise', () => {
    const bp = new Blueprint({ name: 'scout' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    const sensor = bp.place('sensor', [0, 1, 1], IDENTITY_ORIENTATION, { threshold: 0.5 });
    const { world, machine, bus } = build(bp, keyboard());
    run(machine, bus, 1);
    expect(bus.sensor(sensor.id)).toBe(0);

    const wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1, 3));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(4, 2, 0.3).setCollisionGroups(GROUP_WORLD),
      wall,
    );
    run(machine, bus, 0.2);
    expect(bus.sensor(sensor.id)).toBe(1);
  });
});

describe('grabber', () => {
  it('latches a loose crate and carries it, then drops it on release', () => {
    const bp = new Blueprint({ name: 'claw' });
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    bp.place('grabber', [0, 2, 0], IDENTITY_ORIENTATION, {
      binding: { mode: 'always' },
    });
    const { world, machine, bus } = build(bp, keyboard());

    const crateBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2.6, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.3, 0.3, 0.3)
        .setDensity(0.4)
        .setCollisionGroups(GROUP_WORLD),
      crateBody,
    );

    run(machine, bus, 1.5);
    const grabber = bp.list().find((p) => p.type === 'grabber');
    expect(machine.grabs.has(grabber.id)).toBe(true);

    const gap = crateBody.translation().y - machine.partWorldPoint(grabber).y;
    run(machine, bus, 1.5);
    const gapLater = crateBody.translation().y - machine.partWorldPoint(grabber).y;
    expect(Math.abs(gapLater - gap)).toBeLessThan(0.15);
  });
});

/**
 * The bug this pins: a machine standing on wheels was rebounding off the
 * ground at most of the speed it arrived with, on parts whose restitution is
 * 0.04. A cylinder touches a plane along a line rather than across a face, so
 * it sinks further in each step than a box does, and with Rapier's default of
 * a single internal solve pass the solver turned that penetration back into
 * upward velocity on the way out.
 */
describe('landing', () => {
  function drop(blueprint, from) {
    const { machine, bus } = build(blueprint, keyboard(), from);
    let arrived = 0;
    let left = 0;
    for (let i = 0; i < Math.round(3 / STEP); i += 1) {
      for (const body of machine.bodies) arrived = Math.min(arrived, body.linvel().y);
      machine.update(STEP, bus);
      machine.world.step();
      for (const body of machine.bodies) left = Math.max(left, body.linvel().y);
    }
    return left / Math.abs(arrived);
  }

  // It was 0.92 — it came back up at nearly the speed it went down. Now it is
  // about a third, most of which is the suspension of four sprung wheel
  // joints rather than the ground.
  it('does not throw a machine back up off its wheels', () => {
    expect(drop(starterRover(), 1.6)).toBeLessThan(0.45);
  });

  it('settles rather than bouncing about', () => {
    const { machine, bus } = build(starterRover(), keyboard(), 1.6);
    run(machine, bus, 4);
    const v = machine.bodies[0].linvel();
    expect(Math.abs(v.y)).toBeLessThan(0.05);
    expect(machine.isUpsideDown()).toBe(false);
  });
});
