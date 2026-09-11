import * as THREE from 'three';
import { getPart, partDensity, pistonStroke, CELL } from '../parts/registry.js';
import { PISTON_ROD_TOP, PISTON_REST } from '../parts/geometry.js';
import { orientationQuaternion, applyOrientation } from '../core/orientation.js';
import { groupBlueprint } from './grouping.js';
import { driveSide } from './signals.js';
import {
  FlightController, deriveGains, defaultSpin, frameFromAxes, attitudeOf,
  readFlightKeys, controllerOf,
} from './flight.js';
import { createPartMesh } from '../parts/geometry.js';
import { Computer } from './computer.js';
import { emptyProgram } from './program.js';

export const GROUP_WORLD = 0x00010003;
export const GROUP_MACHINE = 0x00020001;

const UP = new THREE.Vector3(0, 1, 0);
const CYLINDER_TO_X = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 0, 1),
  -Math.PI / 2,
);

function vec(v) {
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Turns a blueprint into Rapier bodies plus the Three.js objects that track
 * them, and drives the actuators from a signal bus each step.
 */
// A body's local point and local direction, in world space. Rapier hands back
// plain objects, so these do the transform by hand.
function worldPointOf(body, local) {
  const t = body.translation();
  const r = body.rotation();
  return new THREE.Vector3(local.x, local.y, local.z)
    .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))
    .add(new THREE.Vector3(t.x, t.y, t.z));
}

function worldDirectionOf(body, local) {
  const r = body.rotation();
  return new THREE.Vector3(local.x, local.y, local.z)
    .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
}

export class Machine {
  constructor({ RAPIER, world, scene, blueprint, spawn, level }) {
    this.level = level ?? null;
    this.RAPIER = RAPIER;
    this.world = world;
    this.scene = scene;
    this.blueprint = blueprint;
    this.spawn = spawn.clone();
    this.bodies = [];
    this.colliders = [];
    this.groups = [];
    this.joints = [];
    this.actuators = [];
    this.sensors = [];
    this.controllers = [];
    this.computers = [];
    this.sensorReadings = new Map();
    this.grabs = new Map();
    this.partMeshes = new Map();
    this.grouping = groupBlueprint(blueprint);
    this.origin = {
      centre: blueprint.centre(),
      low: blueprint.lowestCell(),
    };
    this.build();
  }

  localOf(cell) {
    const { centre, low } = this.origin;
    return new THREE.Vector3(
      (cell[0] - centre[0]) * CELL,
      (cell[1] - low) * CELL,
      (cell[2] - centre[2]) * CELL,
    );
  }

