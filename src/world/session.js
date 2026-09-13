import * as THREE from 'three';

import { createWorld, STEP } from '../sim/world.js';
import { Fleet } from '../sim/fleet.js';
import { GROUP_WORLD } from '../sim/machine.js';
import { Blueprint } from '../core/blueprint.js';
import { Terrain, BLOCK } from './terrain.js';
import { WorldEditor } from './editor.js';
import { blankWorld, sanitiseWorld, WORLD_LIMITS } from './format.js';

/**
 * An open world, running.
 *
 * The campaign is one level, one machine, one run, and `main.js` is written
 * that way throughout — one blueprint, one machine, one tracker, one camera.
 * This is the other game: a world you build in, as many machines as you like
 * standing in it, and nothing to win. So it is a session of its own rather
 * than a fourth branch inside the campaign's mode switch, and the campaign's
 * code path is left exactly as it was.
 *
 * Three things you can be doing, and the important part is what does *not*
 * change between them:
 *
 * - **World** — putting blocks down and taking them away.
 * - **Garage** — building the machine you are about to put down.
 * - **Play** — driving one of the machines standing in the world.
 *
 * The world runs in all three. A city of automated systems that stops
 * whenever you open the garage is not a city, it is a diorama; and the thing
 * the mode actually decides is only where your mouse and your keys go. That
 * also makes the modes free to switch between, and makes the host — which has
 * no modes at all, because nobody is looking at it — the same loop as this
 * one with the input left out.
 */

export const MODES = ['world', 'garage', 'play'];

/** How far a click reaches to pick a machine out of the world. */
const PICK_REACH = 250;

/** Substeps one frame may run. Beyond this the world is falling behind. */
const MAX_SUBSTEPS = 5;

const YAW_ORDER = 'YXZ';
const spareEuler = new THREE.Euler(0, 0, 0, YAW_ORDER);

/** Which way round the up axis a rotation is pointing, in radians. */
export function yawOf(quaternion) {
  return spareEuler.setFromQuaternion(quaternion, YAW_ORDER).y;
}

/**
 * Whether a ray gets into a box, and how far along it does.
 *
 * Machines are picked against their bounding box rather than by a physics
 * raycast. A machine is mostly gaps, and a click that misses between two
 * struts of the thing you are plainly pointing at is infuriating. It also
 * does not care whether the query pipeline has been built yet, which a
 * raycast does.
 */
export function rayHitsBox(origin, dir, box) {
  let near = 0;
  let far = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    const d = dir[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    if (Math.abs(d) < 1e-8) {
      if (origin[axis] < lo || origin[axis] > hi) return null;
      continue;
    }
    let t1 = (lo - origin[axis]) / d;
    let t2 = (hi - origin[axis]) / d;
    if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return null;
  }
  return far < 0 ? null : near;
}

export class WorldSession {
  constructor({
    RAPIER, scene, world = null, headless = false, physics = null,
  }) {
    this.RAPIER = RAPIER;
    this.scene = scene ?? new THREE.Scene();
    this.headless = headless;
    // A world of its own by default. The campaign's world holds a level's
    // scenery and its own gravity, and the two should never be able to leave
    // anything in each other.
    this.ownsPhysics = !physics;
    this.physics = physics ?? createWorld(RAPIER);

    this.world = world ? sanitiseWorld(worldData(world)) : blankWorld();
    if (world && world.id) this.world.id = world.id;

    this.mode = 'world';
    this.selected = null;
    this.elapsed = 0;
    this.tick = 0;
    this.behind = 0;
    this.accumulator = 0;
    this.objects = [];
    this.visible = true;

    this.terrain = new Terrain({
      RAPIER,
      world: this.physics,
      scene: this.scene,
      blocks: this.world.blocks,
      headless,
    });
    this.editor = new WorldEditor({ blocks: this.world.blocks });
    this.fleet = new Fleet({
      RAPIER, world: this.physics, scene: this.scene, headless,
    });

    this.buildGround();
    this.buildCursor();
    this.terrain.refresh();
    this.restoreVehicles();
  }

