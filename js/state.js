import { clamp, clamp01, key, nowSec, mulberry32, hash32, pick } from "./util.js";
import { BAR_MAX } from "./world.js";
import { DECAY, ACTION_GAIN } from "./mods/stats.js";
import { EVO } from "./mods/evo.js";
import { CARROT, carrotCellOffsets } from "./mods/carrots.js";
import { pushLog } from "./log.js";
import { newGame, makeSmallConnectedBody, findFaceAnchor } from "./creature.js";
import { applyMutation, applyShrinkDecay } from "./state_mutation.js";

export const STORAGE_KEY = "symbiochi_v6_save";

export function loadSave(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
export function saveGame(state){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
export function deleteSave(){
  localStorage.removeItem(STORAGE_KEY);
}

export function migrateOrNew(){
  let state = loadSave();
  if (!state){
    state = newGame();
    saveGame(state);
    return state;
  }

  function normalizeOrg(org, fallbackSeed){
    if (!org) return;
    const seed = (org.seed ?? fallbackSeed ?? 1) | 0;
    org.seed = seed;

    // per-organism "development plan" (for shape diversity)
    if (!org.plan || typeof org.plan !== "object"){
      const prng = mulberry32(hash32(seed, 60606));
      org.plan = {
        axisDir: pick(prng, [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]),
        symmetry: prng(),
        wiggle: prng(),
        ecotype: pick(prng, ["crawler","swimmer","sentinel","tank"])
      };
    }

    org.version = 6;
    org.care = org.care || { feed:0, wash:0, heal:0, neglect:0 };
    org.bars = org.bars || { food:1, clean:1, hp:1, mood:1 };
    org.palette = org.palette || pick(mulberry32(seed), PALETTES);
    org.body = org.body || makeSmallConnectedBody(seed, 9);
    org.modules = org.modules || [];

    const normCells = (arr)=>{
      if (!Array.isArray(arr)) return [];
      const out = [];
      for (const v of arr){
        if (Array.isArray(v) && v.length >= 2){ out.push([v[0]|0, v[1]|0]); continue; }
        if (typeof v === 'string'){
          const m = /^(-?\d+)\s*,\s*(-?\d+)$/.exec(v.trim());
          if (m){ out.push([m[1]|0, m[2]|0]); }
        }
      }
      return out;
    };

    if (org.body){
      org.body.cells = normCells(org.body.cells);
      org.body.core = Array.isArray(org.body.core) ? [org.body.core[0]|0, org.body.core[1]|0] : [0,0];
    }
    for (const m of org.modules){ m.cells = normCells(m.cells); }

    function enforceAppendageRules(){
      const bodyCells = org.body?.cells || [];
      const maxAppendageLen = bodyCells.length * 3;
      const typeLimits = {
        spike: 10,
        antenna: 27,
        claw: 9
      };
      const kept = [];
      const typeBuckets = new Map();

      function isTooCloseToType(cells, existing){
        if (!existing || existing.length === 0) return false;
        for (const [cx, cy] of existing){
          for (const [nx, ny] of cells){
            const dx = Math.abs(cx - nx);
            const dy = Math.abs(cy - ny);
            if (Math.max(dx, dy) <= 2) return true;
          }
        }
        return false;
      }

      for (const m of org.modules){
        if (!m) continue;
        const type = m.type || "organ";
        let cells = Array.isArray(m.cells) ? m.cells.slice() : [];
        if (!cells.length) continue;
        const typeLimit = typeLimits[type] ?? Infinity;
        const limit = maxAppendageLen > 0 ? Math.min(typeLimit, maxAppendageLen) : typeLimit;
        if (Number.isFinite(limit) && limit > 0 && cells.length > limit){
          cells = cells.slice(0, limit);
        }
        if (!cells.length) continue;
        const existing = typeBuckets.get(type);
        if (isTooCloseToType(cells, existing)) continue;
        m.cells = cells;
        if (Number.isFinite(m.growTo)) m.growTo = Math.min(m.growTo, cells.length);
        kept.push(m);
        if (existing){
          existing.push(...cells);
        } else {
          typeBuckets.set(type, cells.slice());
        }
      }

      org.modules = kept;
    }

    enforceAppendageRules();

    if (!org.face) org.face = { anchor: findFaceAnchor(org.body, seed) };
    if (!org.face.eyeShape){
      const prng = mulberry32(hash32(seed, 9191));
      org.face.eyeShape = prng() < 0.5 ? "diamond" : "sphere";
    }
    if (!Number.isFinite(org.face.eyeRadius)){
      const size = Math.max(1, (org.face.eyeSize ?? 1) | 0);
      org.face.eyeRadius = Math.max(0, size - 1);
    }
    org.cam = org.cam || { ox: org.body.core[0], oy: org.body.core[1] };

    if (org.active === undefined) org.active = null;
    if (!Number.isFinite(org.hueShiftDeg)) org.hueShiftDeg = 0;
    if (!org.partHue) org.partHue = {};
    if (!org.partColor) org.partColor = {};
    if (!Number.isFinite(org.mutationDebt)) org.mutationDebt = 0;
    if (org.growthTarget === undefined) org.growthTarget = null;
    if (org.growthTargetMode === undefined) org.growthTargetMode = null;
    if (!Number.isFinite(org.growthTargetPower)) org.growthTargetPower = 0;
    if (!Number.isFinite(org.growthQueueIndex)) org.growthQueueIndex = 0;
    if (org.growthPattern !== undefined) delete org.growthPattern;
  }

  normalizeOrg(state, state.seed || 1);

  state.log = state.log || [];
  state.lastMutationAt = state.lastMutationAt || (state.createdAt || nowSec());
  state.lastSeen = state.lastSeen || nowSec();

  // Feeding / shaping system (carrots)
  if (!Array.isArray(state.carrots)) state.carrots = [];
  state.inv = state.inv || { carrots: 10 };
  state.carrotTick = state.carrotTick || { id: 0, used: 0 };
  if (state.growthTarget === undefined) state.growthTarget = null;
  if (state.growthTargetMode === undefined) state.growthTargetMode = null;
  if (!Number.isFinite(state.growthTargetPower)) state.growthTargetPower = 0;
  if (!Number.isFinite(state.mutationDebt)) state.mutationDebt = 0;

  // UI / tuning settings
  if (!state.settings) state.settings = {};
  if (!Number.isFinite(state.settings.lengthPriority)) state.settings.lengthPriority = 0.65;
  if (!state.partHue) state.partHue = {};
  if (!state.partColor) state.partColor = {};

  // evo interval: prefer settings (more stable on mobile), normalize & clamp
  {
    const raw = (state.settings && state.settings.evoIntervalMin != null)
      ? state.settings.evoIntervalMin
      : state.evoIntervalMin;
    const v = Number(raw);
    state.evoIntervalMin = clamp(Number.isFinite(v) ? v : 12, 0.1, 240);
    state.settings.evoIntervalMin = state.evoIntervalMin;
  }

  if (!Array.isArray(state.buds)) state.buds = [];
  if (state.active !== null && state.active !== -1) state.active = -1;

  saveGame(state);
  return state;
}

function applyNonLinearDecay(value, ratePerSec, deltaSec){
  if (!Number.isFinite(value) || !Number.isFinite(ratePerSec) || !Number.isFinite(deltaSec)) return 0;
  if (value <= 0 || ratePerSec <= 0 || deltaSec <= 0) return Math.max(0, value || 0);
  const threshold = 0.1;
  const baseRate = ratePerSec;
  if (value > threshold){
    const timeToThreshold = (value - threshold) / baseRate;
    if (deltaSec <= timeToThreshold){
      return Math.max(0, value - baseRate * deltaSec);
    }
    const remaining = deltaSec - timeToThreshold;
    const slowedRate = baseRate * 0.5;
    return Math.max(0, threshold - slowedRate * remaining);
  }
  const slowedRate = baseRate * 0.5;
  return Math.max(0, value - slowedRate * deltaSec);
}

export function simulate(state, deltaSec){
  if (deltaSec <= 0) return { deltaSec: 0, mutations: 0, budMutations: 0, eaten: 0, skipped: 0, dueSteps: 0 };

  const now = (state.lastSeen || nowSec()) + deltaSec;
  pruneExpiredCarrots(state, now);
  if (Array.isArray(state.buds)){
    for (let i = 0; i < state.buds.length; i++){
      const bud = state.buds[i];
      if (!bud) continue;
      bud.__logRoot = state;
      bud.__orgTag = i;
    }
  }

  // decay for parent + buds
  const orgs = [state, ...(Array.isArray(state.buds) ? state.buds : [])];
  for (const org of orgs){
    org.bars.food  = clamp(applyNonLinearDecay(org.bars.food, DECAY.food_per_sec, deltaSec), 0, BAR_MAX);
    org.bars.clean = clamp(applyNonLinearDecay(org.bars.clean, DECAY.clean_per_sec, deltaSec), 0, BAR_MAX);
    org.bars.mood  = clamp(applyNonLinearDecay(org.bars.mood, DECAY.mood_per_sec, deltaSec), 0, BAR_MAX);

    const hungerFactor = clamp01(1 - org.bars.food);
    const dirtFactor   = clamp01(1 - org.bars.clean);
    const sadness      = clamp01(1 - org.bars.mood);

    const hpLoss = (DECAY.base_hp_per_sec + (0.55*hungerFactor + 0.35*dirtFactor + 0.20*sadness) / 3600) * deltaSec;
    org.bars.hp = clamp(org.bars.hp - hpLoss, 0, BAR_MAX);

    const stress = clamp01((hungerFactor + dirtFactor + sadness + clamp01(1-org.bars.hp)) / 4);
    org.care.neglect += deltaSec * (0.00012 * (0.5 + stress));
  }

  const intervalSec = Math.max(1, Math.floor(Number(state.evoIntervalMin || 12) * 60));
  const ANABIOSIS_DELAY_SEC = 45 * 60;
  const ANABIOSIS_INTERVAL_SEC = 30 * 60;
  const anabiosisIntervalSec = Math.max(intervalSec, ANABIOSIS_INTERVAL_SEC);
  const offlineStart = state.lastSeen || nowSec();
  const anabiosisStart = offlineStart + ANABIOSIS_DELAY_SEC;

  // feeding tick == mutation tick (reset per tick carrot limit)
  const tickId = Math.floor(state.lastSeen / intervalSec);
  if (!state.carrotTick) state.carrotTick = { id: tickId, used: 0 };
  if (state.carrotTick.id !== tickId){
    state.carrotTick.id = tickId;
    state.carrotTick.used = 0;
  }

  let mutations = 0;
  let budMutations = 0;
  let eaten = 0;
  let skipped = 0;
  let dueSteps = 0;

  // OFFLINE: apply instantly (no debt)
  const MAX_OFFLINE_STEPS = 666;
  const normalWindowEnd = Math.min(now, anabiosisStart);

  const applySteps = (org, windowEnd, stepIntervalSec, onTick)=>{
    if (windowEnd <= (org.lastMutationAt || 0)) return { due: 0, applied: 0, skipped: 0 };
    const due = Math.floor((windowEnd - (org.lastMutationAt || 0)) / stepIntervalSec);
    if (due <= 0) return { due: 0, applied: 0, skipped: 0 };
    const applied = Math.min(due, org._remainingOfflineSteps ?? MAX_OFFLINE_STEPS);

    for (let k=0; k<applied; k++){
      org.lastMutationAt = (org.lastMutationAt || 0) + stepIntervalSec;
      onTick(org);
    }

    org._remainingOfflineSteps = (org._remainingOfflineSteps ?? MAX_OFFLINE_STEPS) - applied;

    let skippedLocal = 0;
    if (due > applied){
      skippedLocal = due - applied;
      org.lastMutationAt = (org.lastMutationAt || 0) + skippedLocal * stepIntervalSec;
    }
    if (skippedLocal > 0){
      org.mutationDebt = Math.max(0, (org.mutationDebt || 0) + skippedLocal);
    }

    return { due, applied, skipped: skippedLocal };
  };

  const maxPerTick = Math.max(1, Math.floor(EVO.maxMutationsPerTick || 2));
  const getMutationContext = (momentSec)=>{
    const tickIndex = Math.floor(momentSec / intervalSec);
    if (!state._mutationContext || state._mutationContext.tickIndex !== tickIndex){
      state._mutationContext = { tickIndex, appendageBudget: 200 };
    }
    return state._mutationContext;
  };
  const runMutationTick = (org, momentSec)=>{
    const bars = org.bars || {};
    const minBar = Math.min(
      bars.food ?? 0,
      bars.clean ?? 0,
      bars.hp ?? 0,
      bars.mood ?? 0
    );
    if (minBar <= 0){
      reportCriticalState(org, momentSec);
      return 0;
    }
    if (minBar <= 0.1){
      return 0;
    }

    let applied = 0;
    const applyOnce = ()=>{
      org._mutationContext = getMutationContext(momentSec);
      applyMutation(org, momentSec);
      applied += 1;
    };

    applyOnce();

    let debt = Number.isFinite(org.mutationDebt) ? org.mutationDebt : 0;
    const remainingBudget = Math.max(0, maxPerTick - applied);
    if (debt > 0 && remainingBudget > 0){
      const extra = Math.min(debt, remainingBudget);
      for (let i = 0; i < extra; i++){
        applyOnce();
      }
      debt -= extra;
      org.mutationDebt = debt;
    }
    return applied;
  };

  state._remainingOfflineSteps = MAX_OFFLINE_STEPS;
  {
    const normalResult = applySteps(state, normalWindowEnd, intervalSec, ()=>{
      eaten += processCarrotsTick(state, state);
      const bars = state.bars || {};
      const minBar = Math.min(
        bars.food ?? 0,
        bars.clean ?? 0,
        bars.hp ?? 0,
        bars.mood ?? 0
      );
      if (minBar <= 0){
        applyShrinkDecay(state, state.lastMutationAt);
      } else {
        applyMutation(state, state.lastMutationAt);
        mutations++;
      }
      eatBudAppendage(state);
    });
    dueSteps += normalResult.due;
    skipped += normalResult.skipped;

    if (now > normalWindowEnd){
      const slowResult = applySteps(state, now, anabiosisIntervalSec, ()=>{
        eaten += processCarrotsTick(state, state);
        const bars = state.bars || {};
        const minBar = Math.min(
          bars.food ?? 0,
          bars.clean ?? 0,
          bars.hp ?? 0,
          bars.mood ?? 0
        );
        if (minBar <= 0){
          applyShrinkDecay(state, state.lastMutationAt);
        } else {
          applyMutation(state, state.lastMutationAt);
          mutations++;
        }
        eatBudAppendage(state);
      });
      dueSteps += slowResult.due;
      skipped += slowResult.skipped;
    }
  }
  delete state._remainingOfflineSteps;

  // buds: evolve instantly too
  if (Array.isArray(state.buds)){
    for (const bud of state.buds){
      if (!bud) continue;
      const budUpTo = (bud.lastSeen || state.lastSeen) + deltaSec;
      bud.lastMutationAt = Number.isFinite(bud.lastMutationAt) ? bud.lastMutationAt : state.lastMutationAt;
      bud._remainingOfflineSteps = MAX_OFFLINE_STEPS;
      const budNormalEnd = Math.min(budUpTo, anabiosisStart);

      applySteps(bud, budNormalEnd, intervalSec, ()=>{
        eaten += processCarrotsTick(state, bud);
        const bars = bud.bars || {};
        const minBar = Math.min(
          bars.food ?? 0,
          bars.clean ?? 0,
          bars.hp ?? 0,
          bars.mood ?? 0
        );
        if (minBar <= 0){
          applyShrinkDecay(bud, bud.lastMutationAt);
        } else {
          applyMutation(bud, bud.lastMutationAt);
          budMutations++;
        }
        eatParentAppendage(state, bud);
      });
      if (budUpTo > budNormalEnd){
        applySteps(bud, budUpTo, anabiosisIntervalSec, ()=>{
          eaten += processCarrotsTick(state, bud);
          const bars = bud.bars || {};
          const minBar = Math.min(
            bars.food ?? 0,
            bars.clean ?? 0,
            bars.hp ?? 0,
            bars.mood ?? 0
          );
          if (minBar <= 0){
            applyShrinkDecay(bud, bud.lastMutationAt);
          } else {
            applyMutation(bud, bud.lastMutationAt);
            budMutations++;
          }
          eatParentAppendage(state, bud);
        });
      }
      delete bud._remainingOfflineSteps;

      // IMPORTANT: advance bud.lastSeen, иначе оффлайн будет считаться снова и снова
      bud.lastSeen = budUpTo;
    }
  }

  mergeTouchingOrganisms(state);
  state.lastSeen = now;
  return { deltaSec, mutations, budMutations, eaten, skipped, dueSteps };
}

function reportCriticalState(org, momentSec){
  const shrunk = applyShrinkDecay(org, momentSec);
  const msg = shrunk
    ? "Критическое состояние: параметр на нуле, организм усыхает."
    : "Критическое состояние: параметр на нуле.";
  pushLog(org, msg, "alert");
}

function mergeTouchingOrganisms(state){
  if (!Array.isArray(state.buds) || state.buds.length === 0) return false;
  const minTouches = 8;
  let merged = false;
  let searching = true;

  while (searching){
    searching = false;
    const orgs = [
      { org: state, index: -1, isParent: true },
      ...state.buds.map((bud, index) => ({ org: bud, index, isParent: false }))
    ];

    outer: for (let i = 0; i < orgs.length; i++){
      for (let j = i + 1; j < orgs.length; j++){
        const a = orgs[i];
        const b = orgs[j];
        if (!a?.org || !b?.org) continue;
        if (!hasBodyContact(a.org, b.org, minTouches)) continue;

        const aSize = a.org.body?.cells?.length || 0;
        const bSize = b.org.body?.cells?.length || 0;
        const main = (bSize > aSize) ? b : a;
        const other = (main === a) ? b : a;
        performMerge(state, main, other);
        merged = true;
        searching = true;
        break outer;
      }
    }
  }

  return merged;
}

function hasBodyContact(orgA, orgB, minTouches){
  const cellsA = orgA?.body?.cells || [];
  const cellsB = orgB?.body?.cells || [];
  if (!cellsA.length || !cellsB.length) return false;
  const bSet = new Set(cellsB.map(([x, y]) => key(x, y)));
  const neighbors = [
    [0, 0],
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1]
  ];

  let touches = 0;
  for (const [x, y] of cellsA){
    let contact = false;
    for (const [dx, dy] of neighbors){
      if (bSet.has(key(x + dx, y + dy))){
        contact = true;
        break;
      }
    }
    if (contact){
      touches++;
      if (touches >= minTouches) return true;
    }
  }
  return false;
}

function performMerge(state, mainEntry, otherEntry){
  const main = mainEntry.org;
  const other = otherEntry.org;
  if (!main || !other) return;

  const mergedBody = mergeBodyCells(main.body?.cells || [], other.body?.cells || []);
  const mergedModules = [...(main.modules || []), ...(other.modules || [])];

  main.body = main.body || { cells: [], core: [0, 0] };
  main.body.cells = mergedBody;
  main.modules = mergedModules;

  const promoteToParent = !mainEntry.isParent && otherEntry.isParent;
  if (promoteToParent){
    promoteBudToParent(state, main);
  }

  const removeIndexes = new Set();
  if (!otherEntry.isParent) removeIndexes.add(otherEntry.index);
  if (promoteToParent) removeIndexes.add(mainEntry.index);
  if (removeIndexes.size){
    state.buds = state.buds.filter((_, idx) => !removeIndexes.has(idx));
  }

  const mainName = main.name || "Организм";
  const otherName = other.name || "Организм";
  const logTarget = promoteToParent ? state : main;
  pushLog(logTarget, `Слияние: "${mainName}" объединился с "${otherName}".`, "symbiosis");
}

function mergeBodyCells(cellsA, cellsB){
  const merged = new Map();
  for (const [x, y] of cellsA){
    merged.set(key(x, y), [x, y]);
  }
  for (const [x, y] of cellsB){
    const k = key(x, y);
    if (!merged.has(k)) merged.set(k, [x, y]);
  }
  return Array.from(merged.values());
}

function promoteBudToParent(state, bud){
  const fields = [
    "name",
    "seed",
    "plan",
    "version",
    "care",
    "bars",
    "palette",
    "body",
    "modules",
    "face",
    "cam",
    "active",
    "hueShiftDeg",
    "partHue",
    "partColor",
    "growthTarget",
    "growthTargetMode",
    "growthTargetPower",
    "mutationDebt"
  ];
  for (const field of fields){
    if (bud[field] !== undefined) state[field] = bud[field];
  }
  state.active = -1;
}

function eatParentAppendage(state, bud){
  if (!bud || !Array.isArray(state.modules) || state.modules.length === 0) return false;

  const budCells = new Set();
  if (Array.isArray(bud.body?.cells)){
    for (const [x, y] of bud.body.cells) budCells.add(key(x, y));
  }
  if (Array.isArray(bud.modules)){
    for (const mod of bud.modules){
      for (const [x, y] of (mod?.cells || [])) budCells.add(key(x, y));
    }
  }
  if (budCells.size === 0) return false;

  const minOverlap = 2;
  const minLen = 1;

  for (const mod of state.modules){
    const cells = mod?.cells || [];
    if (cells.length === 0) continue;
    let overlap = 0;
    for (const [x, y] of cells){
      if (budCells.has(key(x, y))){
        overlap++;
        if (overlap >= minOverlap) break;
      }
    }
    if (overlap >= minOverlap){
      if (cells.length > minLen){
        mod.cells = cells.slice(0, minLen);
      }
      bud.bars.food = clamp(bud.bars.food + 0.10, 0, BAR_MAX);
      return true;
    }
  }

  return false;
}

function eatBudAppendage(state){
  if (!Array.isArray(state.buds) || state.buds.length === 0) return false;

  const bodyCells = new Set();
  if (Array.isArray(state.body?.cells)){
    for (const [x, y] of state.body.cells) bodyCells.add(key(x, y));
  }
  if (bodyCells.size === 0) return false;

  const neighborDirs = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1]
  ];
  const minLen = 1;

  const touchesBody = (x, y)=>{
    if (bodyCells.has(key(x, y))) return true;
    for (const [dx, dy] of neighborDirs){
      if (bodyCells.has(key(x + dx, y + dy))) return true;
    }
    return false;
  };

  for (const bud of state.buds){
    if (!bud) continue;
    for (const mod of (bud.modules || [])){
      const cells = mod?.cells || [];
      if (cells.length === 0) continue;
      let contact = false;
      for (const [x, y] of cells){
        if (touchesBody(x, y)){
          contact = true;
          break;
        }
      }
      if (contact){
        if (cells.length > minLen){
          mod.cells = cells.slice(0, minLen);
        }
        state.bars.food = clamp(state.bars.food + 0.10, 0, BAR_MAX);
        return true;
      }
    }
  }

  return false;
}

