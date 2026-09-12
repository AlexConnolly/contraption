import { Blueprint } from '../core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../core/orientation.js';
import { tidyLayout } from '../sim/program.js';
import {
  graph, facing, driveTowards, standOn, toWheels,
} from './autopilot.js';

/**
 * Finds the ball among things that are not the ball, gets behind it, and puts
 * it in the goal — with nothing pressed.
 *
 * Nothing in here knows where the ball is. The three objects are dealt among
 * their spots every run, so a remembered position is worth nothing. What the
 * machine has is an eye that reports what it is looking at as well as how far
 * away it is, and the ball is the only thing that reads as a ball.
 *
 * The trick is not the looking, it is where you look from. Driving at a ball
 * and then turning for the goal pushes it off the side of the blade every
 * time, because by then the machine is beside it rather than behind it. Stand
 * instead on the line that runs from the goal out through a spot: from there
 * the only thing between the machine and the goal is whatever is on that spot,
 * so looking at it and shooting at it are the same heading, and the shot needs
 * no steering at all.
 */

export const BALL_TAG = 5;
export const CRATE_TAG = 2;

/**
 * Where to stand to inspect each spot: four metres out along the line from the
 * goal through it. Three fixed places, because the spots are fixed — it is
 * only the dealing that changes.
 */
export const STANDS = [
  [-7.45, 1.2, -3.73],
  [0, 1.2, -4],
  [7.45, 1.2, -3.73],
];

function kickProgram(parts, wheels) {
  const { gps, eye } = parts;

  /**
   * Go and stand on one spot's line, square up on the goal, and ask what is
   * there. A ball means shoot; a crate means try the next one. Anything else —
   * still driving, still turning, nothing in range — is neither, and the state
   * simply keeps working.
   */
  const inspect = (stand, next) => {
    const g = graph();
    const { add, wire } = g;
    const goal = add('waypoint', { zone: 'goal' });
    const mark = add('constant', { kind: 'vec3', vector: stand });

    const { left, right, ready } = standOn(g, { gps }, { node: mark, port: 'value' }, {
      node: goal, port: 'position',
    });
    toWheels(g, wheels, left, right);

    const tag = add('read', { partId: eye, port: 'tag' });
    const branch = (value, state) => {
      const wanted = add('constant', { kind: 'number', value });
      const is = add('compare', { op: 'eq' });
      const both = add('logic', { op: 'and' });
      const go = add('goto', { state });
      wire(tag, 'value', is, 'a');
      wire(wanted, 'value', is, 'b');
      wire(ready, 'r', both, 'a');
      wire(is, 'r', both, 'b');
      wire(both, 'r', go, 'when');
    };
    branch(BALL_TAG, 'shoot');
    branch(CRATE_TAG, next);
    return g;
  };

  /**
   * Straight down the line. The ball is already between the machine and the
   * goal, so there is nothing to steer round and nothing clever to do: drive at
   * the goal and the ball gets there first.
   *
   * Not too fast, though. A rover that arrives at the ball at three metres a
   * second pitches over its own front axle and spends the rest of the run
   * upside down driving backwards — it reads its heading as due north the whole
   * time and is quite sure it is doing the right thing. What keeps the wheels
   * down is leaning on the ball the whole way rather than striking it once.
   *
   * But not too slow either. At 1.8 this scored from the middle spot and fell
   * four metres short from the outer two, which is nearly two metres further to
   * push — so it only ever passed by a hair, and any small change to where the
   * machine started decided it. Swept over all six deals:
   *
   *     topSpeed   1.8   2.2   2.6   3.0
   *     scores     3/6   3/6   6/6   6/6
   *
   * 2.6 clears every deal and still keeps the machine on its wheels.
   */
  const shoot = graph();
  {
    const { add } = shoot;
    const goal = add('waypoint', { zone: 'goal' });
    const { left, right } = driveTowards(shoot, { gps }, { node: goal, port: 'position' }, {
      topSpeed: 2.6,
      keenness: 0.35,
      urgency: 0.4,
    });
    toWheels(shoot, wheels, left, right);
  }

  return {
    version: 1,
    // Starting in the middle, because that is the mark the machine spawns
    // nearest and a wasted crossing is a wasted ten seconds.
    start: 'spot-b',
    states: [
      { id: 'spot-b', name: 'Spot B', ...inspect(STANDS[1], 'spot-a') },
      { id: 'spot-a', name: 'Spot A', ...inspect(STANDS[0], 'spot-c') },
      { id: 'spot-c', name: 'Spot C', ...inspect(STANDS[2], 'spot-b') },
      { id: 'shoot', name: 'Shoot', ...shoot },
    ].map((state) => tidyLayout(state)),
  };
}

/**
 * A rover with a wide flat blade and an eye looking out over it.
 *
 * The blade is the important part. A ball met by a corner rolls off it; met by
 * something flat and wide it goes where the machine is pointing.
 */
export function striker() {
  const bp = new Blueprint({ name: 'Striker' });
  const place = (...args) => {
    const result = bp.place(...args);
    if (!result.ok) throw new Error(`Striker could not place a part: ${result.reason}`);
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

  // The blade, low and wide, and the eye looking out over it.
  //
  // Low is the whole point. A blade carried at chest height meets a ball above
  // the middle of it and rides up over the top — measured, with the machine
  // finishing on its back, wheels turning, crawling half a metre a minute.
  // Down at axle height it pushes instead.
  place('beam', [0, 0, 2]);
  const eye = place('sensor', [0, 1, 2], ahead);

  bp.setConfig(computer.id, {
    program: kickProgram({ gps: gps.id, eye: eye.id }, wheels),
  });
  return bp;
}
