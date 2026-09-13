# Contraption

A building sandbox with a point. You get a problem — move this crate, lift that
payload, stop on that mark — and you solve it by bolting a machine together in
the studio, binding its motors to keys, and driving it.

Three.js for rendering, Rapier for physics, Vite for the build.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 313 tests, including headless physics
npm run build
npm run preview  # serve the production build
```

## The front end

The game opens on a title screen with a tower crane turning slowly behind it,
and four ways in. The crane is there to answer the question a new player has
before they have asked it — how far does this go — which a seven-part rover
does not. It is built from the same parts on the same grid as anything else,
and a test holds it to the same rules, because a display model that could not
actually be built would be a lie told on the first screen.

**Challenges** is a grid of every problem in the game. Each card carries a
picture of the actual course, the parts budget, the par time, a skill level,
and the rules it is played under — *No input* where the machine has to run on
its own program, *No collisions* where touching anything fails the run. A
solved challenge shows a tick and the best time you have set on it.

### Bans

A level can put parts out of reach — `bans: ['flight']`, and also `'wheels'`
and `'grabber'`. It is the cheapest content in the game: no new parts, no new
physics, and it changes the shape of a level more than anything else does.
Flying is the universal answer, so taking it away turns a gentle haul into a
real problem.

What a ban covers is read off the part registry rather than listed by id, so a
rotor added next year is flight because of what it does. Enforcement is at
build time, never at run time: the part is greyed out on the rack, refuses to
place, and a machine loaded from the garage with a banned part on it is turned
away by name. A ban is shown in red on the challenge card and said out loud at
the first stop of the course tour — a constraint you cannot see before you
build reads as unfairness rather than as a puzzle.

Skill levels are worked out from what the challenge actually demands rather
than typed in by hand, so one cannot end up marked easier than it plays:

| | |
|---|---|
| **Easy** | One thing to do, on the ground. |
| **Medium** | Several steps, or it has to fly. |
| **Hard** | Several steps, and it has to fly. |
| **Expert** | It has to run itself. |

The course pictures are not screenshots taken by hand. Each one is built from
the level itself — the same arena the game plays, stepped on a little so the
moving parts are somewhere interesting — and drawn once per session. A course
therefore cannot show something the challenge no longer contains.

**Garage** holds machines you have saved by name. Any of them can be taken into
any challenge, which is the point: a drone that solves the airlift is a
reasonable starting point for the traffic run. Saving one draws its picture the
same way.

**Settings** covers the test camera, shadows and the screen effect over the
menus. Each applies the moment it is pressed and is remembered.

**Build** is where you make a problem of your own. See below.

### Seeing the problem first

The first question every one of these asks is how it could be done at all, and
an empty build plate does not answer it. A challenge you have not solved opens
with a look round the course: the camera visits the start, whatever has to
move, and where it has to end up, looking along the course rather than down at
it. Obstacles that move keep moving while you watch.

`View` next to `Studio` and `Test` is the same course with the camera in your
hands, for going back and looking properly at the bit you are stuck on.

Winning shows the time as the headline, and under it the machine that set it —
every part you spent. A time is worth nothing without what it was done with.

`Esc` leaves the game for the menu and backs out of any screen to the title.
Inside a challenge the top bar shows which one you are on and the way back to
the list, asked for first rather than done on the click.

The whole game is drawn from one design system — `src/ui/tokens.css` — so the
menus, the studio and the node editor share a palette, two typefaces and the
same cut-corner panels.

## Fun mode

Every challenge is two things bolted together: a job to do, and rules about how
you may do it. The job is the interesting half. The rules — no flight, a
budget, a clock, a keep-out, one attempt — are what make it a puzzle rather
than an errand.

Sometimes you do not want the puzzle. **Fun mode** is a switch at the top of
the challenge list that takes the rules off and leaves the course: a no-flight
course becomes flyable, the budget stops counting, the clock stops being a
clock, keep-outs open, height and weight caps lift, and one-attempt courses let
you respawn. The objectives stay exactly as they were.

Nothing is recorded. A time set with the rules off is not a time, so the win
card says *Fun mode — nothing recorded* and no personal best changes hands. The
brief carries an amber tag while it is on, so half an hour later, wondering why
nothing is stopping you, the answer is on screen.

There used to be a Sandbox level for this — an empty yard with a couple of
crates in it, which answered none of the questions people actually had, because
it had none of the courses in it. It is gone; fun mode on a real course is what
it was for.

## Building your own

**Build** opens the same world the studio uses, with the machine put away and
the course in your hands instead. You point at the ground and click, and the
thing you have selected lands on a half-metre grid: ground to stand on, crates
and balls to move, a goal zone, a no-go box, or the start mark the machine
spawns on. Clicking something already there selects it, and `Delete` removes
it.

There is no preview of the level and no separate editor view, because the
draft *is* the level: it is rendered through the ordinary arena, rebuilt on
every change. A mover or a belt runs while you are editing it, so what you are
looking at is what will be played. What the editor draws on top is a wireframe
box round each thing you can pick, and nothing else.

The right-hand rail is the level itself: name, brief, parts budget, par time,
the world numbers — gravity, ground friction, fog, and the cap on how heavy
the machine may be — and the switches that say what kind of run this is: the
three part bans, *No input* for a level the machine has to solve on its own,
*No touching*, and *One go*. Under that is the list of what is in the
course and the objectives, each of which picks a real crate and a real zone
from what you have placed rather than a name typed in hope, and says how long
it has to stay there. Removing a crate an objective needed takes the objective
with it, and says so.

The level's problems are listed live and in plain words — *no objectives*,
*par is 0s*, *nothing to stand on* — from the same check the format runs, so a
level that will not load cannot be saved by accident.

**Test play** drops you into the studio on your own level with the ordinary
rules, bans and budget applied. Coming back finds the draft exactly as you
left it.

### Getting one to somebody else

A level is data — sizes, positions, numbers, ids — and never behaviour, which
is what makes it safe to accept from a stranger. **Copy share code** turns the
level into a string starting `CTP1`: the JSON, deflated where that helps, in
base64url. It travels in a chat message. **Paste a level code** on the Build
screen reads one back.

Everything that comes in that way is put through `sanitiseLevel` first, and so
is everything read back out of your own browser storage, which is no more
trustworthy than a code from a stranger. Unknown fields are dropped, every
number is clamped to a sane range, the lists are capped, text is stripped of
anything unprintable, an objective pointing at a crate that is not there is
discarded, and a code that decompresses to something enormous is refused
before it is parsed. The format is versioned (`LEVEL_FORMAT`, currently 1) so
a code made today can still be read when it is not.

Levels you build or are sent sit on the Challenges screen under **Made by
you**, after the campaign and unnumbered. They are marked *Yours*, they are
not part of the campaign's difficulty ramp, and solving one does not move the
campaign's solved count — it is your problem, not one of ours.

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

Drive mode swaps the steering round while you are reversing, so left is still
left from where the driver is sitting.

It also **backs the throttle off while you steer**, rather than adding steer
to a full throttle and clamping. Clamping does not steer: the outside wheel
saturates and the inside one is only brought to a standstill, which on a
machine already moving is a wheel being dragged. Leaving room for a real
difference lets the inside wheel reverse, which doubles the turn rate and
costs some speed through the corner — which is what every vehicle does.
Holding the steer key on its own still pivots on the spot.

A **turntable** is a motorised bearing: it joins two things and turns one
against the other, with no end stops, so you can stand a boom on it and swing
it round. Both its speed and its torque are set per part. Torque buys spin-up
rather than top speed — a level boom on an upright axis has no gravity pulling
back — and the range runs from 12 Nm, which stalls a loaded boom outright, to
1800, which is instant. That span is what takes the same part from nudging a
flap to throwing something.

A **coupling** holds like a weld until you fire it, and then is not there at
all. It is the two-stage rocket part: build a booster, a coupling, and an upper
stage, and `B` throws the halves apart. How hard it throws is set on the coupling,
and the bottom of that range is **nothing at all** — if you have built your own
push, a thruster on the stage or a piston underneath, the coupling should do
nothing but let go and a floor above zero would only fight you. One shot per
run — once the joint is
gone there is nothing left to re-make it from, which is what makes it a
coupling rather than a clamp. It reports whether it has gone yet, so a program
can wait for the stage to clear before lighting the next motor instead of
counting seconds and hoping.

A piston's **reach** is set on the piston, anywhere from 0.4 m to 2.4 m, so a
short jab and a long lift can sit on the same machine.

Every part that has to be aimed says which way it is facing: an arrow along
the working axis, amber for something the part does to the world and cyan for
something it reads from it. A hinge has no direction, it has a plane, so it
gets a ring instead. A wheel gets the way it will **drive you**, not its axle
— a ring round a wheel looks exactly like the wheel — and that accounts for
the handedness, so both sides of a rover point the same way. They show in the studio
only.

Placing a part the wrong way round is the commonest mistake there is, so the
**Select** panel turns and tips a part that is already down, keeping whatever
is bound to it. `R` and `T` do the same thing before you place.

And the ghost goes **red before you place it** if it would not actually be
held there. Fitting in the grid and being attached are two different
questions: an articulated part joins only on its attach and carry faces, so a
servo hinge lying on its side drops into the grid perfectly happily and then
falls off the moment the run starts. The studio says which part is refusing
and that turning it will fix it. A part placed away from everything is a
different mistake and still allowed — that is somebody starting a second
assembly, and it is reported when the run begins.

The build plate is a datum, not a floor. Wheels, skids and grabbers can hang
underneath; drop the camera below the plate and it fades out of your way.

Designs autosave per challenge and survive a reload.

## The world itself

A level can change `gravity`, the `friction` of the ground or of one surface,
put `wind` volumes across the course, and close the view down with `fog`.

These are the cheapest variety in the game — no new parts, no new objectives,
nothing added to a machine — and between them they re-ask every question the
player has already answered. A rover that works perfectly is useless on ice; a
drone that hovers beautifully is a liability in a crosswind. They apply just as
well to courses that already shipped.

Wind is an **impulse**, not a force, and that is not a detail: a machine clears
its own forces at the top of every update, so a force added by the arena would
be wiped before it did anything. An impulse goes into the velocity and
survives. It still scales with mass, which is the whole point — measured on the
starter rover at 19 kg and the quadcopter at 10.3 kg, a 20 N crosswind drifts
the rover half a metre in three seconds and the drone two and a half. Much past
60 N and everything simply slides away.

## Open world

> **Not offered yet.** The Worlds entry on the title screen says so and explains
> why. Everything below works and is tested; it is switched off behind
> `WORLDS_READY` in `src/ui/frontend.js` until it is good enough to hand
> somebody, and turning it back on is that one line.

The campaign is one level, one machine, one run. Worlds are the other game:
build the place itself, put as many machines in it as you like, and leave them
running.

Three things to be doing, and the point is what does **not** change between
them. The world runs in all three — a city of automated systems that stops
whenever you open the garage is a diorama, not a city — so the mode only
decides where the mouse and the keys go.

| Mode | What a click does |
| --- | --- |
| World | Places or erases a block against whatever you are looking at, or stands a machine there |
| Garage | The same studio as the campaign. The world carries on behind it |
| Play | Takes the controls of the machine you click. Click away to let go |

Blocks are a palette index on a grid, filed into chunks of sixteen cubed. A
chunk is the unit of everything expensive — one instanced mesh per material,
one body carrying a collider per block, one entry in a save — so editing a
block rebuilds that chunk and nothing else. A town of a thousand blocks is
eight chunks, twenty-one draw calls and a third of a millisecond a step.

Machines put down in a world differ from a machine in a challenge in three
ways, all of which had to be built:

- They **collide with each other.** Machine colliders sit in a group that
  never collides with itself, which is what holds one machine together and
  what made two of them ghosts. The group is opened up and a contact filter
  puts back the only exclusion ever wanted.
- They **face where you put them.** The turn goes on the bodies rather than on
  the colliders inside them, so the thrust, the joints, the wheels and the
  core's idea of forward all turn with it.
- They **may sleep.** A challenge machine must never sleep; fifty parked ones
  costing full solver time for ever is another matter.

Worlds are kept in IndexedDB rather than in the one localStorage key
everything else shares: that key is rewritten whole on every autosave and
already carries a thumbnail per machine. Two stores in one transaction — the
world, and a card saying what it is — so listing worlds does not deserialise a
town per row. A world also travels as a `CTPW1` code, the same way a level or a
parts pack does.

### Playing in one together

```
npm run build
npm run host -- --port 7777 --world my-town.json
```

Everybody else opens `http://<that machine>:7777/` and presses **Join
somebody's world**. A browser cannot listen on a port, so hosting is a small
Node process; it also serves the built game, so whoever joins is running the
host's build rather than whatever their tab had open.

