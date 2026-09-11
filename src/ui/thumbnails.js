import * as THREE from 'three';
import { Arena } from '../sim/arena.js';
import { getPart, CELL } from '../parts/registry.js';
import { orientationQuaternion } from '../core/orientation.js';
import { createPartMesh } from '../parts/geometry.js';

const WIDTH = 480;
const HEIGHT = 270;
const SKY = 0x0d131c;

let shared = null;

/**
 * One renderer for every picture the menu needs, kept alive between them. It
 * is separate from the game's so that one is never resized or read from
 * mid-frame, and `preserveDrawingBuffer` lets the canvas still be read after
 * it has been drawn.
 *
 * Reused rather than made fresh each time: a browser only allows so many live
 * WebGL contexts, and building one per thumbnail runs the tab out of them and
 * hangs it.
 */
function sharedRenderer(width = WIDTH, height = HEIGHT) {
  if (shared) {
    shared.setSize(width, height, false);
    return shared;
  }
  shared = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: false,
  });
  shared.setPixelRatio(1);
  shared.setSize(width, height, false);
  shared.shadowMap.enabled = true;
  shared.shadowMap.type = THREE.PCFShadowMap;
  return shared;
}

// Frees the meshes a throwaway scene made, so repeated pictures do not pile up
// geometry on the GPU.
function scrub(scene) {
  scene.traverse((child) => {
    if (!child.isMesh && !child.isLineSegments) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material?.dispose();
  });
}

function lightUp(scene) {
  scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x232a33, 1.2));
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
  sun.position.set(18, 26, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 90;
  scene.add(sun, sun.target);
  return sun;
}

/**
 * Points the camera at `look` from far enough away to take `reach` in. Kept
 * low and close rather than square on from above: a course is mostly empty
 * ground, and framing the whole of it leaves the interesting part a speck in
 * the middle of a grey field.
 */
function frame(camera, look, reach, pull = 0.62, lift = 0.34, floor = 4) {
  const distance = (Math.max(reach, floor) * pull) / Math.tan((camera.fov * Math.PI) / 360);
  const direction = new THREE.Vector3(0.5, lift, -0.82).normalize();
  camera.position.copy(look).addScaledVector(direction, distance);
  camera.lookAt(look);
  camera.updateProjectionMatrix();
}

/**
 * A picture of a course, built from the level itself so it can never drift out
 * of step with what the challenge actually is.
 */
export function renderLevel(RAPIER, level) {
  const renderer = sharedRenderer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 34, 120);
  lightUp(scene);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const arena = new Arena({ RAPIER, world, scene, level, seed: 7 });
  arena.step(1.4);
  world.step();
  arena.sync();

  // Look at the business end — the goal, and whatever has to get there — and
  // take in only as much of the run-up as is needed to read the shape of it.
  const points = [
    ...(level.zones ?? []).map((z) => new THREE.Vector3(...z.pos)),
    ...(level.props ?? []).map((p) => new THREE.Vector3(...p.pos)),
    ...(level.movers ?? []).map((m) => new THREE.Vector3(0, m.pos[1], m.pos[2])),
  ];
  if (points.length === 0) {
    points.push(
      ...(level.pieces ?? []).map((p) => new THREE.Vector3(...p.pos)),
      new THREE.Vector3(...level.spawn),
    );
  }

  const look = points
    .reduce((sum, p) => sum.add(p), new THREE.Vector3())
    .divideScalar(Math.max(points.length, 1));
  look.y = Math.max(look.y, 1.4);

  const span = new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3());
  const reach = Math.min(Math.max(span.x, span.y, span.z, 7), 26);

  const camera = new THREE.PerspectiveCamera(44, WIDTH / HEIGHT, 0.5, 500);
  frame(camera, look, reach, 0.66, level.movers ? 0.3 : 0.4);

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/webp', 0.72);

  arena.dispose();
  scrub(scene);
  return url;
}

/** The meshes of a blueprint, with no physics involved. */
export function blueprintGroup(blueprint) {
  const group = new THREE.Group();
  for (const placed of blueprint.list()) {
    const mesh = createPartMesh(getPart(placed.type));
    mesh.position.set(
      placed.cell[0] * CELL,
      placed.cell[1] * CELL,
      placed.cell[2] * CELL,
    );
    const q = orientationQuaternion(placed.rot);
    mesh.quaternion.set(q.x, q.y, q.z, q.w);
    group.add(mesh);
  }
  return group;
}

/** A picture of a machine, for the garage. */
export function renderMachine(blueprint) {
  const renderer = sharedRenderer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  lightUp(scene);

  const machine = blueprintGroup(blueprint);
  scene.add(machine);

  const plate = new THREE.Mesh(
    new THREE.CircleGeometry(6, 48),
    new THREE.MeshStandardMaterial({ color: 0x161d27, roughness: 1 }),
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = -CELL / 2 - 0.02;
  plate.receiveShadow = true;
  scene.add(plate);

  const box = new THREE.Box3().setFromObject(machine);
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(2, 2, 2));
  const size = box.getSize(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(38, WIDTH / HEIGHT, 0.1, 100);
  frame(camera, box.getCenter(new THREE.Vector3()), Math.max(size.x, size.y, size.z), 0.78, 0.46, 1.5);

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/webp', 0.72);
  scrub(scene);
  return url;
}

const PART = 132;

/**
 * A picture of a single part on its own, for the palette. The part is drawn
 * from the same mesh the studio places, so the rack always shows what you are
 * actually about to build with.
 */
export function renderPart(partId) {
  const renderer = sharedRenderer(PART, PART);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1018);
  lightUp(scene);

  const mesh = createPartMesh(getPart(partId));
  scene.add(mesh);

  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(CELL, CELL, CELL));
  const size = box.getSize(new THREE.Vector3());
  // A part is a handful of centimetres across, so the course framer's floor
  // would push the camera back far enough to lose it altogether.
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 40);
  frame(camera, box.getCenter(new THREE.Vector3()), Math.max(size.x, size.y, size.z), 0.92, 0.44, 0);

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/webp', 0.8);
  scrub(scene);
  return url;
}

// Courses never change, so each one only has to be drawn once a session.
const cache = new Map();

export function levelThumb(RAPIER, level) {
  if (!cache.has(level.id)) cache.set(level.id, renderLevel(RAPIER, level));
  return cache.get(level.id);
}
