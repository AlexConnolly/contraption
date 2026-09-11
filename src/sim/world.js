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