The host runs the same `WorldSession` the browser runs, headless. That is the
whole design rather than an economy: there is one simulation in this codebase
and both ends run it, so a machine cannot behave one way for the person driving
it and another way for everybody watching.

Rapier is not deterministic across machines, and the host and the browser do
not even run the same wasm build, so this cannot be lockstep on inputs. It is:
everybody simulates, the host is the truth, and the truth goes out twenty times
a second as a packed buffer. Control traffic — joining, deploying, editing a
block — is JSON, because it is rare and changes shape every time a feature
lands. Everything a client does to the world is a request: it places the block
when the host says so, which is what stops four people each being sure they are
right.

Who may build is the world's own setting, and it is a button in the bar:
**Only me** means the owner is the only one who can place a block or put a
machine down; **Anyone builds** opens it to everybody. Only the owner can move
that switch — otherwise an open world could never be closed again by the person
who opened it. Either way anybody can drive, no two people can drive the same
machine, and the fleet list says by name who is in what.

### Making it feel instant

Putting every body exactly where the host last said it was is correct and
horrible: on a hundred-millisecond link the machine answers the accelerator a
tenth of a second late and then jerks twenty times a second as it is dragged
back. Three things take that away, in order of how much they matter.

**Velocity, not just position.** The snapshot carries how each body is moving.
A client fed that carries on under its own physics between snapshots and
arrives at nearly the right place by itself. Without it, a machine somebody
else is driving has no local reason to move at all.

