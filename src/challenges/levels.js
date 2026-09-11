// Static `pieces` are fixed geometry, `props` are dynamic objects the machine
// has to move, and `zones` are the trigger volumes objectives test against.

const GREY = 0x6b7480;
const DARK = 0x474e57;

export const LEVELS = [
  {
    id: 'sandbox',
    name: 'Sandbox',
    brief: 'No objective. Build whatever you like and see how it behaves.',
    hint: 'Everything unlocked, no budget. Good for testing a mechanism.',
    spawn: [0, 1.2, -6],
    groundSize: 160,
    pieces: [
      { pos: [10, 0.4, 6], size: [8, 0.8, 8], colour: GREY },
      { pos: [16, 1.2, 6], size: [8, 0.8, 8], colour: GREY },
      { pos: [-12, 1, 4], size: [6, 2, 0.6], colour: DARK },
      { pos: [-6, 0.75, -10], size: [10, 1.5, 1], rotY: 0.4, colour: DARK },
    ],
    props: [
      { id: 'crate-a', pos: [3, 0.5, 2], size: [1, 1, 1], mass: 6, colour: 0xc98b4b },
      { id: 'crate-b', pos: [-3, 0.5, 2], size: [1.4, 0.7, 1.4], mass: 7, colour: 0xb37a3f },
      { id: 'ball', pos: [0, 0.6, 6], radius: 0.6, mass: 4, colour: 0xd0574f },
    ],
    zones: [],
    objectives: [],
  },

  {
    id: 'first-haul',
    name: '1 — First Haul',
    brief: 'Move the crate into the marked square and keep it there for 3 seconds.',
    hint: 'A core, a few blocks and four wheels will do it. Bind the left and right wheels to different keys so you can steer.',
    spawn: [0, 1.2, -8],
    groundSize: 120,
    budget: { cost: 60 },
    pieces: [],
    props: [
      { id: 'crate', pos: [0, 0.55, 2], size: [1.1, 1.1, 1.1], mass: 8, colour: 0xc98b4b },
    ],
    zones: [
      { id: 'goal', pos: [0, 0.6, 12], size: [4, 2.4, 4], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'goal', hold: 3, label: 'Crate parked in the green square' },
    ],
    par: 70,
  },

  {
    id: 'rough-ground',
    name: '2 — Rough Ground',
    brief: 'Same job, but the crate starts past a ramp and a scattering of kerbs.',
    hint: 'Weight low and wheels wide. Ballast under the chassis stops it tipping on the ramp.',
    spawn: [0, 1.2, -12],
    groundSize: 120,
    budget: { cost: 85 },
    pieces: [
      { pos: [0, 0.5, -3], size: [14, 1, 5], rotX: -0.22, colour: GREY },
      { pos: [0, 1.05, 1.4], size: [14, 0.3, 4], colour: GREY },
      { pos: [-3, 1.35, 5], size: [2.5, 0.5, 0.5], colour: DARK },
      { pos: [3.5, 1.35, 7], size: [2.5, 0.5, 0.5], colour: DARK },
      { pos: [0, 1.35, 9.5], size: [3, 0.5, 0.5], colour: DARK },
    ],
    props: [
      { id: 'crate', pos: [0, 1.8, 6], size: [1.1, 1.1, 1.1], mass: 8, colour: 0xc98b4b },
    ],
    zones: [
      { id: 'goal', pos: [0, 1.8, -10], size: [4, 3, 4], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'goal', hold: 3, label: 'Crate brought back down to the start' },
    ],
    par: 110,
  },

  {
    id: 'pick-and-place',
    name: '3 — Pick and Place',
    brief: 'Lift the payload off its pedestal and set it on the far one. Pushing will not work.',
    hint: 'A grabber on a servo hinge. Toggle G to latch, toggle again to let go.',
    spawn: [0, 1.2, -7],
    groundSize: 120,
    budget: { cost: 110 },
    pieces: [
      { pos: [-4, 0.6, 3], size: [2, 1.2, 2], colour: GREY },
      { pos: [4, 0.6, 3], size: [2, 1.2, 2], colour: GREY },
      { pos: [0, 0.9, 3], size: [1, 1.8, 1], colour: DARK },
    ],
    props: [
      { id: 'payload', pos: [-4, 1.45, 3], size: [0.9, 0.7, 0.9], mass: 4, colour: 0x7cc4ff },
    ],
    zones: [
      { id: 'pad', pos: [4, 1.7, 3], size: [2.2, 1.6, 2.2], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'payload', zone: 'pad', hold: 3, label: 'Payload resting on the far pedestal' },
    ],
    par: 150,
  },

  {
    id: 'airlift',
    name: '4 — Airlift',
    brief: 'Get the payload onto the high platform. It is too tall to drive up.',
    hint: 'Wire the rotors to a Flight Controller and it will hold height by itself: WASD to fly, Space and Shift to climb and drop. Hang a grabber underneath to pick the payload up.',
    spawn: [0, 1.2, -8],
    groundSize: 140,
    budget: { cost: 150 },
    pieces: [
      { pos: [0, 3, 8], size: [7, 0.8, 7], colour: GREY },
      { pos: [0, 1.5, 8], size: [1.4, 3, 1.4], colour: DARK },
    ],
    props: [
      { id: 'payload', pos: [0, 0.45, 0], size: [0.8, 0.8, 0.8], mass: 3, colour: 0x7cc4ff },
    ],
    zones: [
      { id: 'roof', pos: [0, 4.1, 8], size: [6, 2.2, 6], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'payload', zone: 'roof', hold: 3, label: 'Payload on the high platform' },
    ],
    par: 180,
  },

  {
    id: 'ledge-runner',
    name: '5 — Ledge Runner',
    brief: 'Park the machine itself on the pad at the end of the gantry, and hold it there for 4 seconds.',
    hint: 'There is nothing past the pad. A distance sensor pointed forward, bound to your drive, will stop you on the mark.',
    spawn: [0, 4.2, -14],
    groundSize: 160,
    groundY: -8,
    budget: { cost: 120 },
    pieces: [
      { pos: [0, 3, -10], size: [8, 0.8, 10], colour: GREY },
      { pos: [0, 3, 2], size: [3.4, 0.8, 15], colour: GREY },
      { pos: [0, 3, 11], size: [4.5, 0.8, 4], colour: 0x5a6470 },
      { pos: [0, 4.4, 14], size: [4.5, 2.6, 0.6], colour: DARK },
    ],
    props: [],
    zones: [
      { id: 'pad', pos: [0, 4.2, 11], size: [4, 3, 3.4], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'coreInZone', zone: 'pad', hold: 4, label: 'Machine stopped and held on the pad' },
    ],
    par: 200,
  },

  {
    id: 'hands-off',
    name: '6 — Hands Off',
    brief: 'No controls at all on this one. Draw the program, press Test, and watch it fly itself to the pad.',
    hint: 'A Computer, a GPS and a Flight Controller. Climb, turn toward the waypoint, run in, then hold. Start from the Auto drone preset if you want a worked example to pull apart.',
    handsOff: true,
    spawn: [0, 1.2, -16],
    groundSize: 180,
    budget: { cost: 150 },
    pieces: [
      { pos: [0, 2.5, 12], size: [6, 5, 6], colour: DARK },
      { pos: [0, 5.2, 12], size: [8, 0.6, 8], colour: GREY },
    ],
    props: [],
    zones: [
      { id: 'pad', pos: [0, 7.4, 12], size: [6, 3.4, 6], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'coreInZone', zone: 'pad', hold: 4, label: 'Machine holding station over the pad' },
    ],
    par: 60,
  },
];

export function getLevel(id) {
  return LEVELS.find((level) => level.id === id) ?? LEVELS[0];
}
