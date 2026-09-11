import { describe, it, expect } from 'vitest';
import { allParts, getPart, workingAxis } from '../src/parts/registry.js';
import { IDENTITY_ORIENTATION, yawStep, applyOrientation } from '../src/core/orientation.js';

describe('direction markers', () => {
  it('points the grabber at the face it actually grabs on', () => {
    // The pad is on +Y, so that is where the arrow has to point.
    expect(workingAxis(getPart('grabber'))).toEqual({ axis: [0, 1, 0], kind: 'act' });
  });

  it('points a thruster the way it pushes you', () => {
    const jet = getPart('thruster');
    expect(workingAxis(jet)).toEqual({ axis: jet.thruster.axis, kind: 'act' });
    const rotor = getPart('propeller');
    expect(workingAxis(rotor).axis).toEqual(rotor.thruster.axis);
  });

  it('points a sensor down its beam, and marks it as reading not acting', () => {
    const sensor = getPart('sensor');
    expect(workingAxis(sensor)).toEqual({ axis: sensor.sensor.axis, kind: 'read' });
  });

  it('shows the flight controller which way it calls forward', () => {
    expect(workingAxis(getPart('controller'))).toEqual({ axis: [0, 0, 1], kind: 'read' });
  });

  it('shows a piston the way it extends', () => {
    expect(workingAxis(getPart('piston')).axis).toEqual([0, 1, 0]);
  });

  // A ring round a wheel's axle looks exactly like the wheel. What you cannot
  // tell by looking is which way it will drive you.
  it('points a wheel the way it drives, not round its axle', () => {
    const wheel = getPart('wheel');
    expect(wheel.axis).toEqual([1, 0, 0]);
    expect(workingAxis(wheel)).toEqual({ axis: [0, 0, 1], kind: 'act' });
  });

  it('marks an unpowered roller the same way', () => {
    expect(workingAxis(getPart('castor')).axis).toEqual([0, 0, 1]);
  });

  // A wheel's motor is handed: the machine flips the command on one side so
  // both sides drive it the same way for the same key. An arrow that ignores
  // that points the left wheels forward and the right ones backward, which is
  // a picture of the joint convention rather than of what the wheel does.
  it('points both sides of a rover the same way in the world', () => {
    const wheel = getPart('wheel');
    const left = IDENTITY_ORIENTATION;
    const right = yawStep(yawStep(IDENTITY_ORIENTATION));
    const world = (rot) => applyOrientation(rot, workingAxis(wheel, rot).axis).map(Math.round);
    expect(world(left)).toEqual([0, 0, 1]);
    expect(world(right)).toEqual([0, 0, 1]);
  });

  it('does the same for an unpowered roller, which rolls the same way', () => {
    const castor = getPart('castor');
    const world = (rot) => applyOrientation(rot, workingAxis(castor, rot).axis).map(Math.round);
    expect(world(IDENTITY_ORIENTATION)).toEqual(world(yawStep(yawStep(IDENTITY_ORIENTATION))));
  });

  it('leaves a part with no handedness alone whatever it is turned to', () => {
    const jet = getPart('thruster');
    for (const rot of [IDENTITY_ORIENTATION, yawStep(IDENTITY_ORIENTATION)]) {
      expect(workingAxis(jet, rot).axis).toEqual(jet.thruster.axis);
    }
  });

  it('leaves plain structure unmarked', () => {
    for (const id of ['block', 'beam', 'panel', 'ballast']) {
      expect(workingAxis(getPart(id)), id).toBe(null);
    }
  });

  // The whole point is that a part you have to aim can be aimed. Anything
  // that acts on the world in one direction has to say which.
  it('marks every part that has to be aimed', () => {
    for (const part of allParts()) {
      const aimed = Boolean(part.thruster || part.sensor || part.grabber);
      if (aimed) expect(workingAxis(part), part.name).not.toBe(null);
    }
  });

  it('only ever says act or read', () => {
    for (const part of allParts()) {
      const hint = workingAxis(part);
      if (hint) expect(['act', 'read'], part.name).toContain(hint.kind);
    }
  });
});
