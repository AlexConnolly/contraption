import { Blueprint } from '../core/blueprint.js';
import { firstBanned } from '../challenges/bans.js';
import { makeId, tidyLayout } from '../sim/program.js';
import { IDENTITY_ORIENTATION, yawStep } from '../core/orientation.js';

/**
 * What a level opens with.
 *
 * Finishing a challenge used to throw your machine away. The next level had no
 * design of its own, so it handed you the stock rover, and ten minutes of
 * building was gone unless you had thought to save it to the garage first. You
 * now arrive in whatever you were driving, which is both the sensible starting
 * point for the next job and the moment to decide whether it is worth keeping.
 *
 * A level you have already built something for keeps what you built: coming
 * back to a half-finished answer and finding last level's machine in its place
 * would be worse than the problem this solves.
 */
export function openingMachine({ stored = null, carried = null, level } = {}) {
  if (stored) return { blueprint: stored, from: 'stored' };
  // A bare core is not a machine. Nor is nothing.
  if (carried && carried.size > 1) {
    const ban = firstBanned(level, carried);
    // Over budget comes through: that is something the player can see and
    // trim. Banned does not, because it could not be run at all.
    if (!ban) return { blueprint: carried.clone(), from: 'carried' };
    return { blueprint: starterRover(), from: 'starter', refused: ban.ban };
  }
  return { blueprint: starterRover(), from: 'starter' };
}

// A four-wheel rover that drives on WASD straight away, so a new player has
// something to test before they have built anything.
export function starterRover() {
  const bp = new Blueprint({ name: 'Starter rover' });
  const facingLeft = yawStep(yawStep(IDENTITY_ORIENTATION));
  bp.place('panel', [0, 0, 0]);
  bp.place('core', [0, 1, 0]);
  bp.place('ballast', [0, 1, 1]);
  bp.place('wheel', [2, 0, 1]);
  bp.place('wheel', [2, 0, -1]);
  bp.place('wheel', [-2, 0, 1], facingLeft);
  bp.place('wheel', [-2, 0, -1], facingLeft);
  return bp;
}

// A four-rotor drone wired to a flight controller. The rotors carry no key
// binding of their own: the controller works out each one's share.
export function quadcopter() {
  const bp = new Blueprint({ name: 'Quadcopter' });
  bp.place('panel', [0, 0, 0]);
  bp.place('core', [0, 1, 0]);
  bp.place('controller', [0, 1, -1]);
  for (const cell of [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1]]) {
    bp.place('propeller', cell, IDENTITY_ORIENTATION, { binding: { mode: 'flight' } });
  }
  return bp;
}

// ---------------------------------------------------------------- programming

