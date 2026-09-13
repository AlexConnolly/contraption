import { firstBanned } from './bans.js';

export function inZone(point, zone) {
  if (!point) return false;
  const [hx, hy, hz] = zone.size.map((n) => n / 2);
  return (
    Math.abs(point.x - zone.pos[0]) <= hx &&
    Math.abs(point.y - zone.pos[1]) <= hy &&
    Math.abs(point.z - zone.pos[2]) <= hz
  );
}

/**
 * How far above a plate something still counts as standing on it.
 *
 * Generous enough that a crate resting on the corner of one is down, mean
 * enough that dangling a crate overhead is not. A plate is a place you put
 * something, not a place you wave it.
 */
const PLATE_REACH = 1.2;

/**
 * The volume a plate reads: its own footprint, and the air just above the
 * slab. No wider than the plate, so a near miss is a miss.
 */
export function plateZone(plate) {
  const [w, h, d] = plate.size ?? [2, 0.3, 2];
  return {
    pos: [plate.pos[0], plate.pos[1] + h / 2 + PLATE_REACH / 2, plate.pos[2]],
    size: [w, PLATE_REACH, d],
  };
}

/**
 * Whether a point is inside any of a level's no-go zones, and which.
 *
 * Airspace counts. Tall stilts and a long arm are the degenerate answer to
 * every "get it up there" problem, and a keep-out that only covered the
 * ground would leave that answer open — which is the whole reason these
 * exist.
 */
export function breached(level, point) {
  if (!point) return null;
  for (const zone of level.keepout ?? []) {
    if (inZone(point, zone)) return zone;
  }
  return null;
}

/**
 * The same question asked of a whole machine rather than of one point.
 *
 * Checking the core alone is not a keep-out at all: park a step outside the
 * line, reach in with a long boom, and the zone stops nothing — which is the
 * first thing anybody tries. Every part is tested, so the arm counts as much
 * as the body does.
 *
 * Part centres rather than part corners, which lets a part overhang the line
 * by up to a quarter of a metre. That is deliberate: clipping the very edge of
 * a zone should not end a run, and the tolerance is far smaller than anything
 * you could exploit.
 */
export function breachedBy(level, machine) {
  if (!machine || (level.keepout ?? []).length === 0) return null;
  for (const placed of machine.blueprint.list()) {
    const zone = breached(level, machine.partWorldPoint(placed));
    if (zone) return zone;
  }
  return null;
}

/**
 * Whether something is in the middle of a hoop rather than resting against
 * it. Measured across the ring's own plane, so a hoop can face any direction:
 * near the plane, and comfortably inside the rim.
 */
export function throughHoop(hoop, point) {
  if (!point) return false;
  const axis = hoop.axis ?? [0, 0, 1];
  const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const n = [axis[0] / length, axis[1] / length, axis[2] / length];
  const d = [point.x - hoop.pos[0], point.y - hoop.pos[1], point.z - hoop.pos[2]];
  const along = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  if (Math.abs(along) > (hoop.depth ?? 0.6)) return false;
  const across = Math.hypot(
    d[0] - n[0] * along,
    d[1] - n[1] * along,
    d[2] - n[2] * along,
  );
  // Well inside the rim, so brushing the ring is not a score.
  return across <= hoop.radius * 0.75;
}

/**
 * What a machine weighs, all of it. A rover's wheels are bodies of their own
 * jointed to the chassis, so anything that only looked at the body the core
 * sits on would report about half the truth.
 */
export function machineMass(machine) {
  let total = 0;
  for (const body of machine?.bodies ?? []) total += body.mass();
  return total;
}

/**
 * The other half of a parts budget. A budget limits what you spend, this
 * limits what you weigh, and the two pull in different directions — a cheap
 * machine can be a very heavy one. It is the rule that makes somebody take
 * parts off rather than bolt more on.
 */
export function withinMassCap(machine, level) {
  const cap = level?.massCap;
  if (!cap) return { ok: true };
  const mass = machineMass(machine);
  return mass <= cap
    ? { ok: true, mass, cap }
    : {
      ok: false,
      mass,
      cap,
      reason: `Too heavy: ${mass.toFixed(0)} kg of ${cap} kg`,
    };
}

/**
 * The ids a stack was dealt out into. A level says "forty blocks" once, and
 * the blocks are named after it, so an objective can talk about the heap
 * without the level listing every one.
 */
function stackIds(level, id) {
  const stack = (level.stacks ?? []).find((entry) => entry.id === id);
  if (!stack) return [];
  return Array.from({ length: stack.count ?? 1 }, (_, i) => `${id}-${i}`);
}

