// The 24 axis-aligned rotations of a cube, as 3x3 integer matrices in
// column-major order [m00,m10,m20, m01,m11,m21, m02,m12,m22].

const AXES = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function buildOrientations() {
  const out = [];
  for (const x of AXES) {
    for (const y of AXES) {
      if (dot(x, y) !== 0) continue;
      const z = cross(x, y);
      out.push([x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]]);
    }
  }
  return out;
}

export const ORIENTATIONS = buildOrientations();
export const ORIENTATION_COUNT = ORIENTATIONS.length;

export function applyOrientation(index, v) {
  const m = ORIENTATIONS[index];
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

export function determinant(index) {
  const m = ORIENTATIONS[index];
  return (
    m[0] * (m[4] * m[8] - m[7] * m[5]) -
    m[3] * (m[1] * m[8] - m[7] * m[2]) +
    m[6] * (m[1] * m[5] - m[4] * m[2])
  );
}

export function composeOrientation(a, b) {
  const x = applyOrientation(a, applyOrientation(b, [1, 0, 0]));
  const y = applyOrientation(a, applyOrientation(b, [0, 1, 0]));
  const z = applyOrientation(a, applyOrientation(b, [0, 0, 1]));
  const target = [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
  return ORIENTATIONS.findIndex((m) => m.every((n, i) => n === target[i]));
}

// Quaternion for the rotation, for handing to Three.js and Rapier.
export function orientationQuaternion(index) {
  const m = ORIENTATIONS[index];
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = m;
  const trace = m00 + m11 + m22;
  let x, y, z, w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return { x, y, z, w };
}

export const IDENTITY_ORIENTATION = ORIENTATIONS.findIndex(
  (m) => m[0] === 1 && m[4] === 1 && m[8] === 1,
);

/**
 * The three quarter turns, one about each world axis.
 *
 * Applied on the left, which is what makes them world turns rather than turns
 * in the part's own frame: a key means the same thing whatever the part is
 * already doing, instead of meaning something different depending on what you
 * pressed last.
 *
 * There are three because a cube has three axes. Two of them generate all
 * twenty-four rotations, but badly -- from square on, reaching a given one
 * took three presses on average and five at worst, with only two of the
 * twenty-four a single press away. With all three and a reverse it is 1.92 and
 * three, and six are one press away. More to the point, three is a model
 * somebody can hold in their head and two is a thing you learn by flailing.
 */
const QUARTER = {
  // About +Y: turns it round, the way you point a machine.
  yaw: [0, 0, -1, 0, 1, 0, 1, 0, 0],
  // About +X: tips it forward and back.
  pitch: [1, 0, 0, 0, 0, 1, 0, -1, 0],
  // About +Z: rolls it onto its side.
  roll: [0, 1, 0, -1, 0, 0, 0, 0, 1],
};

export const TURN_AXES = Object.keys(QUARTER);

const quarterIndex = (axis) => ORIENTATIONS.findIndex(
  (m) => m.every((n, i) => n === QUARTER[axis][i]),
);

/**
 * One quarter turn about a world axis, or several. `quarters` of 3 is the same
 * as one the other way, which is what a reverse key is.
 */
export function turnStep(index, axis = 'yaw', quarters = 1) {
  const step = quarterIndex(axis);
  if (step < 0) return index;
  let out = index;
  for (let n = 0; n < ((quarters % 4) + 4) % 4; n += 1) out = composeOrientation(step, out);
  return out;
}

export function yawStep(index) {
  return turnStep(index, 'yaw');
}

export function pitchStep(index) {
  return turnStep(index, 'pitch');
}

export function rollStep(index) {
  return turnStep(index, 'roll');
}

// Orientation matrices are orthonormal, so the inverse is the transpose.
export function applyOrientationInverse(index, v) {
  const m = ORIENTATIONS[index];
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * Which side of the machine a part bolted at this rotation sits on: +1 for
 * one side, -1 for the other. Opposite sides mount with opposite axle
 * directions, so a motor command has to be flipped on one of them for both to
 * drive the machine the same way.
 *
 * With forward at +Z and up at +Y, the machine's right is forward x up = -X,
 * so a part returning +1 sits on the machine's LEFT.
 */
export function driveSide(rot) {
  const axle = applyOrientation(rot, [1, 0, 0]);
  const dominant = axle.find((n) => n !== 0) ?? 1;
  return dominant < 0 ? -1 : 1;
}
