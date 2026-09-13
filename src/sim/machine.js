import * as THREE from 'three';
import {
  getPart, partDensity, pistonStroke, separationPush, jointTension, jointFlip,
  servoAngleA, servoAngleB, servoSpeed, shortestTurn, turntableRecentres,
  springTravel, springStiffness, springDamping, padMode, padDamping,
  turntableSpin, turntableTorque, CELL,
} from '../parts/registry.js';
import { PISTON_ROD_TOP, PISTON_REST, wedgeCorners } from '../parts/geometry.js';
import { orientationQuaternion, applyOrientation } from '../core/orientation.js';
import { groupBlueprint } from './grouping.js';
import { driveSide } from './signals.js';
import { tagOf } from './tags.js';
import {
  FlightController, deriveGains, defaultSpin, frameFromAxes, attitudeOf,
  readFlightKeys, controllerOf,
} from './flight.js';
import { createPartMesh } from '../parts/geometry.js';
import { Computer } from './computer.js';
import { emptyProgram } from './program.js';

export const GROUP_WORLD = 0x00010003;
/**
 * Machine parts collide with the world and with other machines, but never with
 * the rest of their own machine. The group cannot say that last part -- there
 * are sixteen membership bits and a world may hold more machines than that --
 * so the group opens it up to everything and `Fleet`'s contact filter puts the
 * one exclusion back. A machine built without a fleet gets the old behaviour,
 * because with one machine in the world the two rules are the same rule.
 */
export const GROUP_MACHINE = 0x00020003;
export const GROUP_MACHINE_ALONE = 0x00020001;

/**
 * Whether a collider belongs to some machine rather than to the world. There
 * are two machine groups now -- one for a machine on its own, one for a machine
 * sharing a world -- so the group can no longer be compared for equality.
 */
export function isMachineCollider(collider) {
  const group = collider.collisionGroups();
  return group === GROUP_MACHINE || group === GROUP_MACHINE_ALONE;
}

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

// Joints driven by a motor you can hear: they share one voice, the way the
// wheels do.
const SERVO_KINDS = new Set(['servo', 'spin', 'linear', 'position']);

// How hard a position servo pulls back toward its mark, per degree out. It is
// a speed command rather than a force, so what this buys is how little error
// it will tolerate before correcting. Measured on a loaded arm, degrees off
// the mark once settled against degrees overshot getting there:
//
//     gain      8      20      50
//     off    2.51    1.06    0.38
//     over   0.00    1.61    1.55
//
// Eight is visibly short on a long arm; past fifty the overshoot stops paying
// for the accuracy.
const POSITION_GAIN = 30;