**Lead.** What arrived is where things were half a round trip ago. The round
trip is measured, not guessed, and each body is carried forward by it — so what
you see is where things are now, not where they were.

**A gentle blend.** Whatever error is left is closed over several snapshots, so
a correction is a drift rather than a jump. The machine in your hands gets the
gentlest blend of all, because a correction you feel through the controls is
much worse than one you only see. Past three metres it is not drift, it is
somewhere else, and it is put where it belongs in one step.

`tests/laglink.js` runs both ends in one process over a link that delays,
jitters and stalls on purpose, with the clock turned by hand, so the numbers
repeat. On 100 ms each way with 40 ms of jitter and a 5 % retransmit rate:

| | put where the host said | with all of the above |
| --- | --- | --- |
| watching somebody drive | 0.43 m out, 1.31 m shifted at once | 0.20 m out, 0.19 m |
| driving it yourself | 0.41 m out, 0.49 m shifted at once | 0.19 m out, 0.15 m |

Better on both counts at once, which a smoothing does not usually buy — it is
the velocity and the lead that do it, and the blending only has to tidy up.

What is sent is trimmed to match. A rotation goes as its three smallest parts
and two bits saying which was left out: seven bytes instead of sixteen, and
four thousandths of a degree of error. Velocities go as sixteenths. A machine
whose bodies are all asleep is not sent at all beyond one restatement a second,
and neither is one more than 180 m from where you are looking — so a city
standing still costs almost nothing, and forty machines all moving at once come
to 7.6 KB a tick.

