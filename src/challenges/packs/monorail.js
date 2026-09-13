import { GREY } from '../palette.js';

/**
 * Monorail.
 *
 * The track is one square wide and there is nothing either side of it but a
 * long way down. A machine that sits on top of it is a machine balanced on a
 * knife edge: the first bend tips it off. The answer is not to sit on top of
 * it at all, but to hang off it — put the weight below the rail and the whole
 * thing becomes a pendulum that rights itself, which is why the garage draws
 * where the weight is.
 *
 * No flight, so there is no way across but along. Nothing here is new
 * machinery: the rail is ordinary scenery, the drop is the fall line every
 * course over a hole already has, and the job is to get to the far end.
 */

// A shade under a full square, so a machine that wraps around the rail has
// running clearance either side rather than gripping it solid.
const RAIL = 0.34;
const TOP = 6;

// A stretch of rail. Straight ones are cheap to read; the bends are where a
// machine that is merely balanced discovers that it is merely balanced.
const span = (x, z, length, rotY = 0) => ({
  pos: [x, TOP - 0.3, z],
  size: [RAIL, 0.6, length],
  rotY,
  colour: GREY,
});

export const MONORAIL = [
  {
    id: 'monorail',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    // You start on the rail, not next to it. There is no open ground here
    // by design, and the spawn check knows to ask a different question.
    mounted: true,
    name: 'Monorail',
    brief: 'One square of rail, a long way up, and a dogleg in it. Get to the far end.',
    hint: 'Anything that balances on top of this falls off the first bend. Hang the weight underneath the rail instead and the machine rights itself every time it leans — check the balance drawing in the garage, and get the mark below the rail rather than above it.',
    // Low enough that a machine which hangs off the rail lands on it rather
    // than falling past it. There are no platforms: a slab to start on is a
    // slab for the underslung half of the machine to land on instead, and then
    // the wheels never reach the rail at all.
    spawn: [0, TOP - 1.4, -22],
    groundSize: 140,
    groundY: -14,
    budget: { cost: 150 },
    pieces: [
      span(0, -13, 22),
      // The dogleg. Taken at any speed worth having, a machine that is merely
      // balanced leans out of it and keeps leaning.
      span(1.25, 3, 10.4, 0.2450),
      span(2.5, 19, 22),
    ],
    props: [],
    zones: [
      { id: 'landing', pos: [2.5, TOP + 0.9, 22], size: [3, 4, 4], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'coreInZone', zone: 'landing', hold: 3, label: 'Parked on the far platform' },
    ],
    par: 150,
  },
];
