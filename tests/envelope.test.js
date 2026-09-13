import { describe, it, expect } from 'vitest';

import { envelopeOf, sweepRadius, carriedBy } from '../src/studio/envelope.js';
import { Blueprint } from '../src/core/blueprint.js';
import { CELL, getPart } from '../src/parts/registry.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';
import { groupBlueprint } from '../src/sim/grouping.js';

/**
 * Showing what a part will do before it does it.
 *
 * Every moving part in the game has a range written on it — a hinge's limits,
 * a servo's two angles, a ram's stroke, a strut's travel, a grabber's reach —
 * and until now all of that was a number in a panel. A number does not answer
 * the question anybody is actually asking, which is "will the arm clear the
 * load". You found out by pressing Play.
 *
 * What is checked here is the geometry behind the drawing: that the envelope
 * follows the part's own settings rather than a guess, that it is measured off
 * whatever is bolted to the far side of the joint, and that the parts with no
 * range to speak of draw nothing.
 */

/** A chassis with an arm on a joint of the given type, and a boom to swing. */
function arm(type, { boom = 0, config = null } = {}) {
  const bp = new Blueprint({ name: 'arm' });
  for (let z = 0; z <= 1; z += 1) bp.place('block', [0, 0, z]);
  bp.place('core', [0, 1, 0]);
  const joint = bp.place(type, [0, 1, 1]);
  for (let z = 1; z <= boom; z += 1) bp.place('block', [0, 2, z]);
  if (config) bp.setConfig(joint.id, config);
  return { bp, placed: bp.get(joint.id) };
}

describe('a part with nothing to show', () => {
  it('shows nothing for a plain block', () => {
    const bp = new Blueprint();
    const block = bp.place('block', [0, 0, 0]);
    expect(envelopeOf(bp, bp.get(block.id))).toBe(null);
  });

  it('shows nothing for a wheel, which nobody has ever wondered about', () => {
    const bp = new Blueprint();
    bp.place('block', [0, 0, 0]);
    const wheel = bp.place('wheel', [1, 0, 0], IDENTITY_ORIENTATION);
    expect(envelopeOf(bp, bp.get(wheel.id))).toBe(null);
  });

  it('shows nothing for nothing at all', () => {
    expect(envelopeOf(new Blueprint(), null)).toBe(null);
  });
});

describe('a hinge', () => {
  it('draws the arc its limits allow', () => {
    const { bp, placed } = arm('hinge', { boom: 2 });
    const envelope = envelopeOf(bp, placed);
    expect(envelope.kind).toBe('arc');
    // The hinge stops just short of straight up either way: 1.55 radians.
    expect(envelope.from).toBeCloseTo(-88.8, 0);
    expect(envelope.to).toBeCloseTo(88.8, 0);
    expect(envelope.label).toMatch(/-89° to 89°/);
  });

  it('draws it in the plane it actually turns in', () => {
    const { bp, placed } = arm('hinge', { boom: 2 });
    const { axis, zero } = envelopeOf(bp, placed);
    // The arc has to be square to the axis, or it is a picture of a rotation
    // that is not the one the joint does.
    expect(axis.x * zero.x + axis.y * zero.y + axis.z * zero.z).toBeCloseTo(0, 6);
    expect(Math.hypot(axis.x, axis.y, axis.z)).toBeCloseTo(1, 6);
  });

  it('turns its axis with the part', () => {
    const straight = arm('hinge', { boom: 1 });
    const flat = envelopeOf(straight.bp, straight.placed).axis;
    expect(Math.abs(flat.x)).toBeCloseTo(1, 6);

    const bp = new Blueprint();
    for (let z = 0; z <= 1; z += 1) bp.place('block', [0, 0, z]);
    const turned = bp.place('hinge', [0, 1, 1], yawStep(IDENTITY_ORIENTATION));
    const axis = envelopeOf(bp, bp.get(turned.id)).axis;
    expect(Math.abs(axis.z)).toBeCloseTo(1, 6);
  });
});

describe('a servo, which is the one with the numbers on it', () => {
  it('draws the arc between the two angles it was given', () => {
    const { bp, placed } = arm('positioner', { boom: 2, config: { angleA: -20, angleB: 75 } });
    const envelope = envelopeOf(bp, placed);
    expect(envelope.kind).toBe('arc');
    expect(envelope.from).toBe(-20);
    expect(envelope.to).toBe(75);
    expect(envelope.label).toBe('-20° to 75°');
  });

  it('redraws when the angles change, which is the whole point', () => {
    const narrow = arm('positioner', { boom: 2, config: { angleA: -10, angleB: 10 } });
    const wide = arm('positioner', { boom: 2, config: { angleA: -170, angleB: 170 } });
    const a = envelopeOf(narrow.bp, narrow.placed);
    const b = envelopeOf(wide.bp, wide.placed);
    expect(b.to - b.from).toBeGreaterThan((a.to - a.from) * 8);
  });

  it('does not mind which way round they were set', () => {
    const { bp, placed } = arm('positioner', { boom: 1, config: { angleA: 80, angleB: -40 } });
    const envelope = envelopeOf(bp, placed);
    expect(envelope.from).toBe(-40);
    expect(envelope.to).toBe(80);
  });
});

describe('a turntable', () => {
  it('draws the whole circle, because that is what it does', () => {
    const { bp, placed } = arm('turntable', { boom: 0 });
    const envelope = envelopeOf(bp, placed);
    expect(envelope.kind).toBe('spin');
    expect(envelope.to - envelope.from).toBe(360);
    expect(envelope.axis.y).toBeCloseTo(1, 6);
  });
});