// ===== Carrots (interactive feeding / shaping) =====
function pruneExpiredCarrots(state, now){
  if (!Array.isArray(state.carrots) || !state.carrots.length) return;
  const ttlSec = 60 * 60;
  const kept = [];
  for (const car of state.carrots){
    if (!Number.isFinite(car.t)){
      car.t = now;
      kept.push(car);
      continue;
    }
    if ((now - car.t) <= ttlSec){
      kept.push(car);
    }
  }
  state.carrots = kept;
  if (!state.carrots.length){
    const orgs = [state, ...(Array.isArray(state.buds) ? state.buds : [])];
    for (const org of orgs){
      org.growthTarget = null;
      org.growthTargetMode = null;
      org.growthTargetPower = 0;
    }
  }
}

function carrotCells(car){
  const out = [];
  const w = (car.w ?? CARROT.w ?? 3);
  const h = (car.h ?? CARROT.h ?? 7);
  const offsets = carrotCellOffsets(w, h);
  for (const [dx, dy] of offsets){
    out.push([car.x + dx, car.y + dy]);
  }
  return out;
}

function processCarrotsTick(state, org = state){
  if (!Array.isArray(state.carrots) || !state.carrots.length){
    org.growthTarget = null;
    org.growthTargetMode = null;
    org.growthTargetPower = 0;
    return 0;
  }

  let eaten = 0;
  const bodyOcc = new Set();
  for (const [x,y] of (org.body?.cells || [])) bodyOcc.add(`${x},${y}`);
  const moduleOcc = new Set();
  for (const m of (org.modules || [])){
    for (const [x,y] of (m?.cells || [])) moduleOcc.add(`${x},${y}`);
  }
  const bodyCells = org.body?.cells || [];
  const moduleCells = (org.modules || []).flatMap(m => m?.cells || []);

  function minDistToCells(cells, tx, ty){
    let best = Infinity;
    for (const [x,y] of cells){
      const d = Math.abs(tx - x) + Math.abs(ty - y);
      if (d < best) best = d;
    }
    return best;
  }

  const appendageTypes = new Set([
    "tail",
    "tentacle",
    "worm",
    "limb",
    "antenna",
    "claw"
  ]);
  const cos45 = Math.SQRT1_2;
  function moduleSeesTarget(m, tx, ty){
    if (!m) return false;
    const appendage = m.movable || appendageTypes.has(m.type);
    if (!appendage) return false;
    const dir = m.growDir || m.baseDir;
    if (!dir) return false;
    const base = m.cells?.[0] || m.cells?.[m.cells.length - 1];
    if (!base) return false;
    const vx = tx - base[0];
    const vy = ty - base[1];
    const vLen = Math.hypot(vx, vy);
    if (vLen === 0) return true;
    const dirLen = Math.hypot(dir[0], dir[1]) || 1;
    const dot = (vx * dir[0] + vy * dir[1]) / (vLen * dirLen);
    return dot >= cos45;
  }

  // Eat only if touches >= 2 cells. If target is appendage, count only modules.
  const remaining = [];
  for (const car of state.carrots){
    const cx = car.x + Math.floor((car.w ?? CARROT.w ?? 3) / 2);
    const cy = car.y + Math.floor((car.h ?? CARROT.h ?? 7) / 2);
    const bodyD = minDistToCells(bodyCells, cx, cy);
    const moduleD = minDistToCells(moduleCells, cx, cy);
    const mode = (moduleD < bodyD) ? "appendage" : "body";
    const occ = (mode === "appendage") ? moduleOcc : null;
    let hits = 0;
    for (const [x,y] of carrotCells(car)){
      const k = `${x},${y}`;
      if (mode === "appendage"){
        if (occ.has(k)) hits++;
      } else {
        if (moduleOcc.has(k) || bodyOcc.has(k)) hits++;
      }
      if (hits >= 2) break;
    }
    if (hits >= 2){
      org.bars.food = clamp(org.bars.food + 0.22, 0, BAR_MAX);
      org.bars.mood = clamp(org.bars.mood + 0.06, 0, BAR_MAX);
      pushLog(org, `Кормление: морковка съедена.`, "care");
      eaten++;
    } else {
      remaining.push(car);
    }
  }
  state.carrots = remaining;

  if (!state.carrots.length){
    org.growthTarget = null;
    org.growthTargetMode = null;
    org.growthTargetPower = 0;
    return eaten;
  }

  // Choose nearest carrot as a growth target with carrot visibility rules.
  let best = null;
  let bestMode = null;
  let bestDist = Infinity;
  const bodyRange = Number.isFinite(CARROT.nearDist) ? CARROT.nearDist : 7;
  const maxRange = Number.isFinite(CARROT.farDist) ? CARROT.farDist : 15;
  for (const car of state.carrots){
    const tx = car.x + Math.floor((car.w ?? CARROT.w ?? 3) / 2);
    const ty = car.y + Math.floor((car.h ?? CARROT.h ?? 7) / 2);
    const bodyD = minDistToCells(bodyCells, tx, ty);
    let seeingModuleD = Infinity;
    for (const m of (org.modules || [])){
      if (!moduleSeesTarget(m, tx, ty)) continue;
      const d = minDistToCells(m?.cells || [], tx, ty);
      if (d < seeingModuleD) seeingModuleD = d;
    }
    const closestD = Math.min(bodyD, seeingModuleD);
    if (closestD > maxRange) continue;

    const hasSeeingBetween = seeingModuleD < bodyD;
    let mode = null;
    let activeDist = Infinity;
    if (bodyD <= bodyRange && !hasSeeingBetween){
      mode = "body";
      activeDist = bodyD;
    } else if (seeingModuleD <= maxRange){
      mode = "appendage";
      activeDist = seeingModuleD;
    } else if (bodyD <= maxRange){
      mode = "body";
      activeDist = bodyD;
    }
    if (!mode) continue;
    if (activeDist < bestDist){
      bestDist = activeDist;
      bestMode = mode;
      best = [tx, ty];
    }
  }

  org.growthTarget = best;
  org.growthTargetMode = bestMode;
  org.growthTargetPower = (bestDist !== Infinity)
    ? Math.max(0, Math.min(1, 1 - bestDist / 45))
    : 0;
  return eaten;
}

