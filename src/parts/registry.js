import { IDENTITY_ORIENTATION, driveSide } from '../core/orientation.js';

// Every buildable part. `size` is the footprint in grid cells before rotation.
// `attach` lists the local face normals that accept a connection; a part with
// no entry accepts all six faces.

export const CELL = 0.5;
export const CELL_VOLUME = CELL ** 3;

// Parts carry `mass` in kilograms per grid cell; Rapier wants a density.
export function partDensity(part) {
  return part.mass / CELL_VOLUME;
}

/**
 * The direction a part works in, and what that direction means. A part you
 * have to aim is useless if you cannot tell which way it is facing, and on a
 * cube that is most of them: which face the magnet grabs on, which way the
 * thruster pushes, where the sensor is looking.
 *
 * `act` is something the part does to the world, `read` something it takes
 * from it, which is the same split as amber and cyan everywhere else.
 */
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function workingAxis(part, rot = IDENTITY_ORIENTATION) {
  if (part.thruster) return { axis: part.thruster.axis, kind: 'act' };
  // A wheel rolls in the plane across its axle. Drawing the axle tells you
  // nothing a round part does not already tell you; what you cannot see is
  // which way it will drive you, which is the axle crossed with its own up.
  //
  // It has to take the rotation, because a wheel's motor is handed: wheels
  // facing each other across a chassis mount with opposite axles, and the
  // machine flips the command on one side so both drive it the same way. An
  // arrow that ignored that would point the left wheels forward and the right
  // ones backward, which is a picture of the joint convention rather than of
  // what the wheel actually does.
  if (part.radius && part.joint === 'revolute') {
    const roll = cross(part.axis, [0, 1, 0]);
    const along = roll.some(Boolean) ? roll : cross(part.axis, [0, 0, 1]);
    const side = driveSide(rot);
    // `|| 0` so flipping a zero component gives 0 rather than -0.
    return { axis: along.map((n) => (n * side) || 0), kind: 'act' };
  }
  if (part.sensor) return { axis: part.sensor.axis, kind: 'read' };
  if (part.flight) return { axis: [0, 0, 1], kind: 'read' };
  if (part.grabber) return { axis: [0, 1, 0], kind: 'act' };
  if (part.joint === 'prismatic') return { axis: [0, 1, 0], kind: 'act' };
  return null;
}

function clampTo(value, [lo, hi], fallback) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * How fast a turntable is set to turn, in radians a second.
 */
export function turntableSpin(placed, part = getPart('turntable')) {
  return clampTo(placed?.config?.spin, part.spinRange, part.spin);
}

/**
 * How hard it is allowed to push to get there, in newton-metres.
 *
 * The range matters more than the default, and what it buys is spin-up time
 * rather than top speed: a level boom on an upright axis has no gravity
 * pulling back against it, so a weak motor gets there eventually — or not at
 * all. Swept on a three-cell boom, seconds to reach 4.5 rad/s:
 *
 *     torque      12     40    100    240    600   1800
 *     bare      0.43   0.12   0.05   0.02   0.00   0.00
 *     loaded   never   1.50   0.23   0.07   0.03   0.02
 *
 * So 12 stalls a loaded boom outright, 40 heaves it round over a second and a
 * half, 100 is brisk and anything past 600 is instant. Those are the menial
 * and the heavy ends, and the range covers both with room either side.
 */
export function turntableTorque(placed, part = getPart('turntable')) {
  return clampTo(placed?.config?.torque, part.torqueRange, part.torque);
}

/**
 * How far a piston is set to push, in metres. Each one carries its own, so a
 * short jab and a long reach can sit on the same machine; anything outside
 * what the part can do is pulled back to the nearest end of its range.
 */
export function pistonStroke(placed, part = getPart('piston')) {
  const [min, max] = part.strokeRange;
  const asked = placed?.config?.stroke;
  if (typeof asked !== 'number' || Number.isNaN(asked)) return part.stroke;
  return Math.min(max, Math.max(min, asked));
}

