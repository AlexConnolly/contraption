import * as THREE from 'three';
import { GROUP_WORLD } from './machine.js';
import { makeRng, randomSeed, between } from './rng.js';
import { setTag, clearTag } from './tags.js';
import { gustAt } from './world.js';
import { tagColour } from '../challenges/palette.js';

// Props are authored with a mass in kilograms; Rapier wants a density.
function propVolume(prop) {
  return prop.radius
    ? (4 / 3) * Math.PI * prop.radius ** 3
    : prop.size[0] * prop.size[1] * prop.size[2];
}

/**
 * Below this a surface is ice, and it has to look like ice.
 *
 * A frictionless floor is invisible: it is the same grey as every other
 * floor, and the first a player knows about it is the machine sliding past
 * the goal. A constraint you cannot see before you meet it reads as the game
 * being broken rather than as a puzzle, so slippery surfaces are painted.
 */
export const ICY = 0.25;
// How still two magnetic loads have to be, relative to each other, before
// they take hold, and how close counts as touching.
const MAGNET_SETTLE = 0.9;
const MAGNET_GAP = 0.04;
// How much of the gap between two loads has to be vertical before one counts
// as being on the other rather than beside it. Well under half, because a load
// still settling has not dropped the last few centimetres yet.
const MAGNET_UPRIGHT = 0.6;

/**
 * Whether one load is stacked on the other, rather than merely touching it.
 *
 * A magnet meant "anything you brush against", which is not what a magnet is
 * for here. A load carried past the tower and grazing its side stuck to it, so
 * did one nudged into the pile edge-on, and so did one balanced on a corner
 * with most of itself hanging over nothing.
 *
 * Stacked on has a direction and a footprint: most of the distance between the
 * two has to be vertical, and the upper one's middle has to be over the lower
 * one rather than out past its edge. Inside its edge is generous -- for a
 * ninety-centimetre load that forgives forty-five of placement error, three
 * times what the tower actually needs -- and outside it is not a stack.
 */
function stackedOn(one, other) {
  const a = one.body.translation();
  const b = other.body.translation();
  const rise = Math.abs(a.y - b.y);
  const stack = (one.spec.size[1] + other.spec.size[1]) / 2;
  if (rise < stack * MAGNET_UPRIGHT) return false;

  const low = a.y >= b.y ? other : one;
  const across = Math.hypot(a.x - b.x, a.z - b.z);
  return across <= Math.min(low.spec.size[0], low.spec.size[2]) / 2;
}
// What a load that takes hold of its neighbours is edged in.
const MAGNET_MARK = 0xf0a825;

function surfaceMaterial({ colour, belt, friction }) {
  if (friction !== undefined && friction < ICY) {
    return new THREE.MeshStandardMaterial({
      color: 0xbfe4f2,
      roughness: 0.06,
      metalness: 0.35,
      emissive: 0x16323f,
    });
  }
  // A belt reads as rubber rather than as more floor, and takes a little of
  // its own colour so a sorting bay's lanes can be told apart at a glance.
  return new THREE.MeshStandardMaterial({
    color: colour,
    roughness: belt ? 0.98 : 0.85,
    metalness: 0.05,
    emissive: belt ? new THREE.Color(colour).multiplyScalar(0.22) : 0x000000,
  });
}

/**
 * The chevron a belt is painted with, drawn once and shared.
 *
 * A conveyor with no markings on it is a coloured slab: the crate on it moves
 * and the belt does not, so what a player sees is a crate sliding about on its
 * own. The arrows are the only thing that says the floor is what is moving.
 *
 * Nothing to draw on in Node, where the sim runs headless in the tests, so the
 * markings are simply left off.
 */
let chevron = null;