  // ------------------------------------------------------------------ ground

  /**
   * The floor everything else stands on. The block editor treats everything
   * at or below y = 0 as solid, so this is what makes that true.
   */
  buildGround() {
    const { RAPIER } = this;
    const half = this.world.ground / 2;
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0),
    );
    this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(half, 1, half)
        .setFriction(1)
        .setCollisionGroups(GROUP_WORLD),
      body,
    );
    this.ground = body;
    if (this.headless) return;

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(half * 2, 2, half * 2),
      new THREE.MeshStandardMaterial({ color: 0x39424c, roughness: 0.98 }),
    );
    mesh.position.set(0, -1, 0);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.objects.push(mesh);

    // One line a block, so what you are about to place lines up with
    // something you can see before you place it.
    const grid = new THREE.GridHelper(half * 2, (half * 2) / BLOCK, 0x5a6470, 0x49505a);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.3;
    this.scene.add(grid);
    this.objects.push(grid);
  }

  /**
   * The box that shows where the next block would go.
   *
   * Placing blind is the difference between building and guessing: every cell
   * looks the same from a distance, and a ray that lands on the face you did
   * not expect puts the block a metre from where you wanted it. Kept out of
   * `objects` so that hiding the world does not decide whether the cursor is
   * up -- that is the pointer's business, not the world's.
   */
  buildCursor() {
    if (this.headless) return;
    const box = new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
    const mesh = new THREE.Mesh(box, new THREE.MeshBasicMaterial({
      color: 0xf0a825, transparent: true, opacity: 0.2, depthWrite: false,
    }));
    mesh.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0xffc95c }),
    ));
    mesh.visible = false;
    this.scene.add(mesh);
    this.cursor = mesh;
  }

  /**
   * Where a click would land, shown as well as answered. Erasing highlights
   * the block that would go rather than the air in front of it, because those
   * are two different cells and picking the wrong one is the whole problem.
   */
  aimAt(ray, mode = 'place') {
    const aim = this.editor.aim(ray);
    if (!this.cursor) return aim;
    const cell = aim && (mode === 'erase' ? aim.hit : aim.cell);
    this.cursor.visible = Boolean(cell);
    if (cell) this.cursor.position.set(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5);
    this.cursor.material.color.set(mode === 'erase' ? 0xf06a5d : 0xf0a825);
    this.cursor.children[0].material.color.set(mode === 'erase' ? 0xf06a5d : 0xffc95c);
    return aim;
  }

  hideCursor() {
    if (this.cursor) this.cursor.visible = false;
  }

  // ----------------------------------------------------------------- vehicles

  restoreVehicles() {
    for (const parked of this.world.vehicles) {
      let blueprint;
      try {
        blueprint = Blueprint.fromJSON(parked.blueprint);
      } catch {
        continue;
      }
      this.fleet.deploy({
        blueprint,
        spawn: new THREE.Vector3(parked.at[0], parked.at[1], parked.at[2]),
        yaw: (parked.yaw * Math.PI) / 180,
        name: parked.name,
        owner: parked.owner,
      });
    }
  }

  /**
   * Puts a machine into the world. Unlike a challenge, where every run starts
   * on the level's one spawn, this stays where it was put down and carries on
   * running whatever it was told to run.
   *
   * The blueprint is copied on the way in. The one on the build plate is
   * still being edited, and a machine standing in the world should not change
   * shape because somebody moved a wheel in the garage.
   */
  deploy({
    blueprint, at, yaw = 0, name = null, owner = null, num = 0,
  }) {
    if (this.fleet.list().length >= WORLD_LIMITS.vehicles) {
      return { ok: false, reason: `Only ${WORLD_LIMITS.vehicles} machines fit in one world` };
    }
    if (!blueprint || blueprint.size === 0) {
      return { ok: false, reason: 'There is nothing on the build plate to put down' };
    }
    const member = this.fleet.deploy({
      blueprint: Blueprint.fromJSON(blueprint.toJSON()),
      spawn: new THREE.Vector3(at[0], at[1], at[2]),
      yaw,
      name: name || blueprint.name,
      owner,
      // A machine joining a world somebody else is hosting keeps the number it
      // arrived with: a snapshot says which machine it is describing by number
      // and the two ends have to mean the same one.
      num,
    });
    return { ok: true, member };
  }

  remove(id) {
    if (this.selected === id) this.selected = null;
    return this.fleet.remove(id);
  }

  select(id) {
    this.selected = this.fleet.get(id) ? id : null;
    return this.selected;
  }

  /** Hands the keys to one machine, or takes them back when given no id. */
  control(id, input) {
    const member = this.fleet.control(id, input);
    if (member) this.selected = member.id;
    return member;
  }

  controlled() {
    return this.fleet.controlled();
  }

  /** The box a machine occupies, for picking it and for framing a camera. */
  boundsOf(member) {
    const box = new THREE.Box3();
    const { machine } = member;
    for (const placed of machine.blueprint.list()) {
      box.expandByPoint(machine.partWorldPoint(placed));
    }
    // Part world points are part centres, so without this the box stops
    // halfway into the outermost part on every side.
    return box.expandByScalar(BLOCK * 0.6);
  }

  /** Which machine the player is pointing at, nearest first. */
  pick({ origin, dir }) {
    let best = null;
    for (const member of this.fleet.list()) {
      const t = rayHitsBox(origin, dir, this.boundsOf(member));
      if (t === null || t > PICK_REACH) continue;
      if (!best || t < best.t) best = { t, member };
    }
    return best ? best.member : null;
  }

  // ------------------------------------------------------------------- blocks

  setMaterial(index) {
    this.editor.material = Math.max(1, Math.min(WORLD_LIMITS.materials, Math.round(index)));
    return this.editor.material;
  }

  /**
   * What a click would change, without changing it.
   *
   * Offline the answer is applied on the spot. Online it is sent, and the
   * world changes when it comes back — so the two have to be able to ask the
   * question without doing anything about it, or the online path would be a
   * second copy of the aiming rules that could drift from this one.
   */
  planEdit(ray, mode = 'place') {
    const aim = this.editor.aim(ray);
    if (!aim) return null;
    if (mode === 'erase') return aim.hit ? [aim.hit[0], aim.hit[1], aim.hit[2], 0] : null;
    return [aim.cell[0], aim.cell[1], aim.cell[2], this.editor.material];
  }

  applyEdit(op) {
    return this.world.blocks.set(op[0], op[1], op[2], op[3]);
  }

  place(ray) {
    if (this.world.blocks.count() >= WORLD_LIMITS.blocks) {
      return { ok: false, reason: 'This world is full — take something away first' };
    }
    const op = this.planEdit(ray, 'place');
    return op && this.applyEdit(op) ? { ok: true, op } : { ok: false, reason: null };
  }

  erase(ray) {
    const op = this.planEdit(ray, 'erase');
    return op && this.applyEdit(op) ? { ok: true, op } : { ok: false, reason: null };
  }

  // -------------------------------------------------------------------- modes

  setMode(mode) {
    if (!MODES.includes(mode)) return this.mode;
    this.hideCursor();
    // Only one of the three has your hands on a machine. Leaving it has to
    // give the keys back, or a machine keeps driving under a key you are
    // still holding while you place blocks in front of it.
    if (mode !== 'play') this.fleet.control(null);
    this.mode = mode;
    return this.mode;
  }

  // --------------------------------------------------------------------- loop

  /**
   * One fixed step of everything. The host runs exactly this, which is the
   * point of it being one method.
   */
  step() {
    // Blocks become solid here rather than when the renderer next looks.
    // Terrain carries the colliders as well as the meshes, so leaving this to
    // `sync` would mean a headless host -- which never syncs anything -- ran a
    // world whose buildings you could drive straight through.
    this.terrain.refresh();
    this.fleet.update(STEP);
    this.fleet.step();
    this.elapsed += STEP;
    this.tick += 1;
  }

  /**
   * Wall-clock time turned into fixed steps. Time that does not fit is
   * counted rather than quietly dropped: a client that silently skips steps
   * under load is a client that has drifted away from the host and does not
   * know it.
   */
  advance(dt, afterFirstStep = null) {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_SUBSTEPS) {
      this.step();
      this.accumulator -= STEP;
      steps += 1;
      // A key press must only be seen by the first substep, or one keystroke
      // bound to a toggle flips it several times in a frame.
      if (steps === 1 && afterFirstStep) afterFirstStep();
    }
    if (this.accumulator >= STEP) {
      this.behind += this.accumulator;
      this.accumulator = 0;
    }
    return steps;
  }

  /**
   * Whether the world is drawn. It goes on running either way.
   *
   * The garage is a place you go to rather than a panel you open: the build
   * plate sits at the origin, which is also where somebody's town is, so the
   * two cannot be on screen at once. The world carries on running behind it,
   * which is the part that matters.
   */
  setVisible(on) {
    this.visible = on;
    if (this.headless) return;
    this.terrain.setVisible(on);
    this.fleet.setVisible(on);
    for (const object of this.objects) object.visible = on;
  }

  /** Everything the eye needs, and nothing the simulation does. */
  sync() {
    if (this.headless) return;
    this.fleet.syncMeshes();
  }

  // -------------------------------------------------------------- persistence

  /**
   * Where a machine has got to, in the shape it was put down in.
   *
   * A machine's bodies are built at its spawn point and everything about it
   * is held relative to that, so the first body's own frame is still exactly
   * where the machine's origin is, however far it has driven.
   *
   * What is not kept is what its joints were doing: a reloaded world stands
   * its machines up in their built pose. An arm halfway through a lift comes
   * back down, which is the right trade for a save that is a position and an
   * angle rather than a dump of the solver.
   */
  poseOf(member) {
    const body = member.machine.bodies[0];
    const t = body.translation();
    const r = body.rotation();
    const yaw = yawOf(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    return {
      at: [t.x, t.y, t.z],
      yaw: ((((yaw * 180) / Math.PI) % 360) + 360) % 360,
    };
  }

  /** The world as it stands now, ready to be written down or sent. */
  snapshot() {
    return {
      ...this.world,
      vehicles: this.fleet.list().map((member) => ({
        id: member.id,
        name: member.name,
        owner: member.owner,
        ...this.poseOf(member),
        blueprint: member.machine.blueprint.toJSON(),
      })),
    };
  }

  rename(name) {
    const wanted = String(name == null ? '' : name).trim().slice(0, WORLD_LIMITS.name);
    if (wanted) this.world.name = wanted;
    return this.world.name;
  }

  counts() {
    return {
      blocks: this.world.blocks.count(),
      // Asked of the store rather than of the terrain, so it is true the
      // instant a block is placed instead of one step later.
      chunks: this.world.blocks.chunks.size,
      vehicles: this.fleet.list().length,
    };
  }

  dispose() {
    this.fleet.dispose();
    this.terrain.dispose();
    if (this.cursor) {
      this.scene.remove(this.cursor);
      this.cursor.children[0].geometry.dispose();
      this.cursor.children[0].material.dispose();
      this.cursor.geometry.dispose();
      this.cursor.material.dispose();
      this.cursor = null;
    }
    for (const object of this.objects) {
      this.scene.remove(object);
      if (object.geometry) object.geometry.dispose();
      if (object.material) object.material.dispose();
    }
    this.objects = [];
    if (this.ownsPhysics) this.physics.free();
  }
}

/**
 * A world document on its way in. It may be a plain record out of storage or
 * a live session's own state, and the sanitiser wants the plain one.
 */
function worldData(world) {
  if (!world) return {};
  if (!world.blocks || typeof world.blocks.toJSON !== 'function') return world;
  return { ...world, chunks: world.blocks.toJSON() };
}
