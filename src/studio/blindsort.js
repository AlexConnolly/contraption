import { Blueprint } from '../core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../core/orientation.js';
import { tidyLayout } from '../sim/program.js';
import {
  graph, facing, driveTowards, standOn, toWheels,
} from './autopilot.js';

/**
 * Three crates on three spots, two bays, and no way to know in advance which
 * crate is which.
 *
 * Every other hands-off machine so far follows a route: a list of places in an
 * order, with the states only deciding when one leg is finished and the next
 * begins. This one cannot. The crates are dealt among the spots every run, so
 * the same journey ends in the wrong bay half the time, and the program has to
 * *ask* — put its eye on a crate, read what comes back, and take one of two
 * different roads depending on the answer.
 *
 * It has no memory between ticks either, which sounds fatal for a job that is
 * three deliveries long: there is nowhere to write down which ones are done.
 * The field is the memory. A spot it has already cleared reads as empty when
 * it comes back round, so the machine can simply keep going round the three
 * spots until it finds one with something on it.
 */

export const RED_TAG = 3;
export const BLUE_TAG = 4;

/** Where the three crates start. Fixed places; the dealing is what changes. */
export const SPOTS = [
  [-6, 0, 3],
  [0, 0, 8],
  [6, 0, 13],
];

/**
 * Each spot is worked from three marks: one to the south to look from, and one
 * on either side to push from.
 *
 * Pushing is done along the spot's own lane, straight out to east or west, and
 * the three lanes are stepped apart in z so that a crate on its way to a bay
 * never crosses a spot that still has a crate sitting on it.
 */
const REACH = 4.5;
export const LOOK = SPOTS.map(([x, , z]) => [x, 1.2, z - 5]);
export const WEST = SPOTS.map(([x, , z]) => [x + REACH, 1.2, z]);
export const EAST = SPOTS.map(([x, , z]) => [x - REACH, 1.2, z]);

/** Where a crate has to be across before the machine lets it go. */
const LINE = 11.2;
/** And where the machine aims while pushing it there — well beyond the bay, so
 *  that it is still driving at full effort when it arrives rather than easing
 *  off into a crate it can no longer shift. */
const AIM = 24;

