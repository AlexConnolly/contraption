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
  // Which way the upper half goes when it fires. Worth seeing before you build
  // a rocket upside down.
  if (part.separation) return { axis: part.axis, kind: 'act' };
  if (part.joint === 'prismatic') return { axis: [0, 1, 0], kind: 'act' };
  return null;
}

/**
 * Which way round a turning joint works. Two hinges facing each other — the
 * jaws of a grabber, a pair of legs — are mirror images, so one key has to
 * close them both, and without this the only way to get that was to mount one
 * of them backwards and lose the sensible facing along with it.
 */
export function jointFlip(placed) {
  return placed?.config?.flip ? -1 : 1;
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
 * How hard a powered joint fights to hold the position it was told.
 *
 * One is what every joint used to do. Higher holds a long loaded arm out level
 * instead of letting it droop; zero stops it holding anything at all and
 * leaves a free pivot, which is a swing — supported where it hangs from, loose
 * where it turns. That was not buildable before, because a hinge always drove
 * itself to an angle and so held whatever was on it rather than letting it
 * hang.
 */
export function jointTension(placed, part) {
  const [min, max] = part.tensionRange ?? [1, 1];
  const asked = placed?.config?.tension;
  if (typeof asked !== 'number' || Number.isNaN(asked)) return part.tension ?? 1;
  return Math.min(max, Math.max(min, asked));
}

/**
 * How hard a coupling throws the two halves apart, in relative metres per
 * second. Zero means it only lets go.
 */
export function separationPush(placed, part = getPart('coupling')) {
  const [min, max] = part.separationRange;
  const asked = placed?.config?.separation;
  if (typeof asked !== 'number' || Number.isNaN(asked)) return part.separation;
  return Math.min(max, Math.max(min, asked));
}

/**
 * The two angles a position servo sits at, in degrees, and how fast it moves
 * between them. Unlike a hinge, which is held at an angle for as long as you
 * hold the key, these are places it goes to and stays.
 */
export function servoAngleA(placed, part = getPart('positioner')) {
  return clampTo(placed?.config?.angleA, part.angleRange, part.angleA);
}

export function servoAngleB(placed, part = getPart('positioner')) {
  return clampTo(placed?.config?.angleB, part.angleRange, part.angleB);
}

export function servoSpeed(placed, part = getPart('positioner')) {
  return clampTo(placed?.config?.speed, part.speedRange, part.speed);
}

/**
 * The shortest way round from one angle to another, in degrees. A servo told
 * to go from 170 to -170 should travel twenty degrees, not three hundred and
 * forty, and without this it takes the long way every time.
 */
export function shortestTurn(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * How much a suspension strut can move, in metres, and how hard it resists
 * being moved. A strut is a spring rather than a motor: nothing drives it, it
 * just carries what is above it and gives when the ground pushes back.
 */
export function springTravel(placed, part = getPart('suspension')) {
  return clampTo(placed?.config?.travel, part.travelRange, part.travel);
}

export function springStiffness(placed, part = getPart('suspension')) {
  return clampTo(placed?.config?.stiffness, part.stiffnessRange, part.stiffness);
}

export function springDamping(placed, part = getPart('suspension')) {
  return clampTo(placed?.config?.damping, part.dampingRange, part.damping);
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
    id: 'wedge',
    name: 'Wedge',
    category: 'structure',
    // Full height at +Z, tapering to nothing at -Z over three cells. Nothing
    // else in the game has a sloped face, and this is what lets a machine pick
    // something up by driving at it rather than by grabbing it.
    //
    // Three cells long rather than one on purpose. A single cell is a 45
    // degree face, and a ball meeting that is bulldozed along the floor rather
    // than lifted — measured, not assumed. Over three cells it is about 18
    // degrees, which is shallow enough to get under something and roll it up.
    shape: 'wedge',
    size: [1, 1, 3],
    mass: 1.1,
    colour: 0x7f8b99,
    cost: 2,
    blurb: 'A shallow ramp, three cells long. Drive it under something and the something rides up.',
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
    // Rubber on tarmac is about 0.9. This was 2.4, which gripped so hard that
    // a machine could not scrub its wheels sideways — and skid steering is
    // nothing but scrubbing sideways. Measured on the starter rover, dropping
    // it to 1.6 turned a 14 deg/s pivot back into 61, and cornering from 69
    // to 83, while still hauling everything the campaign asks it to.
    friction: 1.6,
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
    id: 'suspension',
    ports: {
      out: [{ id: 'compression', name: 'Compression', kind: 'number' }],
    },
    name: 'Suspension Strut',
    category: 'drive',
    size: [1, 1, 1],
    mass: 1.6,
    colour: 0xb06a9c,
    cost: 3,
    articulated: true,
    joint: 'prismatic',
    axis: [0, 1, 0],
    // Hangs under what it carries: the chassis above, the wheel below.
    attach: [[0, 1, 0]],
    carry: [[0, -1, 0]],
    spring: true,
    // How far the wheel can move relative to the chassis, either way from
    // where you built it.
    travel: 0.36,
    travelRange: [0.12, 0.9],
    // Soft enough to soak up a kerb, stiff enough that a light machine does
    // not sit on its bump stops. Both ends of the range are useful.
    stiffness: 1400,
    stiffnessRange: [200, 6000],
    // With none of this it pogos; with too much it may as well be a block.
    damping: 90,
    dampingRange: [0, 500],
    blurb: 'A spring between the wheel and the chassis. Set how stiff and how far.',
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
    // Two of these facing each other are mirror images. Without a flip, the
    // only way to make both jaws close on one key was to mount one backwards.
    flippable: true,
    // How hard it fights to keep the angle it was told. All the way down is a
    // free pivot — which is how you build a swing, and there was no other way
    // to build one.
    tension: 1,
    tensionRange: [0, 8],
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
    id: 'positioner',
    ports: {
      in: [{ id: 'pick', name: 'Angle B', kind: 'bool' }],
      out: [{ id: 'angle', name: 'Angle', kind: 'number' }],
    },
    name: 'Position Servo',
    category: 'manipulator',
    size: [1, 1, 1],
    mass: 1.5,
    colour: 0x7d6cff,
    cost: 5,
    articulated: true,
    joint: 'revolute',
    axis: [1, 0, 0],
    attach: [[0, -1, 0]],
    carry: [[0, 1, 0]],
    // No limits, deliberately. A servo that can only reach part of the circle
    // cannot take the short way round, and taking the short way round is the
    // whole difference between this and a hinge.
    positions: true,
    // Same mirror problem as the hinge: a facing pair wants to go to mirrored
    // angles off one key.
    flippable: true,
    angleA: -60,
    angleB: 60,
    angleRange: [-180, 180],
    // Degrees a second. Slow enough to place something down gently, fast
    // enough to flick.
    speed: 180,
    speedRange: [20, 720],
    actuator: {
      kind: 'position',
      port: 'pick',
      signal: 'toggle',
      maxForce: 90,
      defaultBinding: { mode: 'toggle', pos: 'KeyC' },
    },
    blurb: 'Snaps between two set angles and stays there. Set both angles and how fast it moves.',
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
    // Same mirror problem as the hinge: a pair of these turning opposite
    // ways off one key is an ordinary thing to want.
    flippable: true,
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
    id: 'coupling',
    ports: {
      in: [{ id: 'release', name: 'Release', kind: 'bool' }],
      out: [{ id: 'released', name: 'Released', kind: 'bool' }],
    },
    name: 'Coupling',
    category: 'manipulator',
    size: [1, 1, 1],
    mass: 0.7,
    colour: 0xe0554a,
    cost: 3,
    // Rigid until it is fired, and then not there at all. It is articulated so
    // the two halves are separate bodies from the start, held by a fixed joint
    // that is thrown away on release — turning one body into two at runtime is
    // not something the rest of the machinery could do.
    articulated: true,
    joint: 'fixed',
    axis: [0, 1, 0],
    attach: [[0, -1, 0]],
    carry: [[0, 1, 0]],
    // Letting go is not enough on its own. A stage that is merely released
    // settles back onto the one below and rides along, so it is pushed.
    //
    // Set per coupling, and the bottom of the range is nothing at all —
    // somebody who has built their own push, a thruster on the stage or a
    // piston underneath, wants the coupling to do nothing but let go, and a
    // floor above zero would fight them.
    separation: 2.6,
    separationRange: [0, 8],
    actuator: {
      kind: 'release',
      port: 'release',
      signal: 'hold',
      defaultBinding: { mode: 'hold', pos: 'KeyB' },
    },
    blurb: 'Holds like a weld until you fire it, then throws the two halves apart. One shot.',
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
    tension: 1,
    tensionRange: [0, 8],
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
        { id: 'tag', name: 'What it is', kind: 'number' },
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
    blurb: 'Looks along its face, and says how far and what. Bind a motor to it to drive itself.',
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
