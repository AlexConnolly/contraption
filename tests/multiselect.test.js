import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import { Studio } from '../src/studio/studio.js';
import { Blueprint } from '../src/core/blueprint.js';

/**
 * Choosing several parts and doing one thing to all of them.
 *
 * The studio needs a camera and a scene, but not a renderer — the same trick
 * the physics tests use. What is being checked here is the editing model
 * rather than the drawing: what a click means with a modifier held, what is
 * held between picking a selection up and putting it down, and that nothing is
 * written to the blueprint until the moment it is put down.
 */

function studio(build) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 100);
  camera.position.set(0, 6, 10);
  camera.lookAt(0, 0, 0);
  const blueprint = new Blueprint({ name: 'test' });
  build?.(blueprint);
  return new Studio({ scene, camera, blueprint });
}

/** A row of blocks along Z, returned with its ids. */
function row(bp, { from = 0, to = 3, x = 0, y = 0 } = {}) {
  const ids = [];
  for (let z = from; z <= to; z += 1) ids.push(bp.place('block', [x, y, z]).id);
  return ids;
}

describe('choosing parts', () => {
  it('replaces the choice on a plain click', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp); });
    s.setTool('select');

    s.hoverId = ids[0];
    s.click();
    s.hoverId = ids[2];
    s.click();
    expect(s.selectedIds()).toEqual([ids[2]]);
  });

  it('adds to the choice when shift is held', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp); });
    s.setTool('select');

    for (const id of ids) {
      s.hoverId = id;
      s.click({ add: true });
    }
    expect(s.selectedIds().sort()).toEqual([...ids].sort());
  });

  it('takes a part back out when shift-clicked twice', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp); });
    s.setTool('select');

    s.hoverId = ids[0]; s.click({ add: true });
    s.hoverId = ids[1]; s.click({ add: true });
    s.hoverId = ids[0]; s.click({ add: true });
    expect(s.selectedIds()).toEqual([ids[1]]);
  });

  it('takes everything attached when control is held', () => {
    let ids = [];
    const s = studio((bp) => {
      ids = row(bp, { from: 0, to: 5 });
      row(bp, { from: 9, to: 11 });            // a separate island
    });
    s.setTool('select');

    s.hoverId = ids[0];
    s.click({ connected: true });
    expect(s.selectedIds().length).toBe(6);
  });

  it('keeps the inspector pointed at the last part clicked', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp); });
    s.setTool('select');
    s.hoverId = ids[0]; s.click({ add: true });
    s.hoverId = ids[2]; s.click({ add: true });
    expect(s.selectedId).toBe(ids[2]);
  });
});

describe('holding a selection', () => {
  it('writes nothing to the blueprint until it is put down', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp); });
    s.selection = new Set(ids);
    s.selectedId = ids[0];

    const before = s.blueprint.list().map((p) => [...p.cell]);
    s.beginDrag('move');
    s.aimDrag([0, 2, 0]);
    s.aimDrag([0, 5, 0]);
    expect(s.blueprint.list().map((p) => [...p.cell])).toEqual(before);
  });

  it('shows a ghost while it is held, and hides it once it is not', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp); });
    s.selection = new Set(ids);

    s.beginDrag('move');
    s.aimDrag([0, 1, 0]);
    expect(s.groupGhost.visible).toBe(true);
    // One ghost per part, plus the box drawn round the whole lot.
    expect(s.groupGhost.children.length).toBe(ids.length + 1);

    s.cancelDrag();
    expect(s.groupGhost.visible).toBe(false);
  });

  it('puts the ghost exactly where the parts would land', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp); });
    s.selection = new Set(ids);
    s.beginDrag('move');
    s.drag.from = [0, 0, 0];
    s.aimDrag([2, 3, 0]);
    // CELL is 0.5, so two cells across is one metre.
    expect(s.groupGhost.position.x).toBeCloseTo(1.0);
    expect(s.groupGhost.position.y).toBeCloseTo(1.5);
  });

  it('goes back to where it came from on cancel', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp); });
    s.selection = new Set(ids);
    const before = s.blueprint.list().map((p) => [...p.cell]);

    s.beginDrag('move');
    s.drag.from = [0, 0, 0];
    s.aimDrag([0, 4, 0]);
    s.cancelDrag();
    expect(s.blueprint.list().map((p) => [...p.cell])).toEqual(before);
    expect(s.drag).toBeNull();
  });
});