### Whether it holds up

The target was a town of five thousand blocks with forty machines in it and
four people connected, at sixty frames a second. Measured:

| | |
| --- | --- |
| 5000 blocks, nothing moving | 0.007 ms a step, 30 chunks |
| 40 machines parked | 0.05 ms a step, 39 of 40 asleep |
| 40 machines all driving, town and all | 2.3 ms a step |
| host tick, 4 players, 40 driving | 1.0 ms, 31 KB/s each |

And pushing past the format's cap of sixty-four machines, to find where the
simulation itself gives up rather than where the format says to stop:

| machines | bodies | a step | of a frame |
| ---: | ---: | ---: | ---: |
| 64 | 320 | 2.0 ms | 12 % |
| 100 | 500 | 3.2 ms | 19 % |
| 150 | 750 | 7.1 ms | 43 % |
| 220 | 1100 | 13.5 ms | 81 % |
| 300 | 1500 | 17.9 ms | 107 % |

So what breaks first is the cap, and it breaks with about four times the
headroom still in hand — a number to raise when somebody wants it raised,
rather than a wall.

## Sound

Every audio file is **CC0** — Kenney's [Interface Sounds](https://kenney.nl/assets/interface-sounds)
and [Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) packs. That means
it can ship in a paid game with no attribution and no licence screen.
`public/audio/LICENCE.md` records which file came from where, what each one is
used for, and the terms, so the provenance is in the repo rather than in
somebody's memory. Keep to CC0 when adding more: CC-BY would mean shipping an
attribution screen, and a non-commercial licence cannot go on a storefront at
all.