  build() {
    const { RAPIER, world } = this;
    for (const group of this.grouping.bodies) {
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.spawn.x, this.spawn.y, this.spawn.z)
        .setLinearDamping(0.05)
        .setAngularDamping(0.1)
        .setCanSleep(false);
      const body = world.createRigidBody(desc);
      const object = new THREE.Group();
      this.scene.add(object);
      this.bodies.push(body);
      this.groups.push(object);

      for (const partId of group.members) {
        this.addPart(body, object, this.blueprint.get(partId));
      }
    }
    this.buildJoints();
    this.collectActuators();
    this.buildControllers();
    this.buildComputers();
    this.syncMeshes();
  }

  addPart(body, object, placed) {
    const { RAPIER, world } = this;
    const part = getPart(placed.type);
    const local = this.localOf(placed.cell);
    const quat = orientationQuaternion(placed.rot);

    let desc;
    if (part.radius) {
      const spin = new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w)
        .multiply(CYLINDER_TO_X);
      desc = RAPIER.ColliderDesc.cylinder(part.width / 2, part.radius)
        .setRotation({ x: spin.x, y: spin.y, z: spin.z, w: spin.w });
    } else {
      desc = RAPIER.ColliderDesc.cuboid(
        (part.size[0] * CELL) / 2,
        (part.size[1] * CELL) / 2,
        (part.size[2] * CELL) / 2,
      ).setRotation(quat);
    }
    desc
      .setTranslation(local.x, local.y, local.z)
      .setDensity(partDensity(part))
      .setFriction(part.friction ?? 0.85)
      .setRestitution(0.04)
      .setCollisionGroups(GROUP_MACHINE);
    this.colliders.push(world.createCollider(desc, body));

    const mesh = createPartMesh(part);
    mesh.position.copy(local);
    mesh.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    object.add(mesh);
    this.partMeshes.set(placed.id, mesh);
  }

  buildJoints() {
    const { RAPIER, world } = this;
    for (const spec of this.grouping.joints) {
      const placed = this.blueprint.get(spec.partId);
      const part = getPart(placed.type);
      const anchor = vec(this.localOf(placed.cell));
      const axisArr = applyOrientation(placed.rot, part.axis);
      const axis = { x: axisArr[0], y: axisArr[1], z: axisArr[2] };
      const host = this.bodies[spec.hostBody];
      const child = this.bodies[spec.childBody];

      let params;
      if (spec.type === 'prismatic') {
        params = RAPIER.JointData.prismatic(anchor, anchor, axis);
        params.limitsEnabled = true;
        params.limits = [0, pistonStroke(placed, part)];
      } else {
        params = RAPIER.JointData.revolute(anchor, anchor, axis);
        if (part.limits) {
          params.limitsEnabled = true;
          params.limits = [...part.limits];
        }
      }
      const joint = world.createImpulseJoint(params, host, child, true);
      // The anchor and axis are kept so a piston can measure how far it has
      // actually pushed, and draw its rod that long.
      this.joints.push({ partId: placed.id, joint, part, host, child, anchor, axis });
    }
  }

  collectActuators() {
    for (const placed of this.blueprint.list()) {
      const part = getPart(placed.type);
      const bodyIndex = this.grouping.bodyOfPart.get(placed.id);
      if (part.sensor) this.sensors.push({ placed, part });
      if (part.flight) this.controllers.push({ placed, part, bodyIndex });
      if (!part.actuator) continue;
      const jointEntry = this.joints.find((j) => j.partId === placed.id);
      this.actuators.push({
        placed,
        part,
        bodyIndex,
        joint: jointEntry?.joint ?? null,
        signal: 0,
      });
    }
  }

  /**
   * Sets each controller up with the thrusters bound to it, working out what
   * every one of them can do for each control channel from where it sits on
   * the machine and which way it points.
   */
  buildControllers() {
    for (const entry of this.controllers) {
      const frame = frameFromAxes(
        applyOrientation(entry.placed.rot, [0, 0, 1]),
        applyOrientation(entry.placed.rot, [0, 1, 0]),
      );
      const body = this.bodies[entry.bodyIndex];
      const com = body.localCom();
      const members = this.actuators.filter((a) => a.part.thruster
        && controllerOf(this.blueprint, a.placed) === entry.placed.id);

      const specs = members.map((a) => {
        const offset = this.localOf(a.placed.cell)
          .sub(new THREE.Vector3(com.x, com.y, com.z));
        const dir = applyOrientation(a.placed.rot, a.part.thruster.axis);
        const spin = a.placed.config.spin
          ?? defaultSpin(offset.toArray(), frame);
        a.spin = spin;
        return {
          id: a.placed.id,
          offset: offset.toArray(),
          dir,
          maxThrust: a.part.thruster.maxThrust * (a.placed.config.power ?? 1),
          reaction: a.part.thruster.reaction ?? 0,
          spin,
        };
      });

      const derived = deriveGains(specs, frame);
      // A player-set gain wins; anything they have not touched stays derived.
      for (const a of members) {
        const custom = a.placed.config.gains;
        if (custom) derived.set(a.placed.id, { ...derived.get(a.placed.id), ...custom });
      }

      entry.frame = frame;
      entry.members = members;
      entry.gains = derived;
      entry.liftAuthority = specs.reduce(
        (sum, spec) => sum + spec.maxThrust * (derived.get(spec.id)?.climb ?? 0),
        0,
      );
      entry.runtime = new FlightController(entry.part.flight);
      entry.keys = { ...entry.part.flight.defaultKeys, ...(entry.placed.config.keys ?? {}) };
    }
  }

  // Runs before the actuators resolve, so every linked thruster reads the
  // throttle its controller just worked out.
  updateControllers(dt, bus) {
    for (const entry of this.controllers) {
      if (!entry.members?.length) continue;
      const body = this.bodies[entry.bodyIndex];
      const pose = this.worldPose(entry.bodyIndex);
      const frameWorld = {
        forward: entry.frame.forward.clone().applyQuaternion(pose.quaternion),
        up: entry.frame.up.clone().applyQuaternion(pose.quaternion),
        right: entry.frame.right.clone().applyQuaternion(pose.quaternion),
      };
      const com = body.worldCom();
      const linvel = body.linvel();
      const velocity = new THREE.Vector3(linvel.x, 0, linvel.z);
      const flat = (axis) => {
        const v = axis.clone();
        v.y = 0;
        return v.lengthSq() > 1e-6 ? velocity.dot(v.normalize()) : 0;
      };
      // A program writing to the controller's ports takes the stick off the
      // pilot; anything it leaves alone still answers to the keyboard.
      const keys = readFlightKeys(bus.input, entry.keys);
      const command = {
        pitch: this.forced(entry.placed.id, 'pitch') ?? keys.pitch,
        yaw: this.forced(entry.placed.id, 'yaw') ?? keys.yaw,
        roll: this.forced(entry.placed.id, 'roll') ?? 0,
        climb: this.forced(entry.placed.id, 'climb') ?? keys.climb,
      };
      const holdAt = this.forced(entry.placed.id, 'targetAltitude');
      if (holdAt !== undefined) entry.runtime.holdAltitude(holdAt);
      entry.runtime.update(dt, command, {
        mass: body.mass(),
        gravity: -this.world.gravity.y,
        liftAuthority: entry.liftAuthority,
        altitude: com.y,
        verticalSpeed: linvel.y,
        forwardSpeed: flat(frameWorld.forward),
        rightSpeed: flat(frameWorld.right),
        ...attitudeOf(frameWorld, body.angvel()),
      });
      for (const [id, throttle] of entry.runtime.mix(entry.gains)) {
        bus.setChannel(id, throttle);
      }
      entry.command = command;
      entry.forwardSpeed = flat(frameWorld.forward);
      entry.rightSpeed = flat(frameWorld.right);
    }
  }

  /**
   * Whatever the machine is actually touching this step, or null if it is
   * touching nothing. Query it after the world has stepped, since that is when
   * the contacts are worked out.
   *
   * Broad-phase pairs include things that are merely near, so each pair is
   * checked for a contact point that has actually closed.
   */
  contact() {
    let found = null;
    for (const collider of this.colliders) {
      if (found) break;
      this.world.contactPairsWith(collider, (other) => {
        if (found || other.collisionGroups() === GROUP_MACHINE) return;
        this.world.contactPair(collider, other, (manifold) => {
          for (let i = 0; i < manifold.numContacts(); i += 1) {
            if (manifold.contactDist(i) <= 0) {
              found = other;
              return;
            }
          }
        });
      });
    }
    return found;
  }

  sensorDistance(partId) {
    return this.sensorReadings.get(partId)?.distance ?? 0;
  }

  sensorTripped(partId) {
    return this.sensorReadings.get(partId)?.tripped ?? false;
  }

  buildComputers() {
    for (const placed of this.blueprint.list()) {
      if (!getPart(placed.type).computer) continue;
      this.computers.push(new Computer({
        machine: this,
        placed,
        program: placed.config.program ?? emptyProgram(),
        level: this.level,
      }));
    }
  }

  // What the program set for a module port this tick, if it set anything.
  forced(partId, port) {
    for (const computer of this.computers) {
      const value = computer.value(partId, port);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  bindingFor(placed, part) {
    const binding = placed.config.binding ?? part.actuator?.defaultBinding ?? null;
    if (binding?.mode === 'drive' && binding.side === undefined) {
      return { ...binding, side: driveSide(placed.rot) };
    }
    return binding;
  }

  worldPose(bodyIndex) {
    const body = this.bodies[bodyIndex];
    const t = body.translation();
    const r = body.rotation();
    return {
      position: new THREE.Vector3(t.x, t.y, t.z),
      quaternion: new THREE.Quaternion(r.x, r.y, r.z, r.w),
    };
  }

  partWorldPoint(placed) {
    const pose = this.worldPose(this.grouping.bodyOfPart.get(placed.id));
    return this.localOf(placed.cell).clone()
      .applyQuaternion(pose.quaternion)
      .add(pose.position);
  }

  partWorldAxis(placed, localAxis) {
    const pose = this.worldPose(this.grouping.bodyOfPart.get(placed.id));
    const rotated = applyOrientation(placed.rot, localAxis);
    return new THREE.Vector3(rotated[0], rotated[1], rotated[2])
      .applyQuaternion(pose.quaternion)
      .normalize();
  }

  notOwnMachine(collider) {
    return collider.collisionGroups() !== GROUP_MACHINE;
  }

  // A sensor can be aimed off its mounting, swept round the machine's up axis,
  // so a machine can carry whiskers that look ahead and out to the side at the
  // same time instead of only straight down an axis.
  sensorAxis(placed, part) {
    const sweep = ((placed.config.yaw ?? 0) * Math.PI) / 180;
    const [x, y, z] = part.sensor.axis;
    return [
      x * Math.cos(sweep) + z * Math.sin(sweep),
      y,
      -x * Math.sin(sweep) + z * Math.cos(sweep),
    ];
  }

  readSensors(bus) {
    for (const { placed, part } of this.sensors) {
      const dir = this.partWorldAxis(placed, this.sensorAxis(placed, part));
      const start = this.partWorldPoint(placed).addScaledVector(dir, CELL * 0.55);
      const ray = new this.RAPIER.Ray(vec(start), vec(dir));
      const hit = this.world.castRay(
        ray, part.sensor.range, true, undefined, undefined, undefined, undefined,
        (collider) => this.notOwnMachine(collider),
      );
      const proximity = hit ? Math.max(0, 1 - hit.timeOfImpact / part.sensor.range) : 0;
      const threshold = placed.config.threshold ?? part.config.threshold;
      const tripped = hit && proximity >= threshold ? 1 : 0;
      this.sensorReadings.set(placed.id, {
        distance: hit ? hit.timeOfImpact : part.sensor.range,
        tripped: Boolean(tripped),
      });
      bus.setSensor(placed.id, tripped);
      const mesh = this.partMeshes.get(placed.id);
      if (mesh?.userData.indicator) {
        mesh.userData.indicator.material.emissive.setHex(tripped ? 0xc07bff : 0x3a1a66);
      }
    }
  }

  update(dt, bus) {
    // Rapier keeps applied forces until they are cleared, so thrust has to be
    // wiped and re-applied every step or it accumulates. Force and torque are
    // cleared separately, and addForceAtPoint sets both: an off-centre
    // thruster adds the r x F torque as well as the force.
    for (const body of this.bodies) {
      body.resetForces(false);
      body.resetTorques(false);
    }
    // Sensors first, so a program reads this step's world rather than the last
    // one; then the programs; then the controllers and actuators they drive.
    this.readSensors(bus);
    for (const computer of this.computers) computer.tick(dt);
    this.updateControllers(dt, bus);

    for (const actuator of this.actuators) {
      const { placed, part, joint } = actuator;
      const driven = this.forced(placed.id, part.actuator.port);
      const signal = driven === undefined
        ? bus.resolve(placed.id, this.bindingFor(placed, part))
        : Number(driven);
      const power = placed.config.power ?? 1;
      actuator.signal = signal;
      switch (part.actuator.kind) {
        case 'motor':
          joint?.configureMotorVelocity(
            signal * driveSide(placed.rot) * part.actuator.maxSpeed * power,
            part.actuator.maxForce,
          );
          break;
        case 'servo':
          joint?.configureMotorPosition(
            signal * part.actuator.range,
            part.actuator.stiffness,
            part.actuator.damping,
          );
          break;
        case 'linear':
          joint?.configureMotorPosition(
            Math.max(0, signal) * pistonStroke(placed, part),
            part.actuator.stiffness,
            part.actuator.damping,
          );
          break;
        case 'thrust':
          this.applyThrust(actuator, signal * power);
          break;
        case 'grab':
          this.updateGrab(actuator, signal);
          break;
        default:
          break;
      }
    }
    this.animate(dt);
  }

  applyThrust(actuator, signal) {
    const { placed, part, bodyIndex } = actuator;
    const mesh = this.partMeshes.get(placed.id);
    if (mesh?.userData.flame) mesh.userData.flame.visible = signal > 0.01;
    if (signal <= 0.001) return;
    const dir = this.partWorldAxis(placed, part.thruster.axis);
    const point = this.partWorldPoint(placed);
    const body = this.bodies[bodyIndex];
    body.addForceAtPoint(
      vec(dir.clone().multiplyScalar(part.thruster.maxThrust * signal)),
      vec(point),
      true,
    );
    // A rotor pushing air one way is pushed back the other: the reaction
    // torque about its own axis is what a drone yaws with.
    if (part.thruster.reaction) {
      const spin = actuator.spin ?? placed.config.spin ?? 1;
      body.addTorque(
        vec(dir.clone().multiplyScalar(-spin * part.thruster.reaction * signal)),
        true,
      );
    }
  }

  updateGrab(actuator, signal) {
    const { placed, part, bodyIndex } = actuator;
    const active = signal > 0.5;
    const held = this.grabs.get(placed.id);
    const mesh = this.partMeshes.get(placed.id);
    if (mesh?.userData.indicator) {
      mesh.userData.indicator.material.emissive.setHex(active ? 0xff5a3c : 0x000000);
    }
    if (!active) {
      if (held) {
        this.world.removeImpulseJoint(held, true);
        this.grabs.delete(placed.id);
      }
      return;
    }
    if (held) return;

    const dir = this.partWorldAxis(placed, [0, 1, 0]);
    const origin = this.partWorldPoint(placed).addScaledVector(dir, CELL * 0.45);
    const ray = new this.RAPIER.Ray(vec(origin), vec(dir));
    const hit = this.world.castRay(
      ray, part.grabber.reach, true, undefined, undefined, undefined, undefined,
      (collider) => this.notOwnMachine(collider),
    );
    if (!hit) return;
    const target = hit.collider.parent();
    if (!target || target.isFixed()) return;

    const grabPoint = origin.clone().addScaledVector(dir, hit.timeOfImpact);
    const selfBody = this.bodies[bodyIndex];
    const anchor1 = this.toLocal(selfBody, grabPoint);
    const anchor2 = this.toLocal(target, grabPoint);
    const q1 = selfBody.rotation();
    const q2 = target.rotation();
    const frame2 = new THREE.Quaternion(q2.x, q2.y, q2.z, q2.w)
      .invert()
      .multiply(new THREE.Quaternion(q1.x, q1.y, q1.z, q1.w));
    const params = this.RAPIER.JointData.fixed(
      vec(anchor1), { x: 0, y: 0, z: 0, w: 1 },
      vec(anchor2), { x: frame2.x, y: frame2.y, z: frame2.z, w: frame2.w },
    );
    this.grabs.set(placed.id, this.world.createImpulseJoint(params, selfBody, target, true));
  }

  toLocal(body, worldPoint) {
    const t = body.translation();
    const r = body.rotation();
    return worldPoint.clone()
      .sub(new THREE.Vector3(t.x, t.y, t.z))
      .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w).invert());
  }

  animate(dt) {
    for (const actuator of this.actuators) {
      if (!actuator.part.thruster?.spin) continue;
      const mesh = this.partMeshes.get(actuator.placed.id);
      if (mesh?.userData.spinner) {
        mesh.userData.spinner.rotation.y +=
          dt * actuator.part.thruster.spin * (0.15 + actuator.signal);
      }
    }
  }

  syncMeshes() {
    for (let i = 0; i < this.bodies.length; i += 1) {
      const t = this.bodies[i].translation();
      const r = this.bodies[i].rotation();
      this.groups[i].position.set(t.x, t.y, t.z);
      this.groups[i].quaternion.set(r.x, r.y, r.z, r.w);
    }
    this.syncPistons();
  }

  /**
   * How far a piston has actually pushed, in metres, measured from the two
   * bodies it joins rather than read off the motor — what the motor was asked
   * for and where the load ended up are not the same thing under load.
   *
   * The joint anchors the same local point in both bodies, so at rest the two
   * world points coincide; the gap between them along the axis is the travel.
   */
  pistonExtension(entry) {
    const here = worldPointOf(entry.host, entry.anchor);
    const there = worldPointOf(entry.child, entry.anchor);
    const axis = worldDirectionOf(entry.host, entry.axis);
    return there.sub(here).dot(axis);
  }

  // Stretches each piston's rod to span the gap it has opened. Without this
  // the rod stays its built length and the part hangs over open air.
  syncPistons() {
    for (const entry of this.joints) {
      if (entry.part.joint !== 'prismatic') continue;
      const mesh = this.partMeshes.get(entry.partId);
      const rod = mesh?.getObjectByName('rod');
      const foot = mesh?.getObjectByName('foot');
      if (!rod || !foot) continue;
      const reach = PISTON_REST + Math.max(0, this.pistonExtension(entry));
      rod.scale.y = reach;
      foot.position.y = PISTON_ROD_TOP - reach;
    }
  }

  /** Where a piston's foot has ended up, in world space. */
  pistonFootPoint(partId) {
    const mesh = this.partMeshes.get(partId);
    const foot = mesh?.getObjectByName('foot');
    if (!foot) return null;
    foot.updateWorldMatrix(true, false);
    return new THREE.Vector3().setFromMatrixPosition(foot.matrixWorld);
  }

  core() {
    return this.blueprint.list().find((p) => p.type === 'core') ?? null;
  }

  corePosition() {
    const core = this.core();
    if (core) return this.partWorldPoint(core);
    const t = this.bodies[0]?.translation() ?? { x: 0, y: 0, z: 0 };
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  coreForward() {
    const core = this.core();
    if (!core) return new THREE.Vector3(0, 0, 1);
    const forward = this.partWorldAxis(core, [0, 0, 1]);
    forward.y = 0;
    return forward.lengthSq() < 1e-4 ? new THREE.Vector3(0, 0, 1) : forward.normalize();
  }

  isUpsideDown() {
    const core = this.core();
    return core ? this.partWorldAxis(core, [0, 1, 0]).dot(UP) < -0.35 : false;
  }

  dispose() {
    for (const joint of this.grabs.values()) this.world.removeImpulseJoint(joint, false);
    this.grabs.clear();
    for (const entry of this.joints) this.world.removeImpulseJoint(entry.joint, false);
    for (const body of this.bodies) this.world.removeRigidBody(body);
    for (const group of this.groups) {
      this.scene.remove(group);
      group.traverse((child) => {
        if (!child.isMesh && !child.isLineSegments) return;
        child.geometry.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) mat.dispose();
      });
    }
    this.bodies = [];
    this.colliders = [];
    this.groups = [];
    this.joints = [];
    this.actuators = [];
    this.sensors = [];
  }
}
