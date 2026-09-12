import { GREY, DARK } from '../palette.js';

/**
 * Levels that ask something other than "can you move this there".
 *
 * Everything shipped so far is a haul with a different obstacle in front of
 * it. These are deliberately different questions: a race with no cargo at all,
 * two levels that have no win condition and only a number, an opponent that
 * shoves back, a course you cannot see. A player who has one good rover should
 * find that it answers almost none of them.
 */

const AMBER = 0xf0a825;
const CRATE = 0xc98b4b;
const PAYLOAD = 0x7cc4ff;
const SCRAP = 0x9a8b72;
const GOAL = 0x4ade80;

export const QUESTIONS = [
  {
    id: 'time-trial',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Time Trial',
    brief: 'No cargo and nothing to pick up. Through all four gates and onto the pad, against the clock.',
    hint: 'Everything bolted on is weight you are carrying round the course. This is the one level where the answer is to take parts off rather than add them.',
    spawn: [0, 1.2, -27.5],
    groundSize: 140,
    budget: { cost: 70 },
    pieces: [
      // Four gates. Wide enough to drive through at speed, narrow enough that
      // you have to actually aim.
      { pos: [-3, 1, -12], size: [0.6, 2, 0.6], colour: AMBER },
      { pos: [3, 1, -12], size: [0.6, 2, 0.6], colour: AMBER },
      { pos: [-9, 1, -2], size: [0.6, 2, 0.6], colour: AMBER },
      { pos: [-3, 1, -2], size: [0.6, 2, 0.6], colour: AMBER },
      { pos: [5, 1, 8], size: [0.6, 2, 0.6], colour: AMBER },
      { pos: [11, 1, 8], size: [0.6, 2, 0.6], colour: AMBER },
      { pos: [-3, 1, 17], size: [0.6, 2, 0.6], colour: AMBER },
      { pos: [3, 1, 17], size: [0.6, 2, 0.6], colour: AMBER },
      // A kerb to stop the lazy diagonal straight through the middle.
      { pos: [0, 0.35, 3], size: [18, 0.7, 0.7], colour: DARK },
    ],
    props: [],
    zones: [
      { id: 'finish', pos: [0, 0.9, 22], size: [5, 2.4, 4], colour: GOAL },
    ],
    objectives: [
      { type: 'coreInZone', zone: 'finish', hold: 1, label: 'Across the line' },
    ],
    par: 45,
  },

  {
    id: 'parallel-park',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Parallel Park',
    brief: 'Back into the bay between the two parked blocks and hold still there for three seconds. Touch either of them and the run is over.',
    hint: 'Power is no use here. What matters is how tightly the machine turns, which is mostly about how far apart the wheels are — a short wheelbase turns in its own length. Take it slowly: the kerb counts as a bump too.',
    noBumps: true,
    spawn: [0, 1.2, -17.0],
    groundSize: 90,
    budget: { cost: 90 },
    pieces: [
      // The kerb the bay backs onto.
      { pos: [7, 0.6, 4], size: [1.2, 1.2, 16], colour: DARK },
      // Two parked machines, with a gap between them barely longer than a
      // rover.
      { pos: [4.6, 0.7, 0], size: [2.6, 1.4, 3.4], colour: GREY },
      { pos: [4.6, 0.7, 8], size: [2.6, 1.4, 3.4], colour: GREY },
    ],
    props: [],
    zones: [
      { id: 'bay', pos: [4.6, 0.8, 4], size: [2.4, 2, 3.2], colour: GOAL },
    ],
    objectives: [
      { type: 'coreInZone', zone: 'bay', hold: 3, label: 'Parked square in the bay' },
    ],
    par: 110,
  },

  {
    id: 'tray',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Tray of Glasses',
    brief: 'Six loose blocks out of the pen at this end and into the pen at the other. All six, and the ground between is not kind.',
    hint: 'Speed is not the enemy; acceleration is. Something wide and flat with a lip round it, driven gently, beats anything clever.',
    spawn: [0, 1.2, -12],
    groundSize: 110,
    budget: { cost: 120 },
    pieces: [
      // The pen they start in — low walls on three sides so a flat bed can be
      // backed in from the open side.
      { pos: [-2.2, 0.25, -5], size: [0.4, 0.5, 4.4], colour: DARK },
      { pos: [2.2, 0.25, -5], size: [0.4, 0.5, 4.4], colour: DARK },
      { pos: [0, 0.25, -7], size: [4.8, 0.5, 0.4], colour: DARK },
      // Uneven ground the whole way across.
      { pos: [-2, 0.15, 0], size: [4, 0.3, 0.6], colour: GREY },
      { pos: [2.5, 0.15, 3], size: [4, 0.3, 0.6], colour: GREY },
      { pos: [-1.5, 0.15, 6], size: [5, 0.3, 0.6], colour: GREY },
      { pos: [1, 0.2, 9], size: [6, 0.4, 0.6], colour: GREY },
      // The pen they have to end up in.
      { pos: [-2.6, 0.4, 15], size: [0.4, 0.8, 5], colour: DARK },
      { pos: [2.6, 0.4, 15], size: [0.4, 0.8, 5], colour: DARK },
      { pos: [0, 0.4, 17.3], size: [5.6, 0.8, 0.4], colour: DARK },
    ],
    props: [
      { id: 'glass-1', pos: [-1.2, 0.3, -6], size: [0.5, 0.5, 0.5], mass: 1.2, colour: PAYLOAD },
      { id: 'glass-2', pos: [0, 0.3, -6], size: [0.5, 0.5, 0.5], mass: 1.2, colour: PAYLOAD },
      { id: 'glass-3', pos: [1.2, 0.3, -6], size: [0.5, 0.5, 0.5], mass: 1.2, colour: PAYLOAD },
      { id: 'glass-4', pos: [-1.2, 0.3, -4.4], size: [0.5, 0.5, 0.5], mass: 1.2, colour: PAYLOAD },
      { id: 'glass-5', pos: [0, 0.3, -4.4], size: [0.5, 0.5, 0.5], mass: 1.2, colour: PAYLOAD },
      { id: 'glass-6', pos: [1.2, 0.3, -4.4], size: [0.5, 0.5, 0.5], mass: 1.2, colour: PAYLOAD },
    ],
    zones: [
      { id: 'bar', pos: [0, 0.9, 15], size: [5, 2.4, 5], colour: GOAL },
    ],
    objectives: [
      {
        type: 'allPropsInZone',
        props: ['glass-1', 'glass-2', 'glass-3', 'glass-4', 'glass-5', 'glass-6'],
        zone: 'bar',
        hold: 2,
        label: 'All six delivered, none dropped on the way',
      },
    ],
    par: 160,
  },

  {
    id: 'catch',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Catch',
    brief: 'The ball rolls off the end of the chute on the same arc every run. Get under it and keep it off the ground for three seconds.',
    hint: 'You cannot chase it down. Work out where it is going to land, be there first, and have something wide and dished waiting.',
    spawn: [0, 1.2, -6],
    groundSize: 120,
    budget: { cost: 140 },
    pieces: [
      // A long shallow chute. Shallow on purpose: it gives you a few seconds
      // to read the line and get into place before the ball leaves the end.
      { pos: [0, 3.4, 20], size: [3, 0.6, 16], rotX: -0.16, colour: GREY },
      { pos: [-1.8, 4, 20], size: [0.6, 1.2, 16], rotX: -0.16, colour: DARK },
      { pos: [1.8, 4, 20], size: [0.6, 1.2, 16], rotX: -0.16, colour: DARK },
      { pos: [0, 5.4, 28.6], size: [3, 1.4, 0.6], colour: DARK },
    ],
    props: [
      { id: 'ball', pos: [0, 5.1, 26.5], radius: 0.45, mass: 2.2, colour: 0xffa64d, ccd: true },
    ],
    zones: [],
    objectives: [
      { type: 'propAbove', prop: 'ball', height: 1.3, hold: 3, label: 'Ball caught and held off the ground' },
    ],
    par: 150,
  },

  {
    id: 'timed-gate',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Timed Gate',
    brief: 'The shutter across the doorway never stops moving. Get through, fetch the crate, and get back through with it.',
    hint: 'The gap comes round on a fixed beat, so you can wait for it. Either be quick enough to take it in one, or build something that can stop dead and sit still until the next one.',
    spawn: [0, 1.2, -15.5],
    groundSize: 110,
    budget: { cost: 100 },
    pieces: [
      // A wall with one doorway in it.
      { pos: [-6.5, 1.5, 0], size: [9, 3, 0.8], colour: DARK },
      { pos: [6.5, 1.5, 0], size: [9, 3, 0.8], colour: DARK },
      { pos: [0, 2.75, 0], size: [4, 0.5, 0.8], colour: DARK },
    ],
    // One shutter, sliding at a fixed rate so the beat is learnable. Both ends
    // of the speed range are the same number on purpose: everywhere else these
    // are deliberately unpredictable, and here the whole point is that you can
    // time it.
    movers: [
      { group: 'shutter', pos: [0, 1.2, 0], size: [3.4, 2.4, 0.6], axis: 'x', span: 5.5, speed: [0.16, 0.16] },
    ],
    props: [
      { id: 'crate', pos: [0, 0.55, 8], size: [1.1, 1.1, 1.1], mass: 6, colour: CRATE },
    ],
    zones: [
      { id: 'depot', pos: [0, 0.8, -8], size: [4, 2.4, 4], colour: GOAL },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'depot', hold: 2, label: 'Crate brought back through the gate' },
    ],
    par: 140,
  },

  {
    id: 'one-shot',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    noRespawn: true,
    name: 'One Shot',
    brief: 'A long haul over bad ground, and no respawn. Tip it over and the run is finished.',
    hint: 'Everything you would normally chance, do not. Wide, low and slow gets there; quick and clever ends up on its roof with nothing to show for it.',
    spawn: [0, 1.2, -18.5],
    groundSize: 150,
    budget: { cost: 130 },
    pieces: [
      { pos: [0, 0.4, -10], size: [10, 0.8, 4], rotX: -0.18, colour: GREY },
      { pos: [0, 0.75, -5.5], size: [10, 0.3, 5], colour: GREY },
      { pos: [-2.5, 1, -3], size: [3, 0.5, 0.6], colour: DARK },
      { pos: [2.5, 1, -1], size: [3, 0.5, 0.6], colour: DARK },
      { pos: [0, 0.75, 2], size: [10, 0.3, 5], colour: GREY },
      { pos: [0, 0.4, 6.5], size: [10, 0.8, 4], rotX: 0.18, colour: GREY },
      { pos: [-3, 0.2, 11], size: [2.4, 0.4, 0.6], colour: DARK },
      { pos: [3, 0.2, 13], size: [2.4, 0.4, 0.6], colour: DARK },
    ],
    props: [
      { id: 'crate', pos: [0, 1.45, -5.5], size: [1, 1, 1], mass: 5, colour: CRATE },
    ],
    zones: [
      { id: 'depot', pos: [0, 0.9, 18], size: [4.4, 2.4, 4.4], colour: GOAL },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'depot', hold: 3, label: 'Crate delivered, machine still upright' },
    ],
    par: 200,
  },

  {
    id: 'maze',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'The Maze',
    brief: 'Walls higher than you can see over, the pad somewhere inside them, and two ways on at every turn.',
    hint: 'This is what the distance sensor is for. Keep one beam pointed at the wall on your left and steer to hold it at a fixed reading, and you will walk the whole maze without ever needing a map — dead ends included, because following a wall backs you out of them.',
    // Off the back wall, so the size of what you bring is decided by the
    // corridors rather than by where you are put down.
    spawn: [0, 1.2, -32],
    groundSize: 110,
    budget: { cost: 110 },
    pieces: [
      // Outer box. Everything inside runs on the same measure: corridors at
      // least four metres across and walls a metre thick, so nothing comes
      // down to threading a slot.
      // The south wall, opened in the middle so the yard beyond it leads in.
      { pos: [-8.5, 1.5, -15], size: [9, 3, 1], colour: DARK },
      { pos: [8.5, 1.5, -15], size: [9, 3, 1], colour: DARK },
      // The yard itself: thirty metres across, walled, so the maze is still
      // the only way to the middle.
      { pos: [-16.5, 1.5, -32], size: [1, 3, 34], colour: DARK },
      { pos: [16.5, 1.5, -32], size: [1, 3, 34], colour: DARK },
      { pos: [0, 1.5, -48.5], size: [34, 3, 1], colour: DARK },
      { pos: [-14.75, 1.5, -15], size: [3.5, 3, 1], colour: DARK },
      { pos: [14.75, 1.5, -15], size: [3.5, 3, 1], colour: DARK },
      { pos: [0, 1.5, 15], size: [26, 3, 1], colour: DARK },
      { pos: [-12.5, 1.5, 0], size: [1, 3, 31], colour: DARK },
      { pos: [12.5, 1.5, 0], size: [1, 3, 31], colour: DARK },

      // First divider, with two ways through it. The left one is a room.
      { pos: [-9.25, 1.5, -8], size: [6.5, 3, 1], colour: GREY },
      { pos: [2.5, 1.5, -8], size: [7, 3, 1], colour: GREY },
      { pos: [11.25, 1.5, -8], size: [2.5, 3, 1], colour: GREY },
      // The wall that makes it a room rather than a way through.
      { pos: [-0.5, 1.5, -4.5], size: [1, 3, 6], colour: GREY },

      // Second divider: one way through, over on the right.
      { pos: [-5.25, 1.5, -1], size: [14.5, 3, 1], colour: GREY },
      { pos: [9.75, 1.5, -1], size: [5.5, 3, 1], colour: GREY },

      // Third divider, two ways through again. This time the right is the
      // dead end and the long way round to the left is the route.
      { pos: [1, 1.5, 6], size: [12, 3, 1], colour: GREY },
      { pos: [11.75, 1.5, 6], size: [1.5, 3, 1], colour: GREY },
      { pos: [6.5, 1.5, 8.5], size: [1, 3, 5], colour: GREY },
      { pos: [9.5, 1.5, 11], size: [7, 3, 1], colour: GREY },
    ],
    props: [],
    zones: [
      { id: 'centre', pos: [0, 0.9, 12], size: [4, 2.4, 4], colour: GOAL },
    ],
    objectives: [
      { type: 'coreInZone', zone: 'centre', hold: 2, label: 'Found the middle' },
    ],
    par: 180,
  },

  {
    id: 'blackout',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Blackout',
    brief: 'An ordinary fetch and carry, in fog you can see about two metres through.',
    hint: 'You have been steering by eye all game. Now the sensor readouts are all you have, so put them where you can watch them and trust the numbers over the picture.',
    spawn: [0, 1.2, -19.5],
    groundSize: 110,
    fog: { near: 1, far: 13, colour: 0x0a0e13 },
    budget: { cost: 130 },
    pieces: [
      { pos: [-5, 1, -4], size: [6, 2, 1], colour: DARK },
      { pos: [6, 1, 2], size: [1, 2, 9], colour: DARK },
      { pos: [-4, 1, 8], size: [9, 2, 1], colour: DARK },
      { pos: [0, 0.3, 0], size: [3, 0.6, 3], colour: GREY },
    ],
    props: [
      { id: 'crate', pos: [-8, 0.55, 4], size: [1.1, 1.1, 1.1], mass: 5, colour: CRATE },
    ],
    zones: [
      { id: 'depot', pos: [8, 0.8, -10], size: [4, 2.4, 4], colour: GOAL },
    ],
    objectives: [
      { type: 'propInZone', prop: 'crate', zone: 'depot', hold: 2, label: 'Crate found and delivered blind' },
    ],
    par: 190,
  },

  {
    id: 'two-loads',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Two Loads',
    brief: 'Two payloads, two pedestals, and both have to be up there before the run counts.',
    hint: 'One arm does this in two trips and the clock will let you. The question is whether you can build something that carries both at once, and whether that is actually faster.',
    spawn: [0, 1.2, -9],
    groundSize: 110,
    budget: { cost: 150 },
    pieces: [
      { pos: [-5, 0.6, 0], size: [2, 1.2, 2], colour: GREY },
      { pos: [5, 0.6, 0], size: [2, 1.2, 2], colour: GREY },
      { pos: [-5, 0.9, 10], size: [2.4, 1.8, 2.4], colour: GREY },
      { pos: [5, 0.9, 10], size: [2.4, 1.8, 2.4], colour: GREY },
    ],
    props: [
      { id: 'load-a', pos: [-5, 1.55, 0], size: [0.9, 0.7, 0.9], mass: 3, colour: PAYLOAD },
      { id: 'load-b', pos: [5, 1.55, 0], size: [0.9, 0.7, 0.9], mass: 3, colour: PAYLOAD },
    ],
    zones: [
      { id: 'left-pad', pos: [-5, 2.2, 10], size: [2.6, 1.8, 2.6], colour: GOAL },
      { id: 'right-pad', pos: [5, 2.2, 10], size: [2.6, 1.8, 2.6], colour: GOAL },
    ],
    objectives: [
      { type: 'propInZone', prop: 'load-a', zone: 'left-pad', hold: 2, label: 'First load on the left pedestal' },
      { type: 'propInZone', prop: 'load-b', zone: 'right-pad', hold: 2, label: 'Second load on the right pedestal' },
    ],
    par: 190,
  },

  {
    id: 'tall-order',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Tall Order',
    brief: 'A yard of loose blocks and nothing to win. Get as many of them above the line as you can and leave them there.',
    hint: 'Nothing here completes. The run goes to the end of the clock and tells you a number, and the only reason to play it again is to beat that number.',
    spawn: [0, 1.2, -15.5],
    groundSize: 100,
    budget: { cost: 140 },
    scored: { label: 'Blocks above the line', seconds: 120 },
    pieces: [
      // The line itself, drawn as two posts so it is a thing you can see
      // rather than a number in a panel.
      { pos: [-4.4, 1.3, 0], size: [0.3, 2.6, 0.3], colour: AMBER },
      { pos: [4.4, 1.3, 0], size: [0.3, 2.6, 0.3], colour: AMBER },
      { pos: [0, 2.55, 0], size: [9, 0.1, 0.3], colour: AMBER },
    ],
    stacks: [
      { id: 'block', count: 16, pos: [0, 0.4, -4], spread: [7, 0.6, 3], size: [0.7, 0.7, 0.7], mass: 1.6, colour: SCRAP },
    ],
    zones: [
      { id: 'above', pos: [0, 5.3, 0], size: [9, 5.4, 6], colour: GOAL },
    ],
    objectives: [
      { type: 'propsInZone', stack: 'block', zone: 'above', label: 'Blocks above the line' },
    ],
  },

  {
    id: 'quarry',
    demands: { steps: 2, flies: false },
    name: 'Quarry',
    brief: 'Loose rock all over the floor, a bin in the middle, and ninety seconds on the clock. Get as much in as you can.',
    hint: 'Placing one block neatly is worthless here. What counts is how much you can move at once and how quickly you can turn round and go back for more.',
    spawn: [0, 1.2, -14],
    groundSize: 120,
    budget: { cost: 140 },
    scored: { label: 'Rock in the bin', seconds: 90 },
    pieces: [
      // The bin: four low walls, open over the top.
      { pos: [0, 0.5, -3.5], size: [7.8, 1, 0.4], colour: DARK },
      { pos: [0, 0.5, 3.5], size: [7.8, 1, 0.4], colour: DARK },
      { pos: [-3.7, 0.5, 0], size: [0.4, 1, 7.4], colour: DARK },
      { pos: [3.7, 0.5, 0], size: [0.4, 1, 7.4], colour: DARK },
    ],
    stacks: [
      { id: 'rock', count: 40, pos: [0, 0.4, -12], spread: [22, 0.6, 6], size: [0.55, 0.55, 0.55], mass: 1.4, colour: SCRAP },
    ],
    zones: [
      { id: 'bin', pos: [0, 1, 0], size: [7, 3, 6.6], colour: GOAL },
    ],
    objectives: [
      { type: 'propsInZone', stack: 'rock', zone: 'bin', label: 'Rock in the bin' },
    ],
  },

  {
    id: 'derby',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Demolition Derby',
    brief: 'A raised floor with nothing around it, and a machine that is not yours driving straight at you. Stay on it for twenty seconds.',
    hint: 'There is no mechanism to build here, only a shape. Low, wide, heavy, and a sloped face at the front so what hits you rides up instead of shoving you back.',
    spawn: [0, 4.6, -5],
    groundSize: 160,
    groundY: -6,
    budget: { cost: 140 },
    pieces: [
      { pos: [0, 3.6, 0], size: [18, 1.2, 18], colour: GREY },
      // A low rim, so you have to be pushed properly off rather than drifting.
      { pos: [0, 4.4, -9.2], size: [18, 0.4, 0.5], colour: DARK },
      { pos: [0, 4.4, 9.2], size: [18, 0.4, 0.5], colour: DARK },
      { pos: [-9.2, 4.4, 0], size: [0.5, 0.4, 18], colour: DARK },
      { pos: [9.2, 4.4, 0], size: [0.5, 0.4, 18], colour: DARK },
    ],
    opponents: [
      {
        id: 'rival',
        pos: [0, 4.9, 6],
        size: [2.6, 1.2, 3.4],
        mass: 200,
        speed: 4.5,
        route: [[0, 4.9, 6], [0, 4.9, -6], [5, 4.9, 5], [-5, 4.9, -5]],
        colour: 0xd6544a,
      },
    ],
    props: [],
    zones: [
      { id: 'ring', pos: [0, 5.2, 0], size: [18, 3.6, 18], colour: GOAL },
    ],
    objectives: [
      { type: 'coreInZone', zone: 'ring', hold: 20, label: 'Still on the floor after twenty seconds' },
    ],
    par: 60,
  },

  {
    id: 'escort',
    demands: { steps: 2, flies: false },
    bans: ['flight'],
    name: 'Escort',
    brief: 'The hauler sets off on its own and shoves the pallet along in front of it. Rubble blocks the road in three places, and it will not wait for you.',
    hint: 'You are working to somebody else’s clock. Get ahead of it and clear the next heap before it arrives, rather than tidying up behind it.',
    spawn: [-7, 1.2, -37.0],
    groundSize: 150,
    budget: { cost: 140 },
    pieces: [
      // A walled road, so the hauler cannot simply be steered round the mess.
      { pos: [-4.5, 1, 0], size: [1, 2, 44], colour: DARK },
      { pos: [4.5, 1, 0], size: [1, 2, 44], colour: DARK },
    ],
    opponents: [
      {
        id: 'hauler',
        pos: [0, 0.7, -18],
        size: [3.4, 1.4, 3],
        mass: 260,
        speed: 2.2,
        route: [[0, 0.7, -18], [0, 0.7, 18]],
        colour: 0x8a6f3a,
      },
    ],
    stacks: [
      { id: 'rubble-a', count: 9, pos: [0, 0.4, -7], spread: [7, 0.8, 1.6], size: [0.7, 0.7, 0.7], mass: 2.2, colour: SCRAP },
      { id: 'rubble-b', count: 9, pos: [0, 0.4, 2], spread: [7, 0.8, 1.6], size: [0.7, 0.7, 0.7], mass: 2.2, colour: SCRAP },
      { id: 'rubble-c', count: 9, pos: [0, 0.4, 11], spread: [7, 0.8, 1.6], size: [0.7, 0.7, 0.7], mass: 2.2, colour: SCRAP },
    ],
    props: [
      { id: 'pallet', pos: [0, 0.45, -15.4], size: [2.4, 0.8, 1.2], mass: 8, colour: CRATE },
    ],
    zones: [
      { id: 'yard', pos: [0, 1, 19], size: [8, 3, 5], colour: GOAL },
    ],
    objectives: [
      { type: 'propInZone', prop: 'pallet', zone: 'yard', hold: 1, label: 'Pallet reached the yard' },
    ],
    par: 150,
  },

  {
    id: 'dolls-house',
    demands: { steps: 1, flies: false },
    bans: ['flight'],
    name: 'Doll’s House',
    brief: 'The same machine you always build, on a course laid out at ten times the usual size. A kerb here is a cliff.',
    hint: 'Nothing about the machine has changed and everything about the problem has. What was a bump is now a climb, and what was a short hop is now a long way round.',
    spawn: [0, 1.2, -42.0],
    groundSize: 220,
    budget: { cost: 120 },
    pieces: [
      // A kerb, at the scale where a kerb is a wall.
      { pos: [0, 1.6, -14], size: [40, 3.2, 4], colour: GREY },
      // A ramp up onto it, a long way round to the side.
      { pos: [17, 0.9, -20], size: [6, 3.4, 14], rotX: -0.2, colour: GREY },
      // A fallen beam across the top, at the scale of a felled tree.
      { pos: [-4, 3.8, -6], size: [26, 1.2, 1.2], colour: DARK },
      // The table the payload has to end up on.
      { pos: [0, 4.2, 14], size: [12, 2, 12], colour: GREY },
      { pos: [-8, 2.6, 8], size: [7, 2.8, 6], rotX: 0.34, colour: GREY },
    ],
    props: [
      { id: 'payload', pos: [6, 3.9, -4], size: [1.4, 1.4, 1.4], mass: 7, colour: PAYLOAD },
    ],
    zones: [
      { id: 'table', pos: [0, 6.2, 14], size: [10, 3, 10], colour: GOAL },
    ],
    objectives: [
      { type: 'propInZone', prop: 'payload', zone: 'table', hold: 3, label: 'Payload up on the table' },
    ],
    par: 170,
  },
];
