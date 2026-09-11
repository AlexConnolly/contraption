import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  NODE_TYPES, ProgramRunner, sortNodes, validateProgram, emptyProgram, defaultValue,
} from '../src/sim/program.js';

function node(id, type, config = {}) {
  return { id, type, config, x: 0, y: 0 };
}

function link(fromNode, fromPort, toNode, toPort) {
  return { from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } };
}

function state(id, nodes, links, name = id) {
  return { id, name, nodes, links };
}

// A stand-in machine: ports are whatever the test declares, reads come from a
// table, and writes are collected so they can be checked.
function context(options = {}) {
  const written = new Map();
  return {
    written,
    ports: options.ports ?? {},
    reads: options.reads ?? {},
    port(partId, direction, id) {
      return options.ports?.[`${partId}:${direction}:${id}`] ?? null;
    },
    hasPart: (partId) => !options.missing?.includes(partId),
    readPort: (partId, port) => options.reads?.[`${partId}:${port}`] ?? 0,
    writePort: (partId, port, value) => written.set(`${partId}:${port}`, value),
    waypoint: (zone) => options.waypoints?.[zone] ?? new THREE.Vector3(),
  };
}

function runOnce(nodes, links, ctx = context()) {
  const program = { version: 1, start: 's', states: [state('s', nodes, links)] };
  const runner = new ProgramRunner(program);
  const result = runner.tick(1 / 60, ctx);
  return { runner, result, ctx };
}

describe('graph ordering', () => {
  it('evaluates a node only after everything feeding it', () => {
    const s = state('s', [
      node('c', 'constant', { value: 2 }),
      node('m', 'maths', { op: 'multiply' }),
      node('d', 'constant', { value: 3 }),
    ], [link('c', 'value', 'm', 'a'), link('d', 'value', 'm', 'b')]);
    const { order, cyclic } = sortNodes(s);
    expect(cyclic).toEqual([]);
    expect(order.map((n) => n.id).indexOf('m')).toBe(2);
  });

  it('refuses to evaluate nodes caught in a loop', () => {
    const s = state('s', [
      node('a', 'maths', { op: 'add' }),
      node('b', 'maths', { op: 'add' }),
    ], [link('a', 'r', 'b', 'a'), link('b', 'r', 'a', 'a')]);
    const { order, cyclic } = sortNodes(s);
    expect(order).toEqual([]);
    expect(cyclic.sort()).toEqual(['a', 'b']);
  });

  it('reports the loop rather than running a stale value', () => {
    const { result } = runOnce(
      [node('a', 'maths', { op: 'add' }), node('b', 'maths', { op: 'add' })],
      [link('a', 'r', 'b', 'a'), link('b', 'r', 'a', 'a')],
    );
    expect(result.errors[0]).toMatch(/loop/i);
  });
});

describe('value nodes', () => {
  it('carries a number, a bool and a vector', () => {
    const { runner } = runOnce([
      node('n', 'constant', { kind: 'number', value: 4.5 }),
      node('b', 'constant', { kind: 'bool', value: true }),
      node('v', 'constant', { kind: 'vec3', vector: [1, 2, 3] }),
    ], []);
    expect(runner.values.get('n:value')).toBe(4.5);
    expect(runner.values.get('b:value')).toBe(true);
    expect(runner.values.get('v:value')).toEqual(new THREE.Vector3(1, 2, 3));
  });

  it('defaults an unwired socket to the zero of its kind', () => {
    expect(defaultValue('number')).toBe(0);
    expect(defaultValue('bool')).toBe(false);
    expect(defaultValue('vec3')).toEqual(new THREE.Vector3());
  });
});

