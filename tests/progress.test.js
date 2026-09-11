import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../src/ui/progress.js';

// A stand-in for the browser's, so the store can be exercised in node.
function fakeStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
  };
}

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
});

describe('the save store', () => {
  it('starts empty', () => {
    expect(store.machines()).toEqual([]);
    expect(store.lastLevel()).toBe(null);
    expect(store.solved('first-haul')).toBe(false);
  });

  it('survives unreadable storage', () => {
    globalThis.localStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    };
    expect(store.machines()).toEqual([]);
    expect(store.saveDesign('first-haul', {})).toBe(false);
  });

  it('remembers the design for each challenge separately', () => {
    store.saveDesign('first-haul', { parts: ['a'] });
    store.saveDesign('airlift', { parts: ['b'] });
    expect(store.design('first-haul')).toEqual({ parts: ['a'] });
    expect(store.design('airlift')).toEqual({ parts: ['b'] });
    expect(store.design('sandbox')).toBe(null);
  });

  it('treats saving a design as the last challenge played', () => {
    store.saveDesign('airlift', {});
    expect(store.lastLevel()).toBe('airlift');
  });
});

describe('results', () => {
  it('marks a challenge solved once it is won', () => {
    expect(store.solved('first-haul')).toBe(false);
    store.recordWin('first-haul', 12.5, 30);
    expect(store.solved('first-haul')).toBe(true);
  });

  it('keeps the best time, not the latest', () => {
    store.recordWin('first-haul', 12.5, 30);
    expect(store.recordWin('first-haul', 20, 12)).toBe(false);
    expect(store.result('first-haul').best).toBe(12.5);
    expect(store.result('first-haul').bestCost).toBe(30);
  });

  it('takes the cost of the run that set the best time', () => {
    store.recordWin('first-haul', 20, 40);
    expect(store.recordWin('first-haul', 9, 55)).toBe(true);
    expect(store.result('first-haul')).toMatchObject({ best: 9, bestCost: 55 });
  });

  it('counts every attempt', () => {
    store.recordWin('first-haul', 20, 40);
    store.recordWin('first-haul', 18, 40);
    store.recordWin('first-haul', 30, 40);
    expect(store.result('first-haul').runs).toBe(3);
  });

  it('counts how many of a set of challenges are solved', () => {
    store.recordWin('first-haul', 10, 20);
    store.recordWin('airlift', 10, 20);
    expect(store.solvedCount(['first-haul', 'airlift', 'traffic'])).toBe(2);
  });
});

describe('the garage', () => {
  it('gives every machine an id and puts the newest first', () => {
    const first = store.saveMachine({ name: 'Rover', blueprint: {}, thumb: 'a' });
    const second = store.saveMachine({ name: 'Drone', blueprint: {}, thumb: 'b' });
    expect(first.id).toBeTruthy();
    expect(second.id).not.toBe(first.id);
    expect(store.machines().map((m) => m.name)).toEqual(['Drone', 'Rover']);
  });

  it('overwrites a machine saved under an id it already has', () => {
    const saved = store.saveMachine({ name: 'Rover', blueprint: { v: 1 }, thumb: 'a' });
    store.saveMachine({ id: saved.id, name: 'Rover', blueprint: { v: 2 }, thumb: 'c' });
    expect(store.machines()).toHaveLength(1);
    expect(store.machine(saved.id).blueprint).toEqual({ v: 2 });
  });

  it('renames and deletes', () => {
    const saved = store.saveMachine({ name: 'Rover', blueprint: {}, thumb: 'a' });
    store.renameMachine(saved.id, 'Mk II');
    expect(store.machine(saved.id).name).toBe('Mk II');
    store.deleteMachine(saved.id);
    expect(store.machine(saved.id)).toBe(null);
  });

  it('ignores a rename of a machine that is not there', () => {
    expect(() => store.renameMachine('nope', 'x')).not.toThrow();
    expect(store.machines()).toEqual([]);
  });
});

describe('settings', () => {
  it('falls back to the defaults it is given', () => {
    expect(store.settings({ camera: 'chase' })).toEqual({ camera: 'chase' });
  });

  it('lets a stored choice win over the default', () => {
    store.setSetting('camera', 'orbit');
    expect(store.settings({ camera: 'chase', shadows: 'on' }))
      .toEqual({ camera: 'orbit', shadows: 'on' });
  });

  it('keeps settings apart from designs and results', () => {
    store.setSetting('shadows', 'off');
    store.saveDesign('first-haul', { parts: [] });
    store.recordWin('first-haul', 5, 10);
    expect(store.settings({}).shadows).toBe('off');
    expect(store.design('first-haul')).toEqual({ parts: [] });
  });
});

describe('scored levels', () => {
  it('keeps the best score, and bigger is better', () => {
    store.recordScore('quarry', 12);
    expect(store.recordScore('quarry', 8)).toBe(false);
    expect(store.result('quarry').bestScore).toBe(12);
    expect(store.recordScore('quarry', 20)).toBe(true);
    expect(store.result('quarry').bestScore).toBe(20);
  });

  it('counts a score of nothing as having played it', () => {
    store.recordScore('quarry', 0);
    expect(store.result('quarry').bestScore).toBe(0);
    expect(store.solved('quarry')).toBe(true);
  });

  it('counts towards the solved tally like any other challenge', () => {
    store.recordWin('first-haul', 10, 20);
    store.recordScore('quarry', 5);
    expect(store.solvedCount(['first-haul', 'quarry', 'traffic'])).toBe(2);
  });

  it('leaves a timed result alone', () => {
    store.recordWin('first-haul', 10, 20);
    store.recordScore('first-haul', 3);
    expect(store.result('first-haul').best).toBe(10);
    expect(store.result('first-haul').bestScore).toBe(3);
  });
});
