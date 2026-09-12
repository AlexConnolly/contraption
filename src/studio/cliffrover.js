import { Blueprint } from '../core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../core/orientation.js';
import { tidyLayout } from '../sim/program.js';
import { graph } from './autopilot.js';

/**
 * A rover that follows a gantry over a drop without being told where the
 * gantry is.
 *
 * Three beams point straight down off the front — one at each corner and one
 * in the middle. Over the deck they find it within a metre and read tripped;
 * over the edge the floor of the drop is eleven metres away, past the range,
 * and they read nothing. So "tripped" means there is something to drive onto
 * and "clear" means there is not.
 *
 * The whole of the thinking is one sentence: if any beam is clear, turn;
 * otherwise drive. That sentence lives in the decider, which runs every loop
 * whatever state the machine is in, so neither Drive nor Turn contains a
 * single sensor — they are only a pair of throttles. Before there was a
 * decider, that check had to be copied into both of them, and into every
 * state added afterwards.
 */

// Straight down. Any of the four rotations that point the beam at the floor
// would do; this is the one that leaves the part sitting the right way up.
const DOWN = 17;

export function cliffRover({
  reach = 4, speed = 0.3, turn = 0.5, hold = 0.5, back = 0.6, blind = false,
} = {}) {
  const bp = new Blueprint({ name: 'Cliff rover' });
  const place = (...args) => {
    const out = bp.place(...args);
    if (!out.ok) throw new Error(`Cliff rover could not place a part: ${out.reason}`);
    return out;
  };
  const other = yawStep(yawStep(IDENTITY_ORIENTATION));

  place('panel', [0, 0, 0]);
  place('core', [0, 1, 0]);

  // Wheels down both sides. Which side a wheel is on decides which way its
  // motor turns for a given throttle, so driving is one number to all four and
  // turning on the spot is one number to each side.
  const left = [];
  const right = [];
  for (const z of [-1, 1]) {
    left.push(place('wheel', [2, 0, z], IDENTITY_ORIENTATION).id);
    right.push(place('wheel', [-2, 0, z], other).id);
  }

  // An arm to carry the beams out in front of the wheels, held a deck's height
  // above the floor. Looking down at the front bumper is too late to be
  // useful: by the time the beam clears, the wheels are already over the edge.
  // Carrying the arm at floor level is no better — it drops over the lip and
  // the machine beaches itself on its own nose, wheels turning, going nowhere.
  for (let z = 1; z < reach; z += 1) place('block', [0, 1, z]);

  // One at each front corner and one in the middle. The corners catch a turn
  // that has gone too far; the middle catches driving straight at a gap.
  const eyes = [0, 1, -1].map((x) => place('sensor', [x, 1, reach], DOWN).id);

  const computer = place('computer', [0, 2, 0]);
  bp.setConfig(computer.id, {
    program: roverProgram(eyes, { left, right }, {
      speed, turn, hold, back, blind,
    }),
  });
  return bp;
}

function roverProgram(eyes, wheels, {
  speed, turn: spin, hold, back, blind,
}) {
  /**
   * The decider. Reads all three beams, asks whether every one of them has
   * ground under it, and sends the machine to Drive or to Turn accordingly.
   *
   * The two conditions are exact opposites, so only ever one of them fires and
   * the order the nodes happen to be in does not matter.
   */
  const decide = graph();
  {
    const { add, wire } = decide;
    const reads = eyes.map((id) => add('read', { partId: id, port: 'tripped' }));
    const both = add('logic', { op: 'and' });
    wire(reads[0], 'value', both, 'a');
    wire(reads[1], 'value', both, 'b');
    const all = add('logic', { op: 'and' });
    wire(both, 'r', all, 'a');
    wire(reads[2], 'value', all, 'b');

    const any = add('logic', { op: 'not' });
    wire(all, 'r', any, 'a');

    // Which way to come round. Turning the same way every time is what puts
    // the machine in a corner and holds it there: it backs off one edge
    // straight into the next one. Turning away from whichever side has
    // nothing under it walks it along an edge instead, and out of a corner.
    const leftGone = add('logic', { op: 'not' });
    wire(reads[1], 'value', leftGone, 'a');

    const goRight = add('logic', { op: 'and' });
    wire(any, 'r', goRight, 'a');
    wire(leftGone, 'r', goRight, 'b');
    const right = add('goto', { state: 'right' });
    wire(goRight, 'r', right, 'when');

    const goLeft = add('logic', { op: 'and' });
    wire(any, 'r', goLeft, 'a');
    wire(reads[1], 'value', goLeft, 'b');
    const left = add('goto', { state: 'left' });
    wire(goLeft, 'r', left, 'when');

    // Going back to driving the instant the beams come back is not enough:
    // at that moment the machine has only just brought its nose over the
    // deck and is still pointed along the edge, so it drives straight back
    // off. It has to keep turning for a beat after it is clear. The timer
    // reads seconds in the state it is in, so in Turn it is how long the
    // turn has lasted.
    const since = add('timer');
    const enough = add('constant', { value: hold });
    const settled = add('compare', { op: 'gt' });
    wire(since, 'seconds', settled, 'a');
    wire(enough, 'value', settled, 'b');

    const clear = add('logic', { op: 'and' });
    wire(all, 'r', clear, 'a');
    wire(settled, 'r', clear, 'b');

    const drive = add('goto', { state: 'drive' });
    wire(clear, 'r', drive, 'when');
  }

  // Sends one number to every wheel on a side.
  const throttle = (g, leftValue, rightValue) => {
    const { add, wire } = g;
    const left = add('constant', { value: leftValue });
    const right = add('constant', { value: rightValue });
    for (const id of wheels.left) wire(left, 'value', add('write', { partId: id, port: 'throttle' }), 'value');
    for (const id of wheels.right) wire(right, 'value', add('write', { partId: id, port: 'throttle' }), 'value');
  };

  // Both of the ordinary states are a pair of numbers and nothing else.
  const drive = graph();
  throttle(drive, speed, speed);

  // A turn with a lean backwards in it. Turning on the spot keeps the machine
  // pivoting about a point that is still at the edge, so the nose sweeps in
  // and out over the drop and it never gets anywhere; easing back while it
  // comes round takes the pivot with it.
  const right = graph();
  throttle(right, spin - back, -spin - back);
  const left = graph();
  throttle(left, -spin - back, spin - back);

  const states = [
    { id: 'decide', name: 'Decide', main: true, nodes: decide.nodes, links: decide.links },
    { id: 'drive', name: 'Drive', nodes: drive.nodes, links: drive.links },
    { id: 'right', name: 'Turn right', nodes: right.nodes, links: right.links },
    { id: 'left', name: 'Turn left', nodes: left.nodes, links: left.links },
  ];
  for (const state of states) tidyLayout(state);
  // The same machine with the deciding taken out, for comparison: it still
  // has the beams, it just never looks at them.
  const seen = blind ? states.filter((state) => !state.main) : states;
  return { version: 1, start: 'drive', states: seen };
}
