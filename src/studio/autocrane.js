import { Blueprint } from '../core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../core/orientation.js';
import { tidyLayout } from '../sim/program.js';
import {
  graph, pointing, driveTowards, toWheels, halt,
} from './autopilot.js';

/**
 * A crane that runs itself: drive up to the payload, latch on, raise it, carry
 * it across and set it down.
 *
 * The sequence is the level. Where the dodger is one reactive state that never
 * stops weighing things up, this is four states that each do one thing and
 * hand over when it is done — which is what a state machine is actually for,
 * and what a lifting job looks like when you write it down.
 */

const PICKUP = [0, 0.3, 2];
const LIFTED = 0.85;

function craneProgram(parts, wheels) {
  const { gps, grabber, piston } = parts;

  const magnet = (g, on) => {
    const { add, wire } = g;
    const state = add('constant', { kind: 'bool', value: on });
    const write = add('write', { partId: grabber, port: 'active' });
    wire(state, 'value', write, 'value');
  };

  const ram = (g, target) => {
    const { add, wire } = g;
    const set = add('constant', { kind: 'number', value: target });
    const write = add('write', { partId: piston, port: 'target' });
    wire(set, 'value', write, 'value');
  };

  /**
   * Creep up on it with the magnet already live, and let the magnet say when.
   *
   * Driving to a measured spot and grabbing there needs the offset between the
   * aerial and the hook to be right to the centimetre, and it never is. The
   * grabber reports what it is holding, so the machine can simply drive until
   * it is holding something.
   */
  const approach = graph();
  {
    const { add, wire } = approach;
    magnet(approach, true);
    ram(approach, 0);

    const spot = add('constant', { kind: 'vec3', vector: PICKUP });
    const { left, right } = driveTowards(approach, { gps }, { node: spot, port: 'value' }, {
      topSpeed: 1.6,
      keenness: 0.5,
    });
    toWheels(approach, wheels, left, right);

    const holding = add('read', { partId: grabber, port: 'holding' });
    const go = add('goto', { state: 'lift' });
    wire(holding, 'value', go, 'when');
  }

  // Stop dead and wind the ram out. Driving off with the payload still on the
  // floor drags it along the ground and out of the magnet's grip.
  const lift = graph();
  {
    const { add, wire } = lift;
    magnet(lift, true);
    ram(lift, 1);
    halt(lift, wheels);

    const height = add('read', { partId: piston, port: 'extension' });
    const enough = add('constant', { kind: 'number', value: LIFTED });
    const raised = add('compare', { op: 'gte' });
    const go = add('goto', { state: 'carry' });
    wire(height, 'value', raised, 'a');
    wire(enough, 'value', raised, 'b');
    wire(raised, 'r', go, 'when');
  }

  // Across to the platform, which is off to one side, so this is where it has
  // to turn rather than simply press on.
  const carry = graph();
  {
    const { add, wire } = carry;
    magnet(carry, true);
    ram(carry, 1);

    const pad = add('waypoint', { zone: 'top' });
    const { left, right, range } = driveTowards(carry, { gps }, { node: pad, port: 'position' }, {
      topSpeed: 2.2,
      keenness: 0.45,
    });
    toWheels(carry, wheels, left, right);

    /**
     * Let go when it cannot drive any further, not at a measured distance.
     *
     * The arm is three cells long, so the payload hangs barely two metres
     * ahead of the aerial and the machine can never get the aerial over the
     * middle of the platform: it drives until its front wheels are against
     * the side of it and stops. Which is the moment wanted, because by then
     * the load is out over the deck — but it is a distance nobody can work
     * out in advance, and every one guessed at was either short of the
     * platform or a few centimetres past where the machine could reach. So
     * ask the machine instead. Near the platform and no longer moving means
     * up against it.
     */
    const speed = add('read', { partId: gps, port: 'speed' });
    const crawling = add('constant', { kind: 'number', value: 0.2 });
    const stopped = add('compare', { op: 'lt' });
    wire(speed, 'value', stopped, 'a');
    wire(crawling, 'value', stopped, 'b');

    const close = add('constant', { kind: 'number', value: 6 });
    const near = add('compare', { op: 'lt' });
    wire(range, 'flat', near, 'a');
    wire(close, 'value', near, 'b');

    const there = add('logic', { op: 'and' });
    const go = add('goto', { state: 'place' });
    wire(near, 'r', there, 'a');
    wire(stopped, 'r', there, 'b');
    wire(there, 'r', go, 'when');
  }

  // Stand still, let go, and stay put. Reversing away here drags the payload
  // back off the platform with the machine.
  const place = graph();
  {
    magnet(place, false);
    ram(place, 1);
    halt(place, wheels);
  }

  return {
    version: 1,
    start: 'approach',
    states: [
      { id: 'approach', name: 'Approach', ...approach },
      { id: 'lift', name: 'Lift', ...lift },
      { id: 'carry', name: 'Carry', ...carry },
      { id: 'place', name: 'Place', ...place },
    ].map((state) => tidyLayout(state)),
  };
}

/**
 * Four wheels, a ram standing on the deck, and a boom over the front with the
 * magnet hanging off the end of it looking straight down.
 *
 * The magnet reads whatever is directly along its own up axis, so a hook that
 * has to pick something off the floor is a magnet turned upside down. The boom
 * is high enough to pass over the payload without knocking it away first.
 */
export function autocrane() {
  const bp = new Blueprint({ name: 'Autocrane' });
  const place = (...args) => {
    const result = bp.place(...args);
    if (!result.ok) throw new Error(`Autocrane could not place a part: ${result.reason}`);
    return result;
  };
  const back = yawStep(yawStep(IDENTITY_ORIENTATION));

  place('panel', [0, 0, 0]);
  const wheels = { left: [], right: [] };
  for (const z of [-1, 1]) {
    // +X is the machine's left, because forward is +Z and up is +Y.
    wheels.left.push(place('wheel', [2, 0, z], IDENTITY_ORIENTATION).id);
    wheels.right.push(place('wheel', [-2, 0, z], back).id);
  }

  place('core', [0, 1, -1]);
  const gps = place('gps', [1, 1, -1]);
  const computer = place('computer', [-1, 1, -1]);

  // The ram, and the boom it carries. Nothing else may touch the boom or the
  // ram is bridged solid and will not move at all.
  // Three cells of boom and no more. A longer one reaches further ahead, which
  // sounds useful and is not: the ram is a single cell holding the whole arm
  // out sideways, and at five cells it visibly sagged until the payload was
  // back on the floor being dragged along. Short arm, and the course keeps the
  // floor clear instead.
  const piston = place('piston', [0, 1, 0], IDENTITY_ORIENTATION, { stroke: 1.2 });
  for (const z of [0, 1, 2]) place('block', [0, 2, z]);
  const grabber = place('grabber', [0, 2, 3], pointing([0, -1, 0]));

  bp.setConfig(computer.id, {
    program: craneProgram(
      { gps: gps.id, grabber: grabber.id, piston: piston.id },
      wheels,
    ),
  });
  return bp;
}

export const AUTOCRANE_PICKUP = PICKUP;
