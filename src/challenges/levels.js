// Static `pieces` are fixed geometry, `props` are dynamic objects the machine
// has to move, and `zones` are the trigger volumes objectives test against.

const GREY = 0x6b7480;
const DARK = 0x474e57;

/**
 * What a challenge asks of you, and the skill level that follows from it.
 * Written as the demands rather than as a label so the rule lives in one
 * place and a level cannot quietly end up marked easier than it plays.
 *
 *   steps       how many distinct things the machine has to do
 *   flies       whether it has to leave the ground
 *   autonomous  whether it has to run without you
 */
export const TIERS = [
  { id: 'easy', name: 'Easy', note: 'One thing to do, on the ground.' },
  { id: 'medium', name: 'Medium', note: 'Several steps, or it has to fly.' },
  { id: 'hard', name: 'Hard', note: 'Several steps, and it has to fly.' },
  { id: 'expert', name: 'Expert', note: 'It has to run itself.' },
];

export function tierOf(level) {
  const demands = level?.demands;
  if (!demands) return null;
  if (demands.autonomous) return 'expert';
  const many = (demands.steps ?? 1) > 1;
  if (many && demands.flies) return 'hard';
  if (many || demands.flies) return 'medium';
  return 'easy';
}

export function tier(id) {
  return TIERS.find((t) => t.id === id) ?? null;
}

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
    demands: { steps: 1, flies: false },
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
    demands: { steps: 1, flies: false },
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
    demands: { steps: 2, flies: false },
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
    id: 'ledge-runner',
    demands: { steps: 2, flies: false },
    name: '4 — Ledge Runner',
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
    id: 'sorting',
    demands: { steps: 3, flies: false },
    name: '5 — Sorting Bay',
    brief: 'Nine crates in the bin, three colours, one belt each. Read what each one is and put it on the matching belt.',
    hint: 'A distance sensor says what it is looking at as well as how far away: red reads 1, green 2, blue 3. Which crate is where is dealt again every run, so the answer has to come from looking rather than from remembering.',
    spawn: [0, 1, -7],
    groundSize: 90,
    budget: { cost: 160 },
    pieces: [
      // The bin the crates start in.
      { pos: [0, 0.5, -3.4], size: [7.4, 1, 0.4], colour: DARK },
      { pos: [-3.5, 0.5, 0], size: [0.4, 1, 7.2], colour: DARK },
      { pos: [3.5, 0.5, 0], size: [0.4, 1, 7.2], colour: DARK },
      // Three belts running away from the bin, one per colour.
      { pos: [-6, 0.45, 6], size: [2.6, 0.9, 12], colour: 0xd6544a, belt: { dir: [0, 0, 1], speed: 1.6 } },
      { pos: [0, 0.45, 6], size: [2.6, 0.9, 12], colour: 0x46c46a, belt: { dir: [0, 0, 1], speed: 1.6 } },
      { pos: [6, 0.45, 6], size: [2.6, 0.9, 12], colour: 0x4a86d6, belt: { dir: [0, 0, 1], speed: 1.6 } },
      // A lip at the end of each so a delivered crate stays delivered.
      { pos: [-6, 1.3, 12.2], size: [2.6, 0.8, 0.4], colour: DARK },
      { pos: [0, 1.3, 12.2], size: [2.6, 0.8, 0.4], colour: DARK },
      { pos: [6, 1.3, 12.2], size: [2.6, 0.8, 0.4], colour: DARK },
    ],
    props: [
      { id: 'crate-r1', pos: [-2.2, 1.0, -1.2], size: [0.9, 0.9, 0.9], mass: 3, colour: 0xd6544a, tag: 1 },
      { id: 'crate-r2', pos: [0, 1.0, -1.2], size: [0.9, 0.9, 0.9], mass: 3, colour: 0xd6544a, tag: 1 },
      { id: 'crate-r3', pos: [2.2, 1.0, -1.2], size: [0.9, 0.9, 0.9], mass: 3, colour: 0xd6544a, tag: 1 },
      { id: 'crate-g1', pos: [-2.2, 1.0, 0], size: [0.9, 0.9, 0.9], mass: 3, colour: 0x46c46a, tag: 2 },
      { id: 'crate-g2', pos: [0, 1.0, 0], size: [0.9, 0.9, 0.9], mass: 3, colour: 0x46c46a, tag: 2 },
      { id: 'crate-g3', pos: [2.2, 1.0, 0], size: [0.9, 0.9, 0.9], mass: 3, colour: 0x46c46a, tag: 2 },
      { id: 'crate-b1', pos: [-2.2, 1.0, 1.2], size: [0.9, 0.9, 0.9], mass: 3, colour: 0x4a86d6, tag: 3 },
      { id: 'crate-b2', pos: [0, 1.0, 1.2], size: [0.9, 0.9, 0.9], mass: 3, colour: 0x4a86d6, tag: 3 },
      { id: 'crate-b3', pos: [2.2, 1.0, 1.2], size: [0.9, 0.9, 0.9], mass: 3, colour: 0x4a86d6, tag: 3 },
    ],
    // Dealt again every run, so the crate on the left is a different colour
    // each time and the only way to know is to look.
    shuffle: [['crate-r1', 'crate-r2', 'crate-r3', 'crate-g1', 'crate-g2', 'crate-g3', 'crate-b1', 'crate-b2', 'crate-b3']],
    zones: [
      { id: 'red', pos: [-6, 1.6, 9], size: [3, 3, 6], colour: 0xd6544a },
      { id: 'green', pos: [0, 1.6, 9], size: [3, 3, 6], colour: 0x46c46a },
      { id: 'blue', pos: [6, 1.6, 9], size: [3, 3, 6], colour: 0x4a86d6 },
    ],
    objectives: [
      { type: 'allPropsInZone', props: ['crate-r1', 'crate-r2', 'crate-r3'], zone: 'red', hold: 1, label: 'All three red crates on the red belt' },
      { type: 'allPropsInZone', props: ['crate-g1', 'crate-g2', 'crate-g3'], zone: 'green', hold: 1, label: 'All three green crates on the green belt' },
      { type: 'allPropsInZone', props: ['crate-b1', 'crate-b2', 'crate-b3'], zone: 'blue', hold: 1, label: 'All three blue crates on the blue belt' },
    ],
    par: 240,
  },

  {
    id: 'hoops',
    demands: { steps: 2, flies: false },
    name: '6 — Hoops',
    brief: 'Put both balls through the ring. The ground under it is off limits, so you cannot simply carry them up and post them.',
    hint: 'You cannot reach it, so something has to throw. A turntable with a boom on it will fling a ball a long way — wind the torque up until it can actually swing the arm, and remember a boom needs a wide base or the machine just spins underneath it.',
    spawn: [0, 1, -12],
    groundSize: 110,
    budget: { cost: 170 },
    pieces: [
      { pos: [0, 3, 13], size: [10, 6, 1], colour: DARK },
      { pos: [-5.5, 5, 9], size: [1, 10, 9], colour: DARK },
      { pos: [5.5, 5, 9], size: [1, 10, 9], colour: DARK },
      // A lid. Without it the court is a box open at the top, and hanging a
      // ball in from above is an easier answer than throwing one. It also
      // shows the limit rather than only enforcing it: you can see there is
      // no way in over the top, which a keep-out volume alone never says.
      { pos: [0, 10.4, 8.5], size: [12, 0.8, 10], colour: DARK },
    ],
    hoops: [
      { id: 'ring', pos: [0, 6.4, 12], radius: 1.5, axis: [0, 0, 1], colour: 0xf0a825 },
    ],
    // The whole floor in front of the ring. Without this the answer is stilts
    // and a long arm, and the throwing never happens.
    keepout: [
      { id: 'court', pos: [0, 5, 8], size: [10, 10, 9] },
    ],
    props: [
      { id: 'ball-a', pos: [-1.4, 1, -8], radius: 0.42, mass: 2.4, colour: 0xffa64d },
      { id: 'ball-b', pos: [1.4, 1, -8], radius: 0.42, mass: 2.4, colour: 0xffa64d },
    ],
    zones: [],
    objectives: [
      { type: 'propThroughHoop', prop: 'ball-a', hoop: 'ring', label: 'First ball through the ring' },
      { type: 'propThroughHoop', prop: 'ball-b', hoop: 'ring', label: 'Second ball through the ring' },
    ],
    par: 200,
  },

  {
    id: 'airlift',
    demands: { steps: 2, flies: true },
    name: '7 — Airlift',
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
    id: 'hands-off',
    demands: { steps: 1, flies: true, autonomous: true },
    name: '8 — Hands Off',
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

  {
    id: 'traffic',
    demands: { steps: 2, flies: true, autonomous: true },
    name: '9 — Traffic',
    brief: 'Straight down the corridor to the pad — except every blocker covers the middle, so straight never works. Touch anything at all and the run is over.',
    hint: 'They run at a different speed and start somewhere else every time, so there is no timetable to learn. Point a sensor forwards and aim one out to each side, and go where the readings say there is room. The Dodger preset does exactly that.',
    handsOff: true,
    noContact: true,
    spawn: [0, 5, -24],
    groundSize: 180,
    budget: { cost: 170 },
    pieces: [
      { pos: [-14.5, 6, 0.5], size: [1, 12, 51], colour: DARK },
      { pos: [14.5, 6, 0.5], size: [1, 12, 51], colour: DARK },
      { pos: [0, 11.6, 0.5], size: [30, 0.8, 51], colour: DARK },
      { pos: [0, 2.5, 20], size: [7, 5, 7], colour: DARK },
      { pos: [0, 5.2, 20], size: [9, 0.6, 9], colour: GREY },
    ],
    // Each gate is two panels holding a six-metre gap between them, and the
    // whole gate slides. Because the gap is between the panels rather than
    // beside a single blocker, it is always out in open corridor instead of
    // jammed against a wall — which is what forces a machine to hug the wall
    // to get past, and looks every bit as bad as it sounds. It ranges wide
    // enough that it is usually nowhere near the middle, so flying straight at
    // the pad does not work, and where it will be is different every run.
    movers: [
      { group: 'a', pos: [-15, 5.5, -10], size: [24, 9, 1.4], axis: 'x', span: 8, speed: [0.09, 0.18] },
      { group: 'a', pos: [15, 5.5, -10], size: [24, 9, 1.4], axis: 'x', span: 8, speed: [0.09, 0.18] },
      { group: 'b', pos: [-15, 5.5, -1], size: [24, 9, 1.4], axis: 'x', span: 8, speed: [0.1, 0.2] },
      { group: 'b', pos: [15, 5.5, -1], size: [24, 9, 1.4], axis: 'x', span: 8, speed: [0.1, 0.2] },
      { group: 'c', pos: [-15, 5.5, 8], size: [24, 9, 1.4], axis: 'x', span: 8, speed: [0.095, 0.19] },
      { group: 'c', pos: [15, 5.5, 8], size: [24, 9, 1.4], axis: 'x', span: 8, speed: [0.095, 0.19] },
    ],
    props: [],
    zones: [
      { id: 'pad', pos: [0, 7.2, 20], size: [7, 3.2, 7], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'coreInZone', zone: 'pad', hold: 3, label: 'Machine holding station over the pad' },
    ],
    par: 180,
  },
];

export function getLevel(id) {
  return LEVELS.find((level) => level.id === id) ?? LEVELS[0];
}

/** The campaign in order, which is everything that sets a problem. */
export function campaign() {
  return LEVELS.filter((level) => level.objectives.length > 0);
}

/** The one after this, or null at the end of the campaign. */
export function nextLevel(id) {
  const run = campaign();
  const at = run.findIndex((level) => level.id === id);
  return at >= 0 ? run[at + 1] ?? null : run[0] ?? null;
}
