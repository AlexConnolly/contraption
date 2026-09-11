import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Arena } from '../src/sim/arena.js';
import { Machine } from '../src/sim/machine.js';
import { SignalBus } from '../src/sim/signals.js';
import { createWorld } from '../src/sim/world.js';
import { Blueprint } from '../src/core/blueprint.js';
import { IDENTITY_ORIENTATION, yawStep } from '../src/core/orientation.js';
import { starterRover } from '../src/studio/presets.js';
import { GROUND } from '../src/challenges/packs/ground.js';
import { tierOf } from '../src/challenges/levels.js';

const STEP = 1 / 60;

function keyboard(...codes) {
  const down = new Set(codes);
  return { down, isDown: (c) => down.has(c), wasPressed: () => false };
}

beforeAll(async () => { await RAPIER.init(); }, 30000);

const byId = (id) => GROUND.find((level) => level.id === id);

function stage(level, { blueprint = null, seed = 4, spawn = null } = {}) {
  const world = createWorld(RAPIER, { x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  const arena = new Arena({ RAPIER, world, scene, level, seed });
  const machine = blueprint
    ? new Machine({
      RAPIER,
      world,
      scene,
      blueprint,
      level,
      spawn: new THREE.Vector3(...(spawn ?? level.spawn)),
    })
    : null;
  return { world, scene, arena, machine, bus: new SignalBus(keyboard()) };
}

function run({ world, arena, machine, bus }, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    arena.step(STEP);
    if (machine) machine.update(STEP, bus);
    world.step();
  }
}

// ---------------------------------------------------------------- structure

const box = (pos, size) => ({
  min: [pos[0] - size[0] / 2, pos[1] - size[1] / 2, pos[2] - size[2] / 2],
  max: [pos[0] + size[0] / 2, pos[1] + size[1] / 2, pos[2] + size[2] / 2],
});

const overlaps = (a, b, slack = 0) => [0, 1, 2].every(
  (i) => a.min[i] < b.max[i] - slack && a.max[i] > b.min[i] + slack,
);

const propBox = (prop) => box(prop.pos, prop.size ?? [prop.radius * 2, prop.radius * 2, prop.radius * 2]);

describe('the ground pack', () => {
  it('is the ten levels it says it is, every one of them no-flight', () => {
    expect(GROUND).toHaveLength(10);
    for (const level of GROUND) {
      expect(level.bans, level.id).toContain('flight');
    }
  });

  it('gives every level an id nothing else uses', () => {
    const ids = GROUND.map((level) => level.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(GROUND.map((l) => [l.id, l]))('%s is a complete level', (id, level) => {
    expect(tierOf(level), 'tier').toBeTruthy();
    expect(level.budget?.cost, 'budget').toBeGreaterThan(0);
    expect(level.par, 'par').toBeGreaterThan(0);
    expect(level.name, 'name').toBeTruthy();
    expect(level.brief, 'brief').toBeTruthy();
    expect(level.hint, 'hint').toBeTruthy();
    expect(level.objectives.length, 'objectives').toBeGreaterThan(0);
    expect(level.spawn, 'spawn').toHaveLength(3);
  });

  // An objective naming something that is not there never fails and never
  // completes: the level would simply be unwinnable with no sign of why.
  it.each(GROUND.map((l) => [l.id, l]))('%s only asks about things that exist', (id, level) => {
    const zones = new Set((level.zones ?? []).map((z) => z.id));
    const hoops = new Set((level.hoops ?? []).map((h) => h.id));
    const props = new Set((level.props ?? []).map((p) => p.id));
    for (const stack of level.stacks ?? []) {
      for (let i = 0; i < stack.count; i += 1) props.add(`${stack.id}-${i}`);
    }
    for (const objective of level.objectives) {
      if (objective.zone) expect(zones, `${id}: zone ${objective.zone}`).toContain(objective.zone);
      if (objective.hoop) expect(hoops, `${id}: hoop ${objective.hoop}`).toContain(objective.hoop);
      if (objective.prop) expect(props, `${id}: prop ${objective.prop}`).toContain(objective.prop);
      for (const p of objective.props ?? []) expect(props, `${id}: prop ${p}`).toContain(p);
    }
  });

  // A prop started inside a wall is ejected at speed on the first frame, which
  // looks like the physics being broken rather than the level being wrong.
  it.each(GROUND.map((l) => [l.id, l]))('%s starts nothing inside the scenery', (id, level) => {
    for (const prop of level.props ?? []) {
      for (const piece of level.pieces ?? []) {
        expect(
          overlaps(propBox(prop), box(piece.pos, piece.size), 0.02),
          `${id}: ${prop.id} overlaps a piece at ${piece.pos}`,
        ).toBe(false);
      }
    }
  });

  it.each(GROUND.map((l) => [l.id, l]))('%s does not spawn the machine inside anything', (id, level) => {
    const at = box(level.spawn, [2.4, 1.4, 2.4]);
    for (const piece of level.pieces ?? []) {
      expect(
        overlaps(at, box(piece.pos, piece.size)),
        `${id}: spawn sits in a piece at ${piece.pos}`,
      ).toBe(false);
    }
  });

  it.each(GROUND.map((l) => [l.id, l]))('%s puts its goal somewhere reachable, not underground', (id, level) => {
    const floor = level.groundY ?? 0;
    for (const zone of level.zones ?? []) {
      expect(zone.pos[1] + zone.size[1] / 2, `${id}: ${zone.id}`).toBeGreaterThan(floor);
    }
  });
});

// ------------------------------------------------------------------- claims
// Each of these is a level whose whole point is a number. Typing the number
// into the level and then asserting the same number back proves nothing, so
// these run the physics instead.

describe('Letterbox really is too narrow for the starter rover', () => {
  const level = byId('letterbox');

  // The same rover, built thin: one block wide instead of a three-cell panel.
  function narrowRover() {
    const bp = new Blueprint({ name: 'Narrow' });
    const left = yawStep(yawStep(IDENTITY_ORIENTATION));
    for (const z of [0, 1, 2]) bp.place('block', [0, 0, z]);
    bp.place('core', [0, 1, 1]);
    for (const z of [0, 2]) {
      bp.place('wheel', [1, 0, z], IDENTITY_ORIENTATION, {
        binding: { mode: 'drive', pos: 'KeyW', neg: 'KeyS', left: 'KeyA', right: 'KeyD' },
      });
      bp.place('wheel', [-1, 0, z], left, {
        binding: { mode: 'drive', pos: 'KeyW', neg: 'KeyS', left: 'KeyA', right: 'KeyD' },
      });
    }
    return bp;
  }

  // Started past the crate and pointed at the gap, so this measures whether
  // the machine fits rather than whether it can shove a box.
  function driveAtTheSlot(blueprint) {
    const rig = stage(level, { blueprint, spawn: [0, 1.2, 3] });
    run(rig, 1);
    rig.bus.input.down.add('KeyW');
    run(rig, 8);
    return rig.machine.corePosition().z;
  }

  it('stops the starter rover at the wall', () => {
    // The wall stands at z = 7; anything short of it never got through.
    expect(driveAtTheSlot(starterRover())).toBeLessThan(6.5);
  });

  it('lets a machine built narrow enough straight through', () => {
    expect(driveAtTheSlot(narrowRover())).toBeGreaterThan(8);
  });
});

describe('Deadweight really does defeat the starter rover', () => {
  const level = byId('deadweight');

  function shove(blueprint) {
    const rig = stage(level, { blueprint });
    run(rig, 1);
    const before = rig.arena.propPosition('crate').z;
    rig.bus.input.down.add('KeyW');
    run(rig, 8);
    return rig.arena.propPosition('crate').z - before;
  }

  it('barely moves for a machine with no weight over its wheels', () => {
    expect(shove(starterRover())).toBeLessThan(2);
  });

  it('moves for a machine that has been ballasted over the driven axle', () => {
    const bp = starterRover();
    // Four more ballast blocks, sat over the wheels rather than out on the nose.
    for (const cell of [[1, 1, 1], [-1, 1, 1], [1, 1, -1], [-1, 1, -1]]) {
      bp.place('ballast', cell);
    }
    expect(shove(bp)).toBeGreaterThan(3);
  });
});

describe('Seesaw really is a seesaw', () => {
  const level = byId('seesaw');

  it('sits level when nothing is on it', () => {
    const rig = stage(level);
    run(rig, 2.5);
    const plank = rig.arena.props.get('plank').body;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      new THREE.Quaternion(plank.rotation().x, plank.rotation().y, plank.rotation().z, plank.rotation().w),
    );
    expect(up.y).toBeGreaterThan(0.995);
  });

  it('still reaches both sides once it has settled', () => {
    const rig = stage(level);
    run(rig, 2.5);
    const at = rig.arena.propPosition('plank');
    // Half of an 8.4 m plank either side of the pivot, overhanging the ledge
    // that ends at z = 0 and the one that starts at z = 4.
    expect(at.z + 4.2).toBeGreaterThan(4.8);
    expect(at.z - 4.2).toBeLessThan(-0.8);
  });

  it('tips as soon as weight goes on one end of it', () => {
    const rig = stage(level);
    run(rig, 2.5);
    const plank = rig.arena.props.get('plank').body;
    plank.applyImpulseAtPoint({ x: 0, y: -400, z: 0 }, { x: 0, y: 2.2, z: 5.5 }, true);
    run(rig, 1.2);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      new THREE.Quaternion(plank.rotation().x, plank.rotation().y, plank.rotation().z, plank.rotation().w),
    );
    expect(up.y).toBeLessThan(0.97);
  });
});

describe('Jenga really is a crossing', () => {
  const level = byId('jenga');
  const planks = ['plank-a', 'plank-b', 'plank-c', 'plank-d', 'plank-e'];

  it('leaves every plank bridging the gap when nothing has touched them', () => {
    const rig = stage(level);
    run(rig, 2.5);
    for (const id of planks) {
      const at = rig.arena.propPosition(id);
      // Still up at ledge height rather than down on the floor eight metres
      // below, and still lying across the gap.
      expect(at.y, id).toBeGreaterThan(1.9);
      expect(at.z, id).toBeGreaterThan(0.5);
      expect(at.z, id).toBeLessThan(2.5);
    }
  });

  it('is loose, so driving over it moves it', () => {
    const rig = stage(level, { blueprint: starterRover() });
    run(rig, 1);
    const before = planks.map((id) => rig.arena.propPosition(id).clone());
    rig.bus.input.down.add('KeyW');
    run(rig, 5);
    const shifted = planks.some(
      (id, i) => rig.arena.propPosition(id).distanceTo(before[i]) > 0.05,
    );
    expect(shifted).toBe(true);
  });
});

describe('Roundabout really carries its payload', () => {
  const level = byId('roundabout');

  it('keeps the payload in the tray rather than shedding it', () => {
    const rig = stage(level);
    run(rig, 12);
    const at = rig.arena.propPosition('payload');
    expect(at.y).toBeGreaterThan(1);
    expect(Math.abs(at.z - 7)).toBeLessThan(2.5);
  });

  it('actually moves it, so sitting still and waiting is the answer', () => {
    const rig = stage(level);
    run(rig, 1);
    const start = rig.arena.propPosition('payload').x;
    let travelled = 0;
    for (let i = 0; i < Math.round(10 / STEP); i += 1) {
      rig.arena.step(STEP);
      rig.world.step();
      travelled = Math.max(travelled, Math.abs(rig.arena.propPosition('payload').x - start));
    }
    expect(travelled).toBeGreaterThan(2);
  });
});

describe('Shunt really is a pushing problem', () => {
  const level = byId('shunt');

  it('leaves the ball on the ground rather than through it', () => {
    const rig = stage(level);
    run(rig, 3);
    const at = rig.arena.propPosition('ball');
    expect(at.y).toBeGreaterThan(1.1);
    expect(at.y).toBeLessThan(1.7);
  });

  it('is far too heavy for a machine to simply carry off', () => {
    const rig = stage(level);
    expect(rig.arena.props.get('ball').body.mass()).toBeGreaterThan(30);
  });

  it('rolls rather than skids when it is shoved', () => {
    const rig = stage(level);
    run(rig, 1.5);
    rig.arena.props.get('ball').body.setLinvel({ x: 0, y: 0, z: 5 }, true);
    run(rig, 1.5);
    expect(Math.abs(rig.arena.props.get('ball').body.angvel().x)).toBeGreaterThan(1);
  });
});

describe('Sunday League has a goal a ball can stay in', () => {
  const level = byId('sunday-league');

  it('holds a ball that has been put in the net', () => {
    const rig = stage(level);
    const ball = rig.arena.props.get('ball').body;
    ball.setTranslation({ x: 0, y: 1.4, z: 20.6 }, true);
    ball.setLinvel({ x: 0, y: 0, z: 4 }, true);
    run(rig, 3);
    const at = rig.arena.propPosition('ball');
    expect(at.z).toBeGreaterThan(19);
    expect(at.z).toBeLessThan(22);
  });

  it('has a keeper that actually moves across the mouth', () => {
    const rig = stage(level);
    const keeper = rig.arena.movers[0];
    const seen = new Set();
    for (let i = 0; i < Math.round(14 / STEP); i += 1) {
      rig.arena.step(STEP);
      rig.world.step();
      seen.add(Math.round(keeper.body.translation().x));
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});

/**
 * The two crossings are the levels most at risk of being a hole rather than a
 * puzzle: if a plain rover cannot get over them at all, nobody can, and the
 * structural checks above would not notice. A stock starter rover clears both,
 * which is the floor — anything a player builds should do at least as well.
 */
describe('the crossings can actually be crossed', () => {
  function driveAcross(id) {
    const level = byId(id);
    const rig = stage(level, { blueprint: starterRover() });
    run(rig, 1.5);
    rig.bus.input.down.add('KeyW');
    let lowest = Infinity;
    for (let i = 0; i < Math.round(6 / STEP); i += 1) {
      rig.arena.step(STEP);
      rig.machine.update(STEP, rig.bus);
      rig.world.step();
      lowest = Math.min(lowest, rig.machine.corePosition().y);
    }
    return { at: rig.machine.corePosition(), lowest, flipped: rig.machine.isUpsideDown() };
  }

  it('gets a stock rover over the seesaw without dropping it in the gap', () => {
    const { at, lowest, flipped } = driveAcross('seesaw');
    expect(at.z).toBeGreaterThan(6);
    expect(lowest).toBeGreaterThan(2);
    expect(flipped).toBe(false);
  });

  it('gets a stock rover over the planks without dropping it in the gap', () => {
    const { at, lowest, flipped } = driveAcross('jenga');
    expect(at.z).toBeGreaterThan(5);
    expect(lowest).toBeGreaterThan(1.5);
    expect(flipped).toBe(false);
  });
});
