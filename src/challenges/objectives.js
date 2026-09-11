export function inZone(point, zone) {
  if (!point) return false;
  const [hx, hy, hz] = zone.size.map((n) => n / 2);
  return (
    Math.abs(point.x - zone.pos[0]) <= hx &&
    Math.abs(point.y - zone.pos[1]) <= hy &&
    Math.abs(point.z - zone.pos[2]) <= hz
  );
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
