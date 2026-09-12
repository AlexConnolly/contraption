import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import { Studio } from '../src/studio/studio.js';
import { Blueprint } from '../src/core/blueprint.js';

function studio() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  // Where the studio actually opens: on the +Z side, looking back at the
  // machine, so forwards comes towards the viewer.
  camera.position.set(7, 6, 9);
  camera.lookAt(0, 0, 0);
  return new Studio({ scene, camera, blueprint: new Blueprint({ name: 'test' }) });
}

/**
 * Everything that faces anywhere is set up against the machine's own front,
 * and an empty build plate gives no clue where that is. The marker is the
 * answer, so what it has to get right is the direction.
 */
describe('the forward marker', () => {
  it('is on the plate', () => {
    expect(studio().forward).toBeDefined();
  });

  it('points the way the machine calls forwards', () => {
    const { forward } = studio();
    forward.updateWorldMatrix(true, true);
    const mark = forward.children[0];
    // The arrow is drawn in its own plane with the point at the far end; where
    // that point lands in the world is the only thing that matters.
    const tail = new THREE.Vector3(0, 0, 0).applyMatrix4(mark.matrixWorld);
    const tip = new THREE.Vector3(0, 1.9, 0).applyMatrix4(mark.matrixWorld);
    const along = tip.clone().sub(tail).normalize();
    // Forward is +Z, which is what every part's facing is measured against.
    expect(along.dot(new THREE.Vector3(0, 0, 1))).toBeGreaterThan(0.99);
  });

  it('lies flat on the plate rather than standing up in the way', () => {
    const { forward } = studio();
    forward.updateWorldMatrix(true, true);
    const mark = forward.children[0];
    const tail = new THREE.Vector3(0, 0, 0).applyMatrix4(mark.matrixWorld);
    const tip = new THREE.Vector3(0, 1.9, 0).applyMatrix4(mark.matrixWorld);
    expect(Math.abs(tip.y - tail.y)).toBeLessThan(0.01);
  });

  /**
   * The studio camera starts on the +Z side looking back at the machine, so
   * forwards comes towards you. Put the marker far enough out and it sits
   * behind the camera, where nobody will ever see it.
   */
  it('sits in front of the machine and inside the opening view', () => {
    const built = studio();
    built.forward.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(built.forward);
    expect(box.min.z).toBeGreaterThan(2.5);
    expect(box.max.z).toBeLessThan(built.camera.position.z);
    // And in shot, not off to the side of it.
    expect(Math.abs(box.min.x + box.max.x) / 2).toBeLessThan(0.01);
  });

  // You are allowed to build under the plate, and the question is the same
  // down there, so the marker is drawn on both faces.
  it('can be seen from under the plate too', () => {
    const { forward } = studio();
    const heights = forward.children.map((child) => child.position.y);
    expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights));
  });

  it('is not something you can build on or select', () => {
    const built = studio();
    expect(built.pickMeshes).not.toContain(built.forward);
    for (const child of built.forward.children) {
      expect(built.pickMeshes).not.toContain(child);
    }
  });
});
