// Every buildable part. `size` is the footprint in grid cells before rotation.
// `attach` lists the local face normals that accept a connection; a part with
// no entry accepts all six faces.

export const CELL = 0.5;
export const CELL_VOLUME = CELL ** 3;

// Parts carry `mass` in kilograms per grid cell; Rapier wants a density.
export function partDensity(part) {
  return part.mass / CELL_VOLUME;
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
    actuator: {
      kind: 'linear',
      port: 'target',
      signal: 'hold',
      stiffness: 500,
      damping: 70,
      defaultBinding: { mode: 'hold', pos: 'KeyE' },
    },
    blurb: 'Extends along its axis. Pushes hard.',
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
    sensor: { range: 6, axis: [0, 0, 1] },
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