function chevronTexture() {
  if (chevron !== null) return chevron;
  if (typeof document === 'undefined') {
    chevron = false;
    return chevron;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ink = canvas.getContext('2d');
  ink.lineCap = 'butt';
  ink.lineJoin = 'miter';
  // Pointing at the top of the tile, which is the +V end, with a clear gap
  // below it so a run of them reads as a dashed arrow rather than a zigzag.
  // Drawn twice: a dark pass under a light one, so the arrow holds its edge
  // against a pale belt as well as a dark one.
  const stroke = (width, colour) => {
    ink.strokeStyle = colour;
    ink.lineWidth = width;
    ink.beginPath();
    ink.moveTo(16, 84);
    ink.lineTo(64, 34);
    ink.lineTo(112, 84);
    ink.stroke();
  };
  stroke(30, 'rgba(10, 14, 20, 0.55)');
  stroke(18, 'rgba(255, 255, 255, 0.95)');

  chevron = new THREE.CanvasTexture(canvas);
  chevron.wrapS = THREE.ClampToEdgeWrapping;
  chevron.wrapT = THREE.RepeatWrapping;
  chevron.anisotropy = 8;
  return chevron;
}

/** How much belt one chevron covers. */
const CHEVRON = 1.4;

/**
 * Arrows on the top of a belt, laid on as a separate sheet rather than as a
 * face of the box: the box's own faces would need the texture turned to match
 * whichever way the belt happens to run, and a sheet can simply be pointed.
 */
function beltMarkings(scene, piece, dir, speed) {
  const base = chevronTexture();
  if (!base) return null;

  // A right-handed frame with the sheet's V along the belt and its face
  // pointing up. Taken the other way round it is a reflection, not a rotation,
  // and the sheet ends up inside out and invisible.
  const forward = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const up = Math.abs(forward.y) > 0.95
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const lift = new THREE.Vector3().crossVectors(right, forward).normalize();

  // The box measured along the two directions that matter. No shipped belt is
  // turned, so this takes the piece's size as it stands.
  const { size } = piece;
  const reach = (v) => Math.abs(v.x) * size[0] + Math.abs(v.y) * size[1] + Math.abs(v.z) * size[2];
  const along = reach(forward);
  const across = reach(right);

  const texture = base.clone();
  texture.needsUpdate = true;
  texture.repeat.set(1, Math.max(1, Math.round(along / CHEVRON)));

  const mesh = new THREE.Mesh(
    // Short of the edges, so it reads as paint on the belt rather than as a
    // second surface sitting on top of it.
    // Capped as well as proportional: on a nine-metre belt, arrows that span
    // it are squat slabs, and a strip down the middle reads as a lane marking,
    // which is what a conveyor actually looks like.
    new THREE.PlaneGeometry(Math.min(across * 0.72, 2.8), along * 0.98),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  mesh.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, forward, lift),
  );
  mesh.position
    .set(piece.pos[0], piece.pos[1], piece.pos[2])
    .addScaledVector(lift, size[1] / 2 + 0.012);
  mesh.renderOrder = 1;
  scene.add(mesh);
  return { mesh, texture, speed };
}

function fixedBox(RAPIER, world, scene, piece) {
  const { pos, size, rotX = 0, rotY = 0, colour, belt, friction } = piece;
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0));
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(pos[0], pos[1], pos[2])
      .setRotation(quaternion),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      // A surface can be as slippery as the level wants. Near zero is ice,
      // and ice is a whole level on its own: steering stops working and you
      // plan a line instead of correcting your way along one.
      .setFriction(friction ?? (belt ? 1.4 : 0.95))
      .setCollisionGroups(GROUP_WORLD),
    body,
  );
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    surfaceMaterial({ colour, belt, friction }),
  );
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.quaternion.copy(quaternion);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { body, mesh, collider };
}

/**
 * Builds one level's world: ground, fixed scenery, the dynamic props an
 * objective tracks, and the translucent goal zones.
 */
