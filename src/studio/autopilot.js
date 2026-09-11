import { ORIENTATIONS, applyOrientation } from '../core/orientation.js';
import { makeId } from '../sim/program.js';

/**
 * The bits every hands-off machine needs: a way to build a graph, a way to
 * point a part at something, and a ground-steering cascade.
 *
 * `dodger.js` is the flying equivalent and predates this. These three levels
 * are all driven rather than flown, and a rover steers by giving one side of
 * itself more throttle than the other, which is a different problem from
 * leaning a drone.
 */

export function graph() {
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

/** The orientation that points a part's local +Z along `axis`, up still up. */
export function facing(axis) {
  return ORIENTATIONS.findIndex((_, index) => {
    const forward = applyOrientation(index, [0, 0, 1]);
    return forward.every((n, i) => n === axis[i])
      && applyOrientation(index, [0, 1, 0])[1] === 1;
  });
}

/**
 * The orientation that points a part's local +Y along `axis`. What a grabber
 * is looking at is its own up, so a magnet that has to reach down for
 * something has to be turned over to do it.
 */
export function pointing(axis) {
  return ORIENTATIONS.findIndex((_, index) => (
    applyOrientation(index, [0, 1, 0]).every((n, i) => n === axis[i])
  ));
}

/**
 * Throttle for both sides of a rover, as a cascade rather than a straight
 * proportional term. `target` is `{ node, port }`, so it can be a zone the
 * level knows about or a fixed point written into the program.
 *
 * How far there is to go sets a speed to aim for, and the gap between that and
 * the speed it is actually doing sets the throttle. Driving straight off the
 * distance has no ceiling on it: the machine arrives at full tilt and carries
 * everything it was holding off the front.
 *
 * Steering is the shortest way round from where it is pointing to where the
 * target lies. A positive yaw swings the nose to the machine's right, which is
 * -X, so the left-hand wheels are the ones that get the extra.
 */
export function driveTowards(g, parts, target, options = {}) {
  const { add, wire } = g;
  const { gps } = parts;
  const topSpeed = options.topSpeed ?? 3;
  const keenness = options.keenness ?? 0.55;
  const urgency = options.urgency ?? 0.7;
  const turnSpan = options.turnSpan ?? 45;
  const turnGain = options.turnGain ?? 1;

  const here = add('read', { partId: gps, port: 'position' });
  const range = add('distance');
  wire(here, 'value', range, 'a');
  wire(target.node, target.port, range, 'b');

  // Distance to go, softened into a speed and capped.
  const wanted = add('maths', { op: 'multiply' });
  const keen = add('constant', { kind: 'number', value: keenness });
  const ceiling = add('constant', { kind: 'number', value: topSpeed });
  const capped = add('maths', { op: 'clamp' });
  wire(range, 'flat', wanted, 'a');
  wire(keen, 'value', wanted, 'b');
  wire(wanted, 'r', capped, 'a');
  wire(ceiling, 'value', capped, 'b');

  // The gap between that and the speed it is doing.
  const speed = add('read', { partId: gps, port: 'speed' });
  const excess = add('maths', { op: 'subtract' });
  const eager = add('constant', { kind: 'number', value: urgency });
  const demand = add('maths', { op: 'multiply' });
  const one = add('constant', { kind: 'number', value: 1 });
  const drive = add('maths', { op: 'clamp' });
  wire(capped, 'r', excess, 'a');
  wire(speed, 'value', excess, 'b');
  wire(excess, 'r', demand, 'a');
  wire(eager, 'value', demand, 'b');
  wire(demand, 'r', drive, 'a');
  wire(one, 'value', drive, 'b');

  // Which way to point, and how far off it is.
  const want = add('bearing');
  const heading = add('read', { partId: gps, port: 'heading' });
  const off = add('maths', { op: 'angleDelta' });
  const span = add('constant', { kind: 'number', value: turnSpan });
  const rate = add('maths', { op: 'divide' });
  const gain = add('constant', { kind: 'number', value: turnGain });
  const urged = add('maths', { op: 'multiply' });
  const turn = add('maths', { op: 'clamp' });
  wire(here, 'value', want, 'a');
  wire(target.node, target.port, want, 'b');
  wire(heading, 'value', off, 'a');
  wire(want, 'deg', off, 'b');
  wire(off, 'r', rate, 'a');
  wire(span, 'value', rate, 'b');
  wire(rate, 'r', urged, 'a');
  wire(gain, 'value', urged, 'b');

  wire(urged, 'r', turn, 'a');
  wire(one, 'value', turn, 'b');

  // A machine pointing the wrong way should turn on the spot rather than
  // drive off in the wrong direction and correct later.
  const swing = add('maths', { op: 'abs' });
  const wide = add('constant', { kind: 'number', value: 0.55 });
  const wayOff = add('compare', { op: 'gt' });
  const nothing = add('constant', { kind: 'number', value: 0 });
  const forward = add('select');
  wire(turn, 'r', swing, 'a');
  wire(swing, 'r', wayOff, 'a');
  wire(wide, 'value', wayOff, 'b');
  wire(wayOff, 'r', forward, 'when');
  wire(nothing, 'value', forward, 'a');
  wire(drive, 'r', forward, 'b');

  // Heading falls as the nose swings right, so a positive correction means
  // turning right, which is the left-hand wheels doing more.
  const left = add('maths', { op: 'subtract' });
  const right = add('maths', { op: 'add' });
  wire(forward, 'r', left, 'a');
  wire(turn, 'r', left, 'b');
  wire(forward, 'r', right, 'a');
  wire(turn, 'r', right, 'b');

  const leftCapped = add('maths', { op: 'clamp' });
  const rightCapped = add('maths', { op: 'clamp' });
  wire(left, 'r', leftCapped, 'a');
  wire(one, 'value', leftCapped, 'b');
  wire(right, 'r', rightCapped, 'a');
  wire(one, 'value', rightCapped, 'b');

  return {
    left: leftCapped, right: rightCapped, range, here, one, nothing, drive, turn,
  };
}

/** Sends a throttle to every wheel on a side. */
export function toWheels(g, wheels, leftValue, rightValue) {
  const { add, wire } = g;
  for (const id of wheels.left) {
    const w = add('write', { partId: id, port: 'throttle' });
    wire(leftValue, 'r', w, 'value');
  }
  for (const id of wheels.right) {
    const w = add('write', { partId: id, port: 'throttle' });
    wire(rightValue, 'r', w, 'value');
  }
}

/** Stops every wheel dead. */
export function halt(g, wheels) {
  const { add, wire } = g;
  const stop = add('constant', { kind: 'number', value: 0 });
  for (const id of [...wheels.left, ...wheels.right]) {
    const w = add('write', { partId: id, port: 'throttle' });
    wire(stop, 'value', w, 'value');
  }
  return stop;
}

/**
 * How far round the nose has to swing to point at something, and a throttle
 * that will actually swing it.
 *
 * The obvious thing is a turn proportional to how far off it is, and on a
 * machine that is already standing still it does not work: the last few degrees
 * ask for a tenth of a turn, the wheels never break their grip on the ground,
 * and it sits there creeping three degrees a minute. Turning from rest is one
 * effort or none.
 */
export function swingTo(g, gps, target, effort = 1) {
  const { add, wire } = g;
  const here = add('read', { partId: gps, port: 'position' });
  const heading = add('read', { partId: gps, port: 'heading' });
  const want = add('bearing');
  const off = add('maths', { op: 'angleDelta' });
  wire(here, 'value', want, 'a');
  wire(target.node, target.port, want, 'b');
  wire(heading, 'value', off, 'a');
  wire(want, 'deg', off, 'b');

  const nothing = add('constant', { kind: 'number', value: 0 });
  const clockwise = add('compare', { op: 'gt' });
  const hard = add('constant', { kind: 'number', value: effort });
  const soft = add('constant', { kind: 'number', value: -effort });
  const turn = add('select');
  wire(off, 'r', clockwise, 'a');
  wire(nothing, 'value', clockwise, 'b');
  wire(clockwise, 'r', turn, 'when');
  wire(hard, 'value', turn, 'a');
  wire(soft, 'value', turn, 'b');
  return { turn, off };
}

/**
 * Go and stand on a mark, then square up on something else, and say when both
 * are true.
 *
 * This is the posture every machine that has to *look* at something ends up
 * wanting. Where it stands decides what its eye is lined up with, so the
 * answer it gets back is only worth anything once it has stopped moving and
 * stopped turning: mid-swing the beam sweeps across everything else on the
 * field and reports whatever it caught on the way past.
 */
export function standOn(g, parts, mark, aim, options = {}) {
  const { add, wire } = g;
  const { gps } = parts;

  const travel = driveTowards(g, { gps }, mark, options.travel ?? {
    topSpeed: 3,
    keenness: 0.7,
  });
  const square = swingTo(g, gps, aim, options.effort ?? 1);

  const nothing = add('constant', { kind: 'number', value: 0 });
  const aimLeft = add('maths', { op: 'subtract' });
  const aimRight = add('maths', { op: 'add' });
  wire(nothing, 'value', aimLeft, 'a');
  wire(square.turn, 'r', aimLeft, 'b');
  wire(nothing, 'value', aimRight, 'a');
  wire(square.turn, 'r', aimRight, 'b');

  const close = add('constant', { kind: 'number', value: options.near ?? 1 });
  const arrived = add('compare', { op: 'lt' });
  wire(travel.range, 'flat', arrived, 'a');
  wire(close, 'value', arrived, 'b');

  const left = add('select');
  const right = add('select');
  wire(arrived, 'r', left, 'when');
  wire(aimLeft, 'r', left, 'a');
  wire(travel.left, 'r', left, 'b');
  wire(arrived, 'r', right, 'when');
  wire(aimRight, 'r', right, 'a');
  wire(travel.right, 'r', right, 'b');

  const slack = add('maths', { op: 'abs' });
  const fine = add('constant', { kind: 'number', value: options.slack ?? 5 });
  const lined = add('compare', { op: 'lt' });
  const ready = add('logic', { op: 'and' });
  wire(square.off, 'r', slack, 'a');
  wire(slack, 'r', lined, 'a');
  wire(fine, 'value', lined, 'b');
  wire(arrived, 'r', ready, 'a');
  wire(lined, 'r', ready, 'b');

  return {
    left, right, ready, arrived, range: travel.range,
  };
}
