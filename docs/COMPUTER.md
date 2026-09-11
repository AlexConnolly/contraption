# The computer

A machine can carry a **Computer**. Its program is a node graph, and that graph
*is* the machine's behaviour — there is no separate autopilot underneath it.

## Modules have ports

Every part that can do something, or knows something, exposes typed ports.
Inputs are set by the graph, outputs are read by it:

| Module | Reads | Writes |
|---|---|---|
| GPS | position, velocity, speed, altitude, heading | — |
| Flight Controller | altitude, climb rate, forward/right speed, levelness | pitch, yaw, **strafe**, climb, **target altitude** |
| Powered Wheel | spin rate | throttle |
| Servo Hinge | angle | target angle |
| Piston | extension | target extension |
| Magnet Grabber | holding | active |
| Lift Rotor / Jet Thruster | — | throttle |
| Distance Sensor | distance, tripped | — |

A distance sensor can be aimed off its mounting, swept round the machine's up
axis. A beam down the nose with a whisker angled out each side tells a program
which way is clearer, which a single forward beam cannot.

So the same graph can drive a rotor directly, or hand the flight controller a
height and let it work the throttles out itself.

## States own their loop

A program is a set of **states**. Each state holds its own graph, and that graph
runs every tick while the state is active — that is the state's loop. A `Go to`
node with a true condition hands control to another state; the first one to
fire wins, and the new state's loop takes over on the next tick.

## Node kinds

Values are `number`, `bool` or `vec3`, and links are type-checked.

| Node | Purpose |
|---|---|
| Read / Write | one port on one module |
| Constant | a fixed number, bool or vector |
| Waypoint | the position of a marked zone in the level |
| Vector / Split | build a vector, or take it apart |
| Distance / Bearing | between two positions |
| Closing speed | how fast a velocity is carrying the machine toward a point — signed, so it can tell approaching from leaving |
| Maths | add, subtract, multiply, divide, min, max, abs, clamp |
| Compare | `<`, `<=`, `>`, `>=`, `==`, `!=` |
| Logic | and, or, not |
| Select | pick one of two values on a condition |
| Timer | seconds since this state began |
| Go to | switch state when a condition holds |

The graph is evaluated once per tick in dependency order. A cycle is refused
rather than silently producing a stale value.

## Hands-off challenges

A level can be marked hands-off. The keyboard is ignored for the whole run, so
the machine has to fly itself on the program alone.

## Obstacles that move

A level can carry `movers`: obstacles that slide back and forth across the
course. Each one draws its speed, its starting point and its direction fresh
at the start of every run, so there is no timetable to learn and no path worth
memorising. A program has to look where it is going.

The seed is recorded, so a run that went wrong can be set up again exactly.

A level can also demand a clean run: with `noContact` set, touching anything at
all ends it. Parts of the same machine touching each other do not count.
