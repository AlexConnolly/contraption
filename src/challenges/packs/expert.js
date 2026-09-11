import { GREY, DARK } from '../palette.js';

/**
 * The hands-off problems. No keyboard at all: you draw a program on the
 * Computer and press Play, and whatever happens next is what you wrote.
 *
 * Each of these is the same shape as a level you have already beaten by hand,
 * which is the point — you know what the job is, so the only question left is
 * whether you can say it precisely enough for a machine to do it.
 */
export const EXPERT = [
  {
    id: 'autocrane',
    demands: { steps: 3, flies: false, autonomous: true },
    bans: ['flight'],
    handsOff: true,
    name: 'Autocrane',
    brief: 'Lift the payload off the floor and set it on the platform. No rotors, and no hands — draw the program and watch.',
    hint: 'Four moves in order: get to it, grab it, raise it, carry it over and let go. Drive until the magnet says it is holding something rather than to a measured spot, because the offset between your aerial and your hook is never quite what you think it is.',
    spawn: [0, 1.2, -7],
    groundSize: 110,
    budget: { cost: 150 },
    pieces: [
      // The platform, off to one side so the machine has to turn rather than
      // simply press on. Nothing stands near the payload: a plinth to lift it
      // off is the obvious thing to build and the wheels jam against it, so
      // the payload is tall instead and the floor around it is clear.
      { pos: [6, 0.5, 8], size: [4.6, 1, 4.6], colour: DARK },
      { pos: [6, 1.03, 8], size: [5, 0.06, 5], colour: GREY },
    ],
    props: [
      { id: 'payload', pos: [0, 0.3, 2], size: [0.6, 0.6, 0.6], mass: 2, colour: 0x7cc4ff },
    ],
    zones: [
      { id: 'top', pos: [6, 1.7, 8], size: [4.4, 1.4, 4.4], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'payload', zone: 'top', hold: 3, label: 'Payload set down on the platform' },
    ],
    par: 120,
  },

  {
    id: 'blind-sort',
    demands: { steps: 3, flies: false, autonomous: true },
    bans: ['flight'],
    handsOff: true,
    name: 'Blind Sort',
    brief: 'Three crates, two bays, and no telling which is which until you look. Red goes west, blue goes east — and nothing pressed.',
    hint: 'This is the first one a route will not solve. The crates are dealt among the spots every run, so the same journey ends in the wrong bay half the time: the program has to read the tag and take a different road depending on the answer. Range matters as much as the tag — past an empty spot the beam carries on and finds the next one.',
    spawn: [0, 1.2, -8],
    groundSize: 120,
    budget: { cost: 140 },
    pieces: [
      // Back walls, so a crate that is still rolling when the machine lets go
      // stops inside its bay instead of out on the plain.
      { pos: [-16, 1, 8], size: [0.6, 2, 18], colour: DARK },
      { pos: [16, 1, 8], size: [0.6, 2, 18], colour: DARK },
    ],
    props: [
      // Chest high and no higher. Taller than the beam so that a machine
      // squaring up on one still has it in view when it bounces on its
      // suspension — a crate level with the beam is one a machine looks
      // straight over the top of at five metres and calls an empty spot.
      { id: 'crate-red-1', pos: [-6, 0.8, 3], size: [1.2, 1.6, 1.2], mass: 3, colour: 0xff6b6b, tag: 3 },
      { id: 'crate-blue', pos: [0, 0.8, 8], size: [1.2, 1.6, 1.2], mass: 3, colour: 0x5aa9ff, tag: 4 },
      { id: 'crate-red-2', pos: [6, 0.8, 13], size: [1.2, 1.6, 1.2], mass: 3, colour: 0xff6b6b, tag: 3 },
    ],
    // Dealt again every run. Which crate is on which spot is the one thing the
    // machine cannot be told in advance.
    shuffle: [['crate-red-1', 'crate-blue', 'crate-red-2']],
    zones: [
      { id: 'red', pos: [-12.5, 1, 8], size: [5, 2, 17], colour: 0xff6b6b },
      { id: 'blue', pos: [12.5, 1, 8], size: [5, 2, 17], colour: 0x5aa9ff },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate-red-1', zone: 'red', hold: 1, label: 'First red crate in the red bay' },
      { type: 'propInZone', prop: 'crate-red-2', zone: 'red', hold: 1, label: 'Second red crate in the red bay' },
      { type: 'propInZone', prop: 'crate-blue', zone: 'blue', hold: 1, label: 'Blue crate in the blue bay' },
    ],
    par: 150,
  },

  {
    id: 'free-kick',
    demands: { steps: 3, flies: false, autonomous: true },
    bans: ['flight'],
    handsOff: true,
    name: 'Free Kick',
    brief: 'Three things on the pitch and only one of them is the ball. Find it, get behind it and score — with nothing pressed.',
    hint: 'They are dealt among the three spots every run, so a remembered position is worth nothing — but the spots themselves never move. A sensor says what it is looking at as well as how far: the ball reads 5 and the crates read 2. Go and stand on the line that runs from the goal out through a spot, and looking at what is on it and shooting at it become the same heading.',
    spawn: [0, 1.2, -10],
    groundSize: 140,
    budget: { cost: 130 },
    pieces: [
      // A goal that keeps what goes into it.
      { pos: [-5.2, 1.4, 14], size: [0.5, 2.8, 0.5], colour: GREY },
      { pos: [5.2, 1.4, 14], size: [0.5, 2.8, 0.5], colour: GREY },
      { pos: [0, 2.95, 14], size: [10.9, 0.5, 0.5], colour: GREY },
      { pos: [0, 1.4, 17], size: [10.9, 2.8, 0.4], colour: DARK },
      { pos: [-5.2, 1.4, 15.5], size: [0.4, 2.8, 3], colour: DARK },
      { pos: [5.2, 1.4, 15.5], size: [0.4, 2.8, 3], colour: DARK },
    ],
    props: [
      // All three stand about knee height. Any taller and the ball stops being
      // something a rover pushes and becomes something it drives up and over —
      // measured, with a machine that kicked once and spent the rest of the
      // run on its back with its wheels turning.
      { id: 'ball', pos: [0, 0.6, 0], radius: 0.6, mass: 4, colour: 0xffa64d, tag: 5, ccd: true },
      { id: 'crate-a', pos: [-6, 0.6, 0], size: [1.2, 1.2, 1.2], mass: 9, colour: 0x8a7f70, tag: 2 },
      { id: 'crate-b', pos: [6, 0.6, 0], size: [1.2, 1.2, 1.2], mass: 9, colour: 0x8a7f70, tag: 2 },
    ],
    // Dealt again every run. Which of the three spots holds the ball is the
    // only thing the machine cannot be told in advance.
    shuffle: [['ball', 'crate-a', 'crate-b']],
    zones: [
      { id: 'goal', pos: [0, 1.2, 15.4], size: [10, 2.6, 2.6], colour: 0x4ade80 },
    ],
    objectives: [
      { type: 'propInZone', prop: 'ball', zone: 'goal', hold: 1, label: 'Ball in the goal' },
    ],
    par: 150,
  },
];
