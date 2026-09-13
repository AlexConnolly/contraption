import { GREY, DARK, tagColour } from '../palette.js';

/**
 * Pressure plates.
 *
 * A plate is a square of floor that wants something standing on it, and the
 * only new idea in it is that plates are *held* rather than ticked off. Every
 * other objective in the game can be done one at a time; a room full of plates
 * is one problem rather than several errands, because the moment you leave to
 * go and deal with the next one, the last one comes back up.
 *
 * That turns a fetch-and-carry into a question about reach, and the answers
 * ramp cleanly:
 *
 *   two plates, two crates      — drop both, drive away, done
 *   more plates than crates     — the machine has to be part of the answer
 *   three plates, one crate     — and now it has to be all three at once
 *
 * Coloured plates want cargo of that colour and will not take the machine, or
 * every one of them would have the same answer. A neutral plate takes whatever
 * is put on it, including a wheel, an arm, or a lump of ballast on the end of a
 * boom — it is the plate you stand on yourself.
 */

const RED = tagColour(1);
const BLUE = tagColour(3);

export const PLATES = [
  {
    id: 'two-plates',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Two Plates',
    brief: 'Two plates, two crates, and both plates have to be down at the same time.',
    hint: 'Nothing clever needed yet: put the red crate on the red plate and the blue one on the blue plate. What matters is the last word of the brief — a plate only counts while something is on it, so you cannot do one, then go back for the other.',
    spawn: [0, 1.2, -14],
    groundSize: 120,
    budget: { cost: 90 },
    pieces: [],
    plates: [
      { id: 'red', pos: [-4, 0.15, 6], size: [2.6, 0.3, 2.6], tag: 1 },
      { id: 'blue', pos: [4, 0.15, 6], size: [2.6, 0.3, 2.6], tag: 3 },
    ],
    props: [
      { id: 'crate-red', pos: [-3, 0.55, -4], size: [1.1, 1.1, 1.1], mass: 6, colour: RED, tag: 1 },
      { id: 'crate-blue', pos: [3, 0.55, -4], size: [1.1, 1.1, 1.1], mass: 6, colour: BLUE, tag: 3 },
    ],
    zones: [],
    objectives: [
      { type: 'platePressed', plate: 'red', hold: 3, label: 'Red plate held down' },
      { type: 'platePressed', plate: 'blue', hold: 3, label: 'Blue plate held down' },
    ],
    par: 120,
  },

  {
    id: 'short-handed',
    demands: { steps: 2, flies: false },
    bans: ['flight', 'coupling'],
    name: 'Short Handed',
    brief: 'Three plates, two crates. The third one is neutral, and takes anything at all.',
    hint: 'You are one crate short on purpose. A neutral plate does not care what holds it down, so the last one is yours to stand on — park on it, or reach out and lean on it, and keep the other two down while you do.',
    spawn: [0, 1.2, -14],
    groundSize: 120,
    budget: { cost: 110 },
    pieces: [],
    plates: [
      { id: 'red', pos: [-5, 0.15, 5], size: [2.6, 0.3, 2.6], tag: 1 },
      { id: 'blue', pos: [0, 0.15, 8], size: [2.6, 0.3, 2.6], tag: 3 },
      { id: 'spare', pos: [5, 0.15, 5], size: [2.6, 0.3, 2.6] },
    ],
    props: [
      { id: 'crate-red', pos: [-3, 0.55, -5], size: [1.1, 1.1, 1.1], mass: 6, colour: RED, tag: 1 },
      { id: 'crate-blue', pos: [3, 0.55, -5], size: [1.1, 1.1, 1.1], mass: 6, colour: BLUE, tag: 3 },
    ],
    zones: [],
    objectives: [
      { type: 'platePressed', plate: 'red', hold: 3, label: 'Red plate held down' },
      { type: 'platePressed', plate: 'blue', hold: 3, label: 'Blue plate held down' },
      { type: 'platePressed', plate: 'spare', hold: 3, label: 'Neutral plate held down' },
    ],
    par: 170,
  },

  /**
   * The one the mechanic was built for.
   *
   * Three plates on three pillars, ten metres from the left one to the right
   * one, one crate, and no way to fly to any of it. The crate answers the
   * middle plate and there is nothing left over for the other two, so the
   * machine has to answer them itself — both of them, at once, at two metres
   * up and five metres either side of the middle.
   *
   * No couplings, so nothing can be left behind and collected later. Whatever
   * presses the outer plates is still bolted to whatever presses the middle
   * one, which is the whole problem: it has to be one machine, and it has to
   * be wide.
   */
  {
    id: 'the-span',
    demands: { steps: 3, flies: false },
    bans: ['flight', 'coupling'],
    name: 'The Span',
    brief: 'Three plates on three pillars, ten metres end to end, and one crate between them.',
    hint: 'Count the plates, then count what you have to put on them. The crate is red and so is the middle plate; the outer two are neutral and will take any part of your machine. Nothing can be dropped off and left, so build one wide thing that reaches both ends at once — a long beam with weight at each end, and a way to get the crate up two metres in the middle.',
    spawn: [0, 1.2, -16],
    groundSize: 130,
    budget: { cost: 200 },
    pieces: [
      { pos: [-5, 1, 6], size: [3, 2, 3.4], colour: DARK },
      { pos: [0, 1, 6], size: [3, 2, 3.4], colour: GREY },
      { pos: [5, 1, 6], size: [3, 2, 3.4], colour: DARK },
    ],
    plates: [
      { id: 'left', pos: [-5, 2.15, 6], size: [2.4, 0.3, 3.0] },
      { id: 'middle', pos: [0, 2.15, 6], size: [2.4, 0.3, 3.0], tag: 1 },
      { id: 'right', pos: [5, 2.15, 6], size: [2.4, 0.3, 3.0] },
    ],
    props: [
      { id: 'crate', pos: [0, 0.55, -4], size: [1, 1, 1], mass: 4, colour: RED, tag: 1 },
    ],
    zones: [],
    objectives: [
      { type: 'platePressed', plate: 'left', hold: 3, label: 'Left pillar held down' },
      { type: 'platePressed', plate: 'middle', hold: 3, label: 'Crate on the middle pillar' },
      { type: 'platePressed', plate: 'right', hold: 3, label: 'Right pillar held down' },
    ],
    par: 260,
  },
];
