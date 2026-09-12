import { describe, it, expect } from 'vitest';
import { validateProgram, NODE_TYPES, nodeInputs } from '../src/sim/program.js';

// The same shape the editor hands in: it looks parts and their sockets up on
// the blueprint, and here every part exists and every socket is a number.
const ctx = {
  hasPart: () => true,
  port: (_partId, _direction, id) => ({
    id, name: id, kind: id === 'tripped' ? 'bool' : 'number',
  }),
  readPort: () => 0,
  writePort: () => {},
  waypoint: () => null,
};

const state = (id, name, nodes, links = []) => ({
  id, name, nodes, links,
});
const node = (id, type, config = {}) => ({
  id, type, config, x: 0, y: 0,
});
const link = (from, fromPort, to, toPort) => ({
  from: { node: from, port: fromPort },
  to: { node: to, port: toPort },
});

describe('a Logic node set to not', () => {
  it('asks for one value rather than two', () => {
    const ports = nodeInputs(node('n', 'logic', { op: 'not' }), ctx);
    expect(ports).toHaveLength(1);
    expect(ports[0].id).toBe('a');
  });

  it('still asks for two when it is combining', () => {
    for (const op of ['and', 'or']) {
      expect(nodeInputs(node('n', 'logic', { op }), ctx)).toHaveLength(2);
    }
  });

  it('does not upset a program that had wired the old second socket', () => {
    const program = {
      start: 's1',
      states: [state('s1', 'Go', [
        node('r', 'read', { partId: 'p1', port: 'tripped' }),
        node('n', 'logic', { op: 'not' }),
        node('g', 'goto', { state: 's1' }),
      ], [
        link('r', 'value', 'n', 'b'),
        link('n', 'r', 'g', 'when'),
      ])],
    };
    expect(() => validateProgram(program, ctx)).not.toThrow();
  });
});

/**
 * The program a player actually built: three distance sensors read, combined
 * with a chain of logic, and then nothing. It looks finished — every node is
 * wired to the next — but no part is driven and no state is ever left, so the
 * machine sits there. The editor knew all of that and said none of it.
 */
describe('the program that looked finished and did nothing', () => {
  const built = {
    start: 'state1',
    states: [
      state('state1', 'Start', [
        node('n4', 'read', { partId: 'p502', port: 'tripped' }),
        node('n5', 'read', { partId: 'p503', port: 'tripped' }),
        node('n6', 'read', { partId: 'p504', port: 'tripped' }),
        node('n3', 'logic', { op: 'or' }),
        node('n7', 'logic', { op: 'or' }),
        node('n15', 'constant', { value: 1 }),
        node('n14', 'logic', { op: 'and' }),
        node('n17', 'select'),
      ], [
        link('n4', 'value', 'n3', 'a'),
        link('n5', 'value', 'n3', 'b'),
        link('n6', 'value', 'n7', 'b'),
        link('n3', 'r', 'n7', 'a'),
        link('n7', 'r', 'n14', 'a'),
        link('n15', 'value', 'n14', 'b'),
        link('n14', 'r', 'n17', 'when'),
      ]),
      state('s2', 'Rotating', []),
    ],
  };

  const problems = validateProgram(built, ctx);

  it('says the work leads nowhere', () => {
    expect(problems.join(' | ')).toMatch(/Start: a Select is wired to nothing/);
  });

  it('says nothing is being driven', () => {
    expect(problems.join(' | ')).toMatch(/Start: nothing here drives a part or changes state/);
  });

  it('says the second state can never be reached', () => {
    expect(problems.join(' | ')).toMatch(/Rotating: no Go to ever reaches this state/);
  });
});

/**
 * What it should have been: go to the other state when any sensor is clear,
 * and otherwise keep the wheels turning. Any-of-these-is-false is the same
 * thing as not-all-of-them-are-true, which is two ands and a not.
 */
describe('the program that does what was wanted', () => {
  const wanted = {
    start: 'drive',
    states: [
      state('drive', 'Drive', [
        node('s1', 'read', { partId: 'p502', port: 'tripped' }),
        node('s2', 'read', { partId: 'p503', port: 'tripped' }),
        node('s3', 'read', { partId: 'p504', port: 'tripped' }),
        node('and1', 'logic', { op: 'and' }),
        node('and2', 'logic', { op: 'and' }),
        node('any', 'logic', { op: 'not' }),
        node('jump', 'goto', { state: 'turn' }),
        node('power', 'constant', { value: 1 }),
        node('go', 'write', { partId: 'p491', port: 'throttle' }),
      ], [
        link('s1', 'value', 'and1', 'a'),
        link('s2', 'value', 'and1', 'b'),
        link('and1', 'r', 'and2', 'a'),
        link('s3', 'value', 'and2', 'b'),
        link('and2', 'r', 'any', 'a'),
        link('any', 'r', 'jump', 'when'),
        link('power', 'value', 'go', 'value'),
      ]),
      state('turn', 'Turn', [
        node('t', 'constant', { value: 0.5 }),
        node('w', 'write', { partId: 'p491', port: 'throttle' }),
      ], [link('t', 'value', 'w', 'value')]),
    ],
  };

  it('has nothing to complain about', () => {
    expect(validateProgram(wanted, ctx)).toEqual([]);
  });

  it('is only two ands and a not away from what was built', () => {
    const logic = wanted.states[0].nodes.filter((n) => n.type === 'logic');
    expect(logic.map((n) => n.config.op).sort()).toEqual(['and', 'and', 'not']);
  });
});

describe('the checks do not cry wolf', () => {
  it('leaves a state alone when it drives something', () => {
    const fine = {
      start: 'only',
      states: [state('only', 'Only', [
        node('c', 'constant', { value: 1 }),
        node('w', 'write', { partId: 'p1', port: 'throttle' }),
      ], [link('c', 'value', 'w', 'value')])],
    };
    expect(validateProgram(fine, ctx)).toEqual([]);
  });

  it('counts a state reached through another as reached', () => {
    const chain = {
      start: 'a',
      states: [
        state('a', 'A', [node('g', 'goto', { state: 'b' })]),
        state('b', 'B', [node('g2', 'goto', { state: 'c' })]),
        state('c', 'C', [node('g3', 'goto', { state: 'a' })]),
      ],
    };
    expect(validateProgram(chain, ctx).join(' ')).not.toMatch(/never reaches/);
  });

  it('knows a Go to is an action even with nothing written', () => {
    const jump = {
      start: 'a',
      states: [
        state('a', 'A', [node('g', 'goto', { state: 'b' })]),
        state('b', 'B', [node('g2', 'goto', { state: 'a' })]),
      ],
    };
    expect(validateProgram(jump, ctx).join(' ')).not.toMatch(/drives a part/);
  });

  it('still reports the things it always reported', () => {
    expect(NODE_TYPES.goto).toBeDefined();
    const broken = {
      start: 'a',
      states: [state('a', 'A', [node('g', 'goto', { state: 'nowhere' })])],
    };
    expect(validateProgram(broken, ctx).join(' ')).toMatch(/no longer exists/);
  });
});
