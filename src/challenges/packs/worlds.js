import { GREY, DARK } from '../palette.js';

/**
 * Ten problems about the world rather than about the machine.
 *
 * Six of them change nothing but a number — the pull of gravity, the grip of
 * a surface, the air moving across it — and between them they re-ask every
 * question the player has already answered. A rover that works perfectly is
 * useless on ice. A drone that hovers beautifully is a liability in a
 * crosswind. No new parts, no new objectives, and it all applies just as well
 * to courses that already shipped.
 *
 * The other four take away the easy answer instead: a slope that runs against
 * you, a ring you cannot reach, a tower you cannot touch, and a cap on what
 * the machine is allowed to weigh.
 *
 * Names carry no number. The campaign is sorted by tier rather than by the
 * order packs happen to be listed in, so a number baked into a name would be
 * wrong the moment another pack lands beside this one.
 */
export const WORLDS = [
  {
    id: 'uphill',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Uphill Struggle',
    brief: 'The only way up to the pad is a belt running down it, and it does not get tired.',
    hint: 'Driving straight at it is a tug of war you are losing by default. Go at it with weight over the driven wheels, or take it in stages and stop dead between them — a machine that can hold still on a moving floor has already solved most of this.',
    // Further back than it was: the ramp reaches nearly two metres further
    // down the yard now, and a run-up at this is worth having.
    spawn: [0, 1.2, -24.5],
    groundSize: 120,
    budget: { cost: 120 },
    pieces: [
      // The ramp, sloping up towards +z, with its surface running back down.
      //
      // Long enough that its foot reaches the ground. At twelve metres it
      // stopped short and stood on a sheer sixty-centimetre lip -- taller than
      // a wheel, so nothing could climb it and a crate pushed at it simply
      // stopped dead, with nothing on screen to say why.
      //
      // Placed so its top surface finishes flush with the shelf. It used to end
      // half a metre past the shelf's edge and stand 39 cm proud of it, which
      // put a ridge across the full width of the course exactly where you
      // arrive: a machine cresting it sat down on its belly with the wheels off
      // the ground at both ends, and the ridge is the same brown as the ramp
      // seen from above, so there was nothing to see. The same fault as the lip
      // at the foot, at the other end.
      {
        pos: [0, 1.381, -2.329], size: [9, 0.8, 13.6], rotX: -0.32, colour: 0x9a6b4b,
        belt: { dir: [0, -0.31, -0.95], speed: 3 },
      },
      // Walls down both sides of it, so the belt is the route rather than a
      // suggestion.
      { pos: [-5.2, 2.4, -2.329], size: [0.6, 5, 13.6], colour: DARK },
      { pos: [5.2, 2.4, -2.329], size: [0.6, 5, 13.6], colour: DARK },
      // The shelf at the top, and a lip so an arriving crate stays arrived.
      { pos: [0, 3.5, 8], size: [9, 0.8, 8], colour: GREY },
      { pos: [0, 4.3, 11.8], size: [9, 0.8, 0.5], colour: DARK },
    ],
    props: [
      { id: 'crate', pos: [0, 0.55, -13], size: [1, 1, 1], mass: 5, colour: 0xc98b4b },
    ],
    zones: [
      { id: 'shelf', pos: [0, 4.6, 8], size: [7, 2.4, 6], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'shelf', hold: 3, label: 'Crate up the belt and onto the shelf' },
    ],
    par: 150,
  },

  {
    id: 'post-it',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Post It',
    brief: 'The ring lies flat, six metres up, on two posts with nothing underneath. The ground around it is off limits.',
    hint: 'Flat means the ball has to come down through it, not across it, so this is a lob rather than a shot. A turntable boom throws hardest at its tip — wind the torque up until it can actually swing, and let go while the arm is still climbing.',
    spawn: [0, 1, -12],
    groundSize: 110,
    budget: { cost: 150 },
    pieces: [
      { pos: [-2.2, 3.2, 4], size: [0.5, 6.4, 0.5], colour: DARK },
      { pos: [2.2, 3.2, 4], size: [0.5, 6.4, 0.5], colour: DARK },
    ],
    hoops: [
      { id: 'ring', pos: [0, 6.4, 4], radius: 1.5, axis: [0, 1, 0], colour: 0xf0a825 },
    ],
    // Everything under and around the ring. Walking a ball up a tower of your
    // own and dropping it in is the answer to every level like this, and it
    // has to be closed off before the throwing is worth building.
    keepout: [
      { id: 'court', pos: [0, 3.2, 4], size: [7, 6.4, 7] },
    ],
    props: [
      { id: 'ball', pos: [0, 0.6, -8], radius: 0.4, mass: 2.2, colour: 0xffa64d },
    ],
    zones: [],
    objectives: [
      { type: 'propThroughHoop', prop: 'ball', hoop: 'ring', label: 'Ball dropped through the ring' },
    ],
    par: 170,
  },

  {
    id: 'wrecking-ball',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Wrecking Ball',
    brief: 'A column of loose blocks, a pad behind it, and a ring around its feet you may not cross.',
    hint: 'You cannot get close enough to push it, so something of yours has to travel the last few metres on its own. A weight on a long boom carries further than an arm does, and a column falls the way it is hit.',
    spawn: [0, 1.2, -12],
    groundSize: 120,
    budget: { cost: 140 },
    pieces: [],
    props: [
      { id: 'slab-1', pos: [0, 0.5, 8], size: [1.2, 1, 1.2], mass: 4, colour: 0x8d8578 },
      { id: 'slab-2', pos: [0, 1.5, 8], size: [1.2, 1, 1.2], mass: 4, colour: 0x8d8578 },
      { id: 'slab-3', pos: [0, 2.5, 8], size: [1.2, 1, 1.2], mass: 4, colour: 0x9a9285 },
      { id: 'slab-4', pos: [0, 3.5, 8], size: [1.2, 1, 1.2], mass: 4, colour: 0x9a9285 },
      { id: 'slab-5', pos: [0, 4.5, 8], size: [1.2, 1, 1.2], mass: 4, colour: 0xa79e90 },
    ],
    keepout: [
      { id: 'footing', pos: [0, 2.5, 8], size: [6, 5, 6] },
    ],
    zones: [
      { id: 'pad', pos: [0, 1, 13], size: [8, 4, 7], colour: 0x4ade80 },
    ],
    objectives: [
      {
        type: 'allPropsInZone',
        props: ['slab-3', 'slab-4', 'slab-5'],
        zone: 'pad',
        hold: 2,
        label: 'Top three slabs down on the pad',
      },
    ],
    par: 160,
  },

  {
    id: 'three-drops',
    demands: { steps: 3, flies: false },
    bans: ['flight'],
    name: 'Three Drops',
    brief: 'Three crates, three squares, at three different heights. All three in one run.',
    hint: 'Three machines would make this easy and you only get one. Something that can reach the shelf can usually be made to reach the floor as well, so build for the highest one and work down.',
    spawn: [0, 1.2, -10],
    groundSize: 120,
    budget: { cost: 150 },
    pieces: [
      { pos: [0, 0.6, 8], size: [3, 1.2, 3], colour: GREY },
      { pos: [6, 1.3, 8], size: [3, 2.6, 3], colour: GREY },
    ],
    props: [
      { id: 'crate-low', pos: [-2.2, 0.5, -5], size: [0.9, 0.9, 0.9], mass: 3, colour: 0xc98b4b },
      { id: 'crate-mid', pos: [0, 0.5, -5], size: [0.9, 0.9, 0.9], mass: 3, colour: 0x7cc4ff },
      { id: 'crate-high', pos: [2.2, 0.5, -5], size: [0.9, 0.9, 0.9], mass: 3, colour: 0xb488e0 },
    ],
    zones: [
      { id: 'floor', pos: [-6, 0.7, 8], size: [3, 2.2, 3], colour: 0x4ade80 },
      { id: 'bench', pos: [0, 1.8, 8], size: [2.8, 1.6, 2.8], colour: 0x4ade80 },
      { id: 'shelf', pos: [6, 3.2, 8], size: [2.8, 1.6, 2.8], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate-low', zone: 'floor', hold: 2, label: 'One on the floor square' },
      { type: 'propInZone', prop: 'crate-mid', zone: 'bench', hold: 2, label: 'One on the bench' },
      { type: 'propInZone', prop: 'crate-high', zone: 'shelf', hold: 2, label: 'One on the shelf' },
    ],
    par: 200,
  },

  {
    id: 'no-wheels',
    demands: { steps: 1, flies: false },
    bans: ['flight', 'wheels'],
    name: 'No Wheels',
    brief: 'Broken ground, a crate, a goal. No rotors and no wheels — work out something else.',
    hint: 'A hinge that swings a foot forward and a piston that lifts the body over it will walk, slowly. Keep it short, keep it wide, and do not be proud about the speed.',
    spawn: [0, 1.2, -7],
    groundSize: 90,
    budget: { cost: 150 },
    pieces: [
      { pos: [-1.5, 0.15, -1], size: [3, 0.3, 0.4], colour: DARK },
      { pos: [2, 0.15, 1.5], size: [3, 0.3, 0.4], colour: DARK },
      { pos: [-2, 0.15, 4], size: [3.5, 0.3, 0.4], colour: DARK },
    ],
    props: [
      { id: 'crate', pos: [0, 0.45, -3], size: [0.8, 0.8, 0.8], mass: 2, colour: 0xc98b4b },
    ],
    zones: [
      { id: 'goal', pos: [0, 0.8, 7], size: [4, 2.6, 4], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'goal', hold: 3, label: 'Crate walked across to the square' },
    ],
    par: 220,
  },

  {
    id: 'featherweight',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Featherweight',
    brief: 'A gantry over a drop, and it will not take a machine over 14 kg. The gantry is the only way across.',
    hint: 'A parts budget limits what you spend; this limits what you weigh, and the two are not the same — ballast is cheap and heavy. The starter rover is 19 kg before it has picked anything up, so something is coming off.',
    massCap: 14,
    spawn: [0, 1.2, -14],
    groundSize: 160,
    groundY: -10,
    budget: { cost: 140 },
    pieces: [
      { pos: [0, 0, -13], size: [8, 0.8, 8], colour: GREY },
      { pos: [0, 0, 0], size: [3, 0.6, 20], colour: 0x8a6f4a },
      { pos: [0, 0, 13], size: [8, 0.8, 8], colour: GREY },
    ],
    props: [
      { id: 'crate', pos: [0, 0.8, 13], size: [0.8, 0.8, 0.8], mass: 2, colour: 0xc98b4b },
    ],
    zones: [
      { id: 'home', pos: [0, 1.2, -13], size: [6, 3, 6], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'home', hold: 3, label: 'Crate carried back over the gantry' },
    ],
    par: 160,
  },

  {
    id: 'low-gravity',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Low Gravity',
    brief: 'An ordinary haul at a sixth of the usual gravity. Everything you know is still true and almost none of it helps.',
    hint: 'Weight is what pressed the wheels into the ground, and most of it has gone. You will spin, you will bounce, and anything resting on a tray will leave it. More ballast is the blunt answer; a lower machine is the better one.',
    gravity: -1.62,
    spawn: [0, 1.2, -12],
    groundSize: 130,
    budget: { cost: 130 },
    pieces: [
      { pos: [-4, 0.4, 2], size: [4, 0.8, 0.6], colour: DARK },
      { pos: [4, 0.4, 6], size: [4, 0.8, 0.6], colour: DARK },
    ],
    props: [
      { id: 'crate', pos: [0, 0.55, -6], size: [1, 1, 1], mass: 5, colour: 0xc98b4b },
    ],
    zones: [
      { id: 'goal', pos: [0, 1, 11], size: [4.5, 3, 4.5], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'goal', hold: 3, label: 'Crate delivered on the Moon' },
    ],
    par: 180,
  },

  {
    id: 'ice-rink',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Ice Rink',
    brief: 'Flat, open, nothing in the way at all, and almost no grip anywhere on it.',
    hint: 'Steering stops working, so stop trying to steer. Point it, commit, and let it run — or find something that bites: a heavy machine on a narrow footprint has more to give than a light one on a wide one.',
    friction: 0.02,
    spawn: [0, 1.2, -12],
    groundSize: 120,
    budget: { cost: 110 },
    pieces: [],
    props: [
      { id: 'crate', pos: [0, 0.55, -6], size: [1, 1, 1], mass: 4, colour: 0xc98b4b },
    ],
    zones: [
      { id: 'goal', pos: [0, 1, 10], size: [5, 3, 5], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'goal', hold: 3, label: 'Crate slid onto the mark and settled' },
    ],
    par: 150,
  },

  {
    id: 'crosswind',
    demands: { steps: 2, flies: true },
    name: 'Crosswind',
    brief: 'A narrow crossing over a long drop, with a gusting side wind. Flying is allowed here, and that is the joke.',
    hint: 'The wind pushes on mass, so the lighter the machine the further it goes — which makes the drone that has solved everything so far the worst thing you could bring. Watch the streaks: they slow down before they speed up, and the lull is when to move.',
    spawn: [0, 1.2, -14],
    groundSize: 160,
    groundY: -12,
    budget: { cost: 140 },
    pieces: [
      { pos: [0, 0, -13], size: [9, 0.8, 8], colour: GREY },
      { pos: [0, 0, 0], size: [4, 0.6, 20], colour: GREY },
      { pos: [0, 0, 13], size: [9, 0.8, 8], colour: GREY },
    ],
    // Across the crossing, not along it, so it is trying to take you off the
    // side the whole way over.
    wind: [
      { pos: [0, 6, 0], size: [50, 26, 30], dir: [1, 0, 0], force: 20, gust: 0.8 },
    ],
    props: [
      { id: 'payload', pos: [0, 0.8, -13], size: [0.8, 0.8, 0.8], mass: 3, colour: 0x7cc4ff },
    ],
    zones: [
      { id: 'far-side', pos: [0, 1.2, 13], size: [7, 3, 6], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'payload', zone: 'far-side', hold: 3, label: 'Payload across and set down' },
    ],
    par: 170,
  },

  {
    id: 'heavy-world',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Heavy World',
    brief: 'Twice the gravity and the same job. Your usual chassis sags on its own joints before it has picked anything up.',
    hint: 'A long arm is a lever working against you, and every joint along it is somewhere to bend. Short, braced and low is the only thing that stands up here — and what was a comfortable lift is now most of what your motors can do.',
    gravity: -19.6,
    spawn: [0, 1.2, -10],
    groundSize: 120,
    budget: { cost: 150 },
    pieces: [
      { pos: [0, 0.6, 7], size: [3, 1.2, 3], colour: GREY },
    ],
    props: [
      { id: 'payload', pos: [0, 0.5, -4], size: [0.9, 0.9, 0.9], mass: 4, colour: 0x7cc4ff },
    ],
    zones: [
      { id: 'plinth', pos: [0, 1.8, 7], size: [2.8, 1.6, 2.8], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'payload', zone: 'plinth', hold: 3, label: 'Payload lifted onto the plinth' },
    ],
    par: 190,
  },
];
