import * as THREE from 'three';
import {
  getPart, pistonStroke, servoAngleA, servoAngleB, springTravel, dollySpeed, CELL,
} from '../parts/registry.js';
import { applyOrientation } from '../core/orientation.js';
import { groupBlueprint } from '../sim/grouping.js';
import { railRun } from '../sim/rails.js';

/**
 * What a part will actually do, drawn before it does it.
 *
 * A hinge has limits, a servo has two angles, a piston has a stroke, a
 * suspension strut has travel, a grabber has a reach. Every one of those is a
 * number in a panel, and a number in a panel tells you nothing about whether
 * the arm will clear the load or whether the ram is long enough. You found out
 * by pressing Play, going back, changing it by a bit, and pressing Play again.
 *
 * So the selected part draws its own envelope on the plate: the arc a joint
 * will sweep, the line a ram will travel, the circle a turntable will turn.
 * The radius is not a guess either — it is measured off whatever is actually
 * bolted to the far side of the joint, so a long arm draws a long arc and the
 * question "will it reach" is answered by looking.
 *
 * This half is only geometry, and knows nothing about drawing.
 */

/** What to fall back to when a joint is carrying nothing yet. */
const BARE = CELL * 1.6;

/** How far past the outermost part the sweep is drawn. */
const MARGIN = CELL * 0.5;

const vec = (a) => ({ x: a[0], y: a[1], z: a[2] });

/** The parts that move when this joint moves, or null if it is not a joint. */
export function carriedBy(blueprint, placed, cached = null) {
  const grouping = cached ?? groupBlueprint(blueprint);
  const joint = grouping.joints.find((j) => j.partId === placed.id);
  if (!joint) return null;
  const body = grouping.bodies[joint.childBody];
  return body ? body.members.map((id) => blueprint.get(id)).filter(Boolean) : [];
}

/**
 * How far the load reaches from the joint, square to the axis it turns about.
 *
 * A boom three cells long swinging about its own end draws an arc three cells
 * across; the same boom mounted through its middle draws one half that. The
 * difference is the whole question a player is asking, so it is measured
 * rather than assumed.
 */
export function sweepRadius(blueprint, placed, axis, cached = null) {
  const carried = carriedBy(blueprint, placed, cached);
  if (!carried || carried.length === 0) return BARE;
  let far = 0;
  for (const other of carried) {
    const part = getPart(other.type);
    const arm = [0, 1, 2].map((i) => (other.cell[i] - placed.cell[i]) * CELL);
    // Only the part square to the axis swings; whatever lies along it stays
    // where it is however far the joint turns.
    const along = arm[0] * axis[0] + arm[1] * axis[1] + arm[2] * axis[2];
    const out = [0, 1, 2].map((i) => arm[i] - along * axis[i]);
    const size = applyOrientation(other.rot, part.size).map(Math.abs);
    const half = Math.max(size[0], size[1], size[2]) * CELL * 0.5;
    far = Math.max(far, Math.hypot(out[0], out[1], out[2]) + half);
  }
  return Math.max(BARE, far + MARGIN);
}

/**
 * The envelope of the selected part, in the studio's own metres, or null when
 * the part has no range to speak of.
 *
 * `kind` is what to draw: an arc between two angles, a full circle, a line
 * between two extensions, or a straight reach out of the part's nose.
 */
