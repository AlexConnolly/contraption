import { describe, it, expect } from 'vitest';
import {
  ORIENTATIONS,
  applyOrientation,
  applyOrientationInverse,
  determinant,
  composeOrientation,
  orientationQuaternion,
  IDENTITY_ORIENTATION,
  yawStep,
} from '../src/core/orientation.js';

describe('orientation', () => {
  it('has exactly 24 distinct rotations', () => {
    expect(ORIENTATIONS).toHaveLength(24);
    const unique = new Set(ORIENTATIONS.map((m) => m.join(',')));
    expect(unique.size).toBe(24);
  });

  it('contains only proper rotations', () => {
    for (let i = 0; i < ORIENTATIONS.length; i += 1) {
      expect(determinant(i)).toBe(1);
    }
  });

  it('leaves vectors untouched under the identity', () => {
    expect(applyOrientation(IDENTITY_ORIENTATION, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('composes rotations consistently with applying them in sequence', () => {
    const v = [1, 2, 3];
    for (let a = 0; a < 24; a += 1) {
      for (let b = 0; b < 24; b += 1) {
        const composed = composeOrientation(a, b);
        expect(composed).toBeGreaterThanOrEqual(0);
        expect(applyOrientation(composed, v)).toEqual(
          applyOrientation(a, applyOrientation(b, v)),
        );
      }
    }
  });

  it('inverts exactly', () => {
    for (let i = 0; i < 24; i += 1) {
      expect(applyOrientationInverse(i, applyOrientation(i, [1, 2, 3])))
        .toEqual([1, 2, 3]);
    }
  });

  it('returns to the start after four yaw steps', () => {
    let rot = IDENTITY_ORIENTATION;
    for (let i = 0; i < 4; i += 1) rot = yawStep(rot);
    expect(rot).toBe(IDENTITY_ORIENTATION);
  });

  it('produces unit quaternions that rotate the same way as the matrix', () => {
    for (let i = 0; i < 24; i += 1) {
      const q = orientationQuaternion(i);
      const len = Math.hypot(q.x, q.y, q.z, q.w);
      expect(len).toBeCloseTo(1, 6);
      const v = [1, 0, 0];
      const rotated = rotateByQuaternion(q, v);
      const expected = applyOrientation(i, v);
      for (let k = 0; k < 3; k += 1) {
        expect(rotated[k]).toBeCloseTo(expected[k], 6);
      }
    }
  });
});

function rotateByQuaternion(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}
