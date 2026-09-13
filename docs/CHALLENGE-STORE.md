# The challenge store

Levels are the product and levels are small. A pack of a dozen is tens of
kilobytes, so there is no good reason a new problem should cost a release and a
download for everybody. The store is how a pack reaches a game that is already
installed.

It is two static files and no server: an `index.json` listing what exists, and
one file per pack. That is all a catalogue is, which is why it can be hosted for
nothing on GitHub Pages.

## Why static files and never an API

The obvious design is to ask GitHub what is in a directory. Do not.

`api.github.com` allows **60 unauthenticated requests an hour, per address**.
Everyone in one office, one school or behind one CDN shares that number, so the
store would fail for all of them at once, intermittently, in a way that looks
exactly like a bug in the game. Verified:

```
$ curl -s https://api.github.com/rate_limit
"core": { "limit": 60, "remaining": 60, ... }
```

An index built when the catalogue changes has no such limit and is cached by the
CDN. Both hosts send the header the game needs:

```
raw.githubusercontent.com   Access-Control-Allow-Origin: *   Cache-Control: max-age=300
<user>.github.io            Access-Control-Allow-Origin: *   Cache-Control: max-age=600
```

Pages is the one to use — same permissive CORS, longer cache, and a CDN in
front of it.

## Repository layout

A catalogue is its own repository, published to Pages from `main`:

```
contraption-challenges/
  packs/
    harbour.json
    quarry.json
  likes.json            optional; reaction counts baked in at build time
  index.json            built, committed by CI, never edited by hand
  .github/workflows/catalogue.yml
```

A pack file is a name, an author, and its levels:

```json
{
  "name": "Harbour",
  "author": "Contraption",
  "note": "Problems on the dockside. Cranes, mostly.",
  "levels": [ { "name": "Crane the crate", "objectives": [ ... ] } ]
}
```

Level shape is exactly what `sanitiseLevel` accepts — the same thing a share
code carries. `tests/fixtures/packs/harbour.json` is a working example.

## The workflow

The builder lives in the game repository so that a pack is checked by the same
sanitiser the game runs on arrival. A pack the builder will not describe is a
pack the game would have thrown away, and finding that out in a pull request is
better than finding it out in somebody's evening.

```yaml
name: Build catalogue

on:
  push: { branches: [main] }
  pull_request:
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          repository: AlexConnolly/contraption
          path: .game
      - uses: actions/setup-node@v4
        with: { node-version: 22 }

      # Exits non-zero on a pack the game would not accept, so this is the
      # check a pull request has to pass as well as the thing that publishes.
      - run: node .game/tools/build-catalogue.js packs .

      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: . }

  deploy:
    needs: build
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    environment: { name: github-pages }
    steps:
      - uses: actions/deploy-pages@v4
```

Run it locally exactly as CI does:

```
node tools/build-catalogue.js packs .
```

## How the game reads it

`src/challenges/catalogue.js` fetches and cleans; `src/challenges/downloaded.js`
keeps what the player chose. The split matters: a catalogue needs the network,
a shelf must not. Once a pack is on the shelf the game never asks the internet
about it again, which is the difference between shipping levels and streaming
them.

Three rules hold the fetching side together.

**A catalogue may only point inside itself.** `new URL(name, base)` honours an
absolute URL and discards the base, so an index listing a full `https://`
address would send the game — and the address of whoever is playing — anywhere
the file asked. `packURL` requires the resolved URL to sit inside the source's
own directory, which rules out another host, another Pages site on the same
domain, and climbing out with `../` in one check.

**Sources have no privileges.** A source is a name and a URL. The official
catalogue is one row in that list. Steam Workshop, a shared drive or a folder on
disk are the same shape, so none of them is a rewrite later.

**Downloaded ids are namespaced `pack/level`.** `getLevel` answers for an id it
does not recognise by handing back the first campaign level, so a collision
would silently give somebody the wrong problem and mark the wrong one solved.
The namespacing is idempotent because the shelf re-cleans stored packs on every
boot; without that the id would gain a segment each launch and saved progress
would come unstuck from its level.

## What this cannot do

Static hosting has no server, so it cannot count anything on demand:

- **No leaderboards.** For a game scored on cost and time this genuinely hurts —
  comparing solutions is half the appeal of a constraint puzzle. A Cloudflare
  Worker covers it inside the free tier when it is worth doing.
- **No play counts and no comments.**
- **Ratings are baked in.** `likes.json` is read at build time, so reactions on a
  submission issue can be totalled by CI and published as a number. Free, and
  as live as the last build.

Community submission needs a GitHub account even with a prefilled issue form, so
expect a fraction of what Steam Workshop would draw. For official packs — one
author, publishing on purpose — that friction is zero, which is why the store
starts there.
