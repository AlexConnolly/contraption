import { Blueprint } from '../core/blueprint.js';
import {
  IDENTITY_ORIENTATION, ORIENTATIONS, applyOrientation,
} from '../core/orientation.js';
import { makeId, tidyLayout } from '../sim/program.js';

const CRUISE_HEIGHT = 7;
const NOTICE = 6;
const STAND_OFF = 4.5;
const TOP_SPEED = 5;
const CLOSE = 4.5;

function graph() {
  const nodes = [];
  const links = [];
  const add = (type, config = {}) => {
    const id = makeId('n');
    nodes.push({ id, type, config, x: 0, y: 0 });
    return id;
  };
  const wire = (from, fromPort, to, toPort) => {
    links.push({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
  };
  return { nodes, links, add, wire };
}

// The orientation that points a part's local +Z along `axis`, keeping up as up.
function facing(axis) {
  return ORIENTATIONS.findIndex((_, index) => {
    const forward = applyOrientation(index, [0, 0, 1]);
    return forward.every((n, i) => n === axis[i])
      && applyOrientation(index, [0, 1, 0])[1] === 1;
  });
}

/**
 * Flies a machine to the pad through obstacles that move. Nothing in here
 * knows where those obstacles are or when they will shift: every avoiding
 * decision comes off a sensor reading, which is the only thing that works
 * when the blockers run at a different speed and start somewhere else on
 * every single run.
 */
function dodgeProgram(parts) {
  const {
    gps, controller, ahead, portSide, starboard, guardPort, guardStarboard,
  } = parts;

  /**
   * What every state needs: hold the height, and hold the nose pointing
   * straight down the corridor. The machine can slide sideways, so it has no
   * reason to turn, and keeping it still leaves the whiskers looking where
   * they are meant to instead of swinging about.
   */
  const holdCourse = (g, height) => {
    const { add, wire } = g;
    const set = add('constant', { kind: 'number', value: height });
    const hold = add('write', { partId: controller, port: 'targetAltitude' });
    wire(set, 'value', hold, 'value');

    // Heading minus target: a positive yaw command swings the nose to the
    // machine's right, which is -X, so it drives the heading down.
    const heading = add('read', { partId: gps, port: 'heading' });
    const straight = add('constant', { kind: 'number', value: 0 });
    const turn = add('maths', { op: 'angleDelta' });
    const span = add('constant', { kind: 'number', value: 40 });
    const rate = add('maths', { op: 'divide' });
    const full = add('constant', { kind: 'number', value: 1 });
    const limited = add('maths', { op: 'clamp' });
    const yaw = add('write', { partId: controller, port: 'yaw' });
    wire(straight, 'value', turn, 'a');
    wire(heading, 'value', turn, 'b');
    wire(turn, 'r', rate, 'a');
    wire(span, 'value', rate, 'b');
    wire(rate, 'r', limited, 'a');
    wire(full, 'value', limited, 'b');
    wire(limited, 'r', yaw, 'value');

    const here = add('read', { partId: gps, port: 'position' });
    const pad = add('waypoint', { zone: 'pad' });
    const range = add('distance');
    wire(here, 'value', range, 'a');
    wire(pad, 'position', range, 'b');

    return { full, here, pad, range };
  };

  const climb = graph();
  {
    const { add, wire } = climb;
    holdCourse(climb, CRUISE_HEIGHT);
    const altitude = add('read', { partId: gps, port: 'altitude' });
    const enough = add('constant', { kind: 'number', value: CRUISE_HEIGHT - 0.4 });
    const high = add('compare', { op: 'gte' });
    const go = add('goto', { state: 'run' });
    wire(altitude, 'value', high, 'a');
    wire(enough, 'value', high, 'b');
    wire(high, 'r', go, 'when');
  }

  /**
   * Sees the whole frontal arc, not just the one ray down the nose. A single
   * beam lines up with a gap, reads clear, and the machine commits — and then
   * the gap slides shut in front of it. The narrow guards either side close
   * that off. They are kept narrow on purpose: a wide beam picks up the
   * corridor walls whenever the machine is near one and would stop it dead.
   */
  const frontalArc = (g) => {
    const { add, wire } = g;
    const nose = add('read', { partId: ahead, port: 'distance' });
    const guardS = add('read', { partId: guardStarboard, port: 'distance' });
    const guardP = add('read', { partId: guardPort, port: 'distance' });
    const nearer = add('maths', { op: 'min' });
    const nearest = add('maths', { op: 'min' });
    wire(nose, 'value', nearer, 'a');
    wire(guardS, 'value', nearer, 'b');
    wire(nearer, 'r', nearest, 'a');
    wire(guardP, 'value', nearest, 'b');
    return nearest;
  };

  /**
   * Which of a pair of beams has more room, as one signed number. Each counts
   * only once it ends inside `range`, so open air on both sides gives zero and
   * the machine is left to steer for the pad. Positive means the machine's
   * right, which is -X, is the roomier way.
   *
   * Which pair matters. A beam swept out to 50 degrees only reaches about
   * 5.8 m ahead before it runs out of range, so at a 6 m stand-off the wide
   * whiskers cannot see the thing being stood off from at all — the narrow
   * guards are the ones that pick the way past. The wide pair earns its keep
   * close in, where it is the only thing that sees a wall coming.
   */
  const roomier = (g, left, right, range) => {
    const { add, wire } = g;
    const board = add('read', { partId: right, port: 'distance' });
    const port = add('read', { partId: left, port: 'distance' });
    const notice = add('constant', { kind: 'number', value: range });
    const none = add('constant', { kind: 'number', value: 0 });

    const boardGap = add('maths', { op: 'subtract' });
    const boardNear = add('maths', { op: 'max' });
    wire(notice, 'value', boardGap, 'a');
    wire(board, 'value', boardGap, 'b');
    wire(boardGap, 'r', boardNear, 'a');
    wire(none, 'value', boardNear, 'b');

    const portGap = add('maths', { op: 'subtract' });
    const portNear = add('maths', { op: 'max' });
    wire(notice, 'value', portGap, 'a');
    wire(port, 'value', portGap, 'b');
    wire(portGap, 'r', portNear, 'a');
    wire(none, 'value', portNear, 'b');

    const difference = add('maths', { op: 'subtract' });
    wire(portNear, 'r', difference, 'a');
    wire(boardNear, 'r', difference, 'b');
    return difference;
  };

  // The way past, plus a shove off anything close on either beam.
  const sideDemand = (g, wayPastGain, wallGain) => {
    const { add, wire } = g;
    const wayPast = roomier(g, guardPort, guardStarboard, NOTICE);
    const keenToPass = add('constant', { kind: 'number', value: wayPastGain });
    const passing = add('maths', { op: 'multiply' });
    wire(wayPast, 'r', passing, 'a');
    wire(keenToPass, 'value', passing, 'b');

    const walls = roomier(g, portSide, starboard, CLOSE);
    const keenToClear = add('constant', { kind: 'number', value: wallGain });
    const clearing = add('maths', { op: 'multiply' });
    wire(walls, 'r', clearing, 'a');
    wire(keenToClear, 'value', clearing, 'b');

    const total = add('maths', { op: 'add' });
    wire(passing, 'r', total, 'a');
    wire(clearing, 'r', total, 'b');
    return total;
  };

  /**
   * How hard the machine may push forward given what is ahead of it. The room
   * left in front of the stand-off sets a speed it is allowed to do, and the
   * gap between that and the speed it is doing sets the lean.
   *
   * Leaning straight off the distance, with no speed in it, cannot brake: by
   * the time the stand-off is reached the machine still has all its momentum
   * and coasts into whatever it was standing off from. Inside the stand-off
   * the permitted speed goes negative, so it gives ground.
   */
  const standOffFrom = (g, front, full) => {
    const { add, wire } = g;
    const standOff = add('constant', { kind: 'number', value: STAND_OFF });
    const room = add('maths', { op: 'subtract' });
    const openness = add('constant', { kind: 'number', value: 0.7 });
    const allowed = add('maths', { op: 'multiply' });
    const ceiling = add('constant', { kind: 'number', value: TOP_SPEED });
    const permitted = add('maths', { op: 'clamp' });
    wire(front, 'r', room, 'a');
    wire(standOff, 'value', room, 'b');
    wire(room, 'r', allowed, 'a');
    wire(openness, 'value', allowed, 'b');
    wire(allowed, 'r', permitted, 'a');
    wire(ceiling, 'value', permitted, 'b');

    const velocity = add('read', { partId: gps, port: 'velocity' });
    const speed = add('split');
    const excess = add('maths', { op: 'subtract' });
    const firmness = add('constant', { kind: 'number', value: 0.6 });
    const demand = add('maths', { op: 'multiply' });
    const limit = add('maths', { op: 'clamp' });
    wire(velocity, 'value', speed, 'v');
    wire(permitted, 'r', excess, 'a');
    wire(speed, 'z', excess, 'b');
    wire(excess, 'r', demand, 'a');
    wire(firmness, 'value', demand, 'b');
    wire(demand, 'r', limit, 'a');
    wire(full, 'value', limit, 'b');
    return limit;
  };

  /**
   * Flies and avoids at the same time.
   *
   * Along the corridor and across it are each a cascade: how far there is to
   * go sets a speed to aim for, and the gap between that and the speed it is
   * doing sets the lean. Leaning straight off the distance has no ceiling on
   * it, and the machine arrives at the first obstacle far too fast to stop.
   *
   * Forward demand is then whichever is smaller, that or what the frontal arc
   * allows. Sideways demand is the pull back toward the line to the pad plus
   * whichever side is roomier.
   */
  const run = graph();
  {
    const { add, wire } = run;
    const { full, here, pad, range } = holdCourse(run, CRUISE_HEIGHT);

    const velocity = add('read', { partId: gps, port: 'velocity' });
    const speed = add('split');
    const padParts = add('split');
    const hereParts = add('split');
    wire(velocity, 'value', speed, 'v');
    wire(pad, 'position', padParts, 'v');
    wire(here, 'value', hereParts, 'v');

    const toGo = add('maths', { op: 'subtract' });
    const keenness = add('constant', { kind: 'number', value: 0.3 });
    const wanted = add('maths', { op: 'multiply' });
    const topSpeed = add('constant', { kind: 'number', value: TOP_SPEED });
    const capped = add('maths', { op: 'clamp' });
    wire(padParts, 'z', toGo, 'a');
    wire(hereParts, 'z', toGo, 'b');
    wire(toGo, 'r', wanted, 'a');
    wire(keenness, 'value', wanted, 'b');
    wire(wanted, 'r', capped, 'a');
    wire(topSpeed, 'value', capped, 'b');

    const excess = add('maths', { op: 'subtract' });
    const urgency = add('constant', { kind: 'number', value: 0.6 });
    const demand = add('maths', { op: 'multiply' });
    const drive = add('maths', { op: 'clamp' });
    wire(capped, 'r', excess, 'a');
    wire(speed, 'z', excess, 'b');
    wire(excess, 'r', demand, 'a');
    wire(urgency, 'value', demand, 'b');
    wire(demand, 'r', drive, 'a');
    wire(full, 'value', drive, 'b');

    const front = frontalArc(run);
    const limit = standOffFrom(run, front, full);
    const chosen = add('maths', { op: 'min' });
    const pitch = add('write', { partId: controller, port: 'pitch' });
    wire(drive, 'r', chosen, 'a');
    wire(limit, 'r', chosen, 'b');
    wire(chosen, 'r', pitch, 'value');

    // Across the corridor. A positive roll slides toward the machine's right,
    // which is -X, so both guidance terms come out negated.
    const across = add('maths', { op: 'subtract' });
    const homing = add('constant', { kind: 'number', value: -0.12 });
    const pull = add('maths', { op: 'multiply' });
    const damping = add('constant', { kind: 'number', value: 0.75 });
    const steady = add('maths', { op: 'multiply' });
    const guided = add('maths', { op: 'add' });
    wire(padParts, 'x', across, 'a');
    wire(hereParts, 'x', across, 'b');
    wire(across, 'r', pull, 'a');
    wire(homing, 'value', pull, 'b');
    wire(speed, 'x', steady, 'a');
    wire(damping, 'value', steady, 'b');
    wire(pull, 'r', guided, 'a');
    wire(steady, 'r', guided, 'b');

    const sideways = sideDemand(run, 0.3, 0.45);

    const combined = add('maths', { op: 'add' });
    const slide = add('maths', { op: 'clamp' });
    const roll = add('write', { partId: controller, port: 'roll' });
    wire(guided, 'r', combined, 'a');
    wire(sideways, 'r', combined, 'b');
    wire(combined, 'r', slide, 'a');
    wire(full, 'value', slide, 'b');
    wire(slide, 'r', roll, 'value');

    const close = add('constant', { kind: 'number', value: 2.5 });
    const arrived = add('compare', { op: 'lt' });
    const land = add('goto', { state: 'arrive' });
    wire(range, 'flat', arrived, 'a');
    wire(close, 'value', arrived, 'b');
    wire(arrived, 'r', land, 'when');

    // Steering by both terms together balances out exactly in front of
    // something wide, and the machine sits there arguing with itself. Once the
    // way ahead is shut, hand over to a state that has already picked a side
    // and will not reconsider. Whichever wide whisker reads further decides,
    // and the first of these to fire wins, so a dead heat goes right.
    const shut = add('constant', { kind: 'number', value: STAND_OFF + 1 });
    const trapped = add('compare', { op: 'lt' });
    wire(front, 'r', trapped, 'a');
    wire(shut, 'value', trapped, 'b');

    const scanStarboard = add('read', { partId: starboard, port: 'distance' });
    const scanPort = add('read', { partId: portSide, port: 'distance' });
    const rightIsClearer = add('compare', { op: 'gte' });
    wire(scanStarboard, 'value', rightIsClearer, 'a');
    wire(scanPort, 'value', rightIsClearer, 'b');

    const goRight = add('logic', { op: 'and' });
    const takeRight = add('goto', { state: 'slipRight' });
    wire(trapped, 'r', goRight, 'a');
    wire(rightIsClearer, 'r', goRight, 'b');
    wire(goRight, 'r', takeRight, 'when');

    const takeLeft = add('goto', { state: 'slipLeft' });
    wire(trapped, 'r', takeLeft, 'when');
  }

  /**
   * The way ahead is shut, and this state has already picked which way it is
   * going: no weighing up, no changing its mind. Two states rather than one
   * choice made afresh every tick, because a blocker square in front reads the
   * same on both sides and a machine deciding each tick just sits there.
   *
   * The wide whiskers still push it off anything close, so committing to a
   * side does not mean grinding along a wall.
   */
  const slip = (towards) => {
    const g = graph();
    const { add, wire } = g;
    const { full } = holdCourse(g, CRUISE_HEIGHT);

    const front = frontalArc(g);
    const limit = standOffFrom(g, front, full);
    const pitch = add('write', { partId: controller, port: 'pitch' });
    wire(limit, 'r', pitch, 'value');

    // A nudge in the direction this state committed to, on top of the same
    // reading of the way past that the run state uses. The nudge alone breaks
    // the deadlock in front of something square-on; the proportional part is
    // what eases the machine onto the gap instead of carrying it clean across
    // the corridor and into the far wall.
    const committed = add('constant', { kind: 'number', value: towards });
    const reading = sideDemand(g, 0.35, 0.55);
    const urged = add('maths', { op: 'add' });
    wire(committed, 'value', urged, 'a');
    wire(reading, 'r', urged, 'b');

    // And lean against how fast it is already sliding, or it accelerates until
    // something stops it.
    const velocity = add('read', { partId: gps, port: 'velocity' });
    const speed = add('split');
    const damping = add('constant', { kind: 'number', value: 0.75 });
    const steady = add('maths', { op: 'multiply' });
    wire(velocity, 'value', speed, 'v');
    wire(speed, 'x', steady, 'a');
    wire(damping, 'value', steady, 'b');

    const total = add('maths', { op: 'add' });
    const slide = add('maths', { op: 'clamp' });
    const roll = add('write', { partId: controller, port: 'roll' });
    wire(urged, 'r', total, 'a');
    wire(steady, 'r', total, 'b');
    wire(total, 'r', slide, 'a');
    wire(full, 'value', slide, 'b');
    wire(slide, 'r', roll, 'value');

    // Well clear before handing back, so it does not bounce straight in again.
    const clear = add('constant', { kind: 'number', value: STAND_OFF + 2.5 });
    const open = add('compare', { op: 'gt' });
    const resume = add('goto', { state: 'run' });
    wire(front, 'r', open, 'a');
    wire(clear, 'value', open, 'b');
    wire(open, 'r', resume, 'when');
    return g;
  };

  const slipRight = slip(0.4);
  const slipLeft = slip(-0.4);

  // Sit on the pad. With nothing written to pitch or roll the controller holds
  // its own station, which is what keeps it there.
  const arrive = graph();
  {
    const { add, wire } = arrive;
    const { range } = holdCourse(arrive, CRUISE_HEIGHT);
    const drifted = add('constant', { kind: 'number', value: 4 });
    const lost = add('compare', { op: 'gt' });
    const back = add('goto', { state: 'run' });
    wire(range, 'flat', lost, 'a');
    wire(drifted, 'value', lost, 'b');
    wire(lost, 'r', back, 'when');
  }

  return {
    version: 1,
    start: 'climb',
    states: [
      { id: 'climb', name: 'Climb', ...climb },
      { id: 'run', name: 'Run', ...run },
      { id: 'slipRight', name: 'Slip right', ...slipRight },
      { id: 'slipLeft', name: 'Slip left', ...slipLeft },
      { id: 'arrive', name: 'Arrive', ...arrive },
    ].map((state) => tidyLayout(state)),
  };
}

/**
 * A drone that can see: one beam down the nose and a whisker angled out each
 * side, wired to a program that steers round things rather than into them.
 */
export function dodger() {
  const bp = new Blueprint({ name: 'Dodger' });
  const place = (...args) => {
    const result = bp.place(...args);
    if (!result.ok) throw new Error(`Dodger could not place a part: ${result.reason}`);
    return result;
  };

  place('panel', [0, 0, 0]);
  place('core', [0, 1, 0]);
  const controller = place('controller', [0, 1, -1]);
  const gps = place('gps', [0, 2, -1]);
  const computer = place('computer', [0, 2, 0]);
  const ahead = place('sensor', [0, 1, 1], facing([0, 0, 1]));
  const starboard = place('sensor', [-1, 1, 0], facing([0, 0, 1]), { yaw: -50 });
  const portSide = place('sensor', [1, 1, 0], facing([0, 0, 1]), { yaw: 50 });
  const guardStarboard = place('sensor', [-1, 2, 0], facing([0, 0, 1]), { yaw: -20 });
  const guardPort = place('sensor', [1, 2, 0], facing([0, 0, 1]), { yaw: 20 });
  for (const cell of [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1]]) {
    place('propeller', cell, IDENTITY_ORIENTATION, { binding: { mode: 'flight' } });
  }

  bp.setConfig(computer.id, {
    program: dodgeProgram({
      gps: gps.id,
      controller: controller.id,
      ahead: ahead.id,
      portSide: portSide.id,
      starboard: starboard.id,
      guardPort: guardPort.id,
      guardStarboard: guardStarboard.id,
    }),
  });
  return bp;
}