export class Machine {
  constructor({
    RAPIER, world, scene, blueprint, spawn, level,
    canSleep = false, headless = false, contacts = 0, yaw = 0,
  }) {
    this.level = level ?? null;
    // A machine in a challenge must never sleep: it is the only thing in the
    // world and a parked one still has to answer the next key. A machine
    // deployed in an open world is one of many, and a parked one should cost
    // nothing until something touches it.
    this.canSleep = canSleep;
    this.headless = headless;
    // Set on the colliders so Rapier bothers to ask the fleet's filter about
    // them. Zero means nobody is filtering, which is the campaign.
    this.contacts = contacts;
    this.group = contacts ? GROUP_MACHINE : GROUP_MACHINE_ALONE;
    this.RAPIER = RAPIER;
    this.world = world;
    this.scene = scene;
    this.blueprint = blueprint;
    this.spawn = spawn.clone();
    /**
     * Which way it faces when it is put down, in radians about the up axis.
     *
     * A challenge has one spawn and everything starts on it facing the same
     * way, so this was never needed. An open world is the other case: you
     * park a delivery drone facing down a street, and the street does not run
     * along +Z.
     *
     * It is put on the bodies rather than on the colliders inside them.
     * Everything a machine works out about itself -- where a part is, which
     * way a thruster pushes, what a joint turns about, where the core is
     * looking -- is expressed in body-local space and then carried into the
     * world by the body's own rotation. Turn the bodies and all of it comes
     * out turned, with not one other line to change.
     */
    this.yaw = yaw;
    this.facing = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    this.bodies = [];
    this.colliders = [];
    this.groups = [];
    this.joints = [];
    this.actuators = [];
    this.sensors = [];
    this.controllers = [];
    this.computers = [];
    this.sensorReadings = new Map();
    this.colliderOfPart = new Map();
    this.padState = new Map();
    this.pads = [];
    this.grabs = new Map();
    this.events = [];
    this.partMeshes = new Map();
    this.grouping = groupBlueprint(blueprint);
    // Put down by the middle of what it occupies rather than by the average of
    // where its parts are, so a machine with a long arm on one side lands on
    // the spawn instead of beside it.
    this.origin = {
      centre: blueprint.extentCentre(),
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
        .setRotation({
          x: this.facing.x, y: this.facing.y, z: this.facing.z, w: this.facing.w,
        })
        .setLinearDamping(0.05)
        .setAngularDamping(0.1)
        .setCanSleep(this.canSleep);
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
    } else if (part.shape === 'wedge') {
      // The same six corners the mesh is built from, so what you see and what
      // you hit are the same solid. A box here would look like a ramp and
      // behave like a crate.
      const points = new Float32Array(wedgeCorners(part.size).flat());
      desc = RAPIER.ColliderDesc.convexHull(points).setRotation(quat);
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
      .setCollisionGroups(this.group);
    if (this.contacts) desc.setActiveHooks(this.contacts);
    const made = world.createCollider(desc, body);
    this.colliders.push(made);
    this.colliderOfPart.set(placed.id, made);
    if (part.id === 'pressure') {
      this.pads.push(placed);
      this.padState.set(placed.id, { pressed: false, quiet: 0, pulse: 0 });
    }

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
      if (spec.type === 'fixed') {
        // No axis and no freedom: a weld, until somebody throws it away.
        params = RAPIER.JointData.fixed(
          anchor, { x: 0, y: 0, z: 0, w: 1 },
          anchor, { x: 0, y: 0, z: 0, w: 1 },
        );
      } else if (spec.type === 'prismatic') {
        params = RAPIER.JointData.prismatic(anchor, anchor, axis);
        params.limitsEnabled = true;
        if (part.spring) {
          // A strut moves either way from where it was built, so an unloaded
          // machine sits where you drew it and settles from there.
          const half = springTravel(placed, part) / 2;
          params.limits = [-half, half];
        } else {
          params.limits = [0, pistonStroke(placed, part)];
        }
      } else {
        params = RAPIER.JointData.revolute(anchor, anchor, axis);
        if (part.limits) {
          params.limitsEnabled = true;
          params.limits = [...part.limits];
        }
      }
      const joint = world.createImpulseJoint(params, host, child, true);
      // Nothing drives a spring, so it is set once and left: hold the built
      // position, give under load, and come back.
      if (part.spring) {
        joint.configureMotorPosition(
          0, springStiffness(placed, part), springDamping(placed, part),
        );
      }
      // The anchor and axis are kept so a piston can measure how far it has
      // actually pushed, and draw its rod that long.
      this.joints.push({ partId: placed.id, placed, joint, part, host, child, anchor, axis });
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
  /**
   * Pressure pads: which of them has something resting on it.
   *
   * Machine parts do not collide with each other, so anything touching a pad's
   * collider at all came from the world. Damping keeps a landing from reading
   * as a dozen separate touches while it bounces, and a one-shot pad turns the
   * first of those touches into a single pulse.
   */
  updatePads(dt) {
    for (const placed of this.pads) {
      const state = this.padState.get(placed.id);
      const collider = this.colliderOfPart.get(placed.id);
      const damping = padDamping(placed);
      const touching = collider ? this.touchingWorld(collider) : false;

      // Last step's pulse runs down before this step's is set, or a pad with
      // no damping on it would start and finish its pulse inside one step and
      // nothing would ever see it.
      if (state.pulse > 0) state.pulse = Math.max(0, state.pulse - dt);

      if (touching) {
        // The rising edge, once the pad has genuinely been clear.
        if (!state.pressed) state.pulse = Math.max(damping, dt * 1.5);
        state.pressed = true;
        state.quiet = 0;
      } else if (state.pressed) {
        state.quiet += dt;
        if (state.quiet >= damping) state.pressed = false;
      }
    }
  }

  /** Whether anything from the world is touching this collider right now. */
  touchingWorld(collider) {
    let found = false;
    this.world.contactPairsWith(collider, (other) => {
      if (found || isMachineCollider(other)) return;
      this.world.contactPair(collider, other, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i += 1) {
          if (manifold.contactDist(i) <= 0) {
            found = true;
            return;
          }
        }
      });
    });
    return found;
  }

