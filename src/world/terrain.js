import * as THREE from 'three';
import { CHUNK } from './format.js';

/**
 * Blocks made visible and solid.
 *
 * A level builds one rigid body, one collider, one geometry and one material
 * per piece of scenery — which is exactly why it is capped at 250 pieces. A
 * town is thousands, so nothing here is per block if it can be per chunk:
 *
 * - **One instanced mesh per material per chunk.** A thousand blocks of the
 *   same stuff is one draw call and one geometry, not a thousand of each.
 * - **One body per chunk**, carrying a collider for each block in it.
 *   Colliders are cheap to have and expensive to create, and a chunk is
 *   created once and then left alone.
 * - **Nothing is touched unless its chunk was edited.** The world says which
 *   chunks are dirty; everything else is already right and costs nothing.
 *
 * Faces between neighbouring blocks are still drawn — this is instancing, not
 * greedy meshing. That is the next thing to do if a city needs it, and it does
 * not change anything outside this file.
 */

/** What each palette index looks like. Index 0 is air and is never drawn. */
export const MATERIALS = [
  null,
  { name: 'Stone', colour: 0x8b93a0, roughness: 0.9, friction: 0.95 },
  { name: 'Concrete', colour: 0xb9bdc4, roughness: 0.95, friction: 0.95 },
  { name: 'Brick', colour: 0xa8563f, roughness: 0.9, friction: 0.95 },
  { name: 'Timber', colour: 0xa0784a, roughness: 0.85, friction: 0.95 },
  { name: 'Road', colour: 0x40454d, roughness: 1, friction: 1.1 },
  { name: 'Grass', colour: 0x5c8a4a, roughness: 1, friction: 1 },
  { name: 'Sand', colour: 0xc7b183, roughness: 1, friction: 0.7 },
  { name: 'Steel', colour: 0x6f7885, roughness: 0.4, friction: 0.8, metalness: 0.6 },
  { name: 'Glass', colour: 0x7fb4c9, roughness: 0.15, friction: 0.6, opacity: 0.45 },
  { name: 'Ice', colour: 0xbfe4f0, roughness: 0.05, friction: 0.06 },
  { name: 'Hazard', colour: 0xe0a92c, roughness: 0.8, friction: 1 },
  { name: 'Rubber', colour: 0x2c2f35, roughness: 1, friction: 2.2 },
  { name: 'Marble', colour: 0xe6e3dc, roughness: 0.3, friction: 0.9 },
  { name: 'Copper', colour: 0xb87333, roughness: 0.45, friction: 0.9, metalness: 0.7 },
  { name: 'Light', colour: 0xfff0c0, roughness: 0.6, friction: 0.95, glow: true },
];

/** One metre a block, so a block is two of the machine grid's cells. */
export const BLOCK = 1;

export class Terrain {
  constructor({
    RAPIER, world, scene, blocks, headless = false,
  }) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.scene = scene;
    this.blocks = blocks;
    this.headless = headless;
    this.built = new Map();
    // Shared across every chunk: geometry and materials are the things it
    // would be most wasteful to make one of per chunk, let alone per block.
    this.box = headless ? null : new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
    this.skins = new Map();
    this.builds = 0;
    this.visible = true;
  }

  chunkCount() {
    return this.built.size;
  }

  meshCount() {
    let n = 0;
    for (const chunk of this.built.values()) n += chunk.meshes.length;
    return n;
  }

  skin(index) {
    if (this.skins.has(index)) return this.skins.get(index);
    const spec = MATERIALS[index] ?? MATERIALS[1];
    const material = new THREE.MeshStandardMaterial({
      color: spec.colour,
      roughness: spec.roughness ?? 0.9,
      metalness: spec.metalness ?? 0.05,
      transparent: spec.opacity !== undefined,
      opacity: spec.opacity ?? 1,
      emissive: spec.glow ? spec.colour : 0x000000,
      emissiveIntensity: spec.glow ? 0.6 : 0,
    });
    this.skins.set(index, material);
    return material;
  }

  /** Rebuilds whatever has changed since the last look, and nothing else. */
  refresh() {
    for (const key of this.blocks.touched()) {
      this.drop(key);
      if (this.blocks.chunks.has(key)) this.build(key);
    }
    this.blocks.clean();
  }

  build(key) {
    const cells = this.blocks.cellsOf(key);
    if (cells.length === 0) return;
    this.builds += 1;

    const { RAPIER, world } = this;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const half = BLOCK / 2;
    const byMaterial = new Map();
    for (const [x, y, z, kind] of cells) {
      const spec = MATERIALS[kind] ?? MATERIALS[1];
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(half, half, half)
          .setTranslation(x + half, y + half, z + half)
          .setFriction(spec.friction ?? 0.95)
          .setCollisionGroups(0x00010003),
        body,
      );
      if (!byMaterial.has(kind)) byMaterial.set(kind, []);
      byMaterial.get(kind).push([x, y, z]);
    }

    const meshes = [];
    if (!this.headless) {
      const put = new THREE.Object3D();
      for (const [kind, spots] of byMaterial) {
        const mesh = new THREE.InstancedMesh(this.box, this.skin(kind), spots.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.visible = this.visible;
        spots.forEach(([x, y, z], i) => {
          put.position.set(x + half, y + half, z + half);
          put.updateMatrix();
          mesh.setMatrixAt(i, put.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(mesh);
        meshes.push(mesh);
      }
    }
    this.built.set(key, { body, meshes });
  }

  /** Whether the blocks are drawn. They stay solid either way. */
  setVisible(on) {
    for (const chunk of this.built.values()) {
      for (const mesh of chunk.meshes) mesh.visible = on;
    }
    this.visible = on;
  }

  drop(key) {
    const chunk = this.built.get(key);
    if (!chunk) return;
    for (const mesh of chunk.meshes) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.world.removeRigidBody(chunk.body);
    this.built.delete(key);
  }

  dispose() {
    for (const key of [...this.built.keys()]) this.drop(key);
    for (const material of this.skins.values()) material.dispose();
    this.skins.clear();
    this.box?.dispose();
    this.box = null;
  }
}

export { CHUNK };
