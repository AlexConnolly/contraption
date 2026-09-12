import { describe, it, expect } from 'vitest';
import { ProgramRunner, validateProgram } from '../src/sim/program.js';

const node = (id, type, config = {}) => ({
  id, type, config, x: 0, y: 0,
});
const link = (from, fromPort, to, toPort) => ({
  from: { node: from, port: fromPort },
  to: { node: to, port: toPort },
});

/** A world the program can read and write, and a log of what it wrote. */
function world(reads = {}) {
  const wrote = [];
  return {
    wrote,
    ctx: {
      hasPart: () => true,
      port: (_partId, _direction, id) => ({
        id, name: id, kind: id === 'tripped' ? 'bool' : 'number',
      }),
      readPort: (partId, port) => reads[`${partId}:${port}`] ?? 0,
      writePort: (partId, port, value) => wrote.push([partId, port, value]),
      waypoint: () => null,
    },
  };
}

const lastWrite = (wrote, partId, port) => [...wrote]
  .reverse().find(([a, b]) => a === partId && b === port)?.[2];

/**
 * A guard that has to be watched all the time used to be copied into every
 * state, and every state added afterwards had to remember to carry it. The
 * decider is one state that runs every loop before whichever state you are in,
 * so the guard is written once and the states are left for the work.
 */
function program({ guard = false } = {}) {
  return {
    version: 1,
    start: 'drive',
    states: [
      {
        id: 'watch',
        name: 'Decide',
        main: true,
        nodes: [
          node('s', 'read', { partId: 'eye', port: 'tripped' }),
          node('n', 'logic', { op: 'not' }),
          node('g', 'goto', { state: 'stop' }),
        ],
        links: [link('s', 'value', 'n', 'a'), link('n', 'r', 'g', 'when')],
      },
      {
        id: 'drive',
        name: 'Drive',
        nodes: [
          node('c', 'constant', { value: 1 }),
          node('w', 'write', { partId: 'wheel', port: 'throttle' }),
        ],
        links: [link('c', 'value', 'w', 'value')],
      },
      {
        id: 'stop',
        name: 'Stop',
        nodes: [
          node('c2', 'constant', { value: 0 }),
          node('w2', 'write', { partId: 'wheel', port: 'throttle' }),
          // Stop asks to go back every loop. Whether it gets its way is the
          // decider's call, which is the whole point of the arrangement.
          node('always', 'constant', { kind: 'bool', value: true }),
          node('g2', 'goto', { state: 'drive' }),
        ],
        links: [
          link('c2', 'value', 'w2', 'value'),
          link('always', 'value', 'g2', 'when'),
        ],
      },
    ],
    ...(guard ? {} : {}),
  };
}

describe('a state that runs every loop', () => {
  it('is not somewhere you can be', () => {
    const runner = new ProgramRunner(program());
    expect(runner.stateId).toBe('drive');
    expect(runner.state().id).toBe('drive');
  });

  it('does not become the start state even if it is named as one', () => {
    const p = program();
    p.start = 'watch';
    expect(new ProgramRunner(p).stateId).toBe('drive');
  });

  it('runs whichever state you are in, without being wired to it', () => {
    const { ctx, wrote } = world({ 'eye:tripped': true });
    const runner = new ProgramRunner(program());
    runner.tick(1 / 60, ctx);
    // The sensor is tripped, so the decider leaves it alone and Drive drives.
    expect(runner.stateId).toBe('drive');
    expect(lastWrite(wrote, 'wheel', 'throttle')).toBe(1);
  });

  it('takes over the moment its condition is met, from any state', () => {
    const { ctx } = world({ 'eye:tripped': false });
    const runner = new ProgramRunner(program());
    runner.tick(1 / 60, ctx);
    expect(runner.stateId).toBe('stop');
  });

  /**
   * The point of the thing: the guard is written once. Drive knows nothing
   * about the sensor, and never has to.
   */
  it('leaves the ordinary states free of the check', () => {
    const drive = program().states.find((s) => s.id === 'drive');
    expect(drive.nodes.some((n) => n.type === 'read')).toBe(false);
  });

  it('wins the argument when both it and the state ask to move', () => {
    // Stop asks to go back to Drive every loop; the decider says Stop.
    const { ctx } = world({ 'eye:tripped': false });
    const runner = new ProgramRunner(program());
    runner.tick(1 / 60, ctx);
    expect(runner.stateId).toBe('stop');
    runner.tick(1 / 60, ctx);
    expect(runner.stateId, 'the state talked the decider round').toBe('stop');
  });

  it('lets the state have its way once the decider stops asking', () => {
    const { ctx } = world({ 'eye:tripped': false });
    const runner = new ProgramRunner(program());
    runner.tick(1 / 60, ctx);
    expect(runner.stateId).toBe('stop');
    // Sensor comes back: the decider falls silent and Stop's own Go to lands.
    const clear = world({ 'eye:tripped': true });
    runner.tick(1 / 60, clear.ctx);
    expect(runner.stateId).toBe('drive');
  });

  it('runs before the state, so the state writes last', () => {
    const p = program();
    p.states[0].nodes.push(
      node('c3', 'constant', { value: 0.2 }),
      node('w3', 'write', { partId: 'wheel', port: 'throttle' }),
    );
    p.states[0].links.push(link('c3', 'value', 'w3', 'value'));
    const { ctx, wrote } = world({ 'eye:tripped': true });
    new ProgramRunner(p).tick(1 / 60, ctx);
    expect(wrote.map(([, , v]) => v)).toEqual([0.2, 1]);
    expect(lastWrite(wrote, 'wheel', 'throttle'), 'the state should win').toBe(1);
  });

  it('costs nothing when a program has not got one', () => {
    const p = program();
    delete p.states[0].main;
    p.states = p.states.filter((s) => s.id !== 'watch');
    const { ctx, wrote } = world();
    const runner = new ProgramRunner(p);
    runner.tick(1 / 60, ctx);
    expect(runner.stateId).toBe('drive');
    expect(lastWrite(wrote, 'wheel', 'throttle')).toBe(1);
  });
});

describe('what the editor will say about it', () => {
  const ctx = world().ctx;

  it('is happy with one decider', () => {
    expect(validateProgram(program(), ctx)).toEqual([]);
  });

  it('refuses to guess between two', () => {
    const p = program();
    p.states[1].main = true;
    expect(validateProgram(p, ctx).join(' ')).toMatch(/only one can/);
  });

  it('counts a state the decider can reach as reached', () => {
    const p = program();
    // Nothing but the decider points at Stop.
    p.states[2].nodes = p.states[2].nodes.filter((n) => n.type !== 'goto');
    expect(validateProgram(p, ctx).join(' ')).not.toMatch(/no Go to ever reaches/);
  });

  it('still catches a state nothing reaches at all', () => {
    const p = program();
    p.states.push({
      id: 'lost', name: 'Lost', nodes: [node('g9', 'goto', { state: 'drive' })], links: [],
    });
    expect(validateProgram(p, ctx).join(' ')).toMatch(/Lost: no Go to ever reaches/);
  });
});