function sortProgram(parts, wheels) {
  const { gps, eye } = parts;

  /**
   * Stand south of a spot, square up on it, and read what is there.
   *
   * The range matters as much as the tag. Looking down the lane from five
   * metres back, an empty spot is not silence — the beam carries on past it
   * and eventually finds something else to report. Anything further off than
   * the spot itself is not this spot's business.
   */
  const look = (index, next) => {
    const g = graph();
    const { add, wire } = g;
    const mark = add('constant', { kind: 'vec3', vector: LOOK[index] });
    const spot = add('constant', { kind: 'vec3', vector: SPOTS[index] });

    // Two and a half degrees, not five. The eye is a single thread and a crate
    // is only a metre across: at five metres of standoff, five degrees of slop
    // is half a metre of it, and a machine that stops turning at the edge of
    // that window looks straight past the corner of the crate and reports an
    // empty spot.
    const { left, right, ready } = standOn(g, { gps }, { node: mark, port: 'value' }, {
      node: spot, port: 'value',
    }, { slack: 2.5, near: 0.8, travel: { topSpeed: 4, keenness: 0.9 } });
    toWheels(g, wheels, left, right);

    const range = add('read', { partId: eye, port: 'distance' });
    const arm = add('constant', { kind: 'number', value: 5.5 });
    const near = add('compare', { op: 'lt' });
    wire(range, 'value', near, 'a');
    wire(arm, 'value', near, 'b');

    const tag = add('read', { partId: eye, port: 'tag' });
    const reads = (value) => {
      const wanted = add('constant', { kind: 'number', value });
      const is = add('compare', { op: 'eq' });
      const here = add('logic', { op: 'and' });
      wire(tag, 'value', is, 'a');
      wire(wanted, 'value', is, 'b');
      wire(near, 'r', here, 'a');
      wire(is, 'r', here, 'b');
      return here;
    };
    const red = reads(RED_TAG);
    const blue = reads(BLUE_TAG);

    const send = (when, state) => {
      const go = add('goto', { state });
      const both = add('logic', { op: 'and' });
      wire(ready, 'r', both, 'a');
      wire(when, 'r', both, 'b');
      wire(both, 'r', go, 'when');
    };
    send(red, `west-${index}`);
    send(blue, `east-${index}`);

    // Empty is its own reading, not the absence of the other two. Down an
    // empty lane the beam finds nothing at all and comes back at its full nine
    // metres, which is a far clearer answer than "something, but not mine".
    const far = add('constant', { kind: 'number', value: 7 });
    const bare = add('compare', { op: 'gt' });
    wire(range, 'value', bare, 'a');
    wire(far, 'value', bare, 'b');
    send(bare, next);
    return g;
  };

  /** Round to the far side of the crate, so the bay is dead ahead of both. */
  const lineUp = (mark, next) => {
    const g = graph();
    const { add, wire } = g;
    const stand = add('constant', { kind: 'vec3', vector: mark });
    const { left, right, range } = driveTowards(g, { gps }, { node: stand, port: 'value' }, {
      topSpeed: 4,
      keenness: 0.9,
    });
    toWheels(g, wheels, left, right);

    const close = add('constant', { kind: 'number', value: 1.1 });
    const there = add('compare', { op: 'lt' });
    const go = add('goto', { state: next });
    wire(range, 'flat', there, 'a');
    wire(close, 'value', there, 'b');
    wire(there, 'r', go, 'when');
    return g;
  };

  /**
   * Straight out along the lane, crate first.
   *
   * The target is built rather than remembered: the bay's edge for the x of
   * it, and whatever z the machine is standing at for the rest. Standing on
   * the lane is what makes that true, and it stays true all the way out, so
   * the machine holds its line without ever being told which lane it is in.
   *
   * Slowly. A rover that charges a crate pitches over its own front axle and
   * finishes the run upside down with its wheels turning, quite certain it is
   * still pointing the right way.
   */
  const shove = (side, done) => {
    const g = graph();
    const { add, wire } = g;
    const here = add('read', { partId: gps, port: 'position' });
    const mine = add('split');
    const far = add('constant', { kind: 'number', value: side * AIM });
    const target = add('vector');
    wire(here, 'value', mine, 'v');
    wire(far, 'value', target, 'x');
    wire(mine, 'y', target, 'y');
    wire(mine, 'z', target, 'z');

    const { left, right } = driveTowards(g, { gps }, { node: target, port: 'v' }, {
      topSpeed: 2,
      keenness: 0.35,
      urgency: 1,
    });
    toWheels(g, wheels, left, right);

    // Far enough out that the crate is over the line, and no further: the bay
    // has a wall at the back of it and shunting into that is how a delivery
    // becomes a wedged crate.
    const post = add('constant', { kind: 'number', value: side * LINE });
    const out = add('compare', { op: side < 0 ? 'lt' : 'gt' });
    const go = add('goto', { state: done });
    wire(mine, 'x', out, 'a');
    wire(post, 'value', out, 'b');
    wire(out, 'r', go, 'when');
    return g;
  };

  /**
   * Come back down the field before going round again.
   *
   * Driving straight from a bay to the first look mark cuts the corner off the
   * nearest spot, and a machine two and a half metres wide passing a metre and
   * a half from a crate does not pass it — it takes it along, and a crate that
   * is no longer on its spot is one the eye will never find again. Going south
   * first costs a few seconds and crosses no lane that matters.
   */
  const regroup = () => {
    const g = graph();
    const { add, wire } = g;
    const here = add('read', { partId: gps, port: 'position' });
    const mine = add('split');
    const south = add('constant', { kind: 'number', value: -8 });
    const target = add('vector');
    wire(here, 'value', mine, 'v');
    wire(mine, 'x', target, 'x');
    wire(mine, 'y', target, 'y');
    wire(south, 'value', target, 'z');

    const { left, right } = driveTowards(g, { gps }, { node: target, port: 'v' }, {
      topSpeed: 4,
      keenness: 0.9,
    });
    toWheels(g, wheels, left, right);

    const line = add('constant', { kind: 'number', value: -7 });
    const clear = add('compare', { op: 'lt' });
    const go = add('goto', { state: 'look-0' });
    wire(mine, 'z', clear, 'a');
    wire(line, 'value', clear, 'b');
    wire(clear, 'r', go, 'when');
    return g;
  };

  const states = [
    { id: 'look-0', name: 'Look at A', ...look(0, 'look-1') },
    { id: 'look-1', name: 'Look at B', ...look(1, 'look-2') },
    { id: 'look-2', name: 'Look at C', ...look(2, 'look-0') },
    { id: 'west-0', name: 'Round A', ...lineUp(WEST[0], 'to-red') },
    { id: 'west-1', name: 'Round B', ...lineUp(WEST[1], 'to-red') },
    { id: 'west-2', name: 'Round C', ...lineUp(WEST[2], 'to-red') },
    { id: 'east-0', name: 'Round A', ...lineUp(EAST[0], 'to-blue') },
    { id: 'east-1', name: 'Round B', ...lineUp(EAST[1], 'to-blue') },
    { id: 'east-2', name: 'Round C', ...lineUp(EAST[2], 'to-blue') },
    { id: 'to-red', name: 'Red bay', ...shove(-1, 'regroup') },
    { id: 'to-blue', name: 'Blue bay', ...shove(1, 'regroup') },
    { id: 'regroup', name: 'Back down', ...regroup() },
  ];

  return { version: 1, start: 'look-0', states: states.map((state) => tidyLayout(state)) };
}

/**
 * A plough. Low wide blade at axle height, and one eye above it at the height
 * of a crate.
 *
 * Low is the whole point of the blade. Carried at chest height it meets a
 * crate above the middle of it and tips the thing over instead of moving it.
 */
export function sorter() {
  const bp = new Blueprint({ name: 'Sorter' });
  const place = (...args) => {
    const result = bp.place(...args);
    if (!result.ok) throw new Error(`Sorter could not place a part: ${result.reason}`);
    return result;
  };
  const back = yawStep(yawStep(IDENTITY_ORIENTATION));
  const ahead = facing([0, 0, 1]);

  place('panel', [0, 0, 0]);
  const wheels = { left: [], right: [] };
  for (const z of [-1, 1]) {
    wheels.left.push(place('wheel', [2, 0, z], IDENTITY_ORIENTATION).id);
    wheels.right.push(place('wheel', [-2, 0, z], back).id);
  }

  place('core', [0, 1, -1]);
  const gps = place('gps', [1, 1, -1]);
  const computer = place('computer', [-1, 1, -1]);

  place('beam', [0, 0, 2]);
  const eye = place('sensor', [0, 1, 2], ahead);

  bp.setConfig(computer.id, {
    program: sortProgram({ gps: gps.id, eye: eye.id }, wheels),
  });
  return bp;
}