describe('putting it down', () => {
  it('moves every selected part at once', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp); });
    s.selection = new Set(ids);

    s.beginDrag('move');
    s.drag.from = [0, 0, 0];
    s.aimDrag([0, 2, 0]);
    expect(s.commitDrag().ok).toBe(true);
    expect(s.blueprint.list().every((p) => p.cell[1] === 2)).toBe(true);
  });

  it('refuses to put it somewhere it will not fit, and keeps holding it', () => {
    let ids = [];
    const s = studio((bp) => {
      ids = row(bp, { from: 0, to: 3 });
      bp.place('block', [0, 0, 5]);
    });
    s.selection = new Set(ids);

    s.beginDrag('move');
    s.drag.from = [0, 0, 0];
    s.aimDrag([0, 0, 2]);
    expect(s.drag.valid).toBe(false);
    expect(s.commitDrag().ok).toBe(false);
    expect(s.blueprint.get(ids[0]).cell).toEqual([0, 0, 0]);
  });

  it('leaves you holding the copy, so copying twice walks along', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp, { from: 0, to: 1 }); });
    s.selection = new Set(ids);

    for (let i = 0; i < 3; i += 1) {
      s.beginDrag('clone');
      s.drag.from = [0, 0, 0];
      s.aimDrag([1, 0, 0]);
      expect(s.commitDrag().ok).toBe(true);
    }
    expect(s.blueprint.list().length).toBe(8);
    expect(new Set(s.blueprint.list().map((p) => p.cell[0]))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('will not copy a selection holding the one part there can be one of', () => {
    let core = null;
    const s = studio((bp) => {
      core = bp.place('core', [0, 0, 0]).id;
      row(bp, { from: 1, to: 2 });
    });
    s.selection = new Set([core]);
    const held = s.beginDrag('clone');
    expect(held.ok).toBe(false);
    expect(held.reason).toMatch(/only be one/i);
  });
});

describe('deleting a selection', () => {
  it('takes all of it in one undo step', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp, { from: 0, to: 5 }); });
    s.selection = new Set(ids);

    expect(s.deleteSelection().removed).toBe(6);
    expect(s.blueprint.list().length).toBe(0);
    expect(s.undo()).toBe(true);
    expect(s.blueprint.list().length).toBe(6);
  });

  it('leaves nothing selected afterwards', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp); });
    s.selection = new Set(ids);
    s.deleteSelection();
    expect(s.selectedIds()).toEqual([]);
    expect(s.selectedId).toBeNull();
  });
});

describe('a selection that goes stale', () => {
  it('drops ids whose parts an undo took away', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp); });
    s.selection = new Set(ids);
    s.deleteSelection();
    s.undo();

    // The parts are back, but as new records: nothing should still be held.
    s.pruneSelection();
    expect(s.selectedIds().every((id) => s.blueprint.get(id))).toBe(true);
  });

  it('does not keep holding a part deleted from under it', () => {
    let ids = [];
    const s = studio((bp) => { ids = row(bp); });
    s.selection = new Set(ids);
    s.hoverId = ids[1];
    s.deleteHovered();
    expect(s.selectedIds()).not.toContain(ids[1]);
  });
});

describe('reading a shortcut that has a modifier on it', () => {
  // The handlers are called directly with plain objects: Node has no
  // KeyboardEvent, and the Input only ever reads properties off the event.
  const key = (code, extra = {}) => ({ code, preventDefault() {}, ...extra });

  it('remembers the modifier that was held when the key went down', async () => {
    const { Input } = await import('../src/core/input.js');
    const input = new Input({ addEventListener() {}, removeEventListener() {} });

    input.onKeyDown(key('KeyD', { ctrlKey: true }));
    // Ctrl is let go before anything reads the frame, which is a quick press
    // on a busy machine and every press in a background tab.
    input.onKeyUp(key('ControlLeft'));

    expect(input.wasPressedWith('KeyD', 'ctrl')).toBe(true);
    expect(input.wasPressedPlain('KeyD')).toBe(false);
  });

  it('tells a bare key apart from a modified one', async () => {
    const { Input } = await import('../src/core/input.js');
    const input = new Input({ addEventListener() {}, removeEventListener() {} });

    input.onKeyDown(key('KeyG'));
    expect(input.wasPressedPlain('KeyG')).toBe(true);
    expect(input.wasPressedWith('KeyG', 'ctrl')).toBe(false);
  });

  it('forgets it at the end of the frame, like every other press', async () => {
    const { Input } = await import('../src/core/input.js');
    const input = new Input({ addEventListener() {}, removeEventListener() {} });

    input.onKeyDown(key('KeyD', { ctrlKey: true }));
    input.endFrame();
    expect(input.wasPressedWith('KeyD', 'ctrl')).toBe(false);
  });
});
