import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { getLevel } from '../src/challenges/levels.js';
import { breached, throughHoop } from '../src/challenges/objectives.js';
import { getPart, turntableSpin } from '../src/parts/registry.js';

const STEP = 1 / 60;

beforeAll(async () => { await RAPIER.init(); }, 30000);

/**
 * The hoops level asks for something no other level does: the payload has to
 * leave the machine and finish the journey on its own. Whether that is even
 * possible is a question about ballistics and about what a turntable can
 * actually throw, and neither is obvious by looking. These answer it.
 */
const level = getLevel('hoops');
const ring = level.hoops[0];

// A ball given this velocity from this point: where does it end up, and does
// it go through the ring on the way?
function fling(from, velocity, seconds = 4) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const scene = new THREE.Scene();
  const arena = new Arena({ RAPIER, world, scene, level, seed: 1 });

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(from.x, from.y, from.z),
  );
  world.createCollider(RAPIER.ColliderDesc.ball(0.42).setDensity(7.7), body);
  body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);

  let scored = false;
  let closest = Infinity;
  for (let i = 0; i < Math.round(seconds / STEP) && !scored; i += 1) {
    arena.step(STEP);
    world.step();
    const t = body.translation();
    const at = new THREE.Vector3(t.x, t.y, t.z);
    closest = Math.min(closest, at.distanceTo(new THREE.Vector3(...ring.pos)));
    if (throughHoop(ring, at)) scored = true;
  }
  arena.dispose();
  return { scored, closest };
}

// Launch speed and angle turned into a velocity aimed down the court.
function shot(speed, degrees) {
  const a = (degrees * Math.PI) / 180;
  return new THREE.Vector3(0, Math.sin(a) * speed, Math.cos(a) * speed);
}

describe('the hoops level is actually winnable', () => {
  // The nearest you are allowed to stand: the keep-out ends here, and a boom
  // on top of a machine puts the ball about two metres up.
  const edge = new THREE.Vector3(0, 2, 3.4);

  it('lets you stand where the shot is taken from', () => {
    expect(breached(level, edge)).toBe(null);
  });

  it('scores from the edge of the keep-out at a sensible speed and angle', () => {
    expect(fling(edge, shot(13.2, 42)).scored).toBe(true);
  });

  // What a turntable can really throw: tip speed is the rate times the boom's
  // reach, and the level's own hint tells the player to build exactly this.
  it('is inside what the turntable can throw, with room to spare', () => {
    const boom = 3 * 0.5 - 0.5 / 2;
    const tip = turntableSpin({ config: {} }, getPart('turntable')) * boom;
    const fastest = getPart('turntable').spinRange[1] * boom;
    expect(fastest).toBeGreaterThan(13.2 * 1.15);
    expect(tip).toBeGreaterThan(0);
  });

  it('is not so easy that any old lob goes in', () => {
    expect(fling(edge, shot(13.2, 12)).scored).toBe(false);
    expect(fling(edge, shot(6, 42)).scored).toBe(false);
  });

  // If you could simply walk it up and post it, the launcher never happens.
  it('cannot be posted by hand, because the court is off limits', () => {
    expect(breached(level, new THREE.Vector3(0, 6.4, 11))).not.toBe(null);
    expect(breached(level, new THREE.Vector3(0, 9.5, 8))).not.toBe(null);
  });
});
