import { DARK, tagColour } from '../palette.js';

/**
 * Cannonade is the first level in the game you can lose by doing nothing.
 *
 * Everything else is a job — move that, get there, hold this down — and the
 * clock is the only thing that ever acts on its own. Here the course acts and
 * you react: three cannons, nine balls, one every three seconds, and the run
 * ends the moment one of them touches the floor.
 *
 * Two things in it are new because of that. A run that is won by outlasting it
 * rather than by finishing anything, and a failure that comes from a prop
 * rather than from where the machine went. The pressure pad is the third: it
 * is the part that lets the machine know it has caught something, which is the
 * difference between a tray and a machine that can do something about a catch.
 */

const BALL = tagColour(4);
const GAP = 3;

// Nine shots, three seconds apart, round-robin across the three cannons. Each
// cannon therefore waits nine seconds between its own shots.
const cannon = (id, x, aimX, first) => ({
  id,
  pos: [x, 1.6, 17],
  aim: [aimX, 0.52, -1],
  speed: 13,
  balls: [`${id}-1`, `${id}-2`, `${id}-3`],
  first,
  gap: GAP * 3,
  colour: 0x59636f,
});

const ball = (id) => ({
  id, pos: [0, -60, 0], radius: 0.3, mass: 2, friction: 1.2, damping: 0.05, colour: BALL, tag: 4,
});

export const CANNONADE = [
  {
    id: 'cannonade',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Cannonade',
    brief: 'Three cannons, nine balls, one every three seconds. Drop one and the run is over.',
    hint: 'A flat deck will not do it — a ball that lands on one rolls straight off, and off is the floor. You want walls, and something soft about how it lands: a tray on a spring, or a piston you can give a little on. The cannons take turns from left to right, so you have three seconds to be somewhere else.',
    spawn: [0, 1.2, -6],
    groundSize: 120,
    budget: { cost: 160 },
    // Where a ball resting on the ground would sit. Caught low is still caught.
    catchFloor: 0.62,
    pieces: [
      { pos: [-9, 0.9, 17], size: [1.6, 1.8, 1.6], colour: DARK },
      { pos: [0, 0.9, 17], size: [1.6, 1.8, 1.6], colour: DARK },
      { pos: [9, 0.9, 17], size: [1.6, 1.8, 1.6], colour: DARK },
    ],
    launchers: [
      cannon('left', -9, 0.34, 4),
      cannon('mid', 0, 0, 4 + GAP),
      cannon('right', 9, -0.34, 4 + GAP * 2),
    ],
    props: [
      ball('left-1'), ball('left-2'), ball('left-3'),
      ball('mid-1'), ball('mid-2'), ball('mid-3'),
      ball('right-1'), ball('right-2'), ball('right-3'),
    ],
    zones: [],
    objectives: [
      // Four seconds before the first shot, nine shots three apart, and a few
      // seconds at the end for the last one to settle in whatever caught it.
      { type: 'survived', seconds: 4 + GAP * 8 + 6, label: 'All nine caught and held' },
    ],
    par: 40,
  },
];
