# Contraption

A building sandbox with a point. You get a problem — move this crate, lift that
payload, stop on that mark — and you solve it by bolting a machine together in
the studio, binding its motors to keys, and driving it.

Three.js for rendering, Rapier for physics, Vite for the build.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 65 tests, including headless physics
npm run build
npm run preview  # serve the production build
```

## Playing

The studio is a grid. Click a part in the palette, click in the world to place
it against a face of something already there.

| | |
|---|---|
| Left click | place / select / delete, depending on the tool |
| Right drag | orbit · **Middle drag** pan · **Wheel** zoom |
| `R` / `T` | rotate the part you are about to place (yaw / pitch) |
| `1` `2` `3` | place, select, delete tools |
| `X` | delete the part under the cursor |
| `Ctrl+Z` / `Ctrl+Y` | undo / redo |
| `Tab` | switch between studio and test |
| `K` / `C` | respawn · change camera (test mode) |

Pick the **Select** tool and click a part to open the inspector. Any motor,
rotor or grabber can be bound to whatever keys you like, in one of six modes:

- **Drive** — throttle plus steering on four keys. Wheels default to `WASD`,
  and a wheel works out which side of the machine it is on by itself.
- **Axis** — two keys, forward and back.
- **Hold** — on while the key is down.
- **Toggle** — press once on, press again off. Grabbers default to this.
- **Sensor** — driven by a distance sensor instead of a key.
- **Always on**.

Designs autosave per challenge and survive a reload.

## How a machine is put together

A blueprint is a list of parts on an integer grid, each with one of the 24
axis-aligned rotations. Turning that into physics is the interesting part:

- Parts bolted to each other **fuse into a single rigid body**. A twenty-block
  chassis is one body with twenty colliders, not twenty bodies held together by
  joints — which is what keeps it stable.
- An **articulated part** (wheel, hinge, piston) starts a new body and joints
  it back to whatever its attach face touches. Everything on its far side rides
  with it.
- Articulated parts deliberately connect on **only two faces**: the one that
  bolts to the host, and the one that carries the load. Otherwise a hinge that
  happened to brush the chassis would weld itself solid.
- If the rest of the build bridges both sides of a joint anyway, the joint is
  reported as **seized** and you are told before the run starts. Parts with no
  path back to the core are reported as **disconnected**.
- Rotors and thrusters are not articulated. They apply force to the body they
  are part of, which is far more stable than spinning a real blade.

Machine parts do not collide with each other, only with the world.

## Layout

```
src/core/        orientation maths, the blueprint grid, keyboard input
src/parts/       part registry (mass, cost, joints, actuators) and meshes
src/sim/         connectivity, body grouping, signal bus, machine, arena
src/studio/      build mode: picking, ghost preview, undo, presets
src/challenges/  levels and objective tracking
src/ui/          palette, inspector, objectives, win card
```

## Tests

`npm test` runs 65 tests. The pure logic (orientations, grid placement, body
grouping, key bindings, objectives) is covered directly. On top of that,
`tests/physics.test.js` builds real machines in a real Rapier world and asserts
they behave — a rover drives, reverses and steers; a hinged arm lifts and
lowers; a piston extends; a rotor machine takes off and comes back down; a
sensor trips; a grabber picks something up and holds it.

`tests/level.test.js` plays challenge 1 from start to finish with a scripted
driver and asserts the objective actually completes inside par. Those tests
found three real bugs during development — wheels on opposite sides fighting
each other, thrust accumulating every step because Rapier keeps applied forces
until they are cleared, and articulated parts welding themselves solid.

Part masses are given in kilograms per cell and prop masses in kilograms, so
the numbers in the registry and levels mean something when you tune them.

## Build

`npm run build` emits four assets: the game code, Three.js, the stylesheet, and
Rapier's WebAssembly as its own `.wasm` file.

Rapier ships two packages. `@dimforge/rapier3d-compat` inlines the same wasm as
base64, which is convenient but pushed the JavaScript bundle to 1.25 MB gzipped
on its own. The browser therefore uses the plain `@dimforge/rapier3d`, whose
wasm is fetched separately and cached separately — 54 kB of game code and
139 kB of Three.js, with the 774 kB wasm alongside. Tests keep the compat build
because Node loads it without needing experimental flags.

`vite.config.js` excludes Rapier from dependency pre-bundling. Without that the
dev server makes a second copy of the wasm-bindgen glue, only one copy holds
the wasm memory views, and every physics call through the other one throws.

## Adding to it

A new part is one entry in `src/parts/registry.js` plus an optional mesh
builder in `src/parts/geometry.js`. A new challenge is one entry in
`src/challenges/levels.js`: static `pieces`, dynamic `props`, trigger `zones`,
and `objectives` that reference them. Objective types live in
`src/challenges/objectives.js` — there are three, and adding a fourth is a
single function.
