import * as THREE from 'three';
import { CELL, workingAxis } from './registry.js';

// Where the rod leaves the barrel, and how long it is fully retracted, which
// is whatever puts the foot flush with the bottom of the part's own cell.
export const PISTON_ROD_TOP = -CELL * 0.12;
export const PISTON_REST = CELL * 0.4 + PISTON_ROD_TOP;

const INSET = 0.03;

function box(part, scale = 1) {
  return new THREE.BoxGeometry(
    part.size[0] * CELL * scale - INSET,
    part.size[1] * CELL * scale - INSET,
    part.size[2] * CELL * scale - INSET,
  );
}

function material(colour, options = {}) {
  return new THREE.MeshStandardMaterial({
    color: colour,
    roughness: options.roughness ?? 0.62,
    metalness: options.metalness ?? 0.16,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 1,
  });
}

function shell(part) {
  const mesh = new THREE.Mesh(box(part), material(part.colour));
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: 0x101418, transparent: true, opacity: 0.35 }),
  );
  mesh.add(edges);
  return mesh;
}

const BUILDERS = {
  core(part) {
    const group = new THREE.Group();
    group.add(shell(part));
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(CELL * 0.16, 16, 12),
      material(0xfff0c4, { emissive: 0xffae3b, roughness: 0.3 }),
    );
    lamp.position.y = CELL * 0.38;
    group.add(lamp);
    return group;
  },

  wheel(part) {
    const group = new THREE.Group();
    const tyre = new THREE.Mesh(
      new THREE.CylinderGeometry(part.radius, part.radius, part.width, 22),
      material(part.colour, { roughness: 0.9, metalness: 0.05 }),
    );
    tyre.rotation.z = Math.PI / 2;
    group.add(tyre);
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(part.radius * 0.5, part.radius * 0.5, part.width * 1.08, 16),
      material(0xd8dde3, { metalness: 0.5, roughness: 0.3 }),
    );
    hub.rotation.z = Math.PI / 2;
    group.add(hub);
    for (let i = 0; i < 4; i += 1) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(part.width * 1.12, part.radius * 1.5, 0.04),
        material(0xe8edf2, { metalness: 0.4 }),
      );
      spoke.rotation.x = (i * Math.PI) / 4;
      group.add(spoke);
    }
    return group;
  },

  hinge(part) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(CELL - INSET, CELL * 0.52, CELL - INSET),
      material(part.colour),
    );
    body.position.y = CELL * 0.24;
    group.add(body);
    const axle = new THREE.Mesh(
      new THREE.CylinderGeometry(CELL * 0.19, CELL * 0.19, CELL * 1.02, 16),
      material(0xe8edf2, { metalness: 0.6, roughness: 0.25 }),
    );
    axle.rotation.z = Math.PI / 2;
    group.add(axle);
    return group;
  },

  /**
   * An articulated part travels with the load, not with the base it pushes
   * off, so the gap a piston opens is underneath it. The barrel therefore
   * rides up with the part and the rod reaches back down to the foot planted
   * on the base. The rod's geometry is shifted so its origin is at its top
   * and scaling Y grows it downwards; `machine.syncPistons` does that.
   */
  piston(part) {
    const group = new THREE.Group();
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(CELL * 0.34, CELL * 0.34, CELL * 0.62, 18),
      material(part.colour),
    );
    barrel.position.y = CELL * 0.19;
    group.add(barrel);

    const rodGeometry = new THREE.CylinderGeometry(CELL * 0.16, CELL * 0.16, 1, 14);
    rodGeometry.translate(0, -0.5, 0);
    const rod = new THREE.Mesh(
      rodGeometry,
      material(0xdfe6ec, { metalness: 0.7, roughness: 0.2 }),
    );
    rod.name = 'rod';
    rod.position.y = PISTON_ROD_TOP;
    rod.scale.y = PISTON_REST;
    group.add(rod);

    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(CELL - INSET, CELL * 0.2, CELL - INSET),
      material(part.colour),
    );
    foot.name = 'foot';
    foot.position.y = PISTON_ROD_TOP - PISTON_REST;
    group.add(foot);
    return group;
  },

  propeller(part) {
    const group = new THREE.Group();
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(CELL * 0.26, CELL * 0.3, CELL * 0.4, 16),
      material(part.colour),
    );
    group.add(hub);
    const blades = new THREE.Group();
    for (let i = 0; i < 3; i += 1) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(CELL * 1.8, 0.025, CELL * 0.24),
        material(0xf2f6fa, { roughness: 0.4 }),
      );
      blade.rotation.y = (i * Math.PI * 2) / 3;
      blade.position.y = CELL * 0.26;
      blades.add(blade);
    }
    group.add(blades);
    group.userData.spinner = blades;
    return group;
  },

  thruster(part) {
    const group = new THREE.Group();
    // Narrow at the top, flared at the bottom: the exhaust leaves the wide end
    // and the push is the other way, along local +Y.
    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(CELL * 0.2, CELL * 0.34, CELL * 0.8, 16),
      material(part.colour),
    );
    group.add(nozzle);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(CELL * 0.2, CELL * 0.9, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.85 }),
    );
    flame.rotation.x = Math.PI;
    flame.position.y = -CELL * 0.8;
    flame.visible = false;
    group.add(flame);
    group.userData.flame = flame;
    return group;
  },

  grabber(part) {
    const group = new THREE.Group();
    group.add(shell(part));
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(CELL * 0.78, CELL * 0.14, CELL * 0.78),
      material(0x2b2f36, { emissive: 0x000000 }),
    );
    pad.position.y = CELL * 0.46;
    group.add(pad);
    group.userData.indicator = pad;
    return group;
  },

  controller(part) {
    const group = new THREE.Group();
    group.add(shell(part));
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(CELL * 0.62, CELL * 0.08, CELL * 0.62),
      material(0x123b3a, { metalness: 0.4, roughness: 0.5 }),
    );
    board.position.y = CELL * 0.28;
    group.add(board);
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(CELL * 0.09, 12, 10),
      material(0xd8fff8, { emissive: 0x2ce0cf, roughness: 0.2 }),
    );
    led.position.set(CELL * 0.18, CELL * 0.36, CELL * 0.18);
    group.add(led);
    return group;
  },

  sensor(part) {
    const group = new THREE.Group();
    group.add(shell(part));
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(CELL * 0.2, CELL * 0.2, CELL * 0.12, 16),
      material(0x1d2027, { emissive: 0x3a1a66 }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.z = CELL * 0.48;
    group.add(lens);
    group.userData.indicator = lens;
    return group;
  },
};

