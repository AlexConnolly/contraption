# Parts packs

A parts pack adds parts to the game. It is a JSON file: a name, and a list of
parts with their numbers. Nothing in a pack ever runs.

That sounds like a limitation and mostly is not, because of how the game is
built. Every part it ships — wheel, hinge, piston, rotor, grabber, servo — is a
lump of data plus **one of eight behaviours**, and the behaviours are the only
part written in code. A pack picks one of those eight and supplies its own
numbers, which is enough to rebuild anything already in the game and a good
deal that is not: a wheel twice the size, a ram that reaches across a room, a
rotor that lifts three times the load.

Two things a pack cannot do:

- **Bring a mesh.** A mesh is code. A pack can ask to be drawn as any shape the
  game already draws (`look`), which covers most of it.
- **Bring a behaviour.** A ninth behaviour would mean running a stranger's code
  inside the physics step.

## Writing one

Main menu → **Parts** → **Write a pack**, or **Look at the example** to start
from four working parts. The left side is the pack; the right side is what the
game made of it, updated as you type, with every number as it will actually be
used. Nothing is ever refused for asking too much — it is answered. Ask for a
thrust of ninety thousand and you get four hundred, and the panel says so.

**Install** puts the parts in the palette immediately. **Try it** drops you in
the sandbox with them. **Share** copies a `CTPK1…` code that anybody can paste
into their own **Open a pack code**.

## What goes in a part

Only the fields listed here are read. Anything else is dropped, and every
number is pulled into a range the solver survives.

| Field | What it is | Range |
| --- | --- | --- |
| `id` | Name within the pack. Becomes `pack:id`. | a-z, 0-9, `-` |
| `name` | What the palette calls it | 48 characters |
| `category` | Which shelf: `core` `structure` `drive` `manipulator` `flight` `avionics` `logic` | |
| `blurb` | The line under the name in the inspector | 160 characters |
| `cost` | What it spends from the level's budget | 0 – 200 |
| `mass` | Kilograms | 0.05 – 60 |
| `colour` | `0xrrggbb` | |
| `size` | Cells it occupies, `[x, y, z]` | 1 – 5 each |
| `shape` | `box` or `wedge` | |
| `look` | Draw it as one of the shipped shapes | see below |
| `unique` | Only one allowed per machine | |

### Shapes you can borrow

`coupling` `wedge` `core` `wheel` `hinge` `turntable` `positioner`
`suspension` `piston` `propeller` `thruster` `grabber` `controller` `sensor`.

Anything else, and the part is a plain block in its own colour.

### Joints

Set `articulated: true` and the part starts a new body, jointed back to
whatever its attach face touches.

| Field | What it is |
| --- | --- |
| `joint` | `revolute` (turns), `prismatic` (slides), `fixed` |
| `axis` | The axis it turns or slides on, e.g. `[1, 0, 0]` |
| `attach` | Faces it bolts to the host with, e.g. `[[-1, 0, 0]]` |
| `carry` | Faces the load rides on |
| `limits` | How far it may turn, in radians |
| `flippable` | Offer a Flip toggle, for building mirrored pairs |

An articulated part connects on **only** those two faces. Every face would weld
the joint solid the moment anything brushed it.

### Behaviours

`actuator.kind` is one of eight, and one of eight only:

| Kind | What it does |
| --- | --- |
| `motor` | Spins the joint at a speed you set. Wheels. |
| `servo` | Holds an angle while a key is held. |
| `position` | Snaps between two set angles, the short way round. |
| `spin` | Turns continuously. Turntables. |
| `linear` | Drives a prismatic joint to a target extension. |
| `thrust` | Pushes along the part's local +Y. Rotors. |
| `grab` | Latches onto whatever it is touching. |
| `release` | Lets go. |

Alongside it: `port` (which input socket drives it), `signal`
(`axis` `hold` `toggle` `drive` `flight` `sensor` `always`), `maxSpeed`
(0.1 – 40), `maxForce` (1 – 4000), `stiffness` (0 – 20000), `damping`
(0 – 2000), and `defaultBinding` — the keys it comes bound to.

### The rest

- `radius` / `width` / `friction` — anything with a radius rolls.
- `thruster: { axis, maxThrust, spin, reaction }` — anything with one pushes.
- `sensor: { range, axis }` — a beam that reports distance and what it hit.
- `grabber: { reach }`.
- `spring: true` with `travel`, `stiffness`, `damping` and a `…Range` for each
  — a suspension strut, tunable on the part.
- `positions: true` with `angleA`, `angleB`, `speed` — a position servo.
- `tension` `stroke` `spin` `torque` `separation` `speed`, each with a
  `…Range`, are the sliders a player gets on the built part.
- `ports: { in: […], out: […] }` — the sockets the node editor wires to. Each
  is `{ id, name, kind }` where kind is `number`, `bool` or `vec3`.

## Rules a pack does not get out of

**Bans read behaviour, not names.** A level that bans flight bans anything with
a thruster or in the `flight` category, whoever wrote it and whatever it is
called. Same for wheels, same for grabbers. A pack cannot smuggle a rotor onto
a no-flight course by calling it a hat.

**A modded run is not on the board.** A pack sets its own costs and masses, so
a time set with one is not measured against the same thing as everybody else's.
The run is played and won as normal, and the win card says *pack parts — not on
the board* instead of a personal best. This is the line custom levels are
already on.

**A pack cannot shadow a shipped part.** Ids are prefixed with the pack's own
name, and the shipped parts are looked up first either way.

**A machine outlives the pack it was built with.** Remove a pack and machines
that used it still load, without those parts, and say what went.

## Limits

40 parts to a pack, 8 sockets to a side, 24,000 characters to a share code.

## Where it lives

| File | What is in it |
| --- | --- |
| `src/parts/packs.js` | The format, the sanitiser, the share code |
| `src/parts/installed.js` | Which packs this browser has, and the registry |
| `src/parts/registry.js` | `installParts`, `uninstallPack`, `PART_LOOKS` |
| `tests/packs.test.js` | What a pack may and may not do |
| `tests/installed.test.js` | Installing, removing, surviving a reload |
