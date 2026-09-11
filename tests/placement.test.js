import { describe, it, expect } from 'vitest';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep, pitchStep } from '../src/core/orientation.js';
import { wouldConnect } from '../src/sim/connectivity.js';

// A servo hinge joins on its bottom face and carries on its top. Stood on any
// other face it still sits in the grid perfectly happily and still passes the
// overlap check — it just never attaches to anything, which you used to find
// out only when you pressed Test.
describe('whether a placement will actually hold', () => {
  function chassis() {
    const bp = new Blueprint();
    bp.place('panel', [0, 0, 0]);
    bp.place('core', [0, 1, 0]);
    return bp;
  }

  it('joins a hinge sitting upright on the deck', () => {
    const bp = chassis();
    const result = wouldConnect(bp, 'hinge', [1, 1, 0], IDENTITY_ORIENTATION);
    expect(result.touching).toBeGreaterThan(0);
    expect(result.joined).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
  });

  it('refuses a hinge lying on a face that does not connect', () => {
    const bp = chassis();
    // Tipped onto its side, the faces against the deck are neither its attach
    // face nor its carry face.
    const result = wouldConnect(bp, 'hinge', [1, 1, 0], pitchStep(IDENTITY_ORIENTATION));
    expect(result.touching).toBeGreaterThan(0);
    expect(result.joined).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/turn it/i);
  });

  it('blames the part being placed when it is the one refusing', () => {
    const bp = chassis();
    const result = wouldConnect(bp, 'hinge', [1, 1, 0], pitchStep(IDENTITY_ORIENTATION));
    expect(result.reason).toMatch(/servo hinge/i);
  });

  it('blames the other part when that is the one refusing', () => {
    const bp = chassis();
    // A wheel only accepts a connection on its axle face, so a block stuck to
    // any other side of it has nothing holding it.
    bp.place('wheel', [1, 1, 0], IDENTITY_ORIENTATION);
    const result = wouldConnect(bp, 'block', [1, 2, 0], IDENTITY_ORIENTATION);
    expect(result.joined).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/powered wheel/i);
  });

  it('lets plain structure join on any face', () => {
    const bp = chassis();
    for (const rot of [IDENTITY_ORIENTATION, yawStep(IDENTITY_ORIENTATION), pitchStep(IDENTITY_ORIENTATION)]) {
      expect(wouldConnect(bp, 'block', [1, 1, 0], rot).ok).toBe(true);
    }
  });

  it('allows the first part, with nothing to join to', () => {
    const result = wouldConnect(new Blueprint(), 'core', [0, 0, 0], IDENTITY_ORIENTATION);
    expect(result.touching).toBe(0);
    expect(result.ok).toBe(true);
  });

  // Turning a part in place asks the same question about the same cells, so
  // it has to not count itself as the thing holding it up.
  it('does not let a part hold itself up when it is turned in place', () => {
    const bp = chassis();
    const { id } = bp.place('hinge', [1, 1, 0], IDENTITY_ORIENTATION);
    const turned = wouldConnect(bp, 'hinge', [1, 1, 0], pitchStep(IDENTITY_ORIENTATION), id);
    expect(turned.ok).toBe(false);
    const upright = wouldConnect(bp, 'hinge', [1, 1, 0], IDENTITY_ORIENTATION, id);
    expect(upright.ok).toBe(true);
  });

  // Somewhere out on its own is a different mistake, already reported when a
  // run starts. Only a part that is against something and still not held is
  // refused here.
  it('allows a part placed away from everything', () => {
    const bp = chassis();
    const result = wouldConnect(bp, 'block', [6, 0, 6], IDENTITY_ORIENTATION);
    expect(result.touching).toBe(0);
    expect(result.ok).toBe(true);
  });
});