// actions: +10..17% cap 140%
export function addRandom01(rng){ return 0.10 + rng() * 0.07; }

export function act(state, kind){
  const rng = mulberry32(hash32(state.seed, nowSec()));

  if (kind === "feed"){
    const add = addRandom01(rng);
    state.bars.food = clamp(state.bars.food + add, 0, BAR_MAX);
    state.bars.mood = clamp(state.bars.mood + add*0.35, 0, BAR_MAX);
    state.care.feed += 1.0;
    pushLog(state, `Кормление: +${Math.round(add*100)}% к еде.`, "care");
  } else if (kind === "wash"){
    const add = addRandom01(rng);
    state.bars.clean = clamp(state.bars.clean + add, 0, BAR_MAX);
    state.bars.mood = clamp(state.bars.mood + add*0.20, 0, BAR_MAX);
    state.care.wash += 1.0;
    pushLog(state, `Мытьё: +${Math.round(add*100)}% к чистоте.`, "care");
  } else if (kind === "heal"){
    const add = addRandom01(rng);
    state.bars.hp = clamp(state.bars.hp + add, 0, BAR_MAX);
    state.bars.mood = clamp(state.bars.mood + add*0.15, 0, BAR_MAX);
    state.care.heal += 1.0;
    pushLog(state, `Лечение: +${Math.round(add*100)}% к HP.`, "care");
  }

  state.lastSeen = nowSec();
  saveGame(state);
}