describe('maths and logic nodes', () => {
  const cases = [
    ['add', 3, 4, 7],
    ['subtract', 3, 4, -1],
    ['multiply', 3, 4, 12],
    ['divide', 12, 4, 3],
    ['divide', 12, 0, 0],
    ['min', 3, 4, 3],
    ['max', 3, 4, 4],
    ['abs', -3, 0, 3],
    ['clamp', 9, 2, 2],
    ['clamp', -9, 2, -2],
  ];

  for (const [op, a, b, expected] of cases) {
    it(`computes ${op}(${a}, ${b}) as ${expected}`, () => {
      const { runner } = runOnce([
        node('a', 'constant', { value: a }),
        node('b', 'constant', { value: b }),
        node('m', 'maths', { op }),
      ], [link('a', 'value', 'm', 'a'), link('b', 'value', 'm', 'b')]);
      expect(runner.values.get('m:r')).toBe(expected);
    });
  }

  it('takes the short way round when comparing headings', () => {
    const angle = (a, b) => {
      const { runner } = runOnce([
        node('a', 'constant', { value: a }),
        node('b', 'constant', { value: b }),
        node('m', 'maths', { op: 'angleDelta' }),
      ], [link('a', 'value', 'm', 'a'), link('b', 'value', 'm', 'b')]);
      return runner.values.get('m:r');
    };
    expect(angle(10, 40)).toBeCloseTo(30, 6);
    expect(angle(170, -170)).toBeCloseTo(20, 6);
    expect(angle(-170, 170)).toBeCloseTo(-20, 6);
  });

  it('compares and combines', () => {
    const { runner } = runOnce([
      node('a', 'constant', { value: 2 }),
      node('b', 'constant', { value: 5 }),
      node('lt', 'compare', { op: 'lt' }),
      node('gt', 'compare', { op: 'gt' }),
      node('both', 'logic', { op: 'and' }),
      node('either', 'logic', { op: 'or' }),
    ], [
      link('a', 'value', 'lt', 'a'), link('b', 'value', 'lt', 'b'),
      link('a', 'value', 'gt', 'a'), link('b', 'value', 'gt', 'b'),
      link('lt', 'r', 'both', 'a'), link('gt', 'r', 'both', 'b'),
      link('lt', 'r', 'either', 'a'), link('gt', 'r', 'either', 'b'),
    ]);
    expect(runner.values.get('lt:r')).toBe(true);
    expect(runner.values.get('gt:r')).toBe(false);
    expect(runner.values.get('both:r')).toBe(false);
    expect(runner.values.get('either:r')).toBe(true);
  });

  it('picks between two values on a condition', () => {
    const { runner } = runOnce([
      node('c', 'constant', { kind: 'bool', value: true }),
      node('a', 'constant', { value: 7 }),
      node('b', 'constant', { value: 9 }),
      node('s', 'select'),
    ], [
      link('c', 'value', 's', 'when'),
      link('a', 'value', 's', 'a'),
      link('b', 'value', 's', 'b'),
    ]);
    expect(runner.values.get('s:r')).toBe(7);
  });
});

describe('vector nodes', () => {
  it('builds, splits and measures', () => {
    const { runner } = runOnce([
      node('x', 'constant', { value: 3 }),
      node('z', 'constant', { value: 4 }),
      node('v', 'vector'),
      node('origin', 'constant', { kind: 'vec3', vector: [0, 0, 0] }),
      node('sp', 'split'),
      node('d', 'distance'),
      node('br', 'bearing'),
    ], [
      link('x', 'value', 'v', 'x'), link('z', 'value', 'v', 'z'),
      link('v', 'v', 'sp', 'v'),
      link('origin', 'value', 'd', 'a'), link('v', 'v', 'd', 'b'),
      link('origin', 'value', 'br', 'a'), link('v', 'v', 'br', 'b'),
    ]);
    expect(runner.values.get('sp:x')).toBe(3);
    expect(runner.values.get('sp:z')).toBe(4);
    expect(runner.values.get('d:d')).toBeCloseTo(5, 6);
    expect(runner.values.get('d:flat')).toBeCloseTo(5, 6);
    // +X is 90 degrees round from +Z.
    expect(runner.values.get('br:deg')).toBeCloseTo(36.87, 1);
  });

  it('reads a level marker as a position', () => {
    const ctx = context({ waypoints: { pad: new THREE.Vector3(0, 4, 8) } });
    const { runner } = runOnce([node('w', 'waypoint', { zone: 'pad' })], [], ctx);
    expect(runner.values.get('w:position')).toEqual(new THREE.Vector3(0, 4, 8));
  });
});

describe('module nodes', () => {
  const ports = {
    'gps1:out:altitude': { id: 'altitude', name: 'Altitude', kind: 'number' },
    'rotor1:in:throttle': { id: 'throttle', name: 'Throttle', kind: 'number', min: 0, max: 1 },
  };

  it('reads a module output into the graph', () => {
    const ctx = context({ ports, reads: { 'gps1:altitude': 12.5 } });
    const { runner } = runOnce(
      [node('r', 'read', { partId: 'gps1', port: 'altitude' })], [], ctx,
    );
    expect(runner.values.get('r:value')).toBe(12.5);
  });

  it('writes a value out to a module', () => {
    const ctx = context({ ports });
    runOnce([
      node('c', 'constant', { value: 0.6 }),
      node('w', 'write', { partId: 'rotor1', port: 'throttle' }),
    ], [link('c', 'value', 'w', 'value')], ctx);
    expect(ctx.written.get('rotor1:throttle')).toBe(0.6);
  });
});

