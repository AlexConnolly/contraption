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

const CHECKS = {
  propInZone(objective, level, ctx) {
    const zone = level.zones.find((z) => z.id === objective.zone);
    return inZone(ctx.propPosition(objective.prop), zone);
  },
  coreInZone(objective, level, ctx) {
    const zone = level.zones.find((z) => z.id === objective.zone);
    return inZone(ctx.corePosition(), zone);
  },
  propThroughHoop(objective, level, ctx) {
    const hoop = (level.hoops ?? []).find((h) => h.id === objective.hoop);
    return Boolean(hoop) && throughHoop(hoop, ctx.propPosition(objective.prop));
  },
  propAbove(objective, level, ctx) {
    const point = ctx.propPosition(objective.prop);
    return Boolean(point) && point.y >= objective.height;
  },
};

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
    }));
    this.complete = false;
    this.elapsed = 0;
  }

  update(dt, ctx) {
    if (this.complete) return this.report();
    this.elapsed += dt;
    for (const entry of this.state) {
      const check = CHECKS[entry.objective.type];
      const satisfied = check ? check(entry.objective, this.level, ctx) : false;
      const hold = entry.objective.hold ?? 0;
      if (satisfied) {
        entry.held = Math.min(hold, entry.held + dt);
        entry.done = entry.held >= hold;
      } else {
        entry.held = 0;
        entry.done = false;
      }
    }
    this.complete = this.state.every((entry) => entry.done);
    return this.report();
  }

  report() {
    return {
      complete: this.complete,
      elapsed: this.elapsed,
      objectives: this.state.map((entry) => ({
        label: describeObjective(entry.objective),
        done: entry.done,
        progress: entry.objective.hold
          ? entry.held / entry.objective.hold
          : Number(entry.done),
      })),
    };
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
