import * as THREE from 'three';
import { getPart, partDensity, CELL } from '../parts/registry.js';
import { orientationQuaternion, applyOrientation } from '../core/orientation.js';
import { groupBlueprint } from './grouping.js';
import { driveSide } from './signals.js';
import { createPartMesh } from '../parts/geometry.js';

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
export class Machine {
  constructor({ RAPIER, world, scene, blueprint, spawn }) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.scene = scene;
    this.blueprint = blueprint;
    this.spawn = spawn.clone();
    this.bodies = [];
    this.groups = [];
    this.joints = [];
    this.actuators = [];
    this.sensors = [];
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
    world.createCollider(desc, body);

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
        params.limits = [0, part.stroke];
      } else {
        params = RAPIER.JointData.revolute(anchor, anchor, axis);
        if (part.limits) {
          params.limitsEnabled = true;
          params.limits = [...part.limits];
        }
      }
      const joint = world.createImpulseJoint(params, host, child, true);
      this.joints.push({ partId: placed.id, joint, part });
    }
  }

  collectActuators() {
    for (const placed of this.blueprint.list()) {
      const part = getPart(placed.type);
      const bodyIndex = this.grouping.bodyOfPart.get(placed.id);
      if (part.sensor) this.sensors.push({ placed, part });
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

  readSensors(bus) {
    for (const { placed, part } of this.sensors) {
      const dir = this.partWorldAxis(placed, part.sensor.axis);
      const start = this.partWorldPoint(placed).addScaledVector(dir, CELL * 0.55);
      const ray = new this.RAPIER.Ray(vec(start), vec(dir));
      const hit = this.world.castRay(
        ray, part.sensor.range, true, undefined, undefined, undefined, undefined,
        (collider) => this.notOwnMachine(collider),
      );
      const proximity = hit ? Math.max(0, 1 - hit.timeOfImpact / part.sensor.range) : 0;
      const threshold = placed.config.threshold ?? part.config.threshold;
      const tripped = hit && proximity >= threshold ? 1 : 0;
      bus.setSensor(placed.id, tripped);
      const mesh = this.partMeshes.get(placed.id);
      if (mesh?.userData.indicator) {
        mesh.userData.indicator.material.emissive.setHex(tripped ? 0xc07bff : 0x3a1a66);
      }
    }
  }

  update(dt, bus) {
    // Rapier keeps an applied force until it is cleared, so thrust has to be
    // wiped and re-applied every step or it accumulates.
    for (const body of this.bodies) body.resetForces(false);
    this.readSensors(bus);
    for (const actuator of this.actuators) {
      const { placed, part, joint } = actuator;
      const signal = bus.resolve(placed.id, this.bindingFor(placed, part));
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
            Math.max(0, signal) * part.stroke,
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
    const force = dir.multiplyScalar(part.thruster.maxThrust * signal);
    this.bodies[bodyIndex].addForceAtPoint(vec(force), vec(point), true);
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
    this.groups = [];
    this.joints = [];
    this.actuators = [];
    this.sensors = [];
  }
}
