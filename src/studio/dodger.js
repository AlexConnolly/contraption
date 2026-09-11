import { Blueprint } from '../core/blueprint.js';
import {
  IDENTITY_ORIENTATION, ORIENTATIONS, applyOrientation,
} from '../core/orientation.js';
import { makeId, tidyLayout } from '../sim/program.js';

const CRUISE_HEIGHT = 7;
const NOTICE = 6;

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
  const { gps, controller, ahead, portSide, starboard } = parts;

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
   * One state that flies and avoids at the same time.
   *
   * Along the corridor and across it are each a proportional-derivative pair:
   * lean on how far there is to go, lean back on how fast it is already
   * moving. Position alone oscillates — it overshoots, comes back, overshoots
   * again — and the speed term is what settles it. Being signed, it also
   * reverses of its own accord if the machine ever overruns the pad.
   *
   * On top of the sideways pair sits the only part that knows about
   * obstacles: how much more crowded one whisker is than the other.
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

    // Along the corridor.
    const toGo = add('maths', { op: 'subtract' });
    const keenness = add('constant', { kind: 'number', value: 0.35 });
    const push = add('maths', { op: 'multiply' });
    const settle = add('constant', { kind: 'number', value: 0.45 });
    const brake = add('maths', { op: 'multiply' });
    const balance = add('maths', { op: 'subtract' });
    const drive = add('maths', { op: 'clamp' });
    wire(padParts, 'z', toGo, 'a');
    wire(hereParts, 'z', toGo, 'b');
    wire(toGo, 'r', push, 'a');
    wire(keenness, 'value', push, 'b');
    wire(speed, 'z', brake, 'a');
    wire(settle, 'value', brake, 'b');
    wire(push, 'r', balance, 'a');
    wire(brake, 'r', balance, 'b');
    wire(balance, 'r', drive, 'a');
    wire(full, 'value', drive, 'b');

    // What the beam ahead will allow. It goes negative once something is
    // inside the stand-off, so the machine eases back off it.
    const forward = add('read', { partId: ahead, port: 'distance' });
    const standOff = add('constant', { kind: 'number', value: 5 });
    const room = add('maths', { op: 'subtract' });
    const firmness = add('constant', { kind: 'number', value: 0.35 });
    const allowed = add('maths', { op: 'multiply' });
    const limit = add('maths', { op: 'clamp' });
    wire(forward, 'value', room, 'a');
    wire(standOff, 'value', room, 'b');
    wire(room, 'r', allowed, 'a');
    wire(firmness, 'value', allowed, 'b');
    wire(allowed, 'r', limit, 'a');
    wire(full, 'value', limit, 'b');

    const chosen = add('maths', { op: 'min' });
    const pitch = add('write', { partId: controller, port: 'pitch' });
    wire(drive, 'r', chosen, 'a');
    wire(limit, 'r', chosen, 'b');
    wire(chosen, 'r', pitch, 'value');

    // Across the corridor. A positive roll slides toward the machine's right,
    // which is -X, so both terms come out negated.
    const across = add('maths', { op: 'subtract' });
    const homing = add('constant', { kind: 'number', value: -0.22 });
    const pull = add('maths', { op: 'multiply' });
    const damping = add('constant', { kind: 'number', value: 0.3 });
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

    // How near each whisker's beam ends, counted only once it is inside the
    // notice distance, so a clear beam contributes nothing at all.
    const board = add('read', { partId: starboard, port: 'distance' });
    const port = add('read', { partId: portSide, port: 'distance' });
    const notice = add('constant', { kind: 'number', value: NOTICE });
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

    const lean = add('maths', { op: 'subtract' });
    const eagerness = add('constant', { kind: 'number', value: 0.3 });
    const sideways = add('maths', { op: 'multiply' });
    wire(portNear, 'r', lean, 'a');
    wire(boardNear, 'r', lean, 'b');
    wire(lean, 'r', sideways, 'a');
    wire(eagerness, 'value', sideways, 'b');

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

    // Steering by the two terms together balances out exactly in front of
    // something wide, and the machine sits there arguing with itself. Once the
    // way ahead is genuinely shut, hand over to a state that just picks a side.
    const shut = add('constant', { kind: 'number', value: 5.5 });
    const trapped = add('compare', { op: 'lt' });
    const backOff = add('goto', { state: 'boxed' });
    wire(forward, 'value', trapped, 'a');
    wire(shut, 'value', trapped, 'b');
    wire(trapped, 'r', backOff, 'when');
  }

  /**
   * The way ahead is shut. Hold a stand-off and slide all the way across to
   * whichever side has more daylight, with nothing pulling back toward the
   * middle. Committing to one side is the whole point: it is what gets the
   * machine out of a spot where weighing both sides up keeps it still.
   */
  const boxed = graph();
  {
    const { add, wire } = boxed;
    const { full } = holdCourse(boxed, CRUISE_HEIGHT);

    const forward = add('read', { partId: ahead, port: 'distance' });
    const standOff = add('constant', { kind: 'number', value: 5 });
    const room = add('maths', { op: 'subtract' });
    const firmness = add('constant', { kind: 'number', value: 0.35 });
    const easing = add('maths', { op: 'multiply' });
    const held = add('maths', { op: 'clamp' });
    const pitch = add('write', { partId: controller, port: 'pitch' });
    wire(forward, 'value', room, 'a');
    wire(standOff, 'value', room, 'b');
    wire(room, 'r', easing, 'a');
    wire(firmness, 'value', easing, 'b');
    wire(easing, 'r', held, 'a');
    wire(full, 'value', held, 'b');
    wire(held, 'r', pitch, 'value');

    const board = add('read', { partId: starboard, port: 'distance' });
    const port = add('read', { partId: portSide, port: 'distance' });
    const clearer = add('compare', { op: 'gt' });
    const toStarboard = add('constant', { kind: 'number', value: 1 });
    const toPort = add('constant', { kind: 'number', value: -1 });
    const slide = add('select');
    const roll = add('write', { partId: controller, port: 'roll' });
    wire(board, 'value', clearer, 'a');
    wire(port, 'value', clearer, 'b');
    wire(clearer, 'r', slide, 'when');
    wire(toStarboard, 'value', slide, 'a');
    wire(toPort, 'value', slide, 'b');
    wire(slide, 'r', roll, 'value');

    // Well clear before handing back, so it does not bounce straight back in.
    const clear = add('constant', { kind: 'number', value: 8 });
    const open = add('compare', { op: 'gt' });
    const resume = add('goto', { state: 'run' });
    wire(forward, 'value', open, 'a');
    wire(clear, 'value', open, 'b');
    wire(open, 'r', resume, 'when');
  }

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
      { id: 'boxed', name: 'Boxed in', ...boxed },
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
    }),
  });
  return bp;
}