// A thrust axis is invisible until it fires, and yawing a part does not change
// which way it points, so the studio draws the direction on it.
// Amber for something the part does, cyan for something it reads.
const HINT_COLOUR = { act: 0xf0a825, read: 0x35d0e0 };

// Draws over whatever is in front of it, so a marker pointing into the middle
// of a machine is still readable.
function overlaySkin(colour) {
  return new THREE.MeshBasicMaterial({
    color: colour,
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
}

function onTop(group) {
  group.renderOrder = 999;
  group.traverse((child) => { child.renderOrder = 999; });
  return group;
}

/** The circle a hinge swings through, drawn round its axle. */
function hingeRing(axis, colour = HINT_COLOUR.act) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(CELL * 0.62, 0.018, 8, 40),
    overlaySkin(colour),
  );
  // A torus lies in its own XY plane, so its normal is +Z.
  ring.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(...axis).normalize(),
  );
  const group = new THREE.Group();
  group.add(ring);
  return onTop(group);
}

function directionArrow(axis, colour = HINT_COLOUR.act) {
  const group = new THREE.Group();
  // Drawn without depth testing and last, so an arrow pointing into the middle
  // of the machine is still visible instead of being swallowed by the part in
  // front of it.
  const skin = () => overlaySkin(colour);
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, CELL * 0.7, 8),
    skin(),
  );
  shaft.position.y = CELL * 0.85;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.075, CELL * 0.34, 12), skin());
  head.position.y = CELL * 1.35;
  group.add(shaft, head);
  onTop(group);
  group.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(...axis).normalize(),
  );
  return group;
}

export function createPartMesh(part, options = {}) {
  const build = BUILDERS[part.id] ?? shell;
  const object = build(part);
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  if (options.hints) {
    // Which way this part faces, for every part where that matters — the
    // controller's arrow is the machine's flight frame, so it shows which way
    // the whole thing thinks forward is.
    const hint = workingAxis(part);
    if (hint) object.add(directionArrow(hint.axis, HINT_COLOUR[hint.kind]));
    // A hinge has no direction, it has a plane, so it gets the plane instead.
    if (part.joint === 'revolute') object.add(hingeRing(part.axis));
  }
  return object;
}

export function makeGhost(part) {
  const object = createPartMesh(part, { hints: true });
  object.traverse((child) => {
    if (!child.isMesh && !child.isLineSegments) return;
    child.castShadow = false;
    child.receiveShadow = false;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      mat.transparent = true;
      mat.opacity = 0.45;
      mat.depthWrite = false;
    }
  });
  return object;
}

export function cellToLocal(cell) {
  return new THREE.Vector3(cell[0] * CELL, cell[1] * CELL, cell[2] * CELL);
}
