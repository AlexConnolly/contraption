#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';

import {
  CATALOGUE_FORMAT,
  CATALOGUE_LIMITS,
  packProblems,
  sanitiseLevelPack,
} from '../src/challenges/catalogue.js';

/**
 * Builds a catalogue index from a folder of pack files.
 *
 * This is the whole of the server side. A catalogue is an `index.json` and a
 * folder of packs, both static, and what makes the index trustworthy is that
 * it is produced by the same sanitiser the game runs on arrival — a pack that
 * the builder will not describe is a pack the game would have thrown away, and
 * finding that out in a pull request is considerably better than finding it
 * out in somebody's evening.
 *
 * Deliberately not a directory listing over an API. GitHub allows sixty
 * unauthenticated API calls an hour per address, so a store that browsed that
 * way would fail for everyone behind one connection at once. A file built when
 * the catalogue changes has no such limit and is cached by the CDN.
 *
 *   node tools/build-catalogue.js <packs dir> [out dir]
 *
 * Exits non-zero when a pack is broken, so it doubles as the check a pull
 * request has to pass.
 */

const isJSON = (name) => extname(name).toLowerCase() === '.json';

/** Reads and checks every pack in a folder, newest problems first. */
export async function readPacks(dir) {
  const names = (await readdir(dir)).filter(isJSON).sort();
  const packs = [];
  const broken = [];

  for (const name of names) {
    const id = basename(name, '.json');
    let raw;
    try {
      raw = JSON.parse(await readFile(join(dir, name), 'utf8'));
    } catch (error) {
      broken.push(`${name}: not valid JSON — ${error.message}`);
      continue;
    }

    const pack = sanitiseLevelPack(raw, { id });
    const problems = packProblems(pack);

    // A level that sanitising had to cut down is a level whose author wrote
    // something the game will not honour. Publishing it quietly would mean
    // shipping a level that plays differently from the one they tested.
    const lost = (raw.levels?.length ?? 0) - pack.levels.length;
    if (lost > 0) problems.push(`${lost} level(s) were dropped as unreadable`);

    if (problems.length) broken.push(`${name}: ${problems.join('; ')}`);
    else packs.push({ id, file: `packs/${name}`, pack });
  }

  return { packs, broken };
}

/** The index row for a pack — everything a list needs without the levels. */
export function rowFor({ id, file, pack }, likes = {}) {
  return {
    id,
    file,
    name: pack.name,
    author: pack.author,
    note: pack.note,
    count: pack.levels.length,
    likes: Number.isInteger(likes[id]) ? likes[id] : 0,
  };
}

export function indexFor(packs, { name = 'Official challenges', likes = {}, updated } = {}) {
  return {
    v: CATALOGUE_FORMAT,
    name,
    updated: updated ?? new Date().toISOString().slice(0, 10),
    packs: packs.slice(0, CATALOGUE_LIMITS.packs).map((entry) => rowFor(entry, likes)),
  };
}

async function main() {
  const [dir = 'packs', out = '.'] = process.argv.slice(2);

  const { packs, broken } = await readPacks(dir);

  if (broken.length) {
    console.error(`${broken.length} pack(s) will not publish:\n`);
    for (const line of broken) console.error(`  ${line}`);
    process.exitCode = 1;
    return;
  }

  // Reactions counted when the catalogue is built. Static hosting cannot total
  // votes on demand, so a ratings file is how a store gets ratings for nothing.
  let likes = {};
  try {
    likes = JSON.parse(await readFile(join(dir, '..', 'likes.json'), 'utf8'));
  } catch {
    likes = {};
  }

  const index = indexFor(packs, { likes });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

  const levels = packs.reduce((n, entry) => n + entry.pack.levels.length, 0);
  console.log(`${packs.length} pack(s), ${levels} level(s) → ${join(out, 'index.json')}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-catalogue.js')) {
  await main();
}
