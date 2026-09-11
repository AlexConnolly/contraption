# Test plan

## Automated (vitest) — pure logic, no DOM, no WASM

| Area | What is proven |
|---|---|
| `orientation` | The 24 axis-aligned rotations are unique, each is a proper rotation (det = +1), and rotating a direction twice equals rotating by the composed orientation. |
| `blueprint` | Placement rejects overlaps and out-of-bounds cells; removal frees cells; multi-cell parts claim every cell they cover; serialise → deserialise is lossless. |
| `connectivity` | Face-adjacent parts connect only through faces both sides mark attachable; a wheel connects on its axle face alone. |
| `grouping` | Rigid parts fuse into one body; an articulated part becomes its own body jointed to its host; a structure split by a hinge yields two bodies; orphaned parts are reported. |
| `signals` | Axis, hold and toggle bindings resolve to the right value; a sensor-driven binding follows its source; unbound actuators read zero. |
| `challenge` | Objective evaluation completes only after the hold time elapses; a failed objective resets its timer; budgets reject oversized builds. |
| `flight/mixer` | Each thruster's authority per channel follows from where it sits and which way it points: upward rotors all lift, front and rear oppose in pitch, diagonals oppose in yaw through reaction torque, a lone centred rotor has lift and yaw but nothing else, and a forward-facing jet counts as pitch rather than lift. |
| `program/graph` | Nodes evaluate only after what feeds them; a cycle is reported rather than run; every node kind produces the right value; a state hands over on a `Go to` and its timer restarts; validation catches a kind mismatch, a missing part and a dangling transition. |
| `movers` | Obstacles draw a different speed and start point per seed, reproduce exactly for a repeated seed, redraw on reset, and can never slide far enough to seal the course or to pin a machine against a wall. |
| `avoidance` | The traffic challenge is solved hands-off across ten different seeds, going round the blockers rather than down the middle, by a different path each time, with clearance to spare; and it is **not** solved when the forward sensor is made blind. |
| `computer` | Module reads come off the running machine; writes are clamped to the port's range; a program drives actuators directly, and drives the flight controller by naming a height. |
| `flight/loops` | Hover throttle matches weight over available lift; sinking adds throttle and rising removes it; a banked machine asks for more; the climb key drags the held altitude with it; the controller leans against drift and **away** from sideways drift; zero lift authority asks for nothing; every mixed throttle stays in range. |

## Manual (browser)

1. Studio places, rotates and deletes parts on the grid; ghost preview tracks the cursor.
2. Undo/redo restores exact blueprint state.
3. Test mode builds the machine at the spawn point without exploding or sinking.
4. W/S drives wheels forward and back; A/D steers; the binding panel rebinds a key and the new key works.
5. A hinge arm raises and lowers under its bound key; a piston extends and retracts.
6. A propeller machine generates lift and can be throttled.
7. A grabber picks up the brick, carries it, and releases it.
8. A distance sensor drives a motor without a key press.
9. Challenge 1 completes and shows the win panel; the timer and part count are reported.
10. A quadcopter wired to a flight controller lifts off, holds height hands-off, flies on WASD and climbs on Space/Shift; after a hard shove or a long turning run it comes back to level and stops.
11. The node editor opens from a Computer, lays out with Tidy, and wires only between sockets of the same kind; a link into an occupied input replaces it.
12. Challenge 6 completes with every key held down and ignored.
13. Challenge 7 completes hands-off several times running, with visibly different obstacle timing and finishing times each run.
14. Save, reload the page, and load the design back unchanged.
