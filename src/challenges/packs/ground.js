import { GREY, DARK } from '../palette.js';

/**
 * Ten problems with the rotors taken away.
 *
 * Flight is the universal answer — it gets you over, round and past anything —
 * so removing it is the cheapest way to make a level ask a real question. Every
 * one of these is solved on the ground, and each is built around one idea:
 * a shape, a width, a weight, a surface that will not hold still.
 *
 * No level here is numbered in its name. The campaign is sorted by tier rather
 * than by the order packs were written, so a number baked into a name would be
 * wrong the moment another pack landed.
 */
export const GROUND = [
  {
    id: 'shunt',
    demands: { steps: 1, flies: false, bansBite: false },
    bans: ['flight'],
    name: 'Shunt',
    brief: 'Put the ball in the marked square. It is bigger than you are and it weighs a great deal more.',
    hint: 'Hit it off centre and it rolls away from you. A wide flat face keeps it square and pushes it where you are pointing.',
    spawn: [0, 1.2, -6],
    groundSize: 140,
    budget: { cost: 60 },
    pieces: [],
    props: [
      // Taller than the machine and far too heavy to lift, so the only thing
      // to do with it is push. `ccd` because something this big moving this
      // fast will pass straight through the floor without it.
      {
        id: 'ball',
        pos: [0, 1.4, 2],
        radius: 1.4,
        mass: 40,
        colour: 0xd0574f,
        ccd: true,
        damping: 0.25,
        angularDamping: 0.35,
      },
    ],
    zones: [
      { id: 'goal', pos: [0, 1.6, 24], size: [7, 4, 7], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'ball', zone: 'goal', hold: 2, label: 'Ball parked in the green square' },
    ],
    par: 60,
  },

  {
    id: 'kerb-crawl',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Kerb Crawl',
    brief: 'The crate is on the floor and the square is on the ledge. There is no ramp anywhere on this course.',
    hint: 'Nothing here will lift it for you. Either bring a slope of your own and push it up, or stop pushing and pick it up.',
    spawn: [0, 1.2, -7],
    groundSize: 110,
    budget: { cost: 70 },
    pieces: [
      // A plain step, 1.2 m of it, with nothing sloped anywhere near it.
      { pos: [0, 0.6, 10], size: [14, 1.2, 8], colour: GREY },
      { pos: [0, 1.35, 6.1], size: [14, 0.3, 0.3], colour: DARK },
    ],
    props: [
      { id: 'crate', pos: [0, 0.55, 1], size: [1.1, 1.1, 1.1], mass: 6, colour: 0xc98b4b },
    ],
    zones: [
      { id: 'goal', pos: [0, 2, 11], size: [4, 2.4, 4], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'goal', hold: 3, label: 'Crate up on the ledge' },
    ],
    par: 80,
  },

  {
    id: 'letterbox',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Letterbox',
    brief: 'An ordinary haul. The only way through the wall is a slot the starter rover will not fit through.',
    hint: 'Measure before you build. The gap is 1.6 m and the rover is wider than that — the answer is a smaller machine, not a stronger one.',
    spawn: [0, 1.2, -6],
    groundSize: 110,
    budget: { cost: 60 },
    pieces: [
      // A walled yard, because a wall you can drive round the end of is not a
      // wall. The slot is the only way from this half to the other.
      { pos: [0, 2, -10.5], size: [27, 4, 1], colour: DARK },
      { pos: [0, 2, 16.5], size: [27, 4, 1], colour: DARK },
      { pos: [-13.5, 2, 3], size: [1, 4, 28], colour: DARK },
      { pos: [13.5, 2, 3], size: [1, 4, 28], colour: DARK },
      // The divider, holding a 1.6 m gap, with a lintel over it so climbing
      // through the top is not an answer either.
      { pos: [-6.9, 2, 7], size: [12.2, 4, 1], colour: DARK },
      { pos: [6.9, 2, 7], size: [12.2, 4, 1], colour: DARK },
      { pos: [0, 3, 7], size: [1.6, 2, 1], colour: DARK },
    ],
    props: [
      { id: 'crate', pos: [0, 0.5, 1], size: [1, 1, 1], mass: 5, colour: 0xc98b4b },
    ],
    zones: [
      { id: 'goal', pos: [0, 0.6, 13], size: [4, 2.4, 4], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'goal', hold: 3, label: 'Crate through the slot and parked' },
    ],
    par: 75,
  },

  {
    id: 'deadweight',
    demands: { steps: 1, flies: false, bansBite: false },
    bans: ['flight'],
    name: 'Deadweight',
    brief: 'One crate, one square, flat ground the whole way. The crate weighs four times what you are used to.',
    hint: 'The wheels spin because there is not enough weight on them. Ballast over the driven axle, not out on the nose.',
    spawn: [0, 1.2, -6],
    groundSize: 110,
    budget: { cost: 85 },
    pieces: [],
    props: [
      // Four times the usual crate, and gripping the floor hard enough that
      // shoving it is a traction problem rather than a strength one.
      { id: 'crate', pos: [0, 0.6, 2], size: [1.2, 1.2, 1.2], mass: 32, colour: 0xb37a3f, friction: 0.95 },
    ],
    zones: [
      { id: 'goal', pos: [0, 0.7, 13], size: [4.5, 2.6, 4.5], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'goal', hold: 3, label: 'Crate shifted onto the square' },
    ],
    par: 90,
  },

  {
    id: 'roundabout',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Roundabout',
    brief: 'The payload is riding a tray that will not hold still. Take it off and set it on the pedestal.',
    hint: 'Chasing it never works — you arrive where it was. Sit where it is going and let it come to you.',
    spawn: [0, 1.2, -9],
    groundSize: 110,
    budget: { cost: 90 },
    pieces: [
      { pos: [0, 0.5, -3], size: [2.6, 1, 2.6], colour: GREY },
    ],
    // Floor and two lips, all one group so they travel together: a tray with
    // its load still in it, rather than a plank that sheds it on the first
    // change of direction.
    movers: [
      { group: 'tray', pos: [0, 0.7, 7], size: [4.6, 0.4, 4.6], axis: 'x', span: 4.5, speed: [0.3, 0.45], colour: 0x6e7a88 },
      { group: 'tray', pos: [-2.4, 1.15, 7], size: [0.3, 0.7, 4.6], axis: 'x', span: 4.5, speed: [0.3, 0.45], colour: DARK },
      { group: 'tray', pos: [2.4, 1.15, 7], size: [0.3, 0.7, 4.6], axis: 'x', span: 4.5, speed: [0.3, 0.45], colour: DARK },
    ],
    props: [
      { id: 'payload', pos: [0, 1.35, 7], size: [0.9, 0.9, 0.9], mass: 4, colour: 0x7cc4ff },
    ],
    zones: [
      { id: 'pad', pos: [0, 1.5, -3], size: [2.6, 1.8, 2.6], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'payload', zone: 'pad', hold: 3, label: 'Payload set down on the pedestal' },
    ],
    par: 90,
  },

  {
    id: 'sunday-league',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Sunday League',
    brief: 'The ball again, a keeper sliding across the goal mouth, and ten seconds on the clock.',
    hint: 'Ten seconds is not enough to drive round and line a shot up. Build something that strikes it the moment the run starts — a sprung arm, a piston, a thruster behind it — and aim where the keeper is not.',
    spawn: [0, 1.2, -10],
    groundSize: 140,
    budget: { cost: 100 },
    pieces: [
      // Posts, back net and side nets, so a goal stays a goal instead of the
      // ball rolling through and out the other side.
      { pos: [-4.6, 1.6, 19], size: [0.5, 3.2, 0.5], colour: GREY },
      { pos: [4.6, 1.6, 19], size: [0.5, 3.2, 0.5], colour: GREY },
      { pos: [0, 3.4, 19], size: [9.7, 0.4, 0.5], colour: GREY },
      { pos: [0, 1.6, 22], size: [9.7, 3.2, 0.4], colour: DARK },
      { pos: [-4.6, 1.6, 20.5], size: [0.4, 3.2, 3], colour: DARK },
      { pos: [4.6, 1.6, 20.5], size: [0.4, 3.2, 3], colour: DARK },
    ],
    movers: [
      { pos: [0, 1.2, 19], size: [2.6, 2.4, 0.5], axis: 'x', span: 3.2, speed: [0.55, 0.95], colour: 0xd6544a },
    ],
    props: [
      {
        id: 'ball',
        pos: [0, 1.1, 0],
        radius: 1.1,
        mass: 26,
        colour: 0xe8e3d8,
        ccd: true,
        damping: 0.2,
        angularDamping: 0.3,
      },
    ],
    zones: [
      { id: 'net', pos: [0, 1.4, 20.6], size: [8.4, 3, 2.6], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'ball', zone: 'net', hold: 1, label: 'Ball in the back of the net' },
    ],
    // Short enough that driving up and nudging it cannot work: it has to be
    // struck, and struck almost immediately.
    deadline: 10,
    par: 8,
  },

  {
    id: 'jenga',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Jenga',
    brief: 'Get across to the far pad. The only crossing is a run of loose planks that are not fixed to anything.',
    hint: 'They shift the moment you touch them and they keep shifting. Heavy and slow works them loose; light and quick is over before they have gone anywhere.',
    spawn: [0, 3.2, -7],
    groundSize: 120,
    groundY: -6,
    budget: { cost: 90 },
    pieces: [
      { pos: [0, 1, -5], size: [12, 2, 10], colour: GREY },
      { pos: [0, 1, 8], size: [12, 2, 10], colour: GREY },
    ],
    // Laid out by hand rather than scattered, because a heap of random planks
    // is sometimes not a crossing at all. Loose, so they still move.
    props: [
      { id: 'plank-a', pos: [-2.4, 2.16, 1.5], size: [1.2, 0.32, 4], mass: 6, colour: 0x9a8b72 },
      { id: 'plank-b', pos: [-1.2, 2.16, 1.5], size: [1.2, 0.32, 4], mass: 6, colour: 0x9a8b72 },
      { id: 'plank-c', pos: [0, 2.16, 1.5], size: [1.2, 0.32, 4], mass: 6, colour: 0x9a8b72 },
      { id: 'plank-d', pos: [1.2, 2.16, 1.5], size: [1.2, 0.32, 4], mass: 6, colour: 0x9a8b72 },
      { id: 'plank-e', pos: [2.4, 2.16, 1.5], size: [1.2, 0.32, 4], mass: 6, colour: 0x9a8b72 },
    ],
    zones: [
      { id: 'far', pos: [0, 2.6, 10], size: [5, 2.4, 5], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'coreInZone', zone: 'far', hold: 3, label: 'Machine across and stopped on the far pad' },
    ],
    par: 120,
  },

  {
    id: 'round-trip',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Round Trip',
    brief: 'Deliver the crate to the far square, then bring the machine back to the pad it started on. Both at once, at the end.',
    hint: 'A machine that only has to survive one journey is a different machine from one that has to do it twice. Nothing clever that breaks itself on the way out is any use here.',
    spawn: [0, 1.2, -12],
    groundSize: 120,
    budget: { cost: 90 },
    pieces: [
      { pos: [0, 0.1, -12], size: [6, 0.2, 6], colour: 0x5a6470 },
      { pos: [-2.5, 0.45, 3], size: [3, 0.9, 0.6], colour: DARK },
      { pos: [2.5, 0.45, 7], size: [3, 0.9, 0.6], colour: DARK },
    ],
    props: [
      { id: 'crate', pos: [0, 0.55, -2], size: [1.1, 1.1, 1.1], mass: 7, colour: 0xc98b4b },
    ],
    zones: [
      { id: 'drop', pos: [0, 0.7, 13], size: [4, 2.6, 4], colour: 0x4ade80 },
      { id: 'home', pos: [0, 0.9, -12], size: [5.5, 2.6, 5.5], colour: 0x35d0e0 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'drop', hold: 2, label: 'Crate delivered to the far square' },
      { type: 'coreInZone', zone: 'home', hold: 2, label: 'Machine back on the home pad' },
    ],
    par: 130,
  },

  {
    id: 'the-lift',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'The Lift',
    brief: 'The payload goes on the platform five metres up. Sheer sides, no ramp, nothing to climb.',
    hint: 'This is the first one that wants a machine with a reach. Stacked pistons will get there, and so will a boom on a turntable — wind its torque up until it can actually swing the weight.',
    spawn: [0, 1.2, -9],
    groundSize: 120,
    budget: { cost: 120 },
    pieces: [
      { pos: [0, 2.5, 8], size: [6, 5, 6], colour: DARK },
      { pos: [0, 5.15, 8], size: [6.6, 0.3, 6.6], colour: GREY },
    ],
    props: [
      { id: 'payload', pos: [0, 0.45, 0], size: [0.8, 0.8, 0.8], mass: 3, colour: 0x7cc4ff },
    ],
    zones: [
      { id: 'top', pos: [0, 5.9, 8], size: [5.5, 1.8, 5.5], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'payload', zone: 'top', hold: 3, label: 'Payload up on the platform' },
    ],
    par: 150,
  },

  {
    id: 'seesaw',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Seesaw',
    brief: 'The only crossing is a plank balanced on a pillar. It is level right up until something is on it.',
    hint: 'Two ways over. Be quick enough that it has not gone far by the time you are off it, or be slow and keep your weight over the middle of it.',
    spawn: [0, 3.5, -7],
    groundSize: 120,
    budget: { cost: 90 },
    pieces: [
      { pos: [0, 1.15, -5], size: [12, 2.3, 10], colour: GREY },
      { pos: [0, 1.15, 9], size: [12, 2.3, 10], colour: GREY },
      // The pivot, standing up out of the gap. Its top is a flat saddle rather
      // than a knife edge, which is what lets the plank sit still until the
      // load has gone past the edge of it — a true point balance would tip on
      // the first frame and the level would be a hole rather than a crossing.
      { pos: [0, 1.2, 2], size: [1.6, 2.4, 1.2], colour: DARK },
    ],
    props: [
      // Resting on the saddle alone, with both ends hanging a hand's breadth
      // over the ledges rather than sitting on them. Held up at both ends it
      // would just be a bridge.
      { id: 'plank', pos: [0, 2.55, 2], size: [3.4, 0.3, 8.4], mass: 30, colour: 0x9a8b72, friction: 0.9 },
    ],
    zones: [
      { id: 'far', pos: [0, 3.2, 10], size: [5, 2.4, 4.5], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'coreInZone', zone: 'far', hold: 3, label: 'Machine across and stopped on the far side' },
    ],
    par: 120,
  },
];
