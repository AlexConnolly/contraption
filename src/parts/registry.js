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
      signal: 'axis',
      maxSpeed: 14,
      maxForce: 14,
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
      signal: 'hold',
      stiffness: 500,
      damping: 70,
      defaultBinding: { mode: 'hold', pos: 'KeyE' },
    },
    blurb: 'Extends along its axis. Pushes hard.',
  },
  {
    id: 'grabber',
    name: 'Magnet Grabber',
    category: 'manipulator',
    size: [1, 1, 1],
    mass: 1.1,
    colour: 0xd6543f,
    cost: 5,
    grabber: { reach: 0.85, strength: 900 },
    actuator: {
      kind: 'grab',
      signal: 'toggle',
      defaultBinding: { mode: 'toggle', pos: 'KeyG' },
    },
    blurb: 'Latches onto whatever touches its face. Toggle to release.',
  },
  {
    id: 'propeller',
    name: 'Lift Rotor',
    category: 'flight',
    size: [1, 1, 1],
    mass: 0.9,
    colour: 0xc9d34e,
    cost: 6,
    thruster: { axis: [0, 1, 0], maxThrust: 38, spin: 42 },
    actuator: {
      kind: 'thrust',
      signal: 'hold',
      defaultBinding: { mode: 'hold', pos: 'Space' },
    },
    blurb: 'Strong lift straight up its axis. Hungry for power.',
  },
  {
    id: 'thruster',
    name: 'Jet Thruster',
    category: 'flight',
    size: [1, 1, 1],
    mass: 1.1,
    colour: 0xff7a45,
    cost: 5,
    thruster: { axis: [0, 1, 0], maxThrust: 18, spin: 0 },
    actuator: {
      kind: 'thrust',
      signal: 'hold',
      defaultBinding: { mode: 'hold', pos: 'ShiftLeft' },
    },
    blurb: 'Steady push along its axis. Aim it any way you like.',
  },
  {
    id: 'sensor',
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