// Apply action to a specific organism inside a colony, but persist the ROOT state.
export function actOn(rootState, org, kind){
  if (!rootState) return;
  const target = org || rootState;
  const rng = mulberry32(hash32(rootState.seed, nowSec()));
  const label = (target === rootState) ? "" : ` (цель: ${target.name || "почка"})`;
  const withTargetLog = (msg)=>{
    if (target === rootState){
      pushLog(rootState, msg, "care");
      return;
    }
    const prevRoot = target.__logRoot;
    const prevTag = target.__orgTag;
    target.__logRoot = rootState;
    target.__orgTag = Array.isArray(rootState.buds) ? rootState.buds.indexOf(target) : undefined;
    pushLog(target, msg, "care");
    if (prevRoot === undefined) delete target.__logRoot; else target.__logRoot = prevRoot;
    if (prevTag === undefined) delete target.__orgTag; else target.__orgTag = prevTag;
  };

  if (kind === "feed"){
    const add = addRandom01(rng);
    target.bars.food = clamp(target.bars.food + add, 0, BAR_MAX);
    target.bars.mood = clamp(target.bars.mood + add*0.35, 0, BAR_MAX);
    target.care.feed += 1.0;
    withTargetLog(`Кормление${label}: +${Math.round(add*100)}% к еде.`);
  } else if (kind === "wash"){
    const add = addRandom01(rng);
    target.bars.clean = clamp(target.bars.clean + add, 0, BAR_MAX);
    target.bars.mood = clamp(target.bars.mood + add*0.20, 0, BAR_MAX);
    target.care.wash += 1.0;
    withTargetLog(`Мытьё${label}: +${Math.round(add*100)}% к чистоте.`);
  } else if (kind === "heal"){
    const add = addRandom01(rng);
    target.bars.hp = clamp(target.bars.hp + add, 0, BAR_MAX);
    target.bars.mood = clamp(target.bars.mood + add*0.15, 0, BAR_MAX);
    target.care.heal += 1.0;
    withTargetLog(`Лечение${label}: +${Math.round(add*100)}% к HP.`);
  }

  const t = nowSec();
  rootState.lastSeen = t;
  if (target) target.lastSeen = t;
  saveGame(rootState);
}