function graph() {
  const nodes = [];
  const links = [];
  const add = (type, config) => {
    const id = makeId('n');
    nodes.push({ id, type, config, x: 0, y: 0 });
    return id;
  };
  const wire = (from, fromPort, to, toPort) => {
    links.push({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
  };
  return { nodes, links, add, wire };
}

/**
 * A worked program: climb to height, turn onto the bearing of the pad, run in,
 * then stop over it. Every step goes through the same nodes the editor places,
 * so this doubles as the example a player can open up and take apart.
 */
function deliveryProgram(parts) {
  const { gps, controller } = parts;

  // Climb until the GPS says we are high enough, then hand over.
  const climb = graph();
  {
    const { add, wire } = climb;
    const height = add('constant', { kind: 'number', value: 8 });
    const hold = add('write', { partId: controller, port: 'targetAltitude' });
    wire(height, 'value', hold, 'value');

    const altitude = add('read', { partId: gps, port: 'altitude' });
    const target = add('constant', { kind: 'number', value: 7.4 });
    const high = add('compare', { op: 'gte' });
    const go = add('goto', { state: 'cruise' });
    wire(altitude, 'value', high, 'a');
    wire(target, 'value', high, 'b');
    wire(high, 'r', go, 'when');
  }

  // Steer onto the bearing of the pad and fly at it.
  const cruise = graph();
  {
    const { add, wire } = cruise;
    const height = add('constant', { kind: 'number', value: 8 });
    const hold = add('write', { partId: controller, port: 'targetAltitude' });
    wire(height, 'value', hold, 'value');

    const here = add('read', { partId: gps, port: 'position' });
    const pad = add('waypoint', { zone: 'pad' });
    const bearing = add('bearing', {});
    wire(here, 'value', bearing, 'a');
    wire(pad, 'position', bearing, 'b');

    const heading = add('read', { partId: gps, port: 'heading' });
    // Heading minus bearing: a positive yaw command swings the nose toward the
    // machine's right, which is -X, so it drives the heading down.
    const turn = add('maths', { op: 'angleDelta' });
    wire(bearing, 'deg', turn, 'a');
    wire(heading, 'value', turn, 'b');

    // Steer harder the further off the bearing we are, up to full deflection.
    const span = add('constant', { kind: 'number', value: 45 });
    const rate = add('maths', { op: 'divide' });
    const full = add('constant', { kind: 'number', value: 1 });
    const limited = add('maths', { op: 'clamp' });
    const yaw = add('write', { partId: controller, port: 'yaw' });
    wire(turn, 'r', rate, 'a');
    wire(span, 'value', rate, 'b');
    wire(rate, 'r', limited, 'a');
    wire(full, 'value', limited, 'b');
    wire(limited, 'r', yaw, 'value');

    const range = add('distance', {});
    wire(here, 'value', range, 'a');
    wire(pad, 'position', range, 'b');

    // Aim for a speed rather than a throttle: slower the closer it gets, and
    // capped so it never builds up more than it can shed. Running in flat out
    // and braking at the last moment just sails past the pad.
    const slowing = add('constant', { kind: 'number', value: 0.35 });
    const wanted = add('maths', { op: 'multiply' });
    const topSpeed = add('constant', { kind: 'number', value: 6 });
    const capped = add('maths', { op: 'clamp' });
    wire(range, 'flat', wanted, 'a');
    wire(slowing, 'value', wanted, 'b');
    wire(wanted, 'r', capped, 'a');
    wire(topSpeed, 'value', capped, 'b');

    // Lean forward while under that speed and lean back while over it, which
    // is what actually brings it to a stop on the mark.
    const speed = add('read', { partId: gps, port: 'speed' });
    const excess = add('maths', { op: 'subtract' });
    const urgency = add('constant', { kind: 'number', value: 0.5 });
    const demand = add('maths', { op: 'multiply' });
    const lean = add('maths', { op: 'clamp' });
    wire(capped, 'r', excess, 'a');
    wire(speed, 'value', excess, 'b');
    wire(excess, 'r', demand, 'a');
    wire(urgency, 'value', demand, 'b');
    wire(demand, 'r', lean, 'a');
    wire(full, 'value', lean, 'b');

    // And only drive forward once roughly pointed the right way.
    const off = add('maths', { op: 'abs' });
    const window = add('constant', { kind: 'number', value: 30 });
    const aligned = add('compare', { op: 'lt' });
    const stop = add('constant', { kind: 'number', value: 0 });
    const throttle = add('select', {});
    const pitch = add('write', { partId: controller, port: 'pitch' });
    wire(turn, 'r', off, 'a');
    wire(off, 'r', aligned, 'a');
    wire(window, 'value', aligned, 'b');
    wire(aligned, 'r', throttle, 'when');
    wire(lean, 'r', throttle, 'a');
    wire(stop, 'value', throttle, 'b');
    wire(throttle, 'r', pitch, 'value');

    const close = add('constant', { kind: 'number', value: 2.5 });
    const arrived = add('compare', { op: 'lt' });
    const land = add('goto', { state: 'hold' });
    wire(range, 'flat', arrived, 'a');
    wire(close, 'value', arrived, 'b');
    wire(arrived, 'r', land, 'when');
  }

  // Sit still. Writing nothing to pitch or yaw leaves the controller to hold
  // its own station, which is what stops it drifting off the pad.
  const hold = graph();
  {
    const { add, wire } = hold;
    const height = add('constant', { kind: 'number', value: 7.6 });
    const write = add('write', { partId: controller, port: 'targetAltitude' });
    wire(height, 'value', write, 'value');
  }

  return {
    version: 1,
    start: 'climb',
    states: [
      { id: 'climb', name: 'Climb', ...climb },
      { id: 'cruise', name: 'Cruise', ...cruise },
      { id: 'hold', name: 'Hold', ...hold },
    ].map((state) => tidyLayout(state)),
  };
}

/**
 * A drone that flies itself: rotors on a flight controller, a GPS to see where
 * it is, and a computer running the delivery program.
 */
export function autoDrone() {
  const bp = new Blueprint({ name: 'Auto drone' });
  bp.place('panel', [0, 0, 0]);
  bp.place('core', [0, 1, 0]);
  const controller = bp.place('controller', [0, 1, -1]);
  const gps = bp.place('gps', [0, 1, 1]);
  const computer = bp.place('computer', [0, 2, 0]);
  for (const cell of [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1]]) {
    bp.place('propeller', cell, IDENTITY_ORIENTATION, { binding: { mode: 'flight' } });
  }
  bp.setConfig(computer.id, {
    program: deliveryProgram({ gps: gps.id, controller: controller.id }),
  });
  return bp;
}