describe('a ram and a strut', () => {
  it('draws how far a piston pushes out', () => {
    const bp = new Blueprint();
    bp.place('block', [0, 0, 0]);
    const piston = bp.place('piston', [0, 1, 0]);
    bp.setConfig(piston.id, { stroke: 1.8 });
    const envelope = envelopeOf(bp, bp.get(piston.id));
    expect(envelope.kind).toBe('slide');
    expect(envelope.from).toBe(0);
    expect(envelope.to).toBeCloseTo(1.8, 6);
    expect(envelope.label).toMatch(/1.80 m/);
  });

  it('follows the stroke it was set to', () => {
    const bp = new Blueprint();
    bp.place('block', [0, 0, 0]);
    const piston = bp.place('piston', [0, 1, 0]);
    bp.setConfig(piston.id, { stroke: 0.6 });
    const short = envelopeOf(bp, bp.get(piston.id)).to;
    bp.setConfig(piston.id, { stroke: 2.2 });
    const long = envelopeOf(bp, bp.get(piston.id)).to;
    expect(long).toBeGreaterThan(short * 3);
  });

  it('draws a strut giving either way from where it was built', () => {
    const bp = new Blueprint();
    bp.place('block', [0, 0, 0]);
    const strut = bp.place('suspension', [0, 1, 0]);
    bp.setConfig(strut.id, { travel: 0.5 });
    const envelope = envelopeOf(bp, bp.get(strut.id));
    expect(envelope.kind).toBe('slide');
    expect(envelope.from).toBeCloseTo(-0.25, 6);
    expect(envelope.to).toBeCloseTo(0.25, 6);
  });
});

describe('the things that look rather than move', () => {
  it('draws how far a grabber reaches', () => {
    const bp = new Blueprint();
    bp.place('block', [0, 0, 0]);
    const grabber = bp.place('grabber', [0, 1, 0]);
    const envelope = envelopeOf(bp, bp.get(grabber.id));
    expect(envelope.kind).toBe('reach');
    expect(envelope.length).toBe(getPart('grabber').grabber.reach);
  });

  it('draws how far a sensor sees, down the way it is pointed', () => {
    const bp = new Blueprint();
    bp.place('block', [0, 0, 0]);
    const sensor = bp.place('sensor', [0, 1, 0]);
    const envelope = envelopeOf(bp, bp.get(sensor.id));
    expect(envelope.kind).toBe('reach');
    expect(envelope.length).toBe(getPart('sensor').sensor.range);
    expect(Math.hypot(envelope.axis.x, envelope.axis.y, envelope.axis.z)).toBeCloseTo(1, 6);
  });
});

describe('how big the sweep is drawn', () => {
  it('is measured off what is bolted to the far side of the joint', () => {
    const bare = arm('hinge', { boom: 0 });
    const short = arm('hinge', { boom: 1 });
    const long = arm('hinge', { boom: 4 });
    const radius = ({ bp, placed }) => envelopeOf(bp, placed).radius;
    expect(radius(short)).toBeGreaterThan(radius(bare));
    expect(radius(long)).toBeGreaterThan(radius(short) + 1);
    // Four cells of boom out from the joint, plus half of the last one and a
    // little clear air.
    expect(radius(long)).toBeGreaterThan(4 * CELL);
  });

  it('knows which parts actually move with it', () => {
    const { bp, placed } = arm('hinge', { boom: 3 });
    const carried = carriedBy(bp, placed).map((p) => p.type);
    expect(carried).toContain('hinge');
    expect(carried.filter((t) => t === 'block')).toHaveLength(3);
    // The chassis and the core stay put, whatever the hinge does.
    expect(carried).not.toContain('core');
  });

  it('ignores whatever lies along the axis, which does not swing', () => {
    const bp = new Blueprint();
    for (let z = 0; z <= 1; z += 1) bp.place('block', [0, 0, z]);
    const hinge = bp.place('hinge', [0, 1, 1]);
    // A hinge turns about X, so a boom running along X goes round on the spot.
    for (let x = 1; x <= 3; x += 1) bp.place('block', [x, 2, 1]);
    const placed = bp.get(hinge.id);
    const along = envelopeOf(bp, placed).radius;

    const other = new Blueprint();
    for (let z = 0; z <= 1; z += 1) other.place('block', [0, 0, z]);
    const second = other.place('hinge', [0, 1, 1]);
    for (let z = 1; z <= 3; z += 1) other.place('block', [0, 2, z]);
    const across = envelopeOf(other, other.get(second.id)).radius;

    expect(across).toBeGreaterThan(along);
  });

  it('still draws something for a joint carrying nothing yet', () => {
    const { bp, placed } = arm('hinge', { boom: 0 });
    expect(envelopeOf(bp, placed).radius).toBeGreaterThan(CELL);
  });

  it('is the same answer whether or not the grouping is handed in', () => {
    // The studio already has the grouping worked out and passes it in so the
    // envelope is not re-derived sixty times a second. It must not be a
    // different answer when it does.
    const { bp, placed } = arm('hinge', { boom: 2 });
    const axis = [1, 0, 0];
    const fresh = sweepRadius(bp, placed, axis);
    const handed = sweepRadius(bp, placed, axis, groupBlueprint(bp));
    expect(handed).toBe(fresh);
    expect(fresh).toBeGreaterThan(CELL);
  });
});