export class Arena {
  constructor({ RAPIER, world, scene, level, seed }) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.scene = scene;
    this.level = level;
    this.seed = seed ?? randomSeed();
    this.objects = [];
    this.props = new Map();
    this.plates = new Map();
    this.shots = [];
    this.magnets = [];
    this.magnetOf = new Map();
    this.welded = new Set();
    this.joints = [];
    this.welds = 0;
    this.opponents = new Map();
    this.movers = [];
    this.belts = [];
    this.beltMarks = [];
    this.winds = [];
    this.elapsed = 0;
    this.build();
  }

  build() {
    const { RAPIER, world, scene, level } = this;

    // Fog is the level closing the view down, so it belongs to the level and
    // is put back the way it was found when the course is torn down.
    this.fogBefore = scene.fog;
    if (level.fog) {
      scene.fog = new THREE.Fog(
        level.fog.colour ?? 0x0b0f14,
        level.fog.near ?? 1,
        level.fog.far ?? 14,
      );
    }

    const groundY = level.groundY ?? 0;
    const half = (level.groundSize ?? 120) / 2;

    const groundBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, groundY - 1, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, 1, half)
        .setFriction(level.friction ?? 1)
        .setCollisionGroups(GROUP_WORLD),
      groundBody,
    );
    const groundMesh = new THREE.Mesh(
      new THREE.BoxGeometry(half * 2, 2, half * 2),
      surfaceMaterial({ colour: 0x3c434d, friction: level.friction }),
    );
    groundMesh.position.set(0, groundY - 1, 0);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
    this.objects.push({ body: groundBody, mesh: groundMesh });
    // Kept, so a rule can say "touch nothing" and still mean "except the
    // floor you are driving on".
    this.ground = groundBody;

    const grid = new THREE.GridHelper(half * 2, half, 0x5a6470, 0x4a515b);
    grid.position.y = groundY + 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    scene.add(grid);
    this.objects.push({ mesh: grid });

    for (const piece of level.pieces ?? []) {
      const built = fixedBox(RAPIER, world, scene, piece);
      this.objects.push(built);
      if (piece.belt) {
        const [dx, dy, dz] = piece.belt.dir;
        const length = Math.hypot(dx, dy, dz) || 1;
        const dir = [dx / length, dy / length, dz / length];
        const speed = piece.belt.speed ?? 2;
        this.belts.push({ collider: built.collider, dir, speed });
        const marks = beltMarkings(scene, piece, dir, speed);
        if (marks) this.beltMarks.push(marks);
      }
    }
    for (const hoop of level.hoops ?? []) this.addHoop(hoop);
    this.shuffleStarts();
    for (const prop of level.props ?? []) this.addProp(prop);
    for (const stack of level.stacks ?? []) this.addStack(stack);
    for (const launcher of level.launchers ?? []) this.addLauncher(launcher);
    for (const mover of level.movers ?? []) this.addMover(mover);
    for (const rival of level.opponents ?? []) this.addOpponent(rival);
    for (const plate of level.plates ?? []) this.addPlate(plate);
    for (const zone of level.zones ?? []) this.addZone(zone);
    for (const zone of level.keepout ?? []) this.addKeepOut(zone);
    for (const wind of level.wind ?? []) this.addWind(wind);
  }

  /**
   * Streaks drifting through a wind volume.
   *
   * Wind is otherwise completely invisible: the machine gets shoved sideways
   * by nothing at all, which reads as the physics being broken rather than as
   * weather. These say where the volume is and which way it blows, and they
   * speed up and slow down with the gust, so a player can see a lull coming
   * and go then.
   *
   * Lines rather than particles because they are one draw call, they carry
   * direction in their own shape, and nothing has to be sorted.
   */
  addWind(wind, count = 90) {
    const [dx, dy, dz] = wind.dir ?? [1, 0, 0];
    const length = Math.hypot(dx, dy, dz) || 1;
    const dir = [dx / length, dy / length, dz / length];
    const rng = makeRng(this.seed + 104729);
    const [hx, hy, hz] = wind.size.map((n) => n / 2);

    // Spread across the flow, not along it: the travel below supplies the
    // position down the wind, and seeding that axis as well would carry
    // streaks a full half-volume outside the box they are describing.
    const seeds = [];
    for (let i = 0; i < count; i += 1) {
      const at = [
        between(rng, -hx, hx),
        between(rng, -hy, hy),
        between(rng, -hz, hz),
      ];
      const along = at[0] * dir[0] + at[1] * dir[1] + at[2] * dir[2];
      seeds.push([
        at[0] - dir[0] * along,
        at[1] - dir[1] * along,
        at[2] - dir[2] * along,
      ]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(count * 6), 3),
    );
    const mesh = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xbcd8e6,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
    mesh.position.set(wind.pos[0], wind.pos[1], wind.pos[2]);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.objects.push({ mesh });
    this.winds.push({ wind, dir, seeds, geometry, half: [hx, hy, hz], drift: 0 });
  }

  // Advances the streaks. The span they travel is the volume's own size, so
  // they wrap inside it rather than leaking out of the edges.
  driftWind(dt) {
    for (const entry of this.winds) {
      const { dir, seeds, geometry, half } = entry;
      // Well below the force in metres per second — fast enough to read as
      // moving air, slow enough not to strobe.
      const speed = Math.abs(gustAt(this.elapsed, entry.wind)) * 0.06;
      entry.drift += speed * dt;

      const span = Math.abs(dir[0]) * half[0] * 2
        + Math.abs(dir[1]) * half[1] * 2
        + Math.abs(dir[2]) * half[2] * 2;
      const reach = span || 1;
      const tail = Math.min(1.6, reach * 0.08);
      const at = geometry.getAttribute('position');

      for (let i = 0; i < seeds.length; i += 1) {
        const seed = seeds[i];
        // Each streak starts somewhere different along the run, so they do not
        // all cross the volume in step.
        const travel = ((entry.drift + (i / seeds.length) * reach) % reach) - reach / 2;
        const x = seed[0] + dir[0] * travel;
        const y = seed[1] + dir[1] * travel;
        const z = seed[2] + dir[2] * travel;
        at.setXYZ(i * 2, x, y, z);
        at.setXYZ(i * 2 + 1, x - dir[0] * tail, y - dir[1] * tail, z - dir[2] * tail);
      }
      at.needsUpdate = true;
      geometry.computeBoundingSphere();
    }
  }

  /**
   * A ring you have to put something through. Rapier has no torus, so the rim
   * is a circle of small boxes — it has to be real geometry rather than a
   * marker, or a payload can simply be shoved in through the side and the
   * whole problem evaporates.
   */
  addHoop(hoop) {
    const { RAPIER, world, scene } = this;
    const radius = hoop.radius ?? 1.4;
    const thickness = hoop.thickness ?? 0.16;
    const segments = hoop.segments ?? 16;
    const axis = new THREE.Vector3(...(hoop.axis ?? [0, 0, 1])).normalize();
    const frame = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(hoop.pos[0], hoop.pos[1], hoop.pos[2]),
    );
    const step = (Math.PI * 2) / segments;
    // Each box spans one segment of the rim, tilted to sit along the circle.
    const chord = radius * Math.tan(step / 2) * 1.05;
    for (let i = 0; i < segments; i += 1) {
      const angle = i * step;
      const local = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      const spin = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle + Math.PI / 2)
        .premultiply(frame);
      local.applyQuaternion(frame);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(thickness, chord, thickness)
          .setTranslation(local.x, local.y, local.z)
          .setRotation({ x: spin.x, y: spin.y, z: spin.z, w: spin.w })
          .setFriction(0.5)
          .setRestitution(0.2)
          .setCollisionGroups(GROUP_WORLD),
        body,
      );
    }

    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(radius, thickness, 10, 32),
      new THREE.MeshStandardMaterial({
        color: hoop.colour ?? 0xf0a825,
        roughness: 0.5,
        metalness: 0.35,
        emissive: 0x3a2606,
      }),
    );
    mesh.position.set(hoop.pos[0], hoop.pos[1], hoop.pos[2]);
    mesh.quaternion.copy(frame);
    mesh.castShadow = true;
    scene.add(mesh);

    // A faint disc across the opening, so the target reads from a distance.
    const net = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.75, 28),
      new THREE.MeshBasicMaterial({
        color: hoop.colour ?? 0xf0a825,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    net.position.copy(mesh.position);
    net.quaternion.copy(frame);
    scene.add(net);

    this.objects.push({ body, mesh }, { mesh: net });
  }

  /**
   * Deals the starting places of a set of props out among themselves.
   *
   * What moves is where a crate starts, never what it is: a crate keeps its
   * label, so there is still something to sort it by, but knowing that the
   * left-hand one was red last time tells you nothing. A program has to look.
   */
  shuffleStarts() {
    this.starts = new Map();
    for (const [index, group] of (this.level.shuffle ?? []).entries()) {
      const rng = makeRng(this.seed + (index + 1) * 104729);
      const places = group
        .map((id) => (this.level.props ?? []).find((p) => p.id === id))
        .filter(Boolean)
        .map((prop) => [...prop.pos]);
      // Fisher-Yates, so every arrangement is as likely as any other and each
      // starting place is used exactly once.
      for (let i = places.length - 1; i > 0; i -= 1) {
        const j = Math.floor(between(rng, 0, i + 1)) % (i + 1);
        [places[i], places[j]] = [places[j], places[i]];
      }
      group.forEach((id, at) => {
        if (places[at]) this.starts.set(id, places[at]);
      });
    }
  }

  startOf(prop) {
    return this.starts?.get(prop.id) ?? prop.pos;
  }

  addProp(prop) {
    const { RAPIER, world, scene } = this;
    const start = this.startOf(prop);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(start[0], start[1], start[2])
        .setLinearDamping(prop.damping ?? 0.2)
        .setAngularDamping(prop.angularDamping ?? 0.4)
        // A big heavy prop can cover more ground between steps than the floor
        // is thick, and go straight through it. Continuous collision costs
        // something, so it is asked for rather than assumed.
        .setCcdEnabled(prop.ccd ?? false),
    );
    const desc = prop.radius
      ? RAPIER.ColliderDesc.ball(prop.radius)
      : RAPIER.ColliderDesc.cuboid(prop.size[0] / 2, prop.size[1] / 2, prop.size[2] / 2);
    const collider = world.createCollider(
      desc.setDensity(prop.mass / propVolume(prop))
        .setFriction(prop.friction ?? 0.85)
        .setRestitution(0.05)
        .setCollisionGroups(GROUP_WORLD),
      body,
    );
    // What a sensor pointed at this reads back, so a machine can sort one
    // crate from another without a part dedicated to it.
    setTag(world, collider, prop.tag);
    const geometry = prop.radius
      ? new THREE.SphereGeometry(prop.radius, 24, 16)
      : new THREE.BoxGeometry(prop.size[0], prop.size[1], prop.size[2]);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: prop.colour, roughness: 0.7, metalness: 0.1 }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    // Amber edges on anything magnetic. A player has no way to tell a load
    // that will hold on to its neighbours from an ordinary crate, and amber is
    // the one colour the game has not already spent on telling you off: red is
    // a keep-out, green is a goal, cyan is a rule. Here it means "this one
    // does something".
    if (prop.magnetic && !this.headless) {
      const rim = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: MAGNET_MARK }),
      );
      mesh.add(rim);
    }
    this.props.set(prop.id, { spec: prop, body, mesh });
    if (prop.magnetic) {
      const magnet = {
        id: prop.id, body, collider, spec: prop,
      };
      this.magnets.push(magnet);
      this.magnetOf.set(collider.handle, magnet);
    }
    this.objects.push({ body, mesh, collider });
  }

  /**
   * A heap of loose blocks from one line of level data.
   *
   * A rockfall across a road, a jenga bridge, a yard of scrap are all the same
   * thing with different numbers, and writing forty props by hand for each of
   * them would be unreadable. Where each block lands is drawn from the run
   * seed, so a heap is repeatable when a test wants it and different when a
   * player is looking at it: you cannot learn one arrangement and replay it.
   */
  addStack(stack) {
    const rng = makeRng(
      this.seed + [...String(stack.id)].reduce((a, c) => a + c.charCodeAt(0), 0) * 15485863,
    );
    const [sx, sy, sz] = stack.spread ?? [2, 1, 2];
    for (let i = 0; i < (stack.count ?? 1); i += 1) {
      this.addProp({
        id: `${stack.id}-${i}`,
        pos: [
          stack.pos[0] + between(rng, -sx / 2, sx / 2),
          stack.pos[1] + between(rng, 0, sy),
          stack.pos[2] + between(rng, -sz / 2, sz / 2),
        ],
        size: stack.size ?? [0.6, 0.6, 0.6],
        mass: stack.mass ?? 2,
        colour: stack.colour ?? 0x9a8b72,
        friction: stack.friction,
        tag: stack.tag,
        stack: stack.id,
      });
    }
  }

  /**
   * A machine that is not yours, driving a route of its own.
   *
   * Dynamic rather than kinematic, which is the whole point: a scripted body
   * that cannot be moved is scenery, and half of what these are for is being
   * shoved. It steers by pulling its own velocity towards where it wants to
   * go, so a heavy enough machine can hold it up, knock it off line or push it
   * out of a ring, and it will keep trying to get back on route.
   */
  addOpponent(spec) {
    const { RAPIER, world, scene } = this;
    const size = spec.size ?? [2, 1.2, 3];
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spec.pos[0], spec.pos[1], spec.pos[2])
        .setLinearDamping(0.2)
        .setAngularDamping(1.2),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
        .setDensity((spec.mass ?? 120) / (size[0] * size[1] * size[2]))
        // Low, because it is meant to be driving on wheels rather than
        // dragging a crate along the floor. High friction here fights the
        // steering hard enough that it never reaches the speed it was given.
        .setFriction(spec.friction ?? 0.3)
        .setRestitution(0.02)
        .setCollisionGroups(GROUP_WORLD),
      body,
    );
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size[0], size[1], size[2]),
      new THREE.MeshStandardMaterial({
        color: spec.colour ?? 0xd6544a,
        roughness: 0.55,
        metalness: 0.2,
        emissive: 0x2a0b08,
      }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const rival = {
      spec,
      body,
      mesh,
      route: (spec.route ?? [spec.pos]).map((at) => [...at]),
      at: Math.min(1, (spec.route ?? [spec.pos]).length - 1),
      way: 1,
      speed: spec.speed ?? 3,
    };
    this.opponents.set(spec.id, rival);
    this.objects.push({ body, mesh, collider });
  }

  /**
   * Steers every opponent towards its next waypoint. Pulling the velocity
   * rather than setting it, the same way a belt does, so being leaned on by
   * something heavy actually slows it down instead of being ignored.
   */
  /**
   * The arrows travelling along a belt at the belt's own speed.
   *
   * Cosmetic, and the one thing that makes a conveyor read as a conveyor.
   * Scrolled by time rather than set from a clock so that a level which is
   * paused or stepped by hand looks right.
   */
  scrollBelts(dt) {
    for (const mark of this.beltMarks) {
      // Down the V axis, because the sheet's V runs along the belt and the
      // pattern travels the opposite way to the offset.
      mark.texture.offset.y -= (mark.speed * dt) / CHEVRON;
    }
  }

  driveOpponents() {
    const REACHED = 1.4;
    // Firm enough to hold its speed against the ground, soft enough that
    // leaning on it with something heavy actually tells.
    const GRIP = 0.25;
    for (const rival of this.opponents.values()) {
      if (rival.route.length < 2) continue;
      const t = rival.body.translation();
      const target = rival.route[rival.at];
      const dx = target[0] - t.x;
      const dz = target[2] - t.z;
      const away = Math.hypot(dx, dz);
      if (away < REACHED) {
        // Walk the route and turn round at the end rather than snapping back
        // to the start, so a patrol looks like a patrol.
        const next = rival.at + rival.way;
        if (next >= rival.route.length || next < 0) {
          rival.way *= -1;
          rival.at += rival.way;
        } else {
          rival.at = next;
        }
        continue;
      }
      const v = rival.body.linvel();
      const wantX = (dx / away) * rival.speed;
      const wantZ = (dz / away) * rival.speed;
      rival.body.setLinvel(
        { x: v.x + (wantX - v.x) * GRIP, y: v.y, z: v.z + (wantZ - v.z) * GRIP },
        true,
      );
    }
  }

  /**
   * How hard a wind volume is blowing right now. Exposed so a test can watch
   * it breathe rather than having to infer it from where a crate ended up.
   */
  windAt(elapsed, wind) {
    return gustAt(elapsed, wind);
  }

  /**
   * Blows everything inside a wind volume along.
   *
   * An impulse rather than a force, and that is not a detail: a machine
   * clears its own forces at the top of every update, so a force added here
   * would be wiped before it did anything at all. An impulse goes straight
   * into the velocity and survives.
   *
   * It is still scaled by mass, which is the entire point of the mechanic —
   * a light drone gets blown about and a heavy rover barely notices, so the
   * machine that has solved everything so far is the wrong answer here.
   */
  driveWind(dt) {
    const winds = this.level.wind ?? [];
    if (winds.length === 0) return;
    for (const wind of winds) {
      const strength = gustAt(this.elapsed, wind);
      if (!strength) continue;
      const [dx, dy, dz] = wind.dir ?? [1, 0, 0];
      const length = Math.hypot(dx, dy, dz) || 1;
      const [hx, hy, hz] = wind.size.map((n) => n / 2);
      this.world.forEachRigidBody((body) => {
        if (!body.isDynamic()) return;
        const t = body.translation();
        if (Math.abs(t.x - wind.pos[0]) > hx) return;
        if (Math.abs(t.y - wind.pos[1]) > hy) return;
        if (Math.abs(t.z - wind.pos[2]) > hz) return;
        const push = (strength * dt) / length;
        body.applyImpulse({ x: dx * push, y: dy * push, z: dz * push }, true);
      });
    }
  }

  opponentPosition(id) {
    const rival = this.opponents.get(id);
    if (!rival) return null;
    const t = rival.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /**
   * An obstacle that slides back and forth across the course. Its speed,
   * starting point and direction are drawn fresh for every run, so a program
   * cannot be written against a timetable — it has to look where it is going.
   */
  /**
   * Movers sharing a `group` slide together off one set of numbers, so a pair
   * of panels can hold a gap between them at a fixed width while the gap
   * itself wanders.
   */
  motionFor(spec) {
    const key = spec.group ?? `solo-${this.movers.length}`;
    if (!this.motions) this.motions = new Map();
    if (!this.motions.has(key)) {
      const rng = makeRng(this.seed + [...key].reduce((a, c) => a + c.charCodeAt(0), 0) * 7919);
      const [slow, fast] = spec.speed ?? [0.8, 1.9];
      // Which way it sets off varies, but it always sets off from where the
      // level drew it. A free phase put a moving tray anywhere along its run
      // at the instant the level loaded, while whatever was riding on it was
      // placed where the level said — so the load could start beside its tray
      // rather than on it, and be gone before the player touched anything.
      this.motions.set(key, {
        rate: between(rng, slow, fast),
        offset: rng() < 0.5 ? 0 : Math.PI,
      });
    }
    return this.motions.get(key);
  }

  /**
   * A cannon, and the loads it has in it.
   *
   * Everything it will fire already exists as an ordinary prop; until its turn
   * comes it is parked well under the course with its velocity held at zero,
   * which keeps it out of the physics and out of the way rather than needing a
   * body created mid-run. Firing is a teleport to the muzzle and a shove.
   */
  addLauncher(spec) {
    const { scene } = this;
    const aim = new THREE.Vector3(...spec.aim).normalize();
    const at = new THREE.Vector3(...spec.pos);

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.5, 1.8, 16),
      new THREE.MeshStandardMaterial({ color: spec.colour, roughness: 0.5, metalness: 0.45 }),
    );
    barrel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), aim);
    barrel.position.copy(at);
    barrel.castShadow = true;
    scene.add(barrel);
    this.objects.push({ mesh: barrel });

    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.62, 0.3, 16),
      new THREE.MeshStandardMaterial({ color: 0x2b323b, roughness: 0.6, metalness: 0.3 }),
    );
    collar.quaternion.copy(barrel.quaternion);
    collar.position.copy(at).addScaledVector(aim, -0.5);
    scene.add(collar);
    this.objects.push({ mesh: collar });

    const muzzle = at.clone().addScaledVector(aim, 1.1);
    spec.balls.forEach((id, i) => {
      this.shots.push({
        ball: id,
        at: spec.first + i * spec.gap,
        muzzle,
        velocity: aim.clone().multiplyScalar(spec.speed),
        fired: false,
      });
    });
  }

  /**
   * Holds everything still waiting its turn out of play, and fires whatever is
   * due. A shot is one teleport and one velocity: after that it is an ordinary
   * prop falling like any other.
   */
  driveShots() {
    for (const shot of this.shots) {
      const prop = this.props.get(shot.ball);
      if (!prop) continue;
      if (shot.fired) continue;
      if (this.elapsed < shot.at) {
        prop.body.setTranslation({ x: shot.muzzle.x, y: -60, z: shot.muzzle.z }, true);
        prop.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        prop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        continue;
      }
      prop.body.setTranslation(shot.muzzle, true);
      prop.body.setLinvel(shot.velocity, true);
      shot.fired = true;
    }
  }

  /** Which loads are in play: fired, and not still sitting in a cannon. */
  liveProps() {
    if (this.shots.length === 0) return this.propStates();
    const waiting = new Set(this.shots.filter((s) => !s.fired).map((s) => s.ball));
    return this.propStates().filter((p) => !waiting.has(p.id));
  }

  /** How many shots are still to come, for a level that wants to say so. */
  shotsLeft() {
    return this.shots.filter((s) => !s.fired).length;
  }

  /**
   * Loads that take hold of each other.
   *
   * Stacking is a test of placement accuracy long before it is a test of the
   * machine, and a tower that comes down because the sixth load went on four
   * centimetres out is not the puzzle anybody wanted. Magnetic loads latch
   * where they meet, so the question goes back to being how you get a load up
   * there rather than how steady your hand was.
   *
   * They only latch once they have stopped moving relative to one another.
   * Without that a load flung past its neighbour welds itself on at whatever
   * angle it happened to arrive at, and the tower grows sideways.
   */
  driveMagnets() {
    if (this.magnets.length < 2) return;
    for (const magnet of this.magnets) {
      this.world.contactPairsWith(magnet.collider, (other) => {
        const mate = this.magnetOf.get(other.handle);
        if (!mate || mate.id === magnet.id) return;
        const pair = magnet.id < mate.id ? `${magnet.id}|${mate.id}` : `${mate.id}|${magnet.id}`;
        if (this.welded.has(pair)) return;

        const a = magnet.body.linvel();
        const b = mate.body.linvel();
        const drift = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        if (drift > MAGNET_SETTLE) return;
        if (!stackedOn(magnet, mate)) return;

        let touching = false;
        this.world.contactPair(magnet.collider, other, (manifold) => {
          for (let i = 0; i < manifold.numContacts(); i += 1) {
            if (manifold.contactDist(i) <= MAGNET_GAP) {
              touching = true;
              return;
            }
          }
        });
        if (!touching) return;
        this.weld(magnet, mate, pair);
      });
    }
  }

  /** Locks two loads together exactly where they are. */
  weld(magnet, mate, pair) {
    const here = magnet.body.translation();
    const there = mate.body.translation();
    const mid = {
      x: (here.x + there.x) / 2,
      y: (here.y + there.y) / 2,
      z: (here.z + there.z) / 2,
    };
    const local = (body) => {
      const t = body.translation();
      const q = body.rotation();
      return new THREE.Vector3(mid.x - t.x, mid.y - t.y, mid.z - t.z)
        .applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w).invert());
    };
    const qa = magnet.body.rotation();
    const qb = mate.body.rotation();
    const frame = new THREE.Quaternion(qb.x, qb.y, qb.z, qb.w)
      .invert()
      .multiply(new THREE.Quaternion(qa.x, qa.y, qa.z, qa.w));
    const params = this.RAPIER.JointData.fixed(
      local(magnet.body), { x: 0, y: 0, z: 0, w: 1 },
      local(mate.body), {
        x: frame.x, y: frame.y, z: frame.z, w: frame.w,
      },
    );
    this.joints.push(this.world.createImpulseJoint(params, magnet.body, mate.body, true));
    this.welded.add(pair);
    this.welds += 1;
  }

  addMover(spec) {
    const { RAPIER, world, scene } = this;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(spec.pos[0], spec.pos[1], spec.pos[2]),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(spec.size[0] / 2, spec.size[1] / 2, spec.size[2] / 2)
        .setFriction(0.6)
        .setCollisionGroups(GROUP_WORLD),
      body,
    );
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2]),
      new THREE.MeshStandardMaterial({
        color: spec.colour ?? 0xb4603f,
        roughness: 0.6,
        metalness: 0.15,
        emissive: 0x2a0f08,
      }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const motion = this.motionFor(spec);
    this.movers.push({
      spec,
      body,
      mesh,
      axis: spec.axis ?? 'x',
      span: spec.span ?? 4,
      rate: motion.rate,
      offset: motion.offset,
    });
    this.objects.push({ body, mesh });
  }

  /**
   * Rapier has no conveyor surface, so a belt is a plain fixed box that drags
   * whatever is resting on it. Every step it looks at what it is touching and
   * pulls that body's speed along the belt towards the belt's own.
   *
   * Pulling rather than setting: a crate keeps its own falling and sliding,
   * and anything driving against the belt can still fight it. `GRIP` is how
   * much of the difference is taken each step — high enough to get up to belt
   * speed in a few frames, low enough that landing on one is not a smack.
   */
  driveBelts() {
    const GRIP = 0.3;
    for (const belt of this.belts) {
      const [dx, dy, dz] = belt.dir;
      this.world.contactPairsWith(belt.collider, (other) => {
        const body = other.parent();
        if (!body || !body.isDynamic()) return;
        const v = body.linvel();
        const along = v.x * dx + v.y * dy + v.z * dz;
        const change = (belt.speed - along) * GRIP;
        body.setLinvel(
          { x: v.x + dx * change, y: v.y + dy * change, z: v.z + dz * change },
          true,
        );
      });
    }
  }

  // Called once per physics step, before the world advances, so the obstacle
  // is where the sensors will see it.
  step(dt) {
    this.elapsed += dt;
    this.driveShots();
    this.driveMagnets();
    this.driveBelts();
    this.scrollBelts(dt);
    this.driveOpponents();
    this.driveWind(dt);
    this.driftWind(dt);
    for (const mover of this.movers) {
      const travel = Math.sin(this.elapsed * mover.rate + mover.offset) * mover.span;
      const at = [...mover.spec.pos];
      const index = { x: 0, y: 1, z: 2 }[mover.axis];
      at[index] += travel;
      mover.body.setNextKinematicTranslation({ x: at[0], y: at[1], z: at[2] });
    }
  }

  /**
   * Somewhere the machine may not go, airspace included. Drawn as a red cage
   * rather than a tinted box: it has to read as a wall from across the course,
   * because flying into one ends the run.
   */
  addKeepOut(zone) {
    const geometry = new THREE.BoxGeometry(zone.size[0], zone.size[1], zone.size[2]);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0xf0463a,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.set(zone.pos[0], zone.pos[1], zone.pos[2]);
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0xff5a4a }),
    );
    mesh.add(frame);
    this.scene.add(mesh);
    this.objects.push({ mesh });
  }

  /**
   * A pressure plate: a slab you can drive onto, ringed in the colour of
   * whatever it wants standing on it. The ring is the whole readout — it lifts
   * to full brightness while the plate is down, so a machine spanning three of
   * them can be read at a glance rather than off the objective list.
   */
  addPlate(plate) {
    const colour = tagColour(plate.tag);
    const [w, h, d] = plate.size;
    const built = fixedBox(this.RAPIER, this.world, this.scene, {
      pos: plate.pos,
      size: plate.size,
      colour: 0x2b323b,
    });
    this.objects.push(built);

    const face = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.82, 0.06, d * 0.82),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.35 }),
    );
    face.position.set(plate.pos[0], plate.pos[1] + h / 2 + 0.04, plate.pos[2]);
    this.scene.add(face);
    this.objects.push({ mesh: face });

    const ring = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.5 }),
    );
    ring.position.set(plate.pos[0], plate.pos[1], plate.pos[2]);
    this.scene.add(ring);
    this.objects.push({ mesh: ring });

    this.plates.set(plate.id, { spec: plate, face, ring });
  }

  /** Lights the plates that are down. Driven off the objective report. */
  showPlates(objectives = []) {
    for (const entry of objectives) {
      const plate = entry.plate ? this.plates.get(entry.plate) : null;
      if (!plate) continue;
      // Lit while something is on it, not only once the hold has run out:
      // seeing the far end come on as an arm settles is the whole readout.
      const down = entry.done || entry.progress > 0;
      plate.face.material.opacity = down ? 0.85 : 0.35;
      plate.ring.material.opacity = down ? 1 : 0.5;
    }
  }

  /** Every loose prop, with the tag it carries and where it is now. */
  propStates() {
    const out = [];
    for (const [id, prop] of this.props) {
      const t = prop.body.translation();
      out.push({ id, tag: prop.spec.tag ?? 0, point: { x: t.x, y: t.y, z: t.z } });
    }
    return out;
  }

  addZone(zone) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(zone.size[0], zone.size[1], zone.size[2]),
      new THREE.MeshBasicMaterial({
        color: zone.colour,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      }),
    );
    mesh.position.set(zone.pos[0], zone.pos[1], zone.pos[2]);
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: zone.colour }),
    );
    mesh.add(frame);
    this.scene.add(mesh);
    this.objects.push({ mesh });
  }

  propPosition(id) {
    const prop = this.props.get(id);
    if (!prop) return null;
    const t = prop.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  reset() {
    this.elapsed = 0;
    this.seed = randomSeed();
    this.motions = new Map();
    for (const mover of this.movers) {
      const motion = this.motionFor(mover.spec);
      mover.rate = motion.rate;
      mover.offset = motion.offset;
    }
    // A fresh seed means a fresh deal, so a retry is a new arrangement.
    this.shuffleStarts();
    for (const { spec, body } of this.props.values()) {
      const start = this.startOf(spec);
      body.setTranslation({ x: start[0], y: start[1], z: start[2] }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    for (const rival of this.opponents.values()) {
      const { pos } = rival.spec;
      rival.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
      rival.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      rival.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rival.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      rival.at = Math.min(1, rival.route.length - 1);
      rival.way = 1;
    }
  }

  sync() {
    for (const mover of this.movers) {
      const t = mover.body.translation();
      mover.mesh.position.set(t.x, t.y, t.z);
    }
    for (const { body, mesh } of [...this.props.values(), ...this.opponents.values()]) {
      const t = body.translation();
      const r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  dispose() {
    this.scene.fog = this.fogBefore ?? null;
    for (const entry of this.objects) {
      if (entry.mesh) {
        this.scene.remove(entry.mesh);
        entry.mesh.geometry?.dispose();
        entry.mesh.material?.dispose();
      }
      if (entry.collider) clearTag(this.world, entry.collider);
      if (entry.body) this.world.removeRigidBody(entry.body);
    }
    this.objects = [];
    for (const joint of this.joints) this.world.removeImpulseJoint(joint, true);
    this.joints = [];
    this.magnets = [];
    this.magnetOf.clear();
    this.welded.clear();
    this.welds = 0;
    this.props.clear();
    this.plates.clear();
    this.shots = [];
    this.opponents.clear();
    this.movers = [];
    this.belts = [];
    for (const mark of this.beltMarks) {
      this.scene.remove(mark.mesh);
      mark.mesh.geometry.dispose();
      mark.mesh.material.dispose();
      mark.texture.dispose();
    }
    this.beltMarks = [];
    this.winds = [];
  }
}