export function envelopeOf(blueprint, placed, cached = null) {
  if (!placed) return null;
  const part = getPart(placed.type);
  if (!part) return null;

  const at = [0, 1, 2].map((i) => placed.cell[i] * CELL);
  const turned = (local) => applyOrientation(placed.rot, local);

  if (part.id === 'grabber') {
    // It reaches along its own nose, which is +Y before the part is turned.
    return {
      kind: 'reach',
      part: part.id,
      origin: vec(at),
      axis: vec(turned([0, 1, 0])),
      length: part.grabber.reach,
      label: `Reaches ${part.grabber.reach.toFixed(2)} m`,
    };
  }

  if (part.sensor) {
    return {
      kind: 'reach',
      part: part.id,
      origin: vec(at),
      axis: vec(turned(part.sensor.axis)),
      length: part.sensor.range,
      label: `Sees ${part.sensor.range} m`,
    };
  }

  // A dolly's travel is the track it is standing on, not a number on the
  // part, so the envelope is the rail run and it grows as you lay more.
  if (part.id === 'dolly') {
    const run = railRun(blueprint, placed);
    if (!run) {
      return {
        kind: 'slide',
        part: part.id,
        origin: vec(at),
        axis: vec(turned(part.axis)),
        from: 0,
        to: 0,
        label: 'Not on a rail — it will not move',
      };
    }
    const ends = [run.openBack ? 'open' : 'stopped', run.openForward ? 'open' : 'stopped'];
    return {
      kind: 'slide',
      part: part.id,
      origin: vec(at),
      axis: vec(run.axis),
      from: -run.back,
      to: run.forward,
      label: `${run.length.toFixed(1)} m of rail, ${ends.join(' to ')}`
        + ` · ${dollySpeed(placed, part).toFixed(1)} m/s`,
    };
  }

  if (part.joint === 'prismatic') {
    const axis = turned(part.axis);
    // A strut moves either way from where it was built; a ram only pushes out.
    const [from, to] = part.spring
      ? [-springTravel(placed, part) / 2, springTravel(placed, part) / 2]
      : [0, pistonStroke(placed, part)];
    return {
      kind: 'slide',
      part: part.id,
      origin: vec(at),
      axis: vec(axis),
      from,
      to,
      label: part.spring
        ? `Gives ${(to - from).toFixed(2)} m, either way`
        : `Pushes out ${to.toFixed(2)} m`,
    };
  }

  if (part.joint === 'revolute') {
    const axis = turned(part.axis);
    const radius = sweepRadius(blueprint, placed, axis, cached);
    // Which way "no rotation" points, so the arc starts where the part is now
    // rather than at some arbitrary place on the circle.
    const zero = turned(Math.abs(part.axis[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0]);

    if (part.id === 'positioner') {
      const a = servoAngleA(placed, part);
      const b = servoAngleB(placed, part);
      return {
        kind: 'arc',
        part: part.id,
        origin: vec(at),
        axis: vec(axis),
        zero: vec(zero),
        from: Math.min(a, b),
        to: Math.max(a, b),
        radius,
        label: `${Math.round(a)}° to ${Math.round(b)}°`,
      };
    }
    if (part.limits) {
      const from = (part.limits[0] * 180) / Math.PI;
      const to = (part.limits[1] * 180) / Math.PI;
      return {
        kind: 'arc',
        part: part.id,
        origin: vec(at),
        axis: vec(axis),
        zero: vec(zero),
        from,
        to,
        radius,
        label: `${Math.round(from)}° to ${Math.round(to)}°`,
      };
    }
    // A wheel is a revolute joint with no limits too, and nobody has ever
    // wondered how far round a wheel goes.
    if (!part.actuator || part.actuator.kind === 'motor') return null;
    // Nothing stopping it: a turntable goes round and round.
    return {
      kind: 'spin',
      part: part.id,
      origin: vec(at),
      axis: vec(axis),
      zero: vec(zero),
      from: -180,
      to: 180,
      radius,
      label: 'Turns all the way round',
    };
  }

  return null;
}

// ---------------------------------------------------------------- the drawing

// Cyan is rules and wiring everywhere else in the game, and a range is a rule.
// Amber is already the selection, and the two must not be the same thing.
const LINE = 0x35d0e0;
const FILL = 0x35d0e0;
const STEPS = 72;

/** The two directions that span the plane a joint turns in. */
function plane(axis, zero) {
  const a = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
  const u = new THREE.Vector3(zero.x, zero.y, zero.z).projectOnPlane(a);
  if (u.lengthSq() < 1e-8) u.set(a.y, a.z, a.x).projectOnPlane(a);
  u.normalize();
  return { a, u, v: new THREE.Vector3().crossVectors(a, u).normalize() };
}

const around = (origin, u, v, radius, degrees) => new THREE.Vector3(
  origin.x, origin.y, origin.z,
).addScaledVector(u, Math.cos((degrees * Math.PI) / 180) * radius)
  .addScaledVector(v, Math.sin((degrees * Math.PI) / 180) * radius);

/**
 * The envelope, drawn.
 *
 * Rebuilt only when the shape of it changes, which is when the selection
 * changes or somebody drags a slider -- not sixty times a second for a picture
 * that is not moving.
 */
export class RangeView {
  constructor(parent) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.renderOrder = 3;
    parent.add(this.group);
    this.signature = null;
  }

  show(blueprint, placed, grouping = null) {
    const envelope = placed ? envelopeOf(blueprint, placed, grouping) : null;
    const signature = envelope ? JSON.stringify(envelope) : null;
    if (signature === this.signature) return envelope;
    this.signature = signature;
    this.clear();
    if (!envelope) {
      this.group.visible = false;
      return null;
    }
    this.draw(envelope);
    this.group.visible = true;
    return envelope;
  }

  hide() {
    if (this.signature === null) return;
    this.signature = null;
    this.clear();
    this.group.visible = false;
  }

  draw(envelope) {
    if (envelope.kind === 'slide') this.drawSlide(envelope);
    else if (envelope.kind === 'reach') this.drawReach(envelope);
    else this.drawSweep(envelope);
  }

  /** The wedge a joint sweeps, with a hard edge on each limit. */
  drawSweep(envelope) {
    const {
      origin, radius, from, to,
    } = envelope;
    const { u, v } = plane(envelope.axis, envelope.zero);
    const span = to - from;

    const rim = [];
    for (let i = 0; i <= STEPS; i += 1) {
      rim.push(around(origin, u, v, radius, from + (span * i) / STEPS));
    }
    this.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        span >= 359 ? [...rim, rim[0]] : rim,
      ),
      new THREE.LineBasicMaterial({ color: LINE, transparent: true, opacity: 0.9 }),
    ));

    const middle = new THREE.Vector3(origin.x, origin.y, origin.z);
    const fan = [];
    for (let i = 0; i < STEPS; i += 1) fan.push(middle, rim[i], rim[i + 1]);
    this.add(new THREE.Mesh(
      new THREE.BufferGeometry().setFromPoints(fan),
      new THREE.MeshBasicMaterial({
        color: FILL,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ));

    // The ends, which are the numbers in the panel made visible. A full circle
    // has no ends worth marking.
    if (span < 359) {
      for (const at of [from, to]) {
        this.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([middle, around(origin, u, v, radius, at)]),
          new THREE.LineBasicMaterial({ color: LINE }),
        ));
      }
    }
  }

  /** The line a ram or a strut travels along, with a stop at each end. */
  drawSlide(envelope) {
    const {
      origin, from, to,
    } = envelope;
    const axis = new THREE.Vector3(envelope.axis.x, envelope.axis.y, envelope.axis.z).normalize();
    const at = new THREE.Vector3(origin.x, origin.y, origin.z);
    const near = at.clone().addScaledVector(axis, from);
    const far = at.clone().addScaledVector(axis, to);

    this.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([near, far]),
      new THREE.LineBasicMaterial({ color: LINE }),
    ));

    // A cross-bar at each end, square to the travel, so the two stops read as
    // stops rather than as the ends of a line that ran out.
    const across = new THREE.Vector3(0, 1, 0);
    if (Math.abs(axis.dot(across)) > 0.9) across.set(1, 0, 0);
    const bar = new THREE.Vector3().crossVectors(axis, across).normalize().multiplyScalar(CELL * 0.4);
    for (const end of [near, far]) {
      this.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          end.clone().sub(bar), end.clone().add(bar),
        ]),
        new THREE.LineBasicMaterial({ color: LINE }),
      ));
    }
  }

  /** How far a grabber or a sensor reaches, as a line out of its nose. */
  drawReach(envelope) {
    const axis = new THREE.Vector3(envelope.axis.x, envelope.axis.y, envelope.axis.z).normalize();
    const at = new THREE.Vector3(envelope.origin.x, envelope.origin.y, envelope.origin.z);
    const end = at.clone().addScaledVector(axis, envelope.length);
    this.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([at, end]),
      new THREE.LineDashedMaterial({
        color: LINE, dashSize: 0.16, gapSize: 0.1,
      }),
    ).computeLineDistances());

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(CELL * 0.16, CELL * 0.42, 12),
      new THREE.MeshBasicMaterial({ color: LINE, transparent: true, opacity: 0.85 }),
    );
    head.position.copy(end);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    this.add(head);
  }

  add(object) {
    this.group.add(object);
  }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
    }
  }

  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
  }
}
