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
10. Save, reload the page, and load the design back unchanged.
