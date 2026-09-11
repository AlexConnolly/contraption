import * as THREE from 'three';
import { CELL, getPart } from '../parts/registry.js';
import { createPartMesh, makeGhost } from '../parts/geometry.js';
import {
  applyOrientation,
  orientationQuaternion,
  IDENTITY_ORIENTATION,
  yawStep,
  pitchStep,
} from '../core/orientation.js';
import { Blueprint, occupiedCells } from '../core/blueprint.js';
import { groupBlueprint } from '../sim/grouping.js';

const OK_COLOUR = 0x4ade80;
const BAD_COLOUR = 0xff5a5a;
const PLATE_Y = -CELL / 2;

export const TOOLS = ['place', 'select', 'delete'];

/**
 * Build mode. Raycasts the cursor onto the build plate or an existing part to
 * work out which cell the next part goes in, and keeps the scene in step with
 * the blueprint.
 */
export class Studio {
  constructor({ scene, camera, blueprint, onChange }) {
    this.scene = scene;
    this.camera = camera;
    this.blueprint = blueprint;
    this.onChange = onChange ?? (() => {});

    this.tool = 'place';
    this.partType = 'block';
    this.rotation = IDENTITY_ORIENTATION;
    this.selectedId = null;
    this.hoverId = null;
    this.targetCell = null;
    this.valid = false;
    this.reason = '';

    this.undoStack = [];
    this.redoStack = [];

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.partMeshes = new Map();
    this.pickMeshes = [];
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-2, -2);