The machines are electric, so the engine clips are **looped and re-pitched
rather than triggered**: the playback rate of the drive and rotor loops
follows the shaft speed the sim is actually turning at, so a motor spinning up
sounds like a motor spinning up. `sim/audio-mix.js` turns machine state into
levels and rates and is plain arithmetic under test; `ui/audio.js` loads the
files and plays them.

Many sources of the same kind sum as energy rather than as amplitude and pass
through a soft knee, so four rotors are about twice as loud as one rather than
four times, and forty never pin the output.

Sound has its own setting — full, low or off — and it is remembered.

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

## Obstacles that move

Challenge 7 is a corridor with three blockers sliding across it, and each one
draws its speed, its starting point and its direction fresh at the start of
every run. There is no timetable to learn and no path worth memorising: a
program has to look where it is going. The seed is recorded, so a run that
went wrong can be set up again exactly.

Each obstacle is a **gate**: two panels sliding together, holding a six-metre
gap between them. Getting that shape right took a few goes. A single sliding
blocker sounds simpler, but every gap it leaves is jammed against a wall, so
the only way past is to hug one — which fails a no-contact run and looks
terrible while it does it. Narrow blockers in a wide corridor have the opposite
problem: the middle is clear most of the time and a machine sails through on
luck rather than on looking. A gate puts the gap out in open corridor and sends
it wandering, so the way through is somewhere new every run and never against a
wall.

The level also sets `noContact`, so **touching anything ends the run**. Parts of
the same machine touching each other do not count, so a rover's wheels on the
ground are fine on levels that allow it.

Seeing is what a distance sensor is for, and it can be **aimed** off its
mounting. One beam down the nose tells you something is there; a whisker angled
out each side tells you which way is clearer, which is what you actually need
in order to go round it. The flight controller also takes a **strafe** command,
so a machine can slide sideways without turning and keep its whiskers pointed
where it is going.

The **Dodger** preset solves it — cleanly, on 148 of 150 different worlds — and
its program is worth reading. Along the
corridor and across it are each a proportional-derivative pair — lean on how
far there is to go, lean back on how fast you are already moving — and only one
term in the whole graph knows about obstacles: how much more crowded one
whisker is than the other. Weighing both sides up balances out exactly in front
of something wide and leaves the machine sitting there arguing with itself, so
a pair of states takes over when the way ahead is shut, each having already
picked which way it is going and not about to reconsider. That is the state
machine earning its keep.

Three things mattered for flying it clean.

The **stand-off** has to be a speed, not a distance. Leaning on how much room
is left ahead, with no speed term in it, cannot brake — by the time the
stand-off is reached the machine still has all its momentum and coasts into
whatever it was standing off from. Room ahead sets a speed it is allowed to do,
and the gap between that and the speed it is doing sets the lean. Same shape as
the drive term and the altitude loop.

**Beams have to be narrower than the gap they are checking.** The guards either
side of the nose say whether the way ahead is clear; swept too wide they clip
the edges of a six-metre gap from a stand-off away and it never reads clear at
all. The wide whiskers do the opposite job — they reach far enough out to the
side to find a gap that is not ahead yet, which a narrow beam never sees.

And **steering for the destination has to give way to what is in front**. The
way through a gate is rarely on the line to the pad, so a machine that keeps
pulling back toward that line will find the gap, get dragged off it again and
clip an edge on the way out. Asking the nose beam whether it is clear is no
good either: it reads clear exactly when the machine is lined up on the gap,
which is the worst possible moment to start pulling away. The wide whiskers
still have the panels in view, so they are what tells the difference between
open corridor and the middle of a gate.

## Turning things round

