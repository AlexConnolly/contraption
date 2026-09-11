import * as THREE from 'three';
import { GROUP_WORLD } from './machine.js';

// Props are authored with a mass in kilograms; Rapier wants a density.
function propVolume(prop) {
  return prop.radius
    ? (4 / 3) * Math.PI * prop.radius ** 3
    : prop.size[0] * prop.size[1] * prop.size[2];
}

function fixedBox(RAPIER, world, scene, { pos, size, rotX = 0, rotY = 0, colour }) {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0));
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(pos[0], pos[1], pos[2])
      .setRotation(quaternion),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      .setFriction(0.95)
      .setCollisionGroups(GROUP_WORLD),
    body,
  );
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85, metalness: 0.05 }),
  );
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.quaternion.copy(quaternion);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { body, mesh };
}

/**
 * Builds one level's world: ground, fixed scenery, the dynamic props an
 * objective tracks, and the translucent goal zones.
 */
export class Arena {
  constructor({ RAPIER, world, scene, level }) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.scene = scene;
    this.level = level;
    this.objects = [];
    this.props = new Map();
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
      this.objects.push(fixedBox(RAPIER, world, scene, piece));
    }
    for (const prop of level.props ?? []) this.addProp(prop);
    for (const zone of level.zones ?? []) this.addZone(zone);
  }

  addProp(prop) {
    const { RAPIER, world, scene } = this;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(prop.pos[0], prop.pos[1], prop.pos[2])
        .setLinearDamping(0.2)
        .setAngularDamping(0.4),
    );
    const desc = prop.radius
      ? RAPIER.ColliderDesc.ball(prop.radius)
      : RAPIER.ColliderDesc.cuboid(prop.size[0] / 2, prop.size[1] / 2, prop.size[2] / 2);
    world.createCollider(
      desc.setDensity(prop.mass / propVolume(prop))
        .setFriction(prop.friction ?? 0.85)
        .setRestitution(0.05)
        .setCollisionGroups(GROUP_WORLD),
      body,
    );
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
    this.objects.push({ body, mesh });
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
    for (const { spec, body } of this.props.values()) {
      body.setTranslation({ x: spec.pos[0], y: spec.pos[1], z: spec.pos[2] }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  sync() {
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
      if (entry.body) this.world.removeRigidBody(entry.body);
    }
    this.objects = [];
    this.props.clear();
  }
}
