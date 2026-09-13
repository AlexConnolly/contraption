import { Blueprint } from '../core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../core/orientation.js';

/**
 * A machine four blocks tall that is nine metres tall once it is switched on.
 *
 * It exists to answer the one question Stacked Loop turns on: whether a cap on
 * what you may *build* actually leaves a way to reach eight metres, or whether
 * it just makes the level impossible. Three pistons stacked take one block of
 * height each on the bench and give back their full stroke each at runtime.
 *
 * It carries nothing and places nothing. What it shows is reach.
 */
export function mast({ stages = 3, stroke = 2.4 } = {}) {
  const bp = new Blueprint({ name: 'Mast' });
  const place = (...args) => {
    const out = bp.place(...args);
    if (!out.ok) throw new Error(`Mast could not place a part: ${out.reason}`);
    return out;
  };
  const facingLeft = yawStep(yawStep(IDENTITY_ORIENTATION));

  // Everything that is not the mast has to share the bottom block, because
  // every block spent on a chassis is a block of stroke given up.
  for (let x = -1; x <= 1; x += 1) {
    for (const z of [-1, 0, 1]) place('block', [x, 0, z]);
  }
  place('core', [2, 0, 0]);
  place('ballast', [-2, 0, 0]);
  for (const z of [-1, 1]) {
    place('wheel', [3, 0, z], IDENTITY_ORIENTATION);
    place('wheel', [-3, 0, z], facingLeft);
  }

  // The mast. Each piston stands on the one below and is set to its longest
  // stroke; the stack of them is three blocks of the four the level allows.
  const rams = [];
  for (let i = 0; i < stages; i += 1) {
    const ram = place('piston', [0, i + 1, 0]);
    bp.setConfig(ram.id, { stroke });
    rams.push(ram.id);
  }
  return { blueprint: bp, rams };
}
