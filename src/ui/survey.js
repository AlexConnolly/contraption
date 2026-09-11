import * as THREE from 'three';
import { bansOn } from '../challenges/bans.js';

/**
 * A look round the course before you build for it. The first question any of
 * these problems asks is "how would I even do this", and you cannot answer it
 * from a one-line brief and a camera pointed at an empty build plate.
 *
 * The stops are read out of the level, so a course cannot be toured showing
 * something it no longer contains.
 */

const EASE = (t) => t * t * (3 - 2 * t);

function point(v) {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

/**
 * Where the tour stops and what to say at each. Built from the objectives,
 * which is what actually defines the problem: where you start, what has to
 * move, and where it has to end up.
 */
export function stopsFor(level) {
  const zones = new Map((level.zones ?? []).map((z) => [z.id, z]));
  const props = new Map((level.props ?? []).map((p) => [p.id, p]));
  const stops = [];
  const seen = new Set();

  // A constraint the player cannot see before they build reads as unfairness
  // rather than as a puzzle, so the tour opens by saying what is off the table.
  const bans = bansOn(level).map((ban) => ban.name.toLowerCase());
  stops.push({
    at: point(level.spawn),
    reach: 9,
    caption: bans.length > 0
      ? `You start here — ${bans.join(', ')}`
      : 'You start here',
  });

  for (const objective of level.objectives ?? []) {
    const prop = objective.prop ? props.get(objective.prop) : null;
    if (prop && !seen.has(`p${objective.prop}`)) {
      seen.add(`p${objective.prop}`);
      stops.push({
        at: point(prop.pos),
        reach: 7,
        caption: 'This has to move',
      });
    }
    const zone = objective.zone ? zones.get(objective.zone) : null;
    if (zone && !seen.has(`z${objective.zone}`)) {
      seen.add(`z${objective.zone}`);
      stops.push({
        at: point(zone.pos),
        reach: Math.max(...zone.size) + 6,
        caption: objective.label,
      });
    }
  }

  // Whatever is in the way is the whole problem on some courses, so the tour
  // pulls back far enough to take the obstacles in as one picture.
  if ((level.movers ?? []).length > 0) {
    const box = new THREE.Box3();
    for (const mover of level.movers) box.expandByPoint(point(mover.pos));
    for (const zone of level.zones ?? []) box.expandByPoint(point(zone.pos));
    const size = box.getSize(new THREE.Vector3());
    stops.push({
      at: box.getCenter(new THREE.Vector3()),
      reach: Math.max(size.x, size.y, size.z, 14),
      caption: 'And these do not stay still',
    });
  }

  return stops;
}

/**
 * Where to put the camera for a stop. Always behind it, looking the way the
 * course runs: a shot pointed straight down at the start shows nothing but
 * empty ground, whereas the same spot seen with the rest of the course laid
 * out beyond it is the answer to how the thing might be done.
 */
export function shotFor(stops, index) {
  const stop = stops[index];
  const previous = stops[index - 1];
  const next = stops[index + 1];

  const along = new THREE.Vector3();
  if (previous) along.subVectors(stop.at, previous.at);
  else if (next) along.subVectors(next.at, stop.at);
  along.y = 0;
  if (along.lengthSq() < 1e-4) along.set(0, 0, 1);
  along.normalize();

  // A step off the centreline, alternating sides, so consecutive stops are
  // not all the same picture.
  const side = new THREE.Vector3(-along.z, 0, along.x)
    .multiplyScalar(index % 2 === 0 ? 1 : -1);

  const distance = Math.max(stop.reach, 6) * 1.1;
  return new THREE.Vector3()
    .copy(stop.at)
    .addScaledVector(along, -distance * 0.82)
    .addScaledVector(side, distance * 0.42)
    .setY(stop.at.y + Math.max(stop.reach * 0.5, 4));
}

/**
 * What the camera aims at. Biased along the course rather than dead on the
 * stop itself, so the thing you are about to be shown is already in frame
 * instead of sitting on the edge of it.
 */
export function lookFor(stops, index) {
  const at = stops[index].at.clone();
  const next = stops[index + 1];
  return next ? at.lerp(next.at, 0.32) : at;
}

export class Survey {
  constructor({ onCaption, onEnd } = {}) {
    this.onCaption = onCaption ?? (() => {});
    this.onEnd = onEnd ?? (() => {});
    this.stops = [];
    this.running = false;
    this.from = new THREE.Vector3();
    this.fromLook = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.toLook = new THREE.Vector3();
    this.look = new THREE.Vector3();
  }

  get isRunning() {
    return this.running;
  }

  start(level, camera) {
    this.stops = stopsFor(level);
    if (this.stops.length === 0) return false;
    this.index = -1;
    this.running = true;
    this.from.copy(camera.position);
    this.fromLook.copy(lookFor(this.stops, 0));
    this.advance(0);
    return true;
  }

  advance() {
    this.index += 1;
    if (this.index >= this.stops.length) {
      this.stop();
      return;
    }
    const stop = this.stops[this.index];
    this.from.copy(this.to.lengthSq() > 0 ? this.to : this.from);
    this.fromLook.copy(this.toLook.lengthSq() > 0 ? this.toLook : stop.at);
    this.to.copy(shotFor(this.stops, this.index));
    this.toLook.copy(lookFor(this.stops, this.index));
    // The first move is instant: there is nowhere sensible to fly from.
    this.t = this.index === 0 ? 1 : 0;
    this.held = 0;
    this.onCaption(stop.caption, this.index + 1, this.stops.length);
  }

  update(dt, camera) {
    if (!this.running) return;
    const TRAVEL = 1.5;
    const HOLD = 1.6;

    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / TRAVEL);
    } else {
      this.held += dt;
    }

    const k = EASE(this.t);
    camera.position.lerpVectors(this.from, this.to, k);
    this.look.lerpVectors(this.fromLook, this.toLook, k);
    camera.lookAt(this.look);

    if (this.t >= 1 && this.held >= HOLD) this.advance();
  }

  skip() {
    if (this.running) this.stop();
  }

  stop() {
    this.running = false;
    this.stops = [];
    this.to.set(0, 0, 0);
    this.toLook.set(0, 0, 0);
    this.onEnd();
  }
}
