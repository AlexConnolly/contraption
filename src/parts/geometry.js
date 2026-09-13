import * as THREE from 'three';
import { CELL, workingAxis } from './registry.js';
import { IDENTITY_ORIENTATION } from '../core/orientation.js';

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

/**
 * The eight-corners-minus-two solid: full height along +Z, tapering to the
 * floor at -Z. Written out as explicit corners rather than extruded from a
 * shape so the same six points can be handed to the physics engine, which
 * means the thing you can see and the thing you collide with cannot drift
 * apart.
 */
export function wedgeCorners(size = [1, 1, 1]) {
  const x = (size[0] * CELL - INSET) / 2;
  const y = (size[1] * CELL - INSET) / 2;
  const z = (size[2] * CELL - INSET) / 2;
  return [
    [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z],
    [-x, y, z], [x, y, z],
  ];
}

function wedgeGeometry(part) {
  const c = wedgeCorners(part.size);
  // bottom, back, slope, and the two triangular cheeks
  const faces = [
    [0, 2, 1], [0, 3, 2],
    [3, 5, 2], [3, 4, 5],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 5],
    [0, 4, 3],
  ];
  const positions = [];
  for (const [a, b, d] of faces) positions.push(...c[a], ...c[b], ...c[d]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

const BUILDERS = {
  // Two collars with a band between them: it reads as a thing that comes
  // apart, and the seam shows where.
  coupling(part) {
    const group = new THREE.Group();
    for (const y of [-CELL * 0.28, CELL * 0.28]) {
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(CELL * 0.38, CELL * 0.38, CELL * 0.3, 16),
        material(part.colour),
      );
      collar.position.y = y;
      group.add(collar);
    }
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(CELL * 0.26, CELL * 0.26, CELL * 0.3, 16),
      material(0x2b2f36, { metalness: 0.7, roughness: 0.3 }),
    );
    group.add(band);
    return group;
  },

  wedge(part) {
    const mesh = new THREE.Mesh(wedgeGeometry(part), material(part.colour));
    mesh.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x101418, transparent: true, opacity: 0.35 }),
    ));
    return mesh;
  },

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
    // A toothed wheel's collider is its lug tips, so the carcass is drawn
    // inside that and the teeth reach out to it. What bites a step edge on
    // screen is then the same radius that bites it in the solver.
    const lugs = part.lugs ?? 0;
    const carcass = lugs ? part.radius * 0.82 : part.radius;

    const tyre = new THREE.Mesh(
      new THREE.CylinderGeometry(carcass, carcass, part.width, lugs ? 26 : 22),
      material(part.colour, { roughness: 0.9, metalness: 0.05 }),
    );
    tyre.rotation.z = Math.PI / 2;
    group.add(tyre);

    if (lugs) {
      const deep = part.radius - carcass;
      const block = new THREE.BoxGeometry(
        part.width * 1.02,
        deep * 2,
        // Half the gap between teeth, so the tread reads as teeth rather than
        // as a second, knobblier tyre.
        ((Math.PI * 2 * carcass) / lugs) * 0.5,
      );
      const rubber = material(0x14181c, { roughness: 1, metalness: 0.02 });
      for (let i = 0; i < lugs; i += 1) {
        const angle = (i / lugs) * Math.PI * 2;
        const lug = new THREE.Mesh(block, rubber);
        lug.name = 'lug';
        lug.position.set(0, Math.cos(angle) * carcass, Math.sin(angle) * carcass);
        // Turning a box about X by t takes its +Y to (0, cos t, sin t), which
        // is where it was just put. Negating this -- which is what it did at
        // first -- mirrors every tooth but the two at top and bottom, and the
        // ones at the sides end up pointing very nearly inwards.
        lug.rotation.x = angle;
        group.add(lug);
      }
    }

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(carcass * 0.5, carcass * 0.5, part.width * 1.08, 16),
      material(0xd8dde3, { metalness: 0.5, roughness: 0.3 }),
    );
    hub.rotation.z = Math.PI / 2;
    group.add(hub);
    for (let i = 0; i < 4; i += 1) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(part.width * 1.12, carcass * 1.5, 0.04),
        material(0xe8edf2, { metalness: 0.4 }),
      );
      spoke.rotation.x = (i * Math.PI) / 4;
      group.add(spoke);
    }
    return group;
  },

  /**
   * A length of track: two rails on sleepers, running along the part's +Z so
   * the direction arrow and the thing it describes agree.
   */
  /**
   * A length of track: ballast, sleepers and two steel rails, running along
   * the part's +Z so the direction arrow and the thing it describes agree.
   *
   * The railhead sits at the very top of the cell and the dolly's rollers at
   * the very bottom of theirs, because the two colliders are full cells and
   * are already touching. Drawn any lower, the carriage hangs a third of a
   * metre in the air above a track it is in fact sitting on.
   */
  rail(part) {
    const group = new THREE.Group();
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(CELL - INSET, CELL * 0.3, CELL),
      material(part.colour),
    );
    bed.position.y = -CELL * 0.32;
    group.add(bed);
    // Sleepers across, so a run of them reads as a track rather than as a
    // pair of stripes.
    for (const z of [-0.3, 0.3]) {
      const sleeper = new THREE.Mesh(
        new THREE.BoxGeometry(CELL * 0.84, CELL * 0.14, CELL * 0.18),
        material(0x4c545e),
      );
      sleeper.position.set(0, -CELL * 0.11, z * CELL);
      group.add(sleeper);
    }
    const steel = material(0xd8dde3, { metalness: 0.55, roughness: 0.3 });
    for (const x of [-1, 1]) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(CELL * 0.13, CELL * 0.52, CELL),
        steel,
      );
      line.position.set(x * CELL * 0.28, CELL * 0.22, 0);
      group.add(line);
    }
    return group;
  },

  /**
   * The carriage that runs on it: a body filling its cell the way a block
   * does, on four rollers that reach the floor of that cell and therefore the
   * head of the rail below.
   */
  dolly(part) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(CELL - INSET, CELL * 0.72, CELL - INSET),
      material(part.colour, { metalness: 0.3, roughness: 0.5 }),
    );
    body.position.y = CELL * 0.1;
    group.add(body);
    const steel = material(0xc7ced6, { metalness: 0.6, roughness: 0.25 });
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        const roller = new THREE.Mesh(
          new THREE.CylinderGeometry(CELL * 0.15, CELL * 0.15, CELL * 0.13, 12),
          steel,
        );
        roller.rotation.z = Math.PI / 2;
        roller.position.set(x * CELL * 0.28, -CELL * 0.33, z * CELL * 0.26);
        group.add(roller);
      }
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
  // Reads as a bearing: a fixed collar with a plate riding on it. The split
  // between the two is what tells you it goes round rather than being solid.
  turntable(part) {
    const group = new THREE.Group();
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(CELL * 0.42, CELL * 0.46, CELL * 0.4, 20),
      material(0x3a4049),
    );
    collar.position.y = -CELL * 0.28;
    group.add(collar);

    const race = new THREE.Mesh(
      new THREE.TorusGeometry(CELL * 0.4, CELL * 0.06, 8, 24),
      material(0x8b93a0, { metalness: 0.6, roughness: 0.3 }),
    );
    race.rotation.x = Math.PI / 2;
    race.position.y = -CELL * 0.04;
    group.add(race);

    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(CELL * 0.47, CELL * 0.44, CELL * 0.3, 20),
      material(part.colour),
    );
    plate.position.y = CELL * 0.26;
    group.add(plate);

    // A notch on the plate, so you can see it turning at all.
    const mark = new THREE.Mesh(
      new THREE.BoxGeometry(CELL * 0.1, CELL * 0.32, CELL * 0.5),
      material(0xf0e6ff, { emissive: 0x241b33 }),
    );
    mark.position.set(0, CELL * 0.27, CELL * 0.24);
    group.add(mark);
    return group;
  },

  // A drum with a splined horn on the face of it, turned side on: it reads as
  // a thing that points somewhere, which is what separates it from a hinge.
  positioner(part) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(CELL * 0.62, CELL - INSET, CELL - INSET),
      material(part.colour),
    );
    group.add(body);

    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(CELL * 0.34, CELL * 0.34, CELL * 0.26, 18),
      material(0x2b2f36, { metalness: 0.6, roughness: 0.35 }),
    );
    drum.rotation.z = Math.PI / 2;
    drum.position.x = CELL * 0.38;
    group.add(drum);

    const horn = new THREE.Mesh(
      new THREE.BoxGeometry(CELL * 0.12, CELL * 0.62, CELL * 0.12),
      material(0xdfe6ec, { metalness: 0.7, roughness: 0.2 }),
    );
    horn.position.set(CELL * 0.46, CELL * 0.2, 0);
    group.add(horn);
    return group;
  },

  // A coil round a shaft. The coil is named so the machine can squash it as
  // the strut moves: a spring drawn at a fixed length while the wheel goes up
  // and down is the sort of thing you notice immediately.
  suspension(part) {
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(CELL * 0.12, CELL * 0.12, CELL * 0.9, 12),
      material(0xdfe6ec, { metalness: 0.7, roughness: 0.25 }),
    );
    group.add(shaft);

    const coil = new THREE.Group();
    coil.name = 'coil';
    const turns = 5;
    for (let i = 0; i < turns; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(CELL * 0.3, CELL * 0.055, 6, 14),
        material(part.colour, { metalness: 0.4, roughness: 0.5 }),
      );
      ring.rotation.x = Math.PI / 2;
      // Spread over the middle of the cell, leaving the mounts clear.
      ring.position.y = (i / (turns - 1) - 0.5) * CELL * 0.62;
      coil.add(ring);
    }
    group.add(coil);

    for (const y of [-CELL * 0.42, CELL * 0.42]) {
      const mount = new THREE.Mesh(
        new THREE.BoxGeometry(CELL - INSET, CELL * 0.14, CELL - INSET),
        material(0x6c7686),
      );
      mount.position.y = y;
      group.add(mount);
    }
    return group;
  },

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
  // Named so the studio can take every marker off at once when the machine is
  // being shown rather than built.
  group.name = 'hint';
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
  // A part from a pack may ask to be drawn as something the game already
  // draws. `hasOwn` because the name came from a stranger and `BUILDERS.toString`
  // is a function too.
  const asked = part.look && Object.hasOwn(BUILDERS, part.look) ? BUILDERS[part.look] : null;
  const build = asked ?? BUILDERS[part.id] ?? shell;
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
    const hint = workingAxis(part, options.rot ?? IDENTITY_ORIENTATION);
    if (hint) object.add(directionArrow(hint.axis, HINT_COLOUR[hint.kind]));
    // A hinge has no direction, it has a plane, so it gets the plane instead.
    // Wheels are revolute too but got the arrow above: a ring round a wheel
    // looks like the wheel.
    if (part.joint === 'revolute' && !part.radius) object.add(hingeRing(part.axis));
  }
  return object;
}

export function makeGhost(part, rot = IDENTITY_ORIENTATION) {
  const object = createPartMesh(part, { hints: true, rot });
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
