# Contraption

A building sandbox with a point. You get a problem — move this crate, lift that
payload, stop on that mark — and you solve it by bolting a machine together in
the studio, binding its motors to keys, and driving it.

Three.js for rendering, Rapier for physics, Vite for the build.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 150 tests, including headless physics
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
- **Flight controller** — handed over to the controller's mixer.
- **Always on**.

Designs autosave per challenge and survive a reload.

## The flight controller

Rotors and thrusters can be wired to a Flight Controller instead of to keys.
It is a mixer with a stabiliser on top, and it works out what to do from the
machine you actually built rather than assuming four rotors in a square.

For every thruster linked to it, it measures what that thruster can do:

- **climb** — the honest fraction of its thrust acting along the machine's up
  axis. A rotor lying on its side contributes nothing; one tilted 45 degrees
  contributes 0.71.
- **pitch, yaw, roll** — the torque it makes about the centre of mass, which is
  its offset crossed with its thrust, plus a rotor's own reaction torque. Those
  three are normalised across the machine, so each is a share of the authority
  available rather than a raw figure.

That one calculation covers every layout. Four upward rotors in a square get
equal lift, front and rear opposing in pitch, left and right opposing in roll,
and diagonals opposing in yaw — a quadcopter mixer, derived rather than
hard-coded. A jet pointing forward is counted as pitch authority instead of
lift. A single rotor over the centre of mass gets lift and yaw, and honestly
reports that it has no pitch or roll authority at all. Every figure is shown in
the inspector and any of them can be overridden by hand.

Flying it is `WASD` plus `Space` and `Shift`, all rebindable. Let go of
everything and it holds the height it is at.

Nothing here is faked. The controller only ever picks a throttle between 0 and
1 for each thruster, and that throttle becomes a real force:

- **Altitude** is two proportional loops in series — altitude error sets a
  target climb rate, climb-rate error sets an acceleration — converted to
  throttle through the machine's real mass and the lift its thrusters can
  actually make, with an integral term to remove the steady droop and extra
  throttle to pay for being banked over.
- **Attitude** is proportional-derivative on lean and lean rate.
- **Position** is the outer loop: with no stick input it leans against whatever
  drift it has, which is how a real controller loiters. That also absorbs a
  lopsided centre of mass — the machine settles at whatever trim holds it
  still, with no special case for it.

The mixer has to protect two things at once. Attitude control must survive,
because a machine that stops correcting its lean tips over and never recovers,
so where the mix would run past the ends of the throttle range the whole band
slides rather than the differences between thrusters being flattened. The
exception is trim that costs net lift rather than moving it around — the
single-rotor case, where reaction torque is welded to lift and fighting the
spin can only drop the machine. That much trim is allowed only as far as the
altitude loop has throttle left to win back.

## The computer

A machine can carry a **Computer**, and its program is a node graph. That graph
*is* the behaviour — there is no autopilot hiding underneath it.

Every module that can do something, or knows something, exposes typed ports.
A GPS reports position, velocity, speed, altitude and heading. A wheel takes a
throttle and reports its spin. A grabber takes an on-off and reports whether it
is holding anything. The flight controller takes pitch, yaw, climb and a target
altitude, and reports altitude, climb rate and how level it is. So one graph
can set a rotor's throttle directly, or hand the flight controller a height and
let it sort the throttles out itself.

A program is a set of **states**, and each state owns its own graph. That graph
runs every tick while the state is active — the state's loop. A `Go to` node
whose condition holds hands over to another state, and the first to fire wins.

Values are `number`, `bool` or `vec3`, and links are checked against the kind
at both ends. The node vocabulary is deliberately small: read and write a
module port, constants, level waypoints, build and split vectors, distance and
bearing between two points, maths, comparisons, logic, select, a timer for how
long the state has been running, and `Go to`. The graph is evaluated once per
tick in dependency order, and a cycle is reported rather than quietly serving a
stale value.

Open it from the Computer's inspector. Drag nodes about, pull a link from an
output socket to an input socket, and press **Tidy** to lay the current state
out in columns. `docs/COMPUTER.md` lists every port.

A level can be marked **hands-off**: the keyboard is ignored for the whole run,
so the machine has to fly itself. Challenge 6 is one, and the **Auto drone**
preset solves it — worth opening up and taking apart.

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
  are part of, which is far more stable than spinning a real blade. Both push
  along their local **+Y**, so yawing one with `R` does not change where it
  points — tilt it with `T`. The studio draws an arrow through each one showing
  which way it will push.

Machine parts do not collide with each other, only with the world.

## Layout

```
src/core/        orientation maths, the blueprint grid, keyboard input
src/parts/       part registry (mass, cost, joints, actuators) and meshes
src/sim/         connectivity, body grouping, signal bus, machine, arena,
                 flight controller, program graph, computer runtime
src/studio/      build mode: picking, ghost preview, undo, presets
src/challenges/  levels and objective tracking
src/ui/          palette, inspector, objectives, win card, node editor
```

## Tests

`npm test` runs 71 tests. The pure logic (orientations, grid placement, body
grouping, key bindings, objectives) is covered directly. On top of that,
`tests/physics.test.js` builds real machines in a real Rapier world and asserts
they behave — a rover drives, reverses and steers the correct way; an
off-centre thruster pushes without spinning the machine up; a hinged arm lifts
and lowers; a piston extends; a rotor machine takes off and comes back down; a
sensor trips; a grabber picks something up and holds it.

`tests/flight.test.js` covers the mixer and the control loops directly, then
flies real machines: a quadcopter that lifts off, holds height hands-off,
climbs, flies, brakes itself to a stop, yaws both ways and recovers level after
a hard knock; a single-rotor craft that holds height with no pitch or roll
authority; and a platform flown on plain jets with no rotors at all.

`tests/program.test.js` covers the graph on its own — ordering, cycle
detection, every node kind, state transitions and the validation a player sees.
`tests/autonomy.test.js` then runs programs on real machines with the keyboard
provably untouched: the hands-off challenge flown by the preset program, a
drone holding height on maths nodes alone with no flight controller anywhere,
and a rover that drives itself and stops on a sensor.

`tests/level.test.js` plays challenge 1 from start to finish with a scripted
driver, and flies challenge 4 with a drone that picks the payload up and puts
it on the platform. Both assert the objective actually completes.

Three conventions are worth stating because getting them wrong cost real bugs.
Forward is **+Z** and up is **+Y**, so the machine's right-hand side is
`forward x up` = **-X** — steering felt inverted until that was fixed. And
Rapier's `addForceAtPoint` records a force *and* the `r x F` torque, which are
cleared by **separate** calls: `resetForces` alone left the torque to
accumulate, and a single off-centre thruster would wind a machine up until it
threw itself off the floor. Lastly, leaning a machine accelerates it the way it
leans, so braking sideways drift means rolling **away** from it; that sign
inverted made the controller feed drift instead of killing it, and a drone that
so much as turned would accelerate away and never stop.

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