describe('states', () => {
  function twoStates() {
    return {
      version: 1,
      start: 'a',
      states: [
        state('a', [
          node('t', 'timer'),
          node('limit', 'constant', { value: 2 }),
          node('done', 'compare', { op: 'gte' }),
          node('go', 'goto', { state: 'b' }),
        ], [
          link('t', 'seconds', 'done', 'a'),
          link('limit', 'value', 'done', 'b'),
          link('done', 'r', 'go', 'when'),
        ], 'First'),
        state('b', [], [], 'Second'),
      ],
    };
  }

  it('starts in the named state and stays there until told otherwise', () => {
    const runner = new ProgramRunner(twoStates());
    expect(runner.stateId).toBe('a');
    runner.tick(1, context());
    expect(runner.stateId).toBe('a');
  });

  it('moves on when a Go to condition holds', () => {
    const runner = new ProgramRunner(twoStates());
    runner.tick(1, context());
    const result = runner.tick(1.2, context());
    expect(result.next).toBe('b');
    expect(runner.stateId).toBe('b');
  });

  it('restarts the timer on entering a state', () => {
    const runner = new ProgramRunner(twoStates());
    runner.tick(1.5, context());
    runner.tick(1.5, context());
    expect(runner.stateId).toBe('b');
    expect(runner.elapsed).toBe(0);
  });

  it('takes the first transition that fires when several are true', () => {
    const program = {
      version: 1,
      start: 'a',
      states: [
        state('a', [
          node('yes', 'constant', { kind: 'bool', value: true }),
          node('g1', 'goto', { state: 'b' }),
          node('g2', 'goto', { state: 'c' }),
        ], [link('yes', 'value', 'g1', 'when'), link('yes', 'value', 'g2', 'when')]),
        state('b', [], []),
        state('c', [], []),
      ],
    };
    const runner = new ProgramRunner(program);
    runner.tick(0.1, context());
    expect(runner.stateId).toBe('b');
  });

  it('goes back to the start state on reset', () => {
    const runner = new ProgramRunner(twoStates());
    runner.tick(3, context());
    expect(runner.stateId).toBe('b');
    runner.reset();
    expect(runner.stateId).toBe('a');
    expect(runner.elapsed).toBe(0);
  });

  it('gives a usable empty program to start from', () => {
    const program = emptyProgram();
    expect(program.states).toHaveLength(1);
    expect(program.start).toBe(program.states[0].id);
    const runner = new ProgramRunner(program);
    expect(runner.tick(0.1, context()).errors).toEqual([]);
  });
});

describe('validation', () => {
  const ports = {
    'gps1:out:position': { id: 'position', name: 'Position', kind: 'vec3' },
    'rotor1:in:throttle': { id: 'throttle', name: 'Throttle', kind: 'number' },
  };

  it('catches a vector wired into a number', () => {
    const program = {
      version: 1,
      start: 's',
      states: [state('s', [
        node('r', 'read', { partId: 'gps1', port: 'position' }),
        node('w', 'write', { partId: 'rotor1', port: 'throttle' }),
      ], [link('r', 'value', 'w', 'value')], 'Only')],
    };
    const problems = validateProgram(program, context({ ports }));
    expect(problems.some((p) => /vec3 is wired into a number/.test(p))).toBe(true);
  });

  it('catches a Go to pointing at a deleted state', () => {
    const program = {
      version: 1,
      start: 's',
      states: [state('s', [node('g', 'goto', { state: 'gone' })], [], 'Only')],
    };
    expect(validateProgram(program, context())[0]).toMatch(/no longer exists/);
  });

  it('catches a node pointing at a part that has been removed', () => {
    const program = {
      version: 1,
      start: 's',
      states: [state('s', [node('r', 'read', { partId: 'gps1', port: 'position' })], [], 'Only')],
    };
    const problems = validateProgram(program, context({ ports, missing: ['gps1'] }));
    expect(problems[0]).toMatch(/part that is gone/);
  });

  it('passes a clean program', () => {
    const program = {
      version: 1,
      start: 's',
      states: [state('s', [
        node('c', 'constant', { value: 0.5 }),
        node('w', 'write', { partId: 'rotor1', port: 'throttle' }),
      ], [link('c', 'value', 'w', 'value')], 'Only')],
    };
    expect(validateProgram(program, context({ ports }))).toEqual([]);
  });
});

describe('node catalogue', () => {
  it('gives every node type a name and a group', () => {
    for (const [id, type] of Object.entries(NODE_TYPES)) {
      expect(type.name, id).toBeTruthy();
      expect(type.group, id).toBeTruthy();
      expect(typeof type.evaluate, id).toBe('function');
    }
  });
});
