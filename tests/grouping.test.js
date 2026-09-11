import { describe, it, expect } from 'vitest';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep, pitchStep } from '../src/core/orientation.js';
import { groupBlueprint } from '../src/sim/grouping.js';
import { findConnections, faceRole } from '../src/sim/connectivity.js';

function chassis() {
  const bp = new Blueprint();
  bp.place('core', [0, 1, 0]);
  bp.place('block', [0, 1, 1]);
  bp.place('block', [0, 1, -1]);
  return bp;
}

describe('connectivity', () => {
  it('links face-adjacent structural parts', () => {
    const bp = chassis();
    const links = findConnections(bp);
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.roleA === 'rigid' && l.roleB === 'rigid')).toBe(true);
  });

  it('ignores parts that only touch at a corner', () => {
    const bp = new Blueprint();
    bp.place('block', [0, 0, 0]);
    bp.place('block', [1, 1, 0]);
    expect(findConnections(bp)).toHaveLength(0);
  });

  it('connects a wheel through its axle face only', () => {
    const wheel = { id: 'w', type: 'wheel', cell: [0, 0, 0], rot: IDENTITY_ORIENTATION, config: {} };
    expect(faceRole(wheel, [-1, 0, 0])).toBe('host');
    expect(faceRole(wheel, [1, 0, 0])).toBe('none');
    expect(faceRole(wheel, [0, 1, 0])).toBe('none');
  });

  it('moves the wheel axle face with the part rotation', () => {
    const wheel = { id: 'w', type: 'wheel', cell: [0, 0, 0], rot: yawStep(IDENTITY_ORIENTATION), config: {} };
    expect(faceRole(wheel, [-1, 0, 0])).toBe('none');
    expect(faceRole(wheel, [0, 0, 1])).toBe('host');
  });
});

describe('grouping', () => {
  it('fuses bolted parts into a single body', () => {
    const result = groupBlueprint(chassis());
    expect(result.bodies).toHaveLength(1);
    expect(result.bodies[0].members).toHaveLength(3);
    expect(result.joints).toHaveLength(0);
    expect(result.disconnected).toEqual([]);
  });

  it('gives a wheel its own body jointed to the chassis', () => {
    const bp = chassis();
    const wheel = bp.place('wheel', [1, 1, 1], IDENTITY_ORIENTATION);
    const result = groupBlueprint(bp);
    expect(result.bodies).toHaveLength(2);
    expect(result.joints).toHaveLength(1);
    const joint = result.joints[0];
    expect(joint.partId).toBe(wheel.id);
    expect(joint.type).toBe('revolute');
    expect(joint.hostBody).toBe(result.rootBody);
    expect(result.disconnected).toEqual([]);
  });

  it('splits a structure either side of a hinge', () => {
    const bp = new Blueprint();
    bp.place('core', [0, 0, 0]);
    bp.place('hinge', [0, 1, 0]);
    bp.place('block', [0, 2, 0]);
    bp.place('block', [0, 3, 0]);
    const result = groupBlueprint(bp);
    expect(result.bodies).toHaveLength(2);
    expect(result.joints).toHaveLength(1);
    const arm = result.bodies.find((b) => b.index !== result.rootBody);
    expect(arm.members).toHaveLength(3);
    expect(result.disconnected).toEqual([]);
  });

  it('keeps a propeller inside the body it is bolted to', () => {
    const bp = chassis();
    bp.place('propeller', [0, 2, 0]);
    const result = groupBlueprint(bp);
    expect(result.bodies).toHaveLength(1);
    expect(result.joints).toHaveLength(0);
  });

  it('reports parts that are not attached to the core', () => {
    const bp = chassis();
    const floater = bp.place('block', [5, 5, 5]);
    const result = groupBlueprint(bp);
    expect(result.disconnected).toEqual([floater.id]);
  });

  it('anchors the root body on the core wherever the core sits', () => {
    const bp = new Blueprint();
    bp.place('block', [0, 0, 0]);
    const core = bp.place('core', [0, 1, 0]);
    bp.place('hinge', [0, 2, 0], pitchStep(IDENTITY_ORIENTATION));
    const result = groupBlueprint(bp);
    expect(result.bodies[result.rootBody].members).toContain(core.id);
  });
});