// Checks that answer with a number rather than with yes or no. A scored level
// is built out of these: there is nothing to complete, only a tally.
const COUNTS = {
  /**
   * A tower of loads on a pad.
   *
   * Counts the tallest run of loads standing on the pad's footprint, each
   * roughly one load above the one below. A run rather than a count, because
   * four loads parked in a row on the ground is not a stack of four, and a
   * tower with a hole in the middle of it is two short towers.
   *
   * Nothing here is remembered: knock the tower over and the count falls with
   * it, which is what makes the last load the hard one.
   */
  propsStacked(objective, level, ctx) {
    const want = objective.count ?? 3;
    const zone = (level.zones ?? []).find((z) => z.id === objective.zone);
    if (!zone) return { count: 0, of: want };
    const rise = objective.rise ?? 1;
    const half = [zone.size[0] / 2, zone.size[2] / 2];
    const column = (ctx.props?.() ?? [])
      .filter((p) => p.point
        && Math.abs(p.point.x - zone.pos[0]) <= half[0]
        && Math.abs(p.point.z - zone.pos[2]) <= half[1])
      .map((p) => p.point.y)
      .sort((a, b) => a - b);

    let best = column.length ? 1 : 0;
    let run = 1;
    for (let i = 1; i < column.length; i += 1) {
      const gap = column[i] - column[i - 1];
      run = gap > rise * 0.55 && gap < rise * 1.35 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    return { count: Math.min(best, want), of: want };
  },
  propsInZone(objective, level, ctx) {
    const zone = level.zones.find((z) => z.id === objective.zone);
    const ids = objective.props ?? stackIds(level, objective.stack);
    const inside = ids.filter((id) => inZone(ctx.propPosition(id), zone)).length;
    return { count: inside, of: ids.length };
  },
};

const CHECKS = {
  /**
   * A run you win by outlasting rather than by finishing anything.
   *
   * Every other objective in the game is a job. This one is the absence of a
   * failure: the course acts, and the machine is still standing at the end of
   * it. Only useful alongside a way to lose, which is what makes it new.
   */
  survived(objective, level, ctx, elapsed) {
    return elapsed >= (objective.seconds ?? 30);
  },
  propInZone(objective, level, ctx) {
    const zone = level.zones.find((z) => z.id === objective.zone);
    return inZone(ctx.propPosition(objective.prop), zone);
  },
  coreInZone(objective, level, ctx) {
    const zone = level.zones.find((z) => z.id === objective.zone);
    return inZone(ctx.corePosition(), zone);
  },
  // Several things that all have to end up in the same place — a sorting bay
  // wants one line in the panel per colour, not one per crate.
  allPropsInZone(objective, level, ctx) {
    const zone = level.zones.find((z) => z.id === objective.zone);
    return objective.props.every((id) => inZone(ctx.propPosition(id), zone));
  },
  propThroughHoop(objective, level, ctx) {
    const hoop = (level.hoops ?? []).find((h) => h.id === objective.hoop);
    return Boolean(hoop) && throughHoop(hoop, ctx.propPosition(objective.prop));
  },
  /**
   * A pressure plate.
   *
   * A coloured plate wants cargo of that colour and will not take anything
   * else, the machine included -- otherwise every colour puzzle has the same
   * answer, which is to park on it. A neutral plate takes whatever is put on
   * it, and that is what makes it the interesting one, because the thing you
   * put on it can be yourself. Three plates and one crate is then a problem
   * about reach rather than a problem about fetching.
   *
   * Any block of the right colour will do. A level with three red crates and
   * one red plate is not a puzzle about which red crate.
   */
  platePressed(objective, level, ctx) {
    const plate = (level.plates ?? []).find((p) => p.id === objective.plate);
    if (!plate) return false;
    const zone = plateZone(plate);
    for (const prop of ctx.props?.() ?? []) {
      if (plate.tag && prop.tag !== plate.tag) continue;
      if (inZone(prop.point, zone)) return true;
    }
    if (plate.tag) return false;
    for (const point of ctx.machinePoints?.() ?? []) {
      if (inZone(point, zone)) return true;
    }
    return false;
  },
  propAbove(objective, level, ctx) {
    const point = ctx.propPosition(objective.prop);
    return Boolean(point) && point.y >= objective.height;
  },
};

/**
 * How far along a single objective is, as a fraction. A survival objective
 * measures against the clock; everything else against its hold, if it has one.
 */
function progressOf(entry, elapsed) {
  const { objective } = entry;
  if (objective.type === 'survived') {
    return Math.min(1, elapsed / (objective.seconds ?? 30));
  }
  if (objective.hold) return entry.held / objective.hold;
  return Number(entry.done);
}

export function describeObjective(objective) {
  return objective.label ?? objective.type;
}

/**
 * Watches a level's objectives. Each must stay satisfied for its hold time
 * before it counts; losing the condition resets that objective's timer.
 */
export class ObjectiveTracker {
  constructor(level) {
    this.level = level;
    this.reset();
  }

  reset() {
    this.state = this.level.objectives.map((objective) => ({
      objective,
      held: 0,
      done: false,
      count: COUNTS[objective.type] ? 0 : undefined,
      of: COUNTS[objective.type] ? 0 : undefined,
    }));
    this.complete = false;
    this.elapsed = 0;
  }

  update(dt, ctx) {
    if (this.complete) return this.report();
    this.elapsed += dt;
    for (const entry of this.state) {
      const counter = COUNTS[entry.objective.type];
      if (counter) {
        const { count, of } = counter(entry.objective, this.level, ctx);
        entry.count = count;
        entry.of = of;
      }
      const check = CHECKS[entry.objective.type];
      const satisfied = counter
        ? entry.count >= entry.of && entry.of > 0
        : Boolean(check && check(entry.objective, this.level, ctx, this.elapsed));
      const hold = entry.objective.hold ?? 0;
      if (satisfied) {
        entry.held = Math.min(hold, entry.held + dt);
        entry.done = entry.held >= hold;
      } else {
        entry.held = 0;
        entry.done = false;
      }
    }
    // A scored level has no win condition at all — only a number that goes up
    // — so it must never decide it is finished.
    this.complete = !this.level.scored && this.state.every((entry) => entry.done);
    return this.report();
  }

  report() {
    const scored = Boolean(this.level.scored);
    return {
      complete: this.complete,
      elapsed: this.elapsed,
      // Null rather than zero on an ordinary level, so nothing has to guess
      // whether a score of nought means "none yet" or "not that kind".
      score: scored ? this.tally() : null,
      scoreLabel: scored ? this.level.scored.label : null,
      objectives: this.state.map((entry) => ({
        label: describeObjective(entry.objective),
        // So the arena can light the plate this line is about.
        plate: entry.objective.plate,
        done: entry.done,
        count: entry.count,
        of: entry.of,
        progress: entry.of
          ? entry.count / entry.of
          : progressOf(entry, this.elapsed),
      })),
    };
  }

  tally() {
    let total = 0;
    for (const entry of this.state) total += entry.count ?? 0;
    return total;
  }
}

export function withinBudget(blueprint, level) {
  const budget = level.budget?.cost;
  if (!budget) return { ok: true };
  const cost = blueprint.cost();
  return cost <= budget
    ? { ok: true, cost, budget }
    : { ok: false, cost, budget, reason: `Over budget: ${cost} / ${budget}` };
}

/**
 * Whether a machine is inside a level's height cap.
 *
 * Measured on the machine as built, in cells, and deliberately never on the
 * machine as it runs. That is the whole of the mechanic: a cap you could not
 * exceed at runtime would only be a shorter machine, but a cap on what you may
 * assemble leaves the height to come from somewhere else -- a mast that
 * telescopes, an arm that unfolds, a tower built lying down and stood up.
 *
 * Checked while building, like the parts budget and unlike the mass cap. Being
 * told the machine is too tall as the run starts is being told too late.
 */
/**
 * A load that has hit the floor, or null if they are all still up.
 *
 * The line is where a ball resting on the ground would sit, not where a
 * careful player would like to hold one: caught low is still caught. Only
 * loads that are actually in play are looked at, because the rest are still in
 * the cannon and a level that failed you for its own unfired ammunition would
 * be unplayable.
 */
export function droppedLoad(level, ctx) {
  const floor = level?.catchFloor;
  if (!floor) return null;
  for (const load of ctx.liveProps?.() ?? []) {
    if (load.point && load.point.y < floor) return load.id;
  }
  return null;
}

export function withinHeight(blueprint, level) {
  const cap = level?.heightCap;
  if (!cap) return { ok: true };
  const height = blueprint?.height() ?? 0;
  return height <= cap
    ? { ok: true, height, cap }
    : {
      ok: false,
      height,
      cap,
      reason: `Too tall: ${height} blocks of ${cap}`,
    };
}

/**
 * Why this machine cannot be run on this level, or null if it can.
 *
 * This used to live inside main.js, reading module state, which meant every
 * test that built a machine was checking a different and more forgiving set of
 * rules than the game does. A prover that has no Control Core on it passes a
 * physics test happily and is refused the moment a player presses Play.
 */
export function buildProblem(blueprint, level) {
  if (!blueprint || blueprint.size === 0) {
    return 'Nothing built yet. Place a Control Core to start.';
  }
  if (!blueprint.list().some((p) => p.type === 'core')) {
    return 'Add a Control Core — the machine needs one.';
  }
  const budget = withinBudget(blueprint, level);
  if (!budget.ok) return budget.reason;
  const height = withinHeight(blueprint, level);
  if (!height.ok) return height.reason;
  // The palette will not let you place one, but a machine can arrive from the
  // garage or from a design saved before the level banned it.
  const broken = firstBanned(level, blueprint);
  if (broken) return `${broken.ban.name}: take the ${broken.part.name} off`;
  return null;
}
