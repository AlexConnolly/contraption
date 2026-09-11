/**
 * The numbers a level can change about the world itself.
 *
 * These are the cheapest variety in the game. No new parts, no new objectives,
 * nothing added to a machine — and between them they re-ask every question the
 * player has already answered. A rover that works perfectly is useless on ice;
 * a drone that hovers beautifully is a liability in a crosswind. They apply
 * just as well to courses that already shipped.
 */

export const EARTH = -9.81;

/** What a level pulls down with, in the shape Rapier wants. */
export function gravityOf(level) {
  return { x: 0, y: level?.gravity ?? EARTH, z: 0 };
}

/**
 * How hard the wind is blowing through a volume at this moment.
 *
 * A steady push is a slope you lean into once and then forget about, so it
 * breathes. Two waves at different rates rather than one, because a single
 * sine is a metronome you can time your run against — the point is that you
 * cannot.
 */
export function gustAt(elapsed, wind) {
  const depth = wind.gust ?? 0;
  if (depth <= 0) return wind.force ?? 0;
  const swell = Math.sin(elapsed * 0.7) * 0.6 + Math.sin(elapsed * 1.9 + 1.3) * 0.4;
  return (wind.force ?? 0) * (1 + depth * swell);
}

// -------------------------------------------------------------- the solver

export const STEP = 1 / 60;

/**
 * Rapier's default is one internal solve pass per contact, and on a machine
 * standing on wheels that is not enough. A cylinder resting on a plane touches
 * it along a line rather than across a face, so it sinks further into the
 * ground each step than a box does, and the solver turns that penetration back
 * into upward velocity when it pushes it out again.
 *
 * Measured on the starter rover dropped from 1.2 m: it lands at 3.9 m/s and
 * leaves again at 2.0 m/s, a 52 per cent rebound, on parts whose restitution
 * is 0.04. The same machine built on blocks rather than wheels rebounds at 6
 * per cent, which is what those numbers say it should.
 *
 * More passes fix it, and cost nothing worth measuring:
 *
 *     passes   rebound
 *          1       52%
 *          2       30%
 *          4       11%
 *          8        3%
 *
 * Eight is where it stops being a bounce and becomes a bump.
 */
export const PGS_PASSES = 8;

/**
 * Every world in the game and in the tests is made here, so the two cannot
 * drift apart: a solver setting only the game uses is a setting no test is
 * checking.
 */
export function createWorld(RAPIER, gravity = gravityOf(null)) {
  const world = new RAPIER.World(gravity);
  world.timestep = STEP;
  world.integrationParameters.numInternalPgsIterations = PGS_PASSES;
  return world;
}