A blueprint part has one of the 24 axis-aligned rotations, and every turn is
about a **world** axis — so a key means the same thing whatever the part is
already doing, rather than something different depending on what you pressed
last.

There are three turn keys because a cube has three axes, and **Shift** goes the
other way. There used to be two, which is what made rotating things feel like
guesswork:

| | mean presses from square on | worst | one press away |
| --- | ---: | ---: | ---: |
| two axes | 3.08 | 5 | 2 of 24 |
| two axes + reverse | 2.17 | 4 | 4 |
| three axes | 2.50 | 4 | 3 |
| **three axes + reverse** | **1.92** | **3** | **6** |

Two keys do reach all 24 — the problem was never reachability. It was that
there is no route you can plan with them, so you press and look, press and
look.

Better still: almost every part that cares about rotation cares about *one*
direction — which way a thruster pushes, a wheel drives, a sensor looks, a
grabber faces, a ram extends, a rail runs. So the inspector has six buttons —
**Forward, Back, Left, Right, Up, Down** — that say it outright and work the
rotation out. Of the four turns that all point the right way it picks the one
nearest where the part already is, so the rest of it does not spin for no
reason. Pointing a thruster down is one click, not a search.

| | |
| --- | --- |
| `R` | turn it round (about up) |
| `T` | tip it forward (about across) |
| `Y` | roll it onto its side (about forward) |
| `Shift` + any | the other way |

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

A prop marked `magnetic` is one the level means you to pick up with the Magnet
Grabber, and it is edged in amber so you can tell it from scenery. It is a
label, not a rule — every prop in the game can be picked up.

### Rails and dollies

A **Rail** is plain structure: lay as many end to end as you like, in any
direction, and they fuse into the machine like any other block. A **Rail Dolly**
stands on one and runs along it, and whatever you bolt on top of the dolly
rides with it.

The dolly does not carry its own travel the way a piston carries a stroke. It
reads the track underneath it, so how far it runs is a fact about the machine —
lay more rail and it goes further, which is the whole reason to build a gantry
out of parts instead of setting a slider. It takes its *direction* from the
rail too: a dolly turned one way on a rail turned another would simply refuse
to move with nothing on screen to say why, so the rail decides and the dolly
follows.

Both colliders are full cells, so the railhead is drawn at the very top of the
rail's cell and the dolly's rollers at the very bottom of its own — otherwise
the carriage hangs a third of a metre in the air above a track it is in fact
sitting on, which is what the first version did.

It is a prismatic joint, which has one degree of freedom and no rotation at
all, so a loaded gantry does not sway — measured at 6 mm of wander with a
two-block boom on it, over five and a half metres of travel.

The ends are the interesting part. Rail that stops in mid air is an **open
end**: fly at it and the dolly goes over the buffers and carries on under its
own momentum, which is what a runaway gantry does. Put anything at all in the
cell past the last sleeper and that end is a stop instead.

Three things have to be true before it lets go, and the third is the one that
matters: the end is open, it is doing more than 2 m/s, and **it is being
driven that way**. Without that last part a dolly on a vertical rail throws
itself on the floor for standing still — gravity walks it down the mast, it
arrives at the bottom with some speed on, and off it goes. Flying off the end
is something you do on purpose. Drive gently into an open end and it stops
there like anything else.

A dolly left alone holds where it is, load and all — it targets a position
rather than a speed of zero, because a velocity motor's second argument in
Rapier is a damping coefficient and not a maximum force, so aiming at zero
speed under a steady load settles at a slow creep rather than stopping. On a
vertical rail that was a hoist lowering its own load: over a metre in six
seconds, against four millimetres now. Select the dolly and the studio draws the run — `5.5 m of rail,
stopped to open · 2.4 m/s` — so you know which ends will catch you before you
find out.

### Speed, torque, and what they cost

A motor has two numbers and they are not the same question. **Speed** is how
fast it will go. **Torque** is whether it will go at all with something heavy
in the way. There used to be one slider called Power that scaled speed, and
only ever downwards — so a wheel shoved a sixty-kilo crate thirteen
centimetres in ten seconds, and a nozzle made 55 N against a ballast block that
weighs 80, which is why nobody could build a rocket that carried anything.

Both wind a long way up now, and the defaults are unchanged, so nothing already
built behaves differently.

