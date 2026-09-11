import { describe, it, expect } from 'vitest';
import { stopsFor, shotFor, lookFor } from '../src/ui/survey.js';
import { LEVELS, getLevel } from '../src/challenges/levels.js';

describe('the course tour', () => {
  it('starts where the machine starts', () => {
    const level = getLevel('first-haul');
    const [first] = stopsFor(level);
    expect(first.at.toArray()).toEqual(level.spawn);
    expect(first.caption).toMatch(/start/i);
  });

  it('shows what has to move and where it has to end up', () => {
    const captions = stopsFor(getLevel('first-haul')).map((s) => s.caption);
    expect(captions).toHaveLength(3);
    expect(captions[1]).toMatch(/move/i);
    expect(captions[2]).toBe(getLevel('first-haul').objectives[0].label);
  });

  it('does not stop twice on the same thing', () => {
    const level = {
      spawn: [0, 0, 0],
      props: [{ id: 'p', pos: [1, 0, 0] }],
      zones: [{ id: 'z', pos: [2, 0, 0], size: [1, 1, 1] }],
      objectives: [
        { prop: 'p', zone: 'z', label: 'one' },
        { prop: 'p', zone: 'z', label: 'two' },
      ],
    };
    expect(stopsFor(level)).toHaveLength(3);
  });

  it('takes in the moving obstacles as one picture', () => {
    const captions = stopsFor(getLevel('traffic')).map((s) => s.caption);
    expect(captions[captions.length - 1]).toMatch(/still/i);
  });

  it('leaves out obstacles on a course that has none', () => {
    const captions = stopsFor(getLevel('first-haul')).map((s) => s.caption);
    expect(captions.some((c) => /still/i.test(c))).toBe(false);
  });

  // A shot pointed at the spawn from above shows empty ground. Looking along
  // the course from behind the spawn shows the problem.
  it('looks along the course rather than down at it', () => {
    const stops = stopsFor(getLevel('first-haul'));
    const eye = shotFor(stops, 0);
    const toNext = stops[1].at.clone().sub(stops[0].at).setY(0).normalize();
    const view = stops[0].at.clone().sub(eye).setY(0).normalize();
    expect(view.dot(toNext)).toBeGreaterThan(0.5);
    expect(eye.y).toBeGreaterThan(stops[0].at.y);
  });

  it('does not put two stops in a row on the same side', () => {
    const stops = stopsFor(getLevel('first-haul'));
    const offset = (i) => {
      const along = (stops[i].at.clone().sub(stops[i - 1]?.at ?? stops[i + 1].at)).setY(0).normalize();
      const side = new (stops[0].at.constructor)(-along.z, 0, along.x);
      return shotFor(stops, i).clone().sub(stops[i].at).dot(side);
    };
    expect(Math.sign(offset(1))).not.toBe(Math.sign(offset(2)));
  });

  it('aims ahead of a stop, not at it, so the next thing is already in shot', () => {
    const stops = stopsFor(getLevel('first-haul'));
    const look = lookFor(stops, 0);
    expect(look.distanceTo(stops[1].at)).toBeLessThan(look.distanceTo(stops[0].at) * 3);
    expect(look.equals(stops[0].at)).toBe(false);
    // The last stop has nothing beyond it, so it is aimed at squarely.
    expect(lookFor(stops, stops.length - 1).equals(stops[stops.length - 1].at)).toBe(true);
  });

  it('has somewhere to look on every challenge in the game', () => {
    for (const level of LEVELS) {
      const stops = stopsFor(level);
      expect(stops.length, level.name).toBeGreaterThan(0);
      for (const stop of stops) {
        expect(Number.isFinite(stop.at.x + stop.at.y + stop.at.z), level.name).toBe(true);
        expect(stop.reach, level.name).toBeGreaterThan(0);
        expect(typeof stop.caption, level.name).toBe('string');
      }
    }
  });
});
