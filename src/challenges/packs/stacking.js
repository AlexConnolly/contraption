import { GREY, DARK, tagColour } from '../palette.js';

/**
 * Height caps.
 *
 * The cap is on the machine as built, never on the machine as it runs, and
 * that distinction is the entire mechanic. A cap you could not exceed at
 * runtime would only be a shorter machine and a duller level. A cap on what
 * you may *assemble* leaves the height to come from somewhere else, and there
 * are several somewheres: a mast of pistons that telescopes, an arm that
 * unfolds sideways and swings up, a tower built lying on its back and stood
 * upright once the run starts.
 *
 * The job that makes it bite is a stack, because a stack is the one thing that
 * gets further out of reach the better you are doing at it. And the last load
 * is green, and has to end up in the beam at the top — so the tower is not
 * finished when it is tall, it is finished when the right load is on top of
 * it and the whole thing is still standing.
 */

const LOAD = tagColour(0);
const GREEN = tagColour(2);

// Loads are square and a little under a metre, so ten of them is a tower about
// eight metres tall — four times what the machine may be built to.
// Tall enough that a grabber meets a load's side rather than passing over the
// top of it. At 80 cm a load's roof is below every height anybody mounts a
// grabber at, and driving at one just pushes it round the yard.
const SIDE = 0.9;
const RISE = SIDE + 0.02;
// Magnetic, so they take hold of each other where they meet. Ten loads high is
// a question about reach; it should not also be a question about whether the
// sixth one went down four centimetres out.
const loadAt = (id, x, z, colour = LOAD, tag = 0) => ({
  id,
  pos: [x, SIDE / 2 + 0.05, z],
  size: [SIDE, SIDE, SIDE],
  mass: 3,
  friction: 1.1,
  magnetic: true,
  colour,
  tag,
});

export const STACKING = [
  {
    id: 'low-loader',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    heightCap: 4,
    name: 'Low Loader',
    brief: 'Get the crate onto the shelf. Your machine may be four blocks tall; the shelf is higher than that.',
    hint: 'The cap is on what you build, not on what you become. Four blocks is the machine on the bench — a piston, a hinge or an arm folded down flat can all be taller than that once the run starts. Build low, then grow.',
    spawn: [0, 1.2, -12],
    groundSize: 110,
    budget: { cost: 140 },
    pieces: [
      { pos: [0, 1.3, 8], size: [5, 2.6, 4], colour: DARK },
    ],
    props: [
      { id: 'crate', pos: [0, 0.55, -2], size: [1, 1, 1], mass: 5, friction: 1.1, colour: LOAD },
    ],
    zones: [
      { id: 'shelf', pos: [0, 3.2, 8], size: [4, 1.6, 3], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'shelf', hold: 3, label: 'Crate up on the shelf' },
    ],
    par: 170,
  },

  /**
   * The one the cap was built for.
   *
   * Ten loads, and the green one has to finish on top of the pile with its
   * nose in the beam. Nothing about that is reachable by a machine two metres
   * tall, so the height has to be built rather than owned — and there are two
   * good answers. Grow a mast tall enough to place the tenth load at eight
   * metres, or never lift anything higher than one load at all: jack the tower
   * up, post the next one in underneath, and let the green one you put down
   * first ride to the top as the pile grows under it.
   */
  {
    id: 'stacked-loop',
    demands: { steps: 3, flies: false },
    bans: ['flight'],
    // Six blocks is three metres against a tower of eight. A mast that
    // telescopes still has to be most of the machine to reach the top of
    // it, and there is no room left over for anything that is not mast.
    heightCap: 6,
    name: 'Stacked Loop',
    brief: 'Ten loads on the pad, stacked, with the green one on top and up in the beam.',
    hint: 'The loads are magnetic — they take hold of each other where they meet, so a load put down roughly right stays put. You cannot reach the top of this, so stop trying to. Either grow a mast — pistons stack, and each one is a block tall and reaches far more than a block — or work from the bottom: put the green one down first, lift the pile, and post the next load in underneath it. The tower has to be standing at the end, not to have stood at some point.',
    spawn: [0, 1.2, -16],
    groundSize: 140,
    budget: { cost: 200 },
    pieces: [
      { pos: [0, 0.05, 0], size: [4, 0.1, 4], colour: GREY },
    ],
    props: [
      loadAt('load-1', -6, -6),
      loadAt('load-2', -4, -7),
      loadAt('load-3', -2, -8),
      loadAt('load-4', 0, -7),
      loadAt('load-5', 2, -8),
      loadAt('load-6', 4, -7),
      loadAt('load-7', 6, -6),
      loadAt('load-8', -5, -4),
      loadAt('load-9', 5, -4),
      loadAt('green', 0, -4, GREEN, 2),
    ],
    zones: [
      // The pad the tower has to stand on, and the beam across the top of it.
      // Narrow enough that a load parked beside the tower is not on the pad,
      // wide enough for the quarter-metre a ten-high tower leans by.
      { id: 'pad', pos: [0, 4.5, 0], size: [1.9, 9, 1.9], colour: 0x4ade80 },
      { id: 'beam', pos: [0, 8.78, 0], size: [3.2, 1.1, 3.2], colour: 0x35d0e0 },
    ],
    objectives: [
      {
        type: 'propsStacked',
        zone: 'pad',
        count: 10,
        rise: RISE,
        hold: 3,
        label: 'Ten loads stacked on the pad',
      },
      { type: 'propInZone', prop: 'green', zone: 'beam', hold: 3, label: 'Green load up in the beam' },
    ],
    par: 400,
  },
];