| | rated | wound right up |
| --- | --- | --- |
| wheel, top speed | 4.5 m/s (16 km/h) | 19.5 m/s (70 km/h) |
| wheel, 60 kg crate in 12 s | 0.3 m | 22 m |
| one nozzle | 55 N | 440 N — lifts 45 kg |
| rocket carrying 8 kg | does not leave the ground | 520 m at 164 m/s |
| rocket carrying 40 kg | — | 172 m at 54 m/s |

What stops that being free is the budget. **Power is torque times speed, so
that is exactly what it costs**: a wheel at three times the speed and four
times the torque is twelve times the wheel, and the inspector says so on the
slider — *33 rad/s · 88 Nm, costs 36, not 3*. A six-wheeler at the top of both
ranges costs 609, and the largest budget in the game is 240. So the daft end of
the range lives in fun mode, where there is no budget to spend.

Torque runs into grip in the end. Past what the tyres will hold, more of it
only spins them — which is the honest answer to "why will it not push", and the
answer is ballast. Both halves are measured in `tests/power.test.js`.

### Getting up things

A powered wheel stops at a step about half its own radius — measured, 0.4 m on
a 0.42 m wheel — and no amount of ballast changes that, because a step taller
than the axle is a wall to push at rather than a rise to roll up. Weight buys
grip, and grip was never the problem.

So there is a second wheel. The **All-Terrain Wheel** is three cells across its
face where a powered wheel is one, and it carries five times the torque,
because what lifts a machine over a step is the strength to raise its own
weight onto the edge.

| | powered | all-terrain |
| --- | --- | --- |
| step it gets over | 0.4 m | 1.0 m |
| flat out | 4.1 m/s | 4.2 m/s |
| cost | 3 | 9 |
| weight | 1.4 kg | 3.4 kg |
| cells | 1 | 9 |

It is not free. Nine cells a wheel is a design constraint you can see, and two
of them on one side cannot sit closer than four cells apart — which makes for a
long wheelbase, and a long wheelbase is what makes skid steering hard. The
wheel is not what costs you there, though: a powered wheel on the same chassis
pivots at 2°/s, and this one manages 15.

The teeth are not decoration. The collider is drawn at the lug tips and the
carcass inside it, so what bites a step edge on screen is the radius that bites
it in the solver — and a test walks every tooth and checks it points outwards,
because the first version had twelve of the fourteen mirrored.

### Seeing what a part will do

Every moving part carries a range: a hinge's limits, a servo's two angles, a
ram's stroke, a strut's travel, a grabber's reach. All of that used to be a
number in a panel, and a number does not answer the question anybody is asking,
which is *will the arm clear the load*. You found out by pressing Play.

Select a part now and it draws its own envelope on the plate — the arc a joint
will sweep, the circle a turntable will turn, the line a ram will travel, the
reach of a grabber or a sensor. The radius is measured off whatever is actually
bolted to the far side of the joint, so a long arm draws a long arc and the
question is answered by looking. Drag the angle slider and the arc follows it.
The inspector says the same thing in words — `-35° to 110°`, `Pushes out
1.80 m` — marked in the same cyan the envelope is drawn in, so the sentence and
the shape read as one statement.

A part that adds a capability must not delete a puzzle, either. Fifteen levels
have scenery in the band the all-terrain wheel opened up — a kerb, a loading
bay, the lip of a quarry — and `tests/no-free-lunch.test.js` drives the dumbest
machine each one's budget allows straight at it, on both wheels, and fails if
any of them is finished by holding W that was not before. None is.

## Layout

```
src/core/        orientation maths, the blueprint grid, keyboard input
src/parts/       part registry (mass, cost, joints, actuators) and meshes
src/sim/         connectivity, body grouping, signal bus, machine, arena,
                 flight controller, program graph, computer runtime
src/studio/      build mode: picking, ghost preview, undo, presets
src/challenges/  levels, objective tracking, the portable level format
                 and the levels a player has built
src/world/       the open world: chunked block store, portable world format,
                 instanced terrain, block editor, the session that runs it,
                 IndexedDB world store
src/net/         the wire: message shapes, packed snapshots, the client
server/          the host: a headless authoritative world that also serves
                 the built game
src/ui/          design tokens, front end (title, challenges, garage, worlds,
                 build, settings), save store, thumbnail renderer, palette,
                 inspector, objectives, win card, node editor, level builder,
                 open-world chrome
```

