# Test plan

## Automated (vitest) — pure logic, no DOM, no WASM

| Area | What is proven |
|---|---|
| `orientation` | The 24 axis-aligned rotations are unique, each is a proper rotation (det = +1), and rotating a direction twice equals rotating by the composed orientation. |
| `blueprint` | Placement rejects overlaps and out-of-bounds cells; removal frees cells; multi-cell parts claim every cell they cover; serialise → deserialise is lossless; parts can go below the build plate, which is a datum rather than a floor, and there is still a floor a long way down; a part already placed can be turned in position, keeps its cells when the new rotation will not fit, and swaps old cells for new when it does. |
| `connectivity` | Face-adjacent parts connect only through faces both sides mark attachable; a wheel connects on its axle face alone. |
| `placement` | A placement that fits the grid but would not be held is refused before it happens, naming whichever side is refusing; plain structure joins on any face; the first part and a part placed away from everything are both allowed; and turning a part in place does not let it hold itself up. |
| `grouping` | Rigid parts fuse into one body; an articulated part becomes its own body jointed to its host; a structure split by a hinge yields two bodies; orphaned parts are reported. |
| `signals` | Axis, hold and toggle bindings resolve to the right value; a sensor-driven binding follows its source; unbound actuators read zero; reversing swaps the steering round, turning on the spot does not, and a real rover swings the other way on the same key while backing up; steering backs the throttle off so the inside wheel reverses rather than merely stopping, both wheels stay in range, a straight line is untouched, and the pair still sums forward so it corners rather than pivots. A real rover comes round at better than 30 deg/s both from a standstill and at speed, and is still doing better than 0.8 m/s while it does. |
| `challenge` | Objective evaluation completes only after the hold time elapses; a failed objective resets its timer; budgets reject oversized builds. |
| `flight/mixer` | Each thruster's authority per channel follows from where it sits and which way it points: upward rotors all lift, front and rear oppose in pitch, diagonals oppose in yaw through reaction torque, a lone centred rotor has lift and yaw but nothing else, and a forward-facing jet counts as pitch rather than lift. |
| `program/graph` | Nodes evaluate only after what feeds them; a cycle is reported rather than run; every node kind produces the right value; a state hands over on a `Go to` and its timer restarts; validation catches a kind mismatch, a missing part and a dangling transition. |
| `movers` | Obstacles draw a different speed and start point per seed, reproduce exactly for a repeated seed, redraw on reset, and can never slide far enough to seal the course or to pin a machine against a wall. |
| `avoidance` | The traffic challenge is solved hands-off across ten different seeds, and **flown clean** on every one of them — no contact at all. It goes round the blockers rather than down the middle, by a different path each time; and it is **not** solved when the forward sensor is made blind. |
| `no contact` | The rule is on for the traffic challenge and off elsewhere; contact is reported when a machine is put where an obstacle is, and never for a machine's own parts touching each other. |
| `computer` | Module reads come off the running machine; writes are clamped to the port's range; a program drives actuators directly, and drives the flight controller by naming a height. |
| `piston` | A piston pushes as far as its own reach setting says and no further; a reach outside the part's range is pulled back to the nearest end; the foot stays planted on the base while the part rides up, so the rod always spans the gap. |
| `tiers` | Skill level follows from what a challenge demands, not from a label: one thing on the ground is easy, several steps or flying is medium, both is hard, and anything that has to run itself is expert whatever else it involves. Every challenge in the game has a tier, only the sandbox has none, and the campaign never gets easier as it goes on. |
| `survey` | The course tour starts where the machine starts, shows what has to move and where it has to end up, never stops twice on the same thing, takes the moving obstacles in as one picture only where there are some, looks along the course rather than down at it, and has somewhere to look on every challenge. |
| `audio` | The mix is silent with nothing running; the motor note follows shaft speed rather than throttle and is the same backwards as forwards; a rotor is pitched by blade passes; a thruster opens up rather than changing note; nothing runs away at any speed; and many sources of one kind get louder without ever pinning the output. |
| `hints` | Every part that has to be aimed reports which way it faces — the grabber at the face it grabs on, a thruster the way it pushes, a sensor down its beam, a wheel the way it will drive you rather than round its own axle, on both sides of a rover alike since the motor is handed — and plain structure reports none. |
| `progress` | Designs are kept apart per challenge; a slower later run cannot overwrite a best time; the best cost is the cost of the run that set the best time; machines saved in the same millisecond get different ids; renaming a machine that is not there is a no-op; storage that throws leaves the game running. |
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
13. Challenge 7 completes hands-off several times running, with visibly different obstacle timing and finishing times each run, and the objectives panel shows the no-contact rule.
14. Blinding the sensors on challenge 7 ends the run with the failure card rather than a win.
15. Save, reload the page, and load the design back unchanged.
16. The game opens on the title screen with the machine turning behind it and the build UI hidden; `Esc` in game returns to it. Nothing is on screen but the logo, the menu, the solved count and the machine — no build arrows, no plate, no key legend.
17. Every challenge card shows a picture of its own course, its budget and par, and the `No input` / `No collisions` rules where they apply; clicking one starts that challenge.
18. Winning a challenge puts a tick and a best time on its card, and the best time only improves.
19. A machine saved to the garage appears with its own picture, opens into the current challenge, renames and deletes.
20. Each setting takes effect as it is pressed and is still set after a reload.
21. The studio, the menus and the node editor share one palette, two typefaces and the same panel shape; no screen still shows the old blue accent or rounded corners.
22. The parts rack shows a picture of each part, and the selected one is marked.
23. Inside a challenge the top bar names it and offers the way back to the list; the way back asks first, and both Stay here and `Esc` leave you where you were.
24. A piston's Reach slider changes how far it pushes on the next run, and the rod spans the gap at every extension rather than leaving open air.
25. Holding left while reversing swings the machine the opposite way to holding left while driving forward.
26. Every challenge card shows a skill level, and the colours ramp green through red down the list.
27. A challenge you have not solved opens with a look round the course; `Build it`, `Esc` or `Space` cuts it short and drops you on the build plate.
28. The `View` tab shows the course with the camera in your hands, the obstacles still moving, and no run clock or respawn control.
29. Winning shows the time as the headline, the machine that set it, and `Play next challenge` goes to the next one and shows its course.
30. Parts that have to be aimed show an arrow in the studio, the hinge shows its swing plane, and none of them appear during a run.
31. A wheel can be bolted under the build plate, and dropping the camera below it fades the plate out of the way.
32. A wheel shows an arrow for the way it drives; the Select panel turns and tips a part that is already placed, keeps its bindings, and refuses with a message when there is no room.
33. Every wheel on a rover points the same way, whichever side of the chassis it is on.
34. A servo hinge turned onto a face that will not attach shows a red ghost and a message naming it, and clicking does nothing; upright on the same cell it is green.
35. Holding W and D together drives the rover round a corner at a useful rate without it stopping to pivot, and D on its own still spins it on the spot.
36. Buttons click, placing and deleting parts sound different from each other, motors rise in pitch as they spin up, and the Sound setting silences all of it.
