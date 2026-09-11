import * as THREE from 'three';
import { getPart, findPort } from '../parts/registry.js';
import { ProgramRunner, defaultValue } from './program.js';

const UP = new THREE.Vector3(0, 1, 0);

function clampTo(port, value) {
  if (port.min === undefined && port.max === undefined) return value;
  return Math.max(port.min ?? -Infinity, Math.min(port.max ?? Infinity, value));
}

/**
 * Binds a program to a running machine: it reads the module outputs the graph
 * asks for, and collects the module inputs the graph sets so the rest of the
 * step can act on them.
 *
 * Writes are buffered rather than applied straight away, so the whole graph
 * sees one consistent snapshot of the machine and the order nodes happen to be
 * evaluated in cannot change the outcome.
 */
export class Computer {
  constructor({ machine, placed, program, level }) {
    this.machine = machine;
    this.placed = placed;
    this.level = level;
    this.runner = new ProgramRunner(program);
    this.written = new Map();
    this.errors = [];
  }

  reset() {
    this.runner.reset();
    this.written.clear();
  }

  get stateId() {
    return this.runner.stateId;
  }

  value(partId, port) {
    return this.written.get(`${partId}:${port}`);
  }

  context() {
    return {
      port: (partId, direction, id) => {
        const placed = this.machine.blueprint.get(partId);
        return placed ? findPort(getPart(placed.type), direction, id) : null;
      },
      hasPart: (partId) => Boolean(this.machine.blueprint.get(partId)),
      readPort: (partId, port) => this.readPort(partId, port),
      writePort: (partId, port, value) => this.writePort(partId, port, value),
      waypoint: (zoneId) => {
        const zone = this.level?.zones?.find((z) => z.id === zoneId);
        return zone ? new THREE.Vector3(...zone.pos) : new THREE.Vector3();
      },
    };
  }

  tick(dt) {
    this.written.clear();
    const result = this.runner.tick(dt, this.context());
    this.errors = result.errors;
    return result;
  }

  writePort(partId, port, value) {
    const placed = this.machine.blueprint.get(partId);
    if (!placed) return;
    const spec = findPort(getPart(placed.type), 'in', port);
    if (!spec) return;
    const clean = spec.kind === 'bool'
      ? Boolean(value === true || (typeof value === 'number' && value > 0.5))
      : clampTo(spec, typeof value === 'number' && Number.isFinite(value) ? value : 0);
    this.written.set(`${partId}:${port}`, clean);
  }

  readPort(partId, port) {
    const placed = this.machine.blueprint.get(partId);
    if (!placed) return 0;
    const part = getPart(placed.type);
    const spec = findPort(part, 'out', port);
    if (!spec) return 0;
    const reader = READERS[part.id]?.[port];
    const value = reader ? reader(this.machine, placed) : undefined;
    return value === undefined ? defaultValue(spec.kind) : value;
  }
}

function bodyOf(machine, placed) {
  return machine.bodies[machine.grouping.bodyOfPart.get(placed.id)] ?? machine.bodies[0];
}

function velocityOf(machine, placed) {
  const v = bodyOf(machine, placed).linvel();
  return new THREE.Vector3(v.x, v.y, v.z);
}

function headingOf(machine, placed) {
  const forward = machine.partWorldAxis(placed, [0, 0, 1]);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) return 0;
  forward.normalize();
  return (Math.atan2(forward.x, forward.z) * 180) / Math.PI;
}

function controllerEntry(machine, placed) {
  return machine.controllers.find((c) => c.placed.id === placed.id) ?? null;
}

/**
 * How each readable port is measured off the running machine. Everything here
 * is observed, not remembered: the program sees the same state the physics
 * does.
 */
const READERS = {
  gps: {
    position: (machine, placed) => machine.partWorldPoint(placed),
    velocity: (machine, placed) => velocityOf(machine, placed),
    speed: (machine, placed) => {
      const v = velocityOf(machine, placed);
      return Math.hypot(v.x, v.z);
    },
    altitude: (machine, placed) => machine.partWorldPoint(placed).y,
    heading: headingOf,
  },

  wheel: {
    spin: (machine, placed) => {
      const body = bodyOf(machine, placed);
      const axis = machine.partWorldAxis(placed, [1, 0, 0]);
      const w = body.angvel();
      return new THREE.Vector3(w.x, w.y, w.z).dot(axis);
    },
  },

  hinge: {
    angle: (machine, placed) => {
      const arm = machine.partWorldAxis(placed, [0, 1, 0]);
      return (Math.asin(Math.max(-1, Math.min(1, arm.dot(UP)))) * 180) / Math.PI;
    },
  },

  turntable: {
    // Which way it is pointing, and how fast it is going round, both measured
    // against the thing it is bolted to rather than against the world.
    angle: (machine, placed) => {
      const spec = machine.grouping.joints.find((j) => j.partId === placed.id);
      if (!spec) return 0;
      const out = machine.partWorldAxis(placed, [0, 0, 1]);
      const host = machine.bodies[spec.hostBody].rotation();
      const home = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(new THREE.Quaternion(host.x, host.y, host.z, host.w));
      const up = machine.partWorldAxis(placed, [0, 1, 0]);
      const signed = Math.atan2(new THREE.Vector3().crossVectors(home, out).dot(up), home.dot(out));
      return (signed * 180) / Math.PI;
    },
    rate: (machine, placed) => {
      const spec = machine.grouping.joints.find((j) => j.partId === placed.id);
      if (!spec) return 0;
      const axis = machine.partWorldAxis(placed, [0, 1, 0]);
      const a = machine.bodies[spec.childBody].angvel();
      const b = machine.bodies[spec.hostBody].angvel();
      return new THREE.Vector3(a.x - b.x, a.y - b.y, a.z - b.z).dot(axis);
    },
  },

  piston: {
    // Both bodies of a joint share an origin frame, so how far the moving side
    // has slid along the joint axis is the extension.
    extension: (machine, placed) => {
      const spec = machine.grouping.joints.find((j) => j.partId === placed.id);
      if (!spec) return 0;
      const host = machine.bodies[spec.hostBody].translation();
      const child = machine.bodies[spec.childBody].translation();
      return new THREE.Vector3(child.x - host.x, child.y - host.y, child.z - host.z)
        .dot(machine.partWorldAxis(placed, [0, 1, 0]));
    },
  },

  grabber: {
    holding: (machine, placed) => machine.grabs.has(placed.id),
  },

  sensor: {
    distance: (machine, placed) => machine.sensorDistance(placed.id),
    tripped: (machine, placed) => machine.sensorTripped(placed.id),
    tag: (machine, placed) => machine.sensorTag(placed.id),
  },

  controller: {
    altitude: (machine, placed) => bodyOf(machine, placed).worldCom().y,
    verticalSpeed: (machine, placed) => bodyOf(machine, placed).linvel().y,
    forwardSpeed: (machine, placed) => controllerEntry(machine, placed)?.forwardSpeed ?? 0,
    rightSpeed: (machine, placed) => controllerEntry(machine, placed)?.rightSpeed ?? 0,
    levelness: (machine, placed) => machine.partWorldAxis(placed, [0, 1, 0]).dot(UP),
  },
};
