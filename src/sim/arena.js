import * as THREE from 'three';
import { GROUP_WORLD } from './machine.js';
import { makeRng, randomSeed, between } from './rng.js';
import { setTag, clearTag } from './tags.js';

// Props are authored with a mass in kilograms; Rapier wants a density.
function propVolume(prop) {
  return prop.radius
    ? (4 / 3) * Math.PI * prop.radius ** 3
    : prop.size[0] * prop.size[1] * prop.size[2];
}

function fixedBox(RAPIER, world, scene, piece) {
  const { pos, size, rotX = 0, rotY = 0, colour, belt } = piece;
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0));
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(pos[0], pos[1], pos[2])
      .setRotation(quaternion),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      .setFriction(belt ? 1.4 : 0.95)
      .setCollisionGroups(GROUP_WORLD),
    body,
  );
  // A belt reads as rubber rather than as more floor, and takes a little of
  // its own colour so a sorting bay's lanes can be told apart at a glance.
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    new THREE.MeshStandardMaterial({
      color: colour,
      roughness: belt ? 0.98 : 0.85,
      metalness: 0.05,
      emissive: belt ? new THREE.Color(colour).multiplyScalar(0.22) : 0x000000,
    }),
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
    this.movers = [];
    this.belts = [];
    this.elapsed = 0;
    this.build();
  }

  build() {
    const { RAPIER, world, scene, level } = this;
    const groundY = level.groundY ?? 0;
    const half = (level.groundSize ?? 120) / 2;

    const groundBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, groundY - 1, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, 1, half)
        .setFriction(1)
        .setCollisionGroups(GROUP_WORLD),
      groundBody,
    );
    const groundMesh = new THREE.Mesh(
      new THREE.BoxGeometry(half * 2, 2, half * 2),
      new THREE.MeshStandardMaterial({ color: 0x3c434d, roughness: 1, metalness: 0 }),
    );
    groundMesh.position.set(0, groundY - 1, 0);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
    this.objects.push({ body: groundBody, mesh: groundMesh });

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
        this.belts.push({
          collider: built.collider,
          dir: [dx / length, dy / length, dz / length],
          speed: piece.belt.speed ?? 2,
        });
      }
    }
    for (const hoop of level.hoops ?? []) this.addHoop(hoop);
    this.shuffleStarts();
    for (const prop of level.props ?? []) this.addProp(prop);
    for (const mover of level.movers ?? []) this.addMover(mover);
    for (const zone of level.zones ?? []) this.addZone(zone);
    for (const zone of level.keepout ?? []) this.addKeepOut(zone);
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
        .setLinearDamping(0.2)
        .setAngularDamping(0.4),
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
    this.props.set(prop.id, { spec: prop, body, mesh });
    this.objects.push({ body, mesh, collider });
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
      this.motions.set(key, {
        rate: between(rng, slow, fast),
        offset: between(rng, 0, Math.PI * 2),
      });
    }
    return this.motions.get(key);
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
    this.driveBelts();
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
  }

  sync() {
    for (const mover of this.movers) {
      const t = mover.body.translation();
      mover.mesh.position.set(t.x, t.y, t.z);
    }
    for (const { body, mesh } of this.props.values()) {
      const t = body.translation();
      const r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  dispose() {
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
    this.props.clear();
    this.movers = [];
    this.belts = [];
  }
}
