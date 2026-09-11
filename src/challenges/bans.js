import { allParts, getPart } from '../parts/registry.js';

/**
 * A level can put parts out of reach.
 *
 * This is the cheapest content in the game — no new parts, no new physics —
 * and it does more to the shape of a level than anything else available.
 * Flying is the universal answer: rotors get you over, round and past almost
 * every problem, so taking them away turns a gentle haul into a real one.
 *
 * What each ban covers is read off the registry rather than listed by id. A
 * new rotor added next year is flight because of what it does, and nobody has
 * to remember to come back here and add it to a list.
 */
export const BANS = [
  {
    id: 'flight',
    name: 'No flight',
    note: 'No rotors, thrusters or flight controller — it has to stay on the ground.',
    covers: (part) => part.category === 'flight' || Boolean(part.flight),
  },
  {
    id: 'wheels',
    name: 'No wheels',
    // A wheel is a revolute joint that rolls on a rim. A turntable turns on an
    // axle too but has no rim, and it is the part a walker is built out of —
    // banning wheels must not quietly take that away as well.
    note: 'Nothing that rolls. Hinges and pistons still work.',
    covers: (part) => Boolean(part.radius) && part.joint === 'revolute',
  },
  {
    id: 'grabber',
    name: 'No grabbers',
    note: 'Nothing that latches on. Whatever you move, you move by holding it.',
    covers: (part) => Boolean(part.grabber),
  },
];

const BY_ID = new Map(BANS.map((ban) => [ban.id, ban]));

/** The bans in force on a level. Anything unrecognised is left out. */
export function bansOn(level) {
  return (level?.bans ?? []).map((id) => BY_ID.get(id)).filter(Boolean);
}

/** The ban that forbids this part on this level, or null if it is allowed. */
export function banFor(level, partId) {
  const bans = bansOn(level);
  if (bans.length === 0) return null;
  const part = getPart(partId);
  return bans.find((ban) => ban.covers(part)) ?? null;
}

/** Every part id this level forbids, for greying out a palette in one pass. */
export function bannedParts(level) {
  const bans = bansOn(level);
  const out = new Set();
  if (bans.length === 0) return out;
  for (const part of allParts()) {
    if (bans.some((ban) => ban.covers(part))) out.add(part.id);
  }
  return out;
}

/**
 * The first part of a machine this level will not allow, with the ban that
 * did it — enough to tell somebody exactly what is wrong rather than that
 * something is.
 *
 * This is really for machines that arrive from somewhere else: the palette
 * stops you building a banned part in the first place, but a drone loaded out
 * of the garage onto a no-flight level has to be turned away at the door.
 */
export function firstBanned(level, blueprint) {
  const bans = bansOn(level);
  if (bans.length === 0 || !blueprint) return null;
  for (const placed of blueprint.list()) {
    const part = getPart(placed.type);
    const ban = bans.find((rule) => rule.covers(part));
    if (ban) return { placed, part, ban };
  }
  return null;
}
