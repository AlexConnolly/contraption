const KEY = 'contraption.v1';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

// Two machines saved in the same millisecond would otherwise share an id, and
// the second would quietly replace the first.
function newId() {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Everything the game remembers between sessions: the work in progress on each
 * challenge, which ones have been solved and how fast, and the garage of named
 * machines that can be taken into any challenge.
 */
export const store = {
  all: read,

  lastLevel() {
    return read().lastLevel ?? null;
  },

  setLastLevel(id) {
    const data = read();
    data.lastLevel = id;
    write(data);
  },

  // ---------------------------------------------------------------- settings

  settings(defaults) {
    return { ...defaults, ...(read().settings ?? {}) };
  },

  setSetting(key, value) {
    const data = read();
    data.settings = data.settings ?? {};
    data.settings[key] = value;
    write(data);
  },

  // ------------------------------------------------------------- in progress

  design(levelId) {
    return read().designs?.[levelId] ?? null;
  },

  saveDesign(levelId, blueprintJson) {
    const data = read();
    data.designs = data.designs ?? {};
    data.designs[levelId] = blueprintJson;
    data.lastLevel = levelId;
    return write(data);
  },

  // ----------------------------------------------------------------- results

  result(levelId) {
    return read().results?.[levelId] ?? null;
  },

  solved(levelId) {
    const result = read().results?.[levelId];
    return Boolean(result?.best || result?.bestScore !== undefined);
  },

  solvedCount(levelIds) {
    const results = read().results ?? {};
    return levelIds.filter(
      (id) => results[id]?.best || results[id]?.bestScore !== undefined,
    ).length;
  },

  // Keeps the best time only, so a scrappy win is never overwritten by a
  // slower one on a later attempt.
  recordWin(levelId, seconds, cost) {
    const data = read();
    data.results = data.results ?? {};
    const previous = data.results[levelId];
    const better = !previous?.best || seconds < previous.best;
    data.results[levelId] = {
      best: better ? seconds : previous.best,
      bestCost: better ? cost : previous.bestCost,
      runs: (previous?.runs ?? 0) + 1,
      at: Date.now(),
    };
    write(data);
    return better;
  },

  /**
   * A scored level has no time to beat, only a number to beat, and bigger is
   * better — which is the opposite of everything else recorded here, so it is
   * kept under its own name rather than squeezed into `best`.
   */
  recordScore(levelId, score) {
    const data = read();
    data.results = data.results ?? {};
    const previous = data.results[levelId];
    const better = previous?.bestScore === undefined || score > previous.bestScore;
    data.results[levelId] = {
      ...previous,
      bestScore: better ? score : previous.bestScore,
      runs: (previous?.runs ?? 0) + 1,
      at: Date.now(),
    };
    write(data);
    return better;
  },

  // ------------------------------------------------------------------ garage

  machines() {
    return read().machines ?? [];
  },

  machine(id) {
    return this.machines().find((m) => m.id === id) ?? null;
  },

  saveMachine({ id, name, blueprint, thumb }) {
    const data = read();
    data.machines = data.machines ?? [];
    const existing = data.machines.findIndex((m) => m.id === id);
    const entry = {
      id: id ?? newId(),
      name,
      blueprint,
      thumb,
      at: Date.now(),
    };
    if (existing >= 0) data.machines[existing] = { ...data.machines[existing], ...entry };
    else data.machines.unshift(entry);
    // Null rather than the entry when there was no room. Everything the game
    // remembers is one key rewritten whole, and every saved machine carries a
    // thumbnail inside it, so the quota is genuinely reachable -- and a garage
    // that reports a save it never made is the worst way to find that out.
    return write(data) ? entry : null;
  },

  // ---------------------------------------------------------------- levels

  customLevels() {
    return read().levels ?? [];
  },

  customLevel(id) {
    return this.customLevels().find((entry) => entry.id === id) ?? null;
  },

  saveCustomLevel({ id, name, level }) {
    const data = read();
    data.levels = data.levels ?? [];
    const at = data.levels.findIndex((entry) => entry.id === id);
    const record = { id: id ?? newId(), name, level, at: Date.now() };
    if (at >= 0) data.levels[at] = { ...data.levels[at], ...record };
    else data.levels.unshift(record);
    return write(data) ? record : null;
  },

  deleteCustomLevel(id) {
    const data = read();
    data.levels = (data.levels ?? []).filter((entry) => entry.id !== id);
    write(data);
  },

  // ----------------------------------------------------------- parts packs

  packs() {
    return read().packs ?? [];
  },

  savePack(pack) {
    const data = read();
    data.packs = (data.packs ?? []).filter((entry) => entry.id !== pack.id);
    data.packs.unshift({ ...pack, at: Date.now() });
    return write(data);
  },

  deletePack(id) {
    const data = read();
    data.packs = (data.packs ?? []).filter((entry) => entry.id !== id);
    write(data);
  },

  renameMachine(id, name) {
    const data = read();
    const entry = data.machines?.find((m) => m.id === id);
    if (!entry) return;
    entry.name = name;
    write(data);
  },

  deleteMachine(id) {
    const data = read();
    data.machines = (data.machines ?? []).filter((m) => m.id !== id);
    write(data);
  },
};
