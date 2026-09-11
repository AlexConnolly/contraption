import { GREY, DARK } from '../palette.js';

const TAN = 0xc98b4b;
const STEEL = 0x8f9aa6;
const GRIT = 0x9a8b72;

/**
 * Eight problems shaped like work rather than like errands.
 *
 * The names are shorthand. There are no sofas or quaysides in a sandbox of
 * cubes, so what actually gets built is the geometry underneath each name: a
 * long beam and a tight corner, a crate riding a platform on a stroke, a ramp
 * with no grip and a bin of loose blocks to fix that with. Saying it in blocks
 * first is what stops a level being specced that cannot be made.
 *
 * Every one of these bans flight. Rotors are the answer to almost anything,
 * and none of these problems is interesting if you can simply lift the thing
 * over the top of it.
 */
export const JOBS = [
  {
    id: 'removals',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Removals',
    brief: 'Take the long beam down the corridor, round the corner, and out the far end.',
    hint: 'It is longer than the corner is wide, so it will not go round end-on however you push it. The room in the middle is the only place with the space to turn it — a turntable under it does that without letting go.',
    spawn: [0, 1.2, -17],
    groundSize: 90,
    budget: { cost: 110 },
    pieces: [
      // The approach: a 2.4 m corridor running north.
      { pos: [-1.6, 1.3, -8], size: [0.8, 2.6, 16], colour: DARK },
      { pos: [1.6, 1.3, -8], size: [0.8, 2.6, 16], colour: DARK },
      // The turning room. Six metres square, which is just enough.
      { pos: [-2.1, 1.3, -0.4], size: [1.8, 2.6, 0.8], colour: DARK },
      { pos: [2.1, 1.3, -0.4], size: [1.8, 2.6, 0.8], colour: DARK },
      { pos: [-3.4, 1.3, 3], size: [0.8, 2.6, 6], colour: DARK },
      { pos: [0, 1.3, 6.4], size: [7.6, 2.6, 0.8], colour: DARK },
      { pos: [3.4, 1.3, 0.9], size: [0.8, 2.6, 1.8], colour: DARK },
      { pos: [3.4, 1.3, 5.1], size: [0.8, 2.6, 1.8], colour: DARK },
      // The way out, running east.
      { pos: [8.7, 1.3, 1.4], size: [11.4, 2.6, 0.8], colour: DARK },
      { pos: [8.7, 1.3, 4.6], size: [11.4, 2.6, 0.8], colour: DARK },
    ],
    props: [
      { id: 'beam', pos: [0, 0.35, -10], size: [0.5, 0.5, 5.5], mass: 8, colour: TAN },
    ],
    zones: [
      { id: 'out', pos: [13, 1, 3], size: [2.4, 2.4, 2.4], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'beam', zone: 'out', hold: 2, label: 'Beam out the far end' },
    ],
    par: 150,
  },

  {
    id: 'tow-truck',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Tow Truck',
    brief: 'A dead machine sits on the apron with nothing driving it. Get it onto the pad.',
    hint: 'It does not coast. Shove it and it stops the moment you stop, and pushing a long thing from behind slews it sideways — latch onto it and pull instead.',
    spawn: [0, 1.2, -8],
    groundSize: 90,
    budget: { cost: 110 },
    pieces: [
      { pos: [0, 0.3, 15], size: [8, 0.6, 5], colour: GREY },
    ],
    props: [
      // About half as heavy again as a starter rover, and grippy enough that
      // it goes nowhere on its own the instant it is let go of.
      { id: 'wreck', pos: [0, 0.65, 1], size: [2.2, 1.2, 4.2], mass: 30, friction: 1.1, colour: STEEL },
    ],
    zones: [
      { id: 'pad', pos: [0, 1.2, 15], size: [5, 2.4, 4], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'wreck', zone: 'pad', hold: 3, label: 'Dead machine recovered to the pad' },
    ],
    par: 140,
  },

  {
    id: 'container-port',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Container Port',
    brief: 'The crate is riding a platform that rises and falls two metres. Take it off and set it on the fixed pad.',
    hint: 'You cannot fight the platform, so time it. At the top and the bottom of the stroke it is briefly still, and that is when to close on it.',
    spawn: [0, 1.2, -6],
    groundSize: 70,
    budget: { cost: 160 },
    pieces: [
      { pos: [4.6, 0.6, 5], size: [2.8, 1.2, 2.8], colour: GREY },
    ],
    // One platform on a slow, steady vertical stroke. Where in the stroke it
    // starts is drawn per run, so the timing cannot be learned as a count.
    movers: [
      { pos: [0, 2.2, 5], size: [3.4, 0.4, 3.4], axis: 'y', span: 1, speed: [0.45, 0.45], colour: 0x5a6470 },
    ],
    props: [
      { id: 'container', pos: [0, 2.95, 5], size: [1.1, 1.1, 1.1], mass: 5, colour: 0x7cc4ff },
    ],
    zones: [
      { id: 'pad', pos: [4.6, 1.9, 5], size: [2.6, 1.6, 2.6], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'container', zone: 'pad', hold: 3, label: 'Container landed on the quay' },
    ],
    par: 190,
  },

  {
    id: 'gritter',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Gritter',
    brief: 'The road is cut away: a sheer step up to the upper level, and no way round it. There is a bin of hardcore at the bottom. Get the crate up there.',
    hint: 'Nothing on wheels drives up a face taller than it is. The course is not fixed, though — shove the hardcore up against the step until it is a slope rather than a wall, and then drive up what you built.',
    spawn: [0, 1.2, -8],
    groundSize: 80,
    budget: { cost: 150 },
    pieces: [
      // A clean 1.2 m face, which is getting on for three wheel diameters. No
      // ramp, no kerb, nothing to catch on: it is a wall until it is filled.
      { pos: [0, 0.6, 9], size: [14, 1.2, 14], colour: GREY },
      // The bin the hardcore starts in.
      { pos: [-3.5, 0.4, -6.2], size: [3.4, 0.8, 0.3], colour: DARK },
      { pos: [-3.5, 0.4, -1.8], size: [3.4, 0.8, 0.3], colour: DARK },
      { pos: [-5.2, 0.4, -4], size: [0.3, 0.8, 4.4], colour: DARK },
      { pos: [-1.8, 0.4, -4], size: [0.3, 0.8, 4.4], colour: DARK },
    ],
    stacks: [
      // Enough of it to build a slope out of, and heavy enough to stay where
      // it is put rather than skittering away from the first wheel on it.
      { id: 'grit', count: 45, pos: [-3.5, 0.6, -4], spread: [2.6, 1.2, 3.4], size: [0.5, 0.5, 0.5], mass: 1.6, colour: GRIT },
    ],
    props: [
      { id: 'crate', pos: [2.5, 0.6, -4], size: [1.1, 1.1, 1.1], mass: 6, colour: TAN },
    ],
    zones: [
      { id: 'top', pos: [0, 2.2, 10], size: [4, 2, 4], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'top', hold: 3, label: 'Crate up the slope' },
    ],
    par: 200,
  },

  {
    id: 'roadworks',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Roadworks',
    brief: 'Forty loose blocks have come down across the only road. The crate still has to get to the far end.',
    hint: 'Lifting them out one at a time takes all day. Build something wide and low at the front and shove the whole heap aside in one pass.',
    spawn: [0, 1.2, -9],
    groundSize: 80,
    budget: { cost: 110 },
    pieces: [
      { pos: [-3.2, 1.2, 3], size: [0.6, 2.4, 26], colour: DARK },
      { pos: [3.2, 1.2, 3], size: [0.6, 2.4, 26], colour: DARK },
    ],
    stacks: [
      { id: 'rubble', count: 40, pos: [0, 0.5, 4], spread: [5.2, 1.6, 2.4], size: [0.55, 0.55, 0.55], mass: 1.6, colour: GRIT },
    ],
    props: [
      { id: 'crate', pos: [0, 0.6, -6], size: [1.1, 1.1, 1.1], mass: 7, colour: TAN },
    ],
    zones: [
      { id: 'goal', pos: [0, 1, 13], size: [4, 2.4, 4], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'goal', hold: 3, label: 'Crate through to the far end' },
    ],
    par: 140,
  },

  {
    id: 'drawbridge',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Drawbridge',
    brief: 'The span is lying on this side of the gap and the gap is the only way over. Bridge it, then get the machine across.',
    hint: 'The span is loose and heavy and nothing holds it down once it is out there, so how squarely you lay it matters more than how fast. Put it down straight, then take the crossing gently.',
    spawn: [0, 1.2, -10],
    groundSize: 120,
    groundY: -12,
    budget: { cost: 130 },
    pieces: [
      { pos: [0, 0, -6], size: [10, 1, 14], colour: GREY },
      { pos: [0, 0, 11.6], size: [10, 1, 14], colour: GREY },
    ],
    props: [
      { id: 'span', pos: [0, 0.9, -3], size: [2.4, 0.4, 5.4], mass: 14, colour: STEEL },
    ],
    zones: [
      { id: 'gap', pos: [0, 0.75, 2.8], size: [3, 1.4, 3.4], colour: 0x4ade80 },
      { id: 'far', pos: [0, 1.5, 10], size: [4, 2.4, 4], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'span', zone: 'gap', hold: 2, label: 'Span laid across the gap' },
      { type: 'coreInZone', zone: 'far', hold: 3, label: 'Machine over on the far side' },
    ],
    par: 170,
  },

  {
    id: 'loading-bay',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Loading Bay',
    brief: 'Four crates into the bay, over a lip a metre high. All four, one run.',
    hint: 'A machine that handles one crate beautifully does this four times over. Something flat and wide that takes the lot in one lift does it once.',
    spawn: [0, 1.2, -5],
    groundSize: 60,
    budget: { cost: 130 },
    pieces: [
      { pos: [0, 0.5, 6], size: [6.6, 1, 0.5], colour: DARK },
      { pos: [-3.3, 1, 8.2], size: [0.5, 2, 4.9], colour: DARK },
      { pos: [3.3, 1, 8.2], size: [0.5, 2, 4.9], colour: DARK },
      { pos: [0, 1, 10.4], size: [7.1, 2, 0.5], colour: DARK },
    ],
    props: [
      { id: 'parcel-a', pos: [-2.4, 0.5, 0], size: [0.9, 0.9, 0.9], mass: 3, colour: TAN },
      { id: 'parcel-b', pos: [-0.8, 0.5, 0], size: [0.9, 0.9, 0.9], mass: 3, colour: TAN },
      { id: 'parcel-c', pos: [0.8, 0.5, 0], size: [0.9, 0.9, 0.9], mass: 3, colour: TAN },
      { id: 'parcel-d', pos: [2.4, 0.5, 0], size: [0.9, 0.9, 0.9], mass: 3, colour: TAN },
    ],
    zones: [
      { id: 'bay', pos: [0, 1.1, 8.2], size: [6, 3, 4], colour: 0x4ade80 },
    ],
    objectives: [
      {
        type: 'allPropsInZone',
        props: ['parcel-a', 'parcel-b', 'parcel-c', 'parcel-d'],
        zone: 'bay',
        hold: 2,
        label: 'All four parcels in the bay',
      },
    ],
    par: 170,
  },

  {
    id: 'scrapyard',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Scrapyard',
    brief: 'Five blocks scattered round the yard, and a line three metres up. Get all five above it and leave them there for five seconds.',
    hint: 'Reach is not the problem — holding it together is. Each one you put up there knocks the last one off, so build something that stacks square, or something wide enough to lift all five at once.',
    spawn: [0, 1.2, -9],
    groundSize: 60,
    budget: { cost: 150 },
    pieces: [],
    props: [
      { id: 'scrap-a', pos: [-4, 0.35, -3], size: [0.7, 0.7, 0.7], mass: 2, colour: STEEL },
      { id: 'scrap-b', pos: [3.5, 0.35, -4], size: [0.7, 0.7, 0.7], mass: 2, colour: STEEL },
      { id: 'scrap-c', pos: [-2, 0.35, 4], size: [0.7, 0.7, 0.7], mass: 2, colour: STEEL },
      { id: 'scrap-d', pos: [4, 0.35, 3], size: [0.7, 0.7, 0.7], mass: 2, colour: STEEL },
      { id: 'scrap-e', pos: [0, 0.35, 6], size: [0.7, 0.7, 0.7], mass: 2, colour: STEEL },
    ],
    zones: [
      // Everything from three metres up. Where in it they end up is nobody's
      // business but yours — stacked, trayed or held, it counts the same.
      { id: 'line', pos: [0, 4.5, 0], size: [8, 3, 8], colour: 0x4ade80 },
    ],
    objectives: [
      {
        type: 'allPropsInZone',
        props: ['scrap-a', 'scrap-b', 'scrap-c', 'scrap-d', 'scrap-e'],
        zone: 'line',
        hold: 5,
        label: 'All five above the line',
      },
    ],
    par: 210,
  },
];