  padTriggered(partId) {
    const placed = this.blueprint.get(partId);
    const state = this.padState.get(partId);
    if (!placed || !state) return false;
    return padMode(placed) === 'once' ? state.pulse > 0 : state.pressed;
  }

  contact(ignore = null) {
    let found = null;
    for (const collider of this.colliders) {
      if (found) break;
      this.world.contactPairsWith(collider, (other) => {
        if (found || isMachineCollider(other)) return;
        if (ignore && other.parent()?.handle === ignore.handle) return;
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

  /** What the beam is looking at, as the level labelled it. 0 is anything unlabelled. */
  sensorTag(partId) {
    return this.sensorReadings.get(partId)?.tag ?? 0;
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
    return !isMachineCollider(collider);
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
        tag: hit ? tagOf(this.world, hit.collider) : 0,
      });
      bus.setSensor(placed.id, tripped);
      const mesh = this.partMeshes.get(placed.id);
      if (mesh?.userData.indicator) {
        mesh.userData.indicator.material.emissive.setHex(tripped ? 0xc07bff : 0x3a1a66);
      }
    }
  }

  /**
   * Sends a jointed part to a target and sets how hard it holds there.
   * Tension scales the stiffness, and damping goes as its root so a tight
   * joint stays about as well damped as a loose one rather than ringing.
   *
   * At no tension the motor is switched off rather than told to hold nothing:
   * a position motor with no gains still pins the axis, so asking for zero
   * stiffness used to give the stiffest joint of all. Off means a free pivot,
   * which is what a swing is made of.
   */
  driveMotor(joint, placed, part, target) {
    if (!joint) return;
    const tension = jointTension(placed, part);
    if (tension <= 0) return;
    joint.configureMotorPosition(
      target,
      part.actuator.stiffness * tension,
      part.actuator.damping * Math.sqrt(tension),
    );
  }

  update(dt, bus) {
    // Things that happened this step rather than things that are happening:
    // a state snapshot cannot say "it just let go", which is why the parts
    // that do something once had nothing to make a noise about.
    this.events.length = 0;
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
    this.updatePads(dt);
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
        case 'motor': {
          // Configured only when the number changes. Setting a joint motor
          // every step wakes the body every step, which is invisible with one
          // machine and means a parked fleet never sleeps. Zero is still sent
          // once on the way down, so letting go of the throttle still brakes.
          const want = signal * driveSide(placed.rot) * part.actuator.maxSpeed * power;
          if (joint && want !== actuator.lastMotor) {
            joint.configureMotorVelocity(want, part.actuator.maxForce);
            actuator.lastMotor = want;
          }
          break;
        }
        case 'servo':
          this.driveMotor(
            joint, placed, part,
            signal * jointFlip(placed) * part.actuator.range,
          );
          break;
        case 'position': {
          // Commanded as a speed rather than as an angle: it is the only way
          // to both cap how fast it travels and choose which way it goes.
          // Close in the speed falls away with the error, so it settles on the
          // mark and holds against a load instead of hunting round it.
          // Mirroring one of a facing pair mirrors where it goes, not which
          // way it turns to get there: the short way round is worked out
          // afterwards, from wherever it actually is.
          const set = signal > 0.5 ? servoAngleB(placed, part) : servoAngleA(placed, part);
          const target = set * jointFlip(placed);
          const error = shortestTurn(this.jointAngle(placed), target);
          const top = servoSpeed(placed, part);
          const wanted = Math.max(-top, Math.min(top, error * POSITION_GAIN));
          joint?.configureMotorVelocity((wanted * Math.PI) / 180, part.actuator.maxForce);
          break;
        }
        // Its own speed and torque, and no handedness: a turntable is not on
        // one side of the machine the way a wheel is.
        case 'spin': {
          const top = turntableSpin(placed, part);
          const asked = signal * jointFlip(placed) * top * power;
          // Let go of one set to recentre and it winds itself back to where it
          // was built, the short way round, at the speed it is set to turn.
          // Otherwise it stops where it was left, which is what a crane wants.
          if (asked === 0 && turntableRecentres(placed, part)) {
            const off = shortestTurn(this.jointAngle(placed), 0);
            const back = Math.max(-top, Math.min(top, (off * Math.PI) / 180 * POSITION_GAIN));
            joint?.configureMotorVelocity(back, turntableTorque(placed, part));
            break;
          }
          joint?.configureMotorVelocity(asked, turntableTorque(placed, part));
          break;
        }
        case 'linear':
          this.driveMotor(joint, placed, part, Math.max(0, signal) * pistonStroke(placed, part));
          break;
        case 'thrust':
          this.applyThrust(actuator, signal * power);
          break;
        case 'grab':
          this.updateGrab(actuator, signal);
          break;
        case 'release':
          if (signal > 0.5) this.release(actuator);
          break;
        default:
          break;
      }
    }
    this.animate(dt);
  }

  /**
   * Throws the joint away and pushes the two halves apart.
   *
   * One way. Once the joint is gone there is nothing left to re-make it from,
   * and that is the part behaving as a coupling rather than as a clamp: you
   * get one separation per run, and a respawn is how you get another.
   *
   * The push is split between the halves in inverse proportion to their mass,
   * so a heavy booster shoving off a light upper stage sends the light one
   * away rather than shunting itself backwards — which is what actually
   * happens, and what makes it read as a separation rather than a shrug.
   */
  release(actuator) {
    const entry = this.joints.find((j) => j.partId === actuator.placed.id);
    if (!entry || entry.released) return;
    entry.released = true;
    this.world.removeImpulseJoint(entry.joint, true);
    this.events.push('separate');

    const push = separationPush(actuator.placed, actuator.part);
    if (push <= 0) return;
    const dir = this.partWorldAxis(actuator.placed, actuator.part.axis).normalize();
    const up = entry.child;
    const down = entry.host;
    const share = up.mass() * down.mass() / (up.mass() + down.mass());
    up.applyImpulse({ x: dir.x * push * share, y: dir.y * push * share, z: dir.z * push * share }, true);
    down.applyImpulse({ x: -dir.x * push * share, y: -dir.y * push * share, z: -dir.z * push * share }, true);
  }

  /**
   * Which way a jointed part is turned, in degrees, measured against the thing
   * it is bolted to rather than against the world — so a servo on a machine
   * that is itself rolling over still knows where it is. Wraps at half a turn
   * either way, which is what makes the short way round findable at all.
   */
  jointAngle(placed) {
    const spec = this.grouping.joints.find((j) => j.partId === placed.id);
    if (!spec) return 0;
    const part = getPart(placed.type);
    // Any direction square to the axis serves as a pointer; it only has to be
    // the same one on both sides of the comparison.
    const ref = Math.abs(part.axis[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0];
    const out = this.partWorldAxis(placed, ref);
    const host = this.bodies[spec.hostBody].rotation();
    const home = new THREE.Vector3(...applyOrientation(placed.rot, ref))
      .applyQuaternion(new THREE.Quaternion(host.x, host.y, host.z, host.w));
    const axis = this.partWorldAxis(placed, part.axis);
    const signed = Math.atan2(
      new THREE.Vector3().crossVectors(home, out).dot(axis),
      home.dot(out),
    );
    return (signed * 180) / Math.PI;
  }

  /** Which body a given part ended up in, once the machine was built. */
  bodyOf(partId) {
    const index = this.grouping.bodies.findIndex((group) => group.members.includes(partId));
    return index >= 0 ? this.bodies[index] : null;
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
        this.events.push('unlatch');
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
    this.events.push('latch');
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

  /** Whether it is drawn. It goes on running either way. */
  setVisible(on) {
    for (const group of this.groups) group.visible = on;
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

  /**
   * How far a strut has moved from where it was built, in metres. Negative is
   * compressed. This is the joint itself rather than any two points on the
   * machine, so a body that is leaning or tipping does not read as travel.
   */
  strutTravel(partId) {
    const entry = this.joints.find((j) => j.partId === partId);
    return entry ? this.pistonExtension(entry) : 0;
  }

  // Stretches each piston's rod to span the gap it has opened. Without this
  // the rod stays its built length and the part hangs over open air.
  syncPistons() {
    for (const entry of this.joints) {
      if (entry.part.joint !== 'prismatic') continue;
      // A strut squashes its coil instead of growing a rod, so you can see
      // which corner is taking the weight.
      if (entry.part.spring) {
        const half = springTravel(entry.placed, entry.part) / 2;
        const travel = this.pistonExtension(entry);
        const moved = Math.max(-half, Math.min(half, travel));
        const coil = this.partMeshes.get(entry.partId)?.getObjectByName('coil');
        if (coil) coil.scale.y = Math.max(0.25, 1 + moved / Math.max(half, 0.01) * 0.45);
        // A strut run out of travel is taking the landing through the chassis
        // instead of soaking it up, which is worth hearing once rather than
        // every frame it stays there.
        const onStop = travel <= -half * 0.97;
        if (onStop && !entry.onStop) this.events.push('bottom');
        entry.onStop = onStop;
        continue;
      }
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

  /**
   * What the machine is doing, in the terms the sound needs: how hard each
   * kind of actuator is working and how fast the fastest shaft is turning.
   * Read off the joints rather than off the commands, so a motor that is
   * stalled against a wall sounds stalled.
   */
  audioState() {
    const wheels = [];
    const rotors = [];
    const jets = [];
    const servos = [];
    let wheelSpeed = 0;
    let rotorSpin = 0;
    let servoRate = 0;

    for (const actuator of this.actuators) {
      const { part, signal, bodyIndex } = actuator;
      if (part.actuator.kind === 'motor') {
        wheels.push(signal);
        const spin = this.bodies[bodyIndex]?.angvel() ?? { x: 0, y: 0, z: 0 };
        wheelSpeed = Math.max(wheelSpeed, Math.hypot(spin.x, spin.y, spin.z));
      } else if (part.thruster) {
        const level = Math.max(0, signal);
        if (part.thruster.spin > 0) {
          rotors.push(level);
          rotorSpin = Math.max(rotorSpin, level * part.thruster.spin);
        } else {
          jets.push(level);
        }
      } else if (SERVO_KINDS.has(part.actuator.kind)) {
        // A servo is heard when it is moving, not when it is merely holding a
        // load, so this is measured off the joint rather than off the key.
        const rate = Math.abs(this.jointRate(actuator));
        if (rate > 0.02) {
          servos.push(Math.min(1, rate / 4));
          servoRate = Math.max(servoRate, rate);
        }
      }
    }

    const body = this.bodies[0];
    const v = body?.linvel() ?? { x: 0, y: 0, z: 0 };
    return {
      wheels,
      rotors,
      jets,
      wheelSpeed,
      rotorSpin,
      servos,
      servoRate,
      groundSpeed: Math.hypot(v.x, v.z),
      grounded: this.contact() !== null,
      events: this.events,
    };
  }

  /**
   * How fast a jointed part is actually moving, in radians or metres a second.
   * Taken from the two bodies the joint holds together rather than from the
   * command, so a servo straining against a load it cannot shift stays quiet
   * instead of screaming at full throttle.
   */
  jointRate(actuator) {
    const spec = this.grouping.joints.find((j) => j.partId === actuator.placed.id);
    if (!spec) return 0;
    const child = this.bodies[spec.childBody];
    const host = this.bodies[spec.hostBody];
    if (!child || !host) return 0;
    const axis = this.partWorldAxis(actuator.placed, actuator.part.axis ?? [0, 1, 0]);
    if (actuator.part.joint === 'prismatic') {
      const a = child.linvel();
      const b = host.linvel();
      return new THREE.Vector3(a.x - b.x, a.y - b.y, a.z - b.z).dot(axis);
    }
    const a = child.angvel();
    const b = host.angvel();
    return new THREE.Vector3(a.x - b.x, a.y - b.y, a.z - b.z).dot(axis);
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