    this.buildPlate();
    this.buildGhost();
    this.rebuild();
  }

  buildPlate() {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({
        color: 0x2f353d,
        roughness: 0.95,
        transparent: true,
        opacity: 0.9,
      }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = PLATE_Y;
    plate.receiveShadow = true;
    this.root.add(plate);
    this.plate = plate;

    const grid = new THREE.GridHelper(30, 60, 0x5f6b7a, 0x424a55);
    grid.position.y = PLATE_Y + 0.002;
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    this.grid = grid;
    this.root.add(grid);
  }

  buildGhost() {
    this.ghostHolder = new THREE.Group();
    this.root.add(this.ghostHolder);

    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(CELL, CELL, CELL)),
      new THREE.LineBasicMaterial({ color: 0xffd166, linewidth: 2 }),
    );
    this.highlight.visible = false;
    this.root.add(this.highlight);
    this.refreshGhost();
  }

  refreshGhost() {
    if (this.ghost) {
      this.ghostHolder.remove(this.ghost);
      disposeTree(this.ghost);
    }
    const part = getPart(this.partType);
    this.ghost = makeGhost(part);
    this.ghostHolder.add(this.ghost);
    this.ghostBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(
          part.size[0] * CELL, part.size[1] * CELL, part.size[2] * CELL,
        ),
      ),
      new THREE.LineBasicMaterial({ color: OK_COLOUR }),
    );
    this.ghost.add(this.ghostBox);
  }

  setPartType(id) {
    if (this.partType === id) return;
    this.partType = id;
    this.refreshGhost();
  }

  setTool(tool) {
    this.tool = tool;
    this.ghostHolder.visible = tool === 'place';
  }

  rotateYaw() {
    this.rotation = yawStep(this.rotation);
  }

  rotatePitch() {
    this.rotation = pitchStep(this.rotation);
  }

  setPointer(x, y) {
    this.pointer.set(x, y);
  }

  clearPointer() {
    this.pointer.set(-2, -2);
    this.targetCell = null;
    this.ghostHolder.visible = false;
    this.highlight.visible = false;
  }

  // Works out which cell the cursor is pointing at, by hitting an existing
  // part's face or falling back to the build plate.
  pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickMeshes, false);
    if (hits.length > 0) {
      const hit = hits[0];
      const normal = hit.face.normal.clone()
        .transformDirection(hit.object.matrixWorld)
        .round();
      const inside = hit.point.clone().addScaledVector(normal, -CELL * 0.25);
      const cell = [
        Math.round(inside.x / CELL),
        Math.round(inside.y / CELL),
        Math.round(inside.z / CELL),
      ];
      return {
        partId: hit.object.userData.partId,
        cell,
        normal: [normal.x, normal.y, normal.z],
      };
    }
    const plateHit = this.raycaster.intersectObject(this.plate, false)[0];
    if (!plateHit) return null;
    return {
      partId: null,
      cell: [Math.round(plateHit.point.x / CELL), 0, Math.round(plateHit.point.z / CELL)],
      normal: [0, 0, 0],
    };
  }

  // A part wider than one cell has to step further off the face it sits on.
  offsetForSize(normal) {
    const part = getPart(this.partType);
    const rotated = applyOrientation(this.rotation, part.size).map(Math.abs);
    const axis = normal.findIndex((n) => n !== 0);
    if (axis === -1) return [0, 0, 0];
    const extra = Math.floor(rotated[axis] / 2);
    return normal.map((n) => n * extra);
  }

  update() {
    const hit = this.pick();
    this.hoverId = hit?.partId ?? null;

    if (!hit) {
      this.targetCell = null;
      this.ghostHolder.visible = false;
      this.highlight.visible = false;
      return;
    }

    if (this.tool === 'place') {
      const offset = this.offsetForSize(hit.normal);
      this.targetCell = [
        hit.cell[0] + hit.normal[0] + offset[0],
        hit.cell[1] + hit.normal[1] + offset[1],
        hit.cell[2] + hit.normal[2] + offset[2],
      ];
      const check = this.blueprint.canPlace(this.partType, this.targetCell, this.rotation);
      this.valid = check.ok;
      this.reason = check.reason ?? '';
      this.ghostHolder.visible = true;
      this.ghostHolder.position.set(
        this.targetCell[0] * CELL,
        this.targetCell[1] * CELL,
        this.targetCell[2] * CELL,
      );
      const q = orientationQuaternion(this.rotation);
      this.ghostHolder.quaternion.set(q.x, q.y, q.z, q.w);
      this.ghostBox.material.color.setHex(check.ok ? OK_COLOUR : BAD_COLOUR);
      this.highlight.visible = false;
      return;
    }

    this.ghostHolder.visible = false;
    const hovered = this.hoverId ? this.blueprint.get(this.hoverId) : null;
    if (!hovered) {
      this.highlight.visible = false;
      return;
    }
    const part = getPart(hovered.type);
    this.highlight.geometry.dispose();
    this.highlight.geometry = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(
        part.size[0] * CELL + 0.04,
        part.size[1] * CELL + 0.04,
        part.size[2] * CELL + 0.04,
      ),
    );
    this.highlight.position.set(
      hovered.cell[0] * CELL, hovered.cell[1] * CELL, hovered.cell[2] * CELL,
    );
    const q = orientationQuaternion(hovered.rot);
    this.highlight.quaternion.set(q.x, q.y, q.z, q.w);
    this.highlight.material.color.setHex(
      this.tool === 'delete' ? BAD_COLOUR : 0xffd166,
    );
    this.highlight.visible = true;
  }

  click() {
    if (this.tool === 'place') return this.placeHere();
    if (this.tool === 'delete') return this.deleteHovered();
    this.selectedId = this.hoverId;
    this.onChange({ reason: 'select' });
    return { ok: true };
  }

  placeHere() {
    if (!this.targetCell) return { ok: false };
    this.snapshot();
    const result = this.blueprint.place(this.partType, this.targetCell, this.rotation);
    if (!result.ok) {
      this.undoStack.pop();
      return result;
    }
    this.rebuild();
    this.onChange({ reason: 'place', id: result.id });
    return result;
  }

  deleteHovered() {
    if (!this.hoverId) return { ok: false };
    this.snapshot();
    this.blueprint.remove(this.hoverId);
    if (this.selectedId === this.hoverId) this.selectedId = null;
    this.hoverId = null;
    this.rebuild();
    this.onChange({ reason: 'delete' });
    return { ok: true };
  }

  deleteSelected() {
    if (!this.selectedId) return { ok: false };
    this.snapshot();
    this.blueprint.remove(this.selectedId);
    this.selectedId = null;
    this.rebuild();
    this.onChange({ reason: 'delete' });
    return { ok: true };
  }

  snapshot() {
    this.undoStack.push(this.blueprint.toJSON());
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(this.blueprint.toJSON());
    this.loadState(previous);
    this.onChange({ reason: 'undo' });
    return true;
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.blueprint.toJSON());
    this.loadState(next);
    this.onChange({ reason: 'redo' });
    return true;
  }

  loadState(data) {
    const restored = Blueprint.fromJSON(data, { bounds: this.blueprint.bounds });
    this.blueprint.parts = restored.parts;
    this.blueprint.occupancy = restored.occupancy;
    this.blueprint.name = restored.name;
    if (this.selectedId && !this.blueprint.get(this.selectedId)) this.selectedId = null;
    this.rebuild();
  }

  replaceBlueprint(blueprint) {
    this.snapshot();
    this.blueprint.parts = blueprint.parts;
    this.blueprint.occupancy = blueprint.occupancy;
    this.blueprint.name = blueprint.name;
    this.selectedId = null;
    this.rebuild();
    this.onChange({ reason: 'load' });
  }

  clear() {
    this.snapshot();
    this.blueprint.parts.clear();
    this.blueprint.occupancy.clear();
    this.selectedId = null;
    this.rebuild();
    this.onChange({ reason: 'clear' });
  }

  rebuild() {
    for (const mesh of this.partMeshes.values()) {
      this.root.remove(mesh);
      disposeTree(mesh);
    }
    this.partMeshes.clear();
    for (const mesh of this.pickMeshes) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.pickMeshes = [];

    const grouping = groupBlueprint(this.blueprint);
    const orphans = new Set(grouping.disconnected);

    for (const placed of this.blueprint.list()) {
      const part = getPart(placed.type);
      const mesh = createPartMesh(part, { hints: true });
      mesh.position.set(
        placed.cell[0] * CELL, placed.cell[1] * CELL, placed.cell[2] * CELL,
      );
      const q = orientationQuaternion(placed.rot);
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
      if (orphans.has(placed.id)) tint(mesh, 0xff8a5a);
      this.root.add(mesh);
      this.partMeshes.set(placed.id, mesh);

      for (const cell of occupiedCells(placed.type, placed.cell, placed.rot)) {
        const pick = new THREE.Mesh(
          new THREE.BoxGeometry(CELL, CELL, CELL),
          new THREE.MeshBasicMaterial({ visible: false }),
        );
        pick.position.set(cell[0] * CELL, cell[1] * CELL, cell[2] * CELL);
        pick.userData.partId = placed.id;
        this.root.add(pick);
        this.pickMeshes.push(pick);
      }
    }
    this.grouping = grouping;
  }

  /**
   * Where the machine sits and how big it is, for a camera that wants to frame
   * it. Falls back to a sensible empty-plate shot when nothing is built.
   */
  machineFraming() {
    const box = new THREE.Box3();
    let any = false;
    for (const mesh of this.partMeshes.values()) {
      box.expandByObject(mesh);
      any = true;
    }
    if (!any) return { centre: new THREE.Vector3(0, 1, 0), reach: 3 };
    const size = box.getSize(new THREE.Vector3());
    return {
      centre: box.getCenter(new THREE.Vector3()),
      reach: Math.max(size.x, size.y, size.z, 1.6),
    };
  }

  // The title screen turns the machine on an empty stage: no grid, and nothing
  // to point at, so the placement ghost goes with the plate.
  setShowPlate(show) {
    this.plate.visible = show;
    if (this.grid) this.grid.visible = show;
    if (!show) this.clearPointer();
  }

  setVisible(visible) {
    this.root.visible = visible;
    if (!visible) this.clearPointer();
  }

  dispose() {
    this.scene.remove(this.root);
    disposeTree(this.root);
  }
}

function tint(object, colour) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.material = child.material.clone();
    child.material.emissive?.setHex(colour);
    child.material.emissiveIntensity = 0.45;
  });
}

function disposeTree(object) {
  object.traverse((child) => {
    if (!child.isMesh && !child.isLineSegments) return;
    child.geometry?.dispose();
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) mat?.dispose();
  });
}