export const CATEGORIES = [
  { id: 'core', name: 'Core' },
  { id: 'structure', name: 'Structure' },
  { id: 'drive', name: 'Drive' },
  { id: 'manipulator', name: 'Manipulators' },
  { id: 'flight', name: 'Flight' },
  { id: 'avionics', name: 'Avionics' },
  { id: 'logic', name: 'Sensors' },
];

const PARTS = [
  {
    id: 'core',
    name: 'Control Core',
    category: 'core',
    size: [1, 1, 1],
    mass: 1.5,
    colour: 0xffb347,
    unique: true,
    cost: 0,
    blurb: 'The brain. Every machine needs exactly one.',
  },
  {
    id: 'block',
    name: 'Block',
    category: 'structure',
    size: [1, 1, 1],
    mass: 1.2,
    colour: 0x9aa7b4,
    cost: 1,
    blurb: 'Plain structural cube.',
  },
  {
    id: 'beam',
    name: 'Beam',
    category: 'structure',
    size: [3, 1, 1],
    mass: 0.8,
    colour: 0x8792a0,
    cost: 2,
    blurb: 'Three cells long. Cheaper per cell than blocks.',
  },
  {
    id: 'panel',
    name: 'Panel',
    category: 'structure',
    size: [3, 1, 3],
    mass: 0.45,
    colour: 0x76828f,
    cost: 3,
    blurb: 'Wide and light. Good for decks and wings.',
  },
  {
    id: 'ballast',
    name: 'Ballast',
    category: 'structure',
    size: [1, 1, 1],
    mass: 8,
    colour: 0x4a5058,
    cost: 2,
    blurb: 'Very heavy. Lowers the centre of mass.',
  },
  {
    id: 'wheel',
    ports: {
      in: [{ id: 'throttle', name: 'Throttle', kind: 'number', min: -1, max: 1 }],
      out: [{ id: 'spin', name: 'Spin rate', kind: 'number' }],
    },
    name: 'Powered Wheel',
    category: 'drive',
    size: [1, 1, 1],
    mass: 1.1,
    colour: 0x2f3439,
    cost: 3,
    articulated: true,
    joint: 'revolute',
    axis: [1, 0, 0],
    attach: [[-1, 0, 0]],
    radius: 0.42,
    width: 0.28,
    friction: 2.4,
    actuator: {
      kind: 'motor',
      port: 'throttle',
      signal: 'axis',
      maxSpeed: 11,
      maxForce: 22,
      defaultBinding: { mode: 'drive', pos: 'KeyW', neg: 'KeyS', left: 'KeyA', right: 'KeyD' },
    },
    blurb: 'Drives on its axle. Bind two sets to opposite keys to steer.',
  },
  {
    id: 'castor',
    name: 'Castor',
    category: 'drive',
    size: [1, 1, 1],
    mass: 0.5,
    colour: 0x596069,
    cost: 1,
    articulated: true,
    joint: 'revolute',
    axis: [1, 0, 0],
    attach: [[-1, 0, 0]],
    radius: 0.3,
    width: 0.24,
    friction: 0.35,
    blurb: 'Unpowered roller. Takes weight without fighting the steering.',
  },
  {
    id: 'hinge',
    ports: {
      in: [{ id: 'target', name: 'Target angle', kind: 'number', min: -1, max: 1 }],
      out: [{ id: 'angle', name: 'Angle', kind: 'number' }],
    },
    name: 'Servo Hinge',
    category: 'manipulator',
    size: [1, 1, 1],
    mass: 1.4,
    colour: 0x4ea1ff,
    cost: 4,
    articulated: true,
    joint: 'revolute',
    axis: [1, 0, 0],
    attach: [[0, -1, 0]],
    carry: [[0, 1, 0]],
    limits: [-1.55, 1.55],
    actuator: {
      kind: 'servo',
      port: 'target',
      signal: 'axis',
      range: 1.55,
      stiffness: 140,
      damping: 26,
      defaultBinding: { mode: 'axis', pos: 'KeyR', neg: 'KeyF' },
    },
    blurb: 'Holds an angle. Build arms and steering knuckles from these.',
  },
  {
    id: 'turntable',
    ports: {
      in: [{ id: 'speed', name: 'Speed', kind: 'number', min: -1, max: 1 }],
      out: [
        { id: 'angle', name: 'Angle', kind: 'number' },
        { id: 'rate', name: 'Turn rate', kind: 'number' },
      ],
    },
    name: 'Turntable',
    category: 'manipulator',
    size: [1, 1, 1],
    mass: 2.2,
    colour: 0xc27bd6,
    cost: 5,
    articulated: true,
    joint: 'revolute',
    axis: [0, 1, 0],
    attach: [[0, -1, 0]],
    carry: [[0, 1, 0]],
    // No limits: unlike the hinge it goes round and round, which is what
    // makes it the thing you build a launcher on.
    spin: 6,
    spinRange: [0.5, 14],
    torque: 240,
    torqueRange: [12, 1800],
    actuator: {
      kind: 'spin',
      port: 'speed',
      signal: 'axis',
      defaultBinding: { mode: 'axis', pos: 'KeyZ', neg: 'KeyX' },
    },
    blurb: 'A motorised bearing. Stand anything on it and turn it. Set the speed and the torque.',
  },
  {
    id: 'piston',
    ports: {
      in: [{ id: 'target', name: 'Target extension', kind: 'number', min: 0, max: 1 }],
      out: [{ id: 'extension', name: 'Extension', kind: 'number' }],
    },
    name: 'Piston',
    category: 'manipulator',
    size: [1, 1, 1],
    mass: 1.4,
    colour: 0x36c9a4,
    cost: 4,
    articulated: true,
    joint: 'prismatic',
    axis: [0, 1, 0],
    attach: [[0, -1, 0]],
    carry: [[0, 1, 0]],
    stroke: 1.2,
    strokeRange: [0.4, 2.4],
    actuator: {
      kind: 'linear',
      port: 'target',
      signal: 'hold',
      stiffness: 500,
      damping: 70,
      defaultBinding: { mode: 'hold', pos: 'KeyE' },
    },
    blurb: 'Extends along its axis. Pushes hard. Set how far it reaches.',
  },
  {
    id: 'grabber',
    ports: {
      in: [{ id: 'active', name: 'Grab', kind: 'bool' }],
      out: [{ id: 'holding', name: 'Holding', kind: 'bool' }],
    },
    name: 'Magnet Grabber',
    category: 'manipulator',
    size: [1, 1, 1],
    mass: 1.1,
    colour: 0xd6543f,
    cost: 5,
    grabber: { reach: 0.85, strength: 900 },
    actuator: {
      kind: 'grab',
      port: 'active',
      signal: 'toggle',
      defaultBinding: { mode: 'toggle', pos: 'KeyG' },
    },
    blurb: 'Latches onto whatever touches its face. Toggle to release.',
  },
  {
    id: 'propeller',
    ports: {
      in: [{ id: 'throttle', name: 'Throttle', kind: 'number', min: 0, max: 1 }],
      out: [],
    },
    name: 'Lift Rotor',
    category: 'flight',
    size: [1, 1, 1],
    mass: 0.9,
    colour: 0xc9d34e,
    cost: 6,
    thruster: { axis: [0, 1, 0], maxThrust: 95, spin: 42, reaction: 9 },
    actuator: {
      kind: 'thrust',
      port: 'throttle',
      signal: 'hold',
      defaultBinding: { mode: 'hold', pos: 'Space' },
    },
    blurb: 'Strong lift out of its top face. Tilt it with T — R only spins it on the spot.',
  },
  {
    id: 'thruster',
    ports: {
      in: [{ id: 'throttle', name: 'Throttle', kind: 'number', min: 0, max: 1 }],
      out: [],
    },
    name: 'Jet Thruster',
    category: 'flight',
    size: [1, 1, 1],
    mass: 1.1,
    colour: 0xff7a45,
    cost: 5,
    thruster: { axis: [0, 1, 0], maxThrust: 55, spin: 0 },
    actuator: {
      kind: 'thrust',
      port: 'throttle',
      signal: 'hold',
      defaultBinding: { mode: 'hold', pos: 'ShiftLeft' },
    },
    blurb: 'Steady push out of its nozzle. Tilt it with T — R only spins it on the spot.',
  },
  {
    id: 'controller',
    ports: {
      in: [
        { id: 'pitch', name: 'Pitch', kind: 'number', min: -1, max: 1 },
        { id: 'yaw', name: 'Yaw', kind: 'number', min: -1, max: 1 },
        { id: 'roll', name: 'Strafe', kind: 'number', min: -1, max: 1 },
        { id: 'climb', name: 'Climb', kind: 'number', min: -1, max: 1 },
        { id: 'targetAltitude', name: 'Hold altitude', kind: 'number' },
      ],
      out: [
        { id: 'altitude', name: 'Altitude', kind: 'number' },
        { id: 'verticalSpeed', name: 'Climb rate', kind: 'number' },
        { id: 'forwardSpeed', name: 'Forward speed', kind: 'number' },
        { id: 'rightSpeed', name: 'Right speed', kind: 'number' },
        { id: 'levelness', name: 'Levelness', kind: 'number' },
      ],
    },
    name: 'Flight Controller',
    category: 'avionics',
    size: [1, 1, 1],
    mass: 1.2,
    colour: 0x37d4c8,
    unique: true,
    cost: 8,
    flight: {
      maxLean: 0.38,
      maxClimbRate: 4.5,
      maxYawRate: 2.2,
      altitudeGain: 1.5,
      climbRateGain: 3.2,
      integralGain: 1.1,
      integralLimit: 5,
      attitudeGain: 5.5,
      attitudeDamping: 1.4,
      yawGain: 1.1,
      velocityGain: 0.22,
      authority: 0.45,
      defaultKeys: {
        forward: 'KeyW',
        back: 'KeyS',
        left: 'KeyA',
        right: 'KeyD',
        up: 'Space',
        down: 'ShiftLeft',
      },
    },
    blurb: 'Mixes every rotor and thruster linked to it, and holds altitude when you let go.',
  },
  {
    id: 'gps',
    name: 'GPS',
    category: 'avionics',
    size: [1, 1, 1],
    mass: 0.4,
    colour: 0x7ad4ff,
    cost: 4,
    ports: {
      in: [],
      out: [
        { id: 'position', name: 'Position', kind: 'vec3' },
        { id: 'velocity', name: 'Velocity', kind: 'vec3' },
        { id: 'speed', name: 'Ground speed', kind: 'number' },
        { id: 'altitude', name: 'Altitude', kind: 'number' },
        { id: 'heading', name: 'Heading', kind: 'number' },
      ],
    },
    blurb: 'Tells the computer where the machine is, how fast it is going and which way it faces.',
  },
  {
    id: 'computer',
    name: 'Computer',
    category: 'avionics',
    size: [1, 1, 1],
    mass: 1,
    colour: 0xffa3d1,
    unique: true,
    cost: 10,
    computer: true,
    blurb: 'Runs the program you draw. States, each with its own loop, wired to every module on the machine.',
  },
  {
    id: 'sensor',
    ports: {
      in: [],
      out: [
        { id: 'distance', name: 'Distance', kind: 'number' },
        { id: 'tripped', name: 'Tripped', kind: 'bool' },
      ],
    },
    name: 'Distance Sensor',
    category: 'logic',
    size: [1, 1, 1],
    mass: 0.35,
    colour: 0xb06bff,
    cost: 3,
    sensor: { range: 9, axis: [0, 0, 1] },
    emits: true,
    config: { threshold: 0.5, invert: false },
    blurb: 'Looks along its face. Bind a motor to it to drive itself.',
  },
];

const BY_ID = new Map(PARTS.map((p) => [p.id, p]));

export function getPart(id) {
  const part = BY_ID.get(id);
  if (!part) throw new Error(`Unknown part type: ${id}`);
  return part;
}

export function allParts() {
  return PARTS.slice();
}

export function partsInCategory(category) {
  return PARTS.filter((p) => p.category === category);
}

export function attachFaces(part) {
  return part.attach ?? [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1],
  ];
}

export function isActuator(part) {
  return Boolean(part.actuator);
}

export function portsOf(part, direction) {
  return part.ports?.[direction] ?? [];
}

export function findPort(part, direction, id) {
  return portsOf(part, direction).find((port) => port.id === id) ?? null;
}
