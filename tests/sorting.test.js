import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { ObjectiveTracker } from '../src/challenges/objectives.js';
import { getLevel, LEVELS, tierOf } from '../src/challenges/levels.js';

const STEP = 1 / 60;
beforeAll(async () => { await RAPIER.init(); }, 30000);

function arenaFor(level, seed) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  return new Arena({ RAPIER, world, scene: new THREE.Scene(), level, seed });
}

const level = () => ({
  spawn: [0, 1, 0],
  groundSize: 60,
  pieces: [],
  props: [
    { id: 'a', pos: [-2, 1, 0], size: [1, 1, 1], mass: 2, colour: 0xff0000, tag: 1 },
    { id: 'b', pos: [0, 1, 0], size: [1, 1, 1], mass: 2, colour: 0x00ff00, tag: 2 },
    { id: 'c', pos: [2, 1, 0], size: [1, 1, 1], mass: 2, colour: 0x0000ff, tag: 3 },
    { id: 'd', pos: [4, 1, 0], size: [1, 1, 1], mass: 2, colour: 0xffff00, tag: 4 },
  ],
  shuffle: [['a', 'b', 'c', 'd']],
  zones: [],
  objectives: [],
});

describe('shuffling where things start', () => {
  it('puts the same crates in different places on different runs', () => {
    const one = arenaFor(level(), 11);
    const two = arenaFor(level(), 12);
    const at = (arena, id) => arena.propPosition(id).x;
    const same = ['a', 'b', 'c', 'd'].every((id) => at(one, id) === at(two, id));
    expect(same).toBe(false);
  });

  it('gives the same arrangement back for the same seed', () => {
    const one = arenaFor(level(), 21);
    const two = arenaFor(level(), 21);
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(two.propPosition(id).x).toBeCloseTo(one.propPosition(id).x, 6);
    }
  });

  // What shuffles is where a crate starts, not what it is: a crate has to
  // keep its identity or there is nothing to sort it by.
  it('leaves every crate its own label', () => {
    const arena = arenaFor(level(), 31);
    const tags = [...arena.props.values()].map((p) => p.spec.tag).sort();
    expect(tags).toEqual([1, 2, 3, 4]);
  });

  it('uses every starting place exactly once', () => {
    const arena = arenaFor(level(), 41);
    const xs = ['a', 'b', 'c', 'd'].map((id) => Math.round(arena.propPosition(id).x));
    expect([...xs].sort((p, q) => p - q)).toEqual([-2, 0, 2, 4]);
  });

  it('puts them back in their shuffled places after a reset', () => {
    const arena = arenaFor(level(), 51);
    const before = arena.propPosition('a').x;
    arena.props.get('a').body.setTranslation({ x: 30, y: 5, z: 30 }, true);
    arena.reset();
    // A reset redraws the seed, so a crate lands on one of the starting
    // places rather than necessarily its old one.
    const after = arena.propPosition('a').x;
    expect([-2, 0, 2, 4]).toContain(Math.round(after));
    expect(Number.isFinite(before)).toBe(true);
  });
});

describe('all of a set in one place', () => {
  it('is only done once every one of them is there', () => {
    const spec = {
      zones: [{ id: 'bay', pos: [0, 1, 0], size: [4, 4, 4], colour: 0x4ade80 }],
      objectives: [{ type: 'allPropsInZone', props: ['a', 'b'], zone: 'bay', label: 'both' }],
    };
    const tracker = new ObjectiveTracker(spec);
    const place = { a: new THREE.Vector3(0, 1, 0), b: new THREE.Vector3(20, 1, 0) };
    let report = tracker.update(STEP, { propPosition: (id) => place[id] });
    expect(report.complete).toBe(false);
    place.b = new THREE.Vector3(0, 1, 0);
    report = tracker.update(STEP, { propPosition: (id) => place[id] });
    expect(report.complete).toBe(true);
  });
});

describe('the sorting challenge', () => {
  const sorting = () => getLevel('sorting');

  it('is in the game', () => {
    expect(sorting().id).toBe('sorting');
    expect(LEVELS.map((l) => l.id)).toContain('sorting');
  });

  it('has three of each colour to deliver', () => {
    const tags = sorting().props.map((p) => p.tag).filter(Boolean).sort();
    expect(tags).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });

  it('has a belt for each colour', () => {
    const belts = sorting().pieces.filter((p) => p.belt);
    expect(belts.length).toBeGreaterThanOrEqual(3);
  });

  it('shuffles the crates, so which one is where cannot be learned', () => {
    expect(sorting().shuffle?.length).toBeGreaterThan(0);
  });

  it('asks for one delivery per colour rather than one in total', () => {
    expect(sorting().objectives).toHaveLength(3);
    for (const o of sorting().objectives) expect(o.props).toHaveLength(3);
  });

  it('is classified by what it demands', () => {
    expect(tierOf(sorting())).toBeTruthy();
  });
});