## Tests

`npm test` runs 1385 tests. The pure logic (orientations, grid placement, body
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

The piston tests check both halves of what a piston is: it pushes as far as it
is set to and no further, and its foot stays planted on the base while the
part itself rides up — a piston whose rod does not follow it leaves a gap of
open air and looks broken however well it works.

`tests/avoidance.test.js` solves challenge 7 hands-off across ten different
seeds — ten different worlds, since a program that had memorised a path would
only ever get through the one it was written for — and checks that it flies
every one of them **without touching anything**, going round the blockers
rather than down the middle, by a different path each time. It also checks the opposite: blind the forward sensor and
the same machine never finishes.

`tests/format.test.js` and `tests/builder.test.js` cover the portable level
format and the editor's own logic. The format is tested chiefly on what it
does with rubbish: a share code that is truncated, is not a code at all, or
decompresses to something enormous, and a level whose numbers are nonsense or
whose objectives point at nothing. The builder tests assemble a level a piece
at a time the way clicking would, and check it survives — that every tool makes
something the format accepts unchanged, that removing a crate takes the
objectives that needed it, that a level comes back from a share code identical,
and that a level somebody built stays out of the campaign's tally however many
times it is solved.

`tests/progress.test.js` covers the save store on its own — designs kept apart
per challenge, best times that a slower later run cannot overwrite, the garage,
and settings — including what happens when the browser refuses storage
altogether.

`tests/level.test.js` plays challenge 1 from start to finish with a scripted
driver, and flies challenge 4 with a drone that picks the payload up and puts
it on the platform. Both assert the objective actually completes.

Every physics world, in the game and in the tests, is made by `createWorld` in
`sim/world.js`, so a solver setting the game uses is always a setting the tests
are checking.

`npm run lint` exists for one rule, `no-undef`. A missing import is not a
syntax error and not a test failure: the bundle builds happily around a name
that is not there, the suite passes because nothing loads the entry point, and
the first thing to find out is somebody opening the site. That shipped once. That file carries the measurements behind the one setting that is
not a Rapier default.

Four conventions are worth stating because getting them wrong cost real bugs.
Forward is **+Z** and up is **+Y**, so the machine's right-hand side is
`forward x up` = **-X** — steering felt inverted until that was fixed. And
Rapier's `addForceAtPoint` records a force *and* the `r x F` torque, which are
cleared by **separate** calls: `resetForces` alone left the torque to
accumulate, and a single off-centre thruster would wind a machine up until it
threw itself off the floor. Lastly, leaning a machine accelerates it the way it
leans, so braking sideways drift means rolling **away** from it; that sign
inverted made the controller feed drift instead of killing it, and a drone that
so much as turned would accelerate away and never stop. Lastly, ground speed is
a magnitude: it cannot tell approaching from leaving, so a controller holding an
approach on it will happily fly backwards at exactly the right speed. That is
what the closing-speed node is for.

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

## Parts packs

Anybody can add parts without writing code. A pack is JSON: a name, and a list
of parts that each pick one of the game's eight behaviours and supply their own
numbers — which is enough to rebuild every part the game ships, and a good deal
it does not. Main menu → **Parts**. The editor shows what the game made of the
pack as you type, every number as it will really be used, and a `CTPK1…` code
sends it to somebody else.

Nothing in a pack runs. It cannot bring a mesh or a ninth behaviour, it cannot
shadow a shipped part, and it does not get out of a level's bans — those read a
part's behaviour rather than its name, so a pack rotor is flight because it
pushes. A run using pack parts is played and won as normal but is not recorded,
the same line custom levels are on.

The format, field by field, is in [docs/PARTS-PACKS.md](docs/PARTS-PACKS.md).

## Adding to it

A new part is one entry in `src/parts/registry.js` plus an optional mesh
builder in `src/parts/geometry.js`. A new challenge is one entry in
`src/challenges/levels.js`: static `pieces`, dynamic `props`, trigger `zones`,
and `objectives` that reference them. Objective types live in
`src/challenges/objectives.js` — there are three, and adding a fourth is a
single function.
