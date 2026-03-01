import { clamp, clamp01, key, nowSec, mulberry32, hash32, pick } from "./util.js";
import { BAR_MAX } from "./world.js";
import { DECAY, ACTION_GAIN } from "./mods/stats.js";
import { EVO, computeEvoSpeed, evoIntervalSecFromSpeed } from "./mods/evo.js";
import { CARROT, carrotCellOffsets } from "./mods/carrots.js";
import { COIN, coinCellOffsets } from "./mods/coins.js";
import { pushLog } from "./log.js";
import { newGame, makeSmallConnectedBody, findFaceAnchor, repairDetachedModules, getOrganMaxLen } from "./creature.js";
import { ensureBodyWave } from "./mods/body_wave.js";
import { applyMutation, applyShrinkDecay, reanchorModulesToPerimeter } from "./state_mutation.js";
import { normalizeFaceEye } from "./organs/eye.js";

export const STORAGE_KEY = "symbiochi_v6_save";

// Balance v2.2 inventory defaults
export const INV_DEFAULTS = {
  food: 100,
  water: 100,
  heal: 100,
  coins: 10,
};

export const MOOD_MAX = 1.10;

function clampMood(x){
  return clamp(x, 0, MOOD_MAX);
}

export function loadSave(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
export function saveGame(state){
  // State can contain non-serializable backrefs used by the log system
  // (e.g. bud.__logRoot -> state, creating a circular structure).
  // Save must be robust: drop transient/private fields and break cycles.
  const seen = new WeakSet();
  const json = JSON.stringify(state, (k, v)=>{
    // drop private / runtime-only fields
    if (k === "__logRoot" || k === "__parent" || k === "__state") return undefined;
    if (typeof k === "string" && k.startsWith("__")) return undefined;
    if (typeof v === "function") return undefined;
    if (v && typeof v === "object"){
      if (seen.has(v)) return undefined;
      seen.add(v);
    }
    return v;
  });
  localStorage.setItem(STORAGE_KEY, json);
}
export function deleteSave(){
  localStorage.removeItem(STORAGE_KEY);
}

export function migrateOrNew(){
  let state = loadSave();
if (!state){
  state = newGame();

  // v2.2: inventory defaults must exist even for a fresh save
  state.inv = state.inv || {};
  if (!Number.isFinite(state.inv.food))  state.inv.food  = INV_DEFAULTS.food;
  if (!Number.isFinite(state.inv.water)) state.inv.water = INV_DEFAULTS.water;
  if (!Number.isFinite(state.inv.heal))  state.inv.heal  = INV_DEFAULTS.heal;
  if (!Number.isFinite(state.inv.coins)) state.inv.coins = INV_DEFAULTS.coins;

  clampAppendageLengths(state);
  saveGame(state);
  return state;
}

  function normalizeOrg(org, fallbackSeed){
    if (!org) return;
    const base = (fallbackSeed ?? 1) | 0;

// если org.seed отсутствует — генерируем устойчивый, но отличающийся от других
const seed = (org.seed ?? hash32(base, org.id ?? 0)) | 0;

org.seed = seed;

    // per-organism "development plan" (for shape diversity)
    if (!org.plan || typeof org.plan !== "object"){
      const prng = mulberry32(hash32(seed, 60606));
      org.plan = {
        axisDir: pick(prng, [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]),
        symmetry: prng(),
        wiggle: prng(),
        ecotype: pick(prng, ["crawler","swimmer","sentinel","tank","sprinter","lurker","seer","fortress","bloomer"])
      };
    }

    org.version = 6;
    org.care = org.care || { feed:0, wash:0, heal:0, neglect:0 };
    org.bars = org.bars || { food:1, clean:1, hp:1, mood:1 };
    org.visual = org.visual || { saturation: 1 };
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

    // Variant A: ensure organic body-wave growth params exist (single source: mods/body_wave.js)
    ensureBodyWave(org);
    for (const m of org.modules){ m.cells = normCells(m.cells); }

    function enforceAppendageRules(){
      // Без глобального cap от тела: длина ограничивается только параметрами органа.
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

        const maxLen = getOrganMaxLen(type);
        if (Number.isFinite(maxLen) && maxLen > 0 && cells.length > maxLen){
          cells = cells.slice(0, maxLen);
        }
        if (!cells.length) continue;

        const existing = typeBuckets.get(type);
        if (isTooCloseToType(cells, existing)) continue;

        m.cells = cells;
        // Keep growth cursor consistent with the trimmed/validated geometry.
        if (cells.length){
          const last = cells[cells.length - 1];
          m.growPos = [last[0], last[1]];
          if (Number.isFinite(m.growStep)){
            m.growStep = Math.min(m.growStep, Math.max(0, cells.length - 1));
          }
        } else {
          m.growPos = null;
          if (Number.isFinite(m.growStep)) m.growStep = 0;
        }
        if (Number.isFinite(m.growTo)) m.growTo = Math.min(m.growTo, cells.length);
        kept.push(m);
        if (existing) existing.push(...cells);
        else typeBuckets.set(type, cells.slice());
      }

      org.modules = kept;
    }

    enforceAppendageRules();

if (!org.face) org.face = { anchor: findFaceAnchor(org.body, seed) };
// единый источник правды: eye.js
const bodyBlocks = (org?.body?.cells?.length || 0);
normalizeFaceEye(org, bodyBlocks);

    // Camera is a pure view concern and should NOT be persisted in save.
    // (Old saves may still contain org.cam; we remove it during migration.)
    if (org.cam !== undefined) delete org.cam;

    if (org.active === undefined) org.active = null;
    if (!Number.isFinite(org.hueShiftDeg)) org.hueShiftDeg = 0;
    if (!org.partHue) org.partHue = {};
    if (!org.partColor) org.partColor = {};
    if (!Number.isFinite(org.mutationDebt)) org.mutationDebt = 0;
    // v2.2 economy: persist per-organism mutation-to-coin accumulator.
    if (!Number.isFinite(org.coinEarnAcc)){
      if (Number.isFinite(org._coinEarnAcc)) org.coinEarnAcc = org._coinEarnAcc;
      else org.coinEarnAcc = 0;
    }
    if (org._coinEarnAcc !== undefined) delete org._coinEarnAcc;

    // v2.2: smooth offline catch-up queue (events to play back on return).
    if (!Number.isFinite(org.offlineCatchup)) org.offlineCatchup = 0;
    if (!Number.isFinite(org.offlineCatchupAcc)) org.offlineCatchupAcc = 0;
	if (!Number.isFinite(org.lastBudAt)) org.lastBudAt = -Infinity;
    if (org.growthTarget === undefined) org.growthTarget = null;
    if (org.growthTargetMode === undefined) org.growthTargetMode = null;
    if (!Number.isFinite(org.growthTargetPower)) org.growthTargetPower = 0;
    if (!Number.isFinite(org.growthQueueIndex)) org.growthQueueIndex = 0;
    // Persisted heading angle (in degrees, modulo 180). Used so carrot targeting and
    // appendage "vision" stay consistent when organism is rendered rotated.
    if (!Number.isFinite(org.headingDeg)) org.headingDeg = 0;
    if (org.growthPattern !== undefined) delete org.growthPattern;
  }

  normalizeOrg(state, state.seed || 1);
  clampAppendageLengths(state);
  if (Array.isArray(state.buds)){
    for (const bud of state.buds){
      if (bud && bud.cam !== undefined) delete bud.cam;
      clampAppendageLengths(bud);
    }
  }

  // Make sure visual-only derived fields are ready immediately after loading.
  updateVisualSaturation(state);
  if (Array.isArray(state.buds)){
    for (const bud of state.buds) updateVisualSaturation(bud);
  }

  state.log = state.log || [];
  state.lastMutationAt = state.lastMutationAt || (state.createdAt || nowSec());
  state.lastSeen = state.lastSeen || nowSec();

  // Feeding / shaping system (carrots)
  if (!Array.isArray(state.carrots)) state.carrots = [];
  state.coins = Array.isArray(state.coins) ? state.coins : [];
  // Global inventory (shared for the whole save / colony)
  // Legacy: state.inv.carrots may exist in old saves; keep it but stop relying on it.
  state.inv = state.inv || {};
  if (!Number.isFinite(state.inv.food)) state.inv.food = INV_DEFAULTS.food;
  if (!Number.isFinite(state.inv.water)) state.inv.water = INV_DEFAULTS.water;
  if (!Number.isFinite(state.inv.heal)) state.inv.heal = INV_DEFAULTS.heal;
  if (!Number.isFinite(state.inv.coins)) state.inv.coins = INV_DEFAULTS.coins;

  // Cosmetics sinks (v2.2): purely visual slots, no buffs.
  // Cosmetics (v2.2 sinks). Global per-save collection, no buffs.
  // Structure:
  //   cosmetics = { equipped:{eyes,hat,jewel}, owned:{eyes:[],hat:[],jewel:[]} }
  if (!state.cosmetics || typeof state.cosmetics !== "object") state.cosmetics = {};
  // Migrate legacy flat slots {eyes,hat,jewel}
  if (!("equipped" in state.cosmetics)){
    const legacy = state.cosmetics;
    state.cosmetics = {
      equipped: { eyes: legacy.eyes ?? null, hat: legacy.hat ?? null, jewel: legacy.jewel ?? null },
      owned:    { eyes: [], hat: [], jewel: [] },
    };
  }
  if (!state.cosmetics.equipped || typeof state.cosmetics.equipped !== "object"){
    state.cosmetics.equipped = { eyes: null, hat: null, jewel: null };
  }
  if (!state.cosmetics.owned || typeof state.cosmetics.owned !== "object"){
    state.cosmetics.owned = { eyes: [], hat: [], jewel: [] };
  }
  for (const k of ["eyes","hat","jewel"]){
    if (!Array.isArray(state.cosmetics.owned[k])) state.cosmetics.owned[k] = [];
    if (!(k in state.cosmetics.equipped)) state.cosmetics.equipped[k] = null;
  }

  state.carrotTick = state.carrotTick || { id: 0, used: 0 };
  state.coinTick = state.coinTick || { id: 0, used: 0 };
  if (state.growthTarget === undefined) state.growthTarget = null;
  if (state.growthTargetMode === undefined) state.growthTargetMode = null;
  if (!Number.isFinite(state.growthTargetPower)) state.growthTargetPower = 0;
  if (!Number.isFinite(state.mutationDebt)) state.mutationDebt = 0;

  // UI / tuning settings
  if (!state.settings) state.settings = {};
  if (!Number.isFinite(state.settings.lengthPriority)) state.settings.lengthPriority = 0.65;
  // Screen FX (post-processing). Default ON.
  if (state.settings.fxEnabled === undefined) state.settings.fxEnabled = true;
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

function clampAppendageLengths(org){
  if (!org || !Array.isArray(org.modules)) return;
  for (const m of org.modules){
    if (!m || !Array.isArray(m.cells) || m.cells.length === 0) continue;
    const type = m.type || "organ";
    const maxLen = getOrganMaxLen(type);
    if (Number.isFinite(maxLen) && maxLen > 0 && m.cells.length > maxLen){
      m.cells = m.cells.slice(0, maxLen);
    }
    // IMPORTANT:
    // growTo is the *target* length. Never clamp it down to the current length,
    // otherwise appendages will immediately stop growing after load/migration.
    // Only enforce:
    //  - growTo >= current length
    //  - growTo <= maxLen (if maxLen is finite)
    if (Number.isFinite(m.growTo)){
      if (m.growTo < m.cells.length) m.growTo = m.cells.length;
      if (Number.isFinite(maxLen) && maxLen > 0) m.growTo = Math.min(m.growTo, maxLen);
    } else {
      // If growTo is missing (old saves), keep at least the current length.
      m.growTo = m.cells.length;
      if (Number.isFinite(maxLen) && maxLen > 0) m.growTo = Math.min(m.growTo, maxLen);
    }
  }
}


function applyNonLinearDecay(value, baseRate, deltaSec){
  // New balance v2.2:
  // >70%  : softer drain
  // 70..40: faster drain
  // <40%  : noticeably faster drain (to make stasis meaningful)
  if (!Number.isFinite(value) || !Number.isFinite(baseRate) || !Number.isFinite(deltaSec) || deltaSec <= 0) return value;

  const v = clamp(value, 0, BAR_MAX);

  let k = 1.0;
  if (v > 0.70){
    k = 0.70; // soft
  } else if (v > 0.40){
    // ramp 1.10..1.35 as we go down from 70% to 40%
    const t = clamp01((0.70 - v) / 0.30);
    k = 1.10 + 0.25 * t;
  } else {
    // ramp 1.45..1.85 as we go down from 40% to 0%
    const t = clamp01((0.40 - v) / 0.40);
    k = 1.45 + 0.40 * t;
  }

  return Math.max(0, v - baseRate * k * deltaSec);
}

// =====================
// Decay step (time-accurate offline)
// =====================
// IMPORTANT:
// Offline simulation must NOT apply a single huge decay upfront.
// Otherwise the hunger gate (anabiosis pause) is evaluated "from the end"
// and the creature can lose all positive growth that should have happened
// before entering the pause.
//
// This helper applies the same decay logic as the old big block, but for
// an arbitrary small dt. We then advance dt along the simulated timeline.
function applyDecayStep(org, dt){
  if (!org || !Number.isFinite(dt) || dt <= 0) return;
  org.bars = org.bars || { food: 1, clean: 1, hp: 1, mood: 1 };
  org.care = org.care || { feed: 0, wash: 0, heal: 0, neglect: 0 };

  org.bars.food  = clamp(applyNonLinearDecay(org.bars.food,  DECAY.food_per_sec,  dt), 0, BAR_MAX);
  org.bars.clean = clamp(applyNonLinearDecay(org.bars.clean, DECAY.clean_per_sec, dt), 0, BAR_MAX);
  org.bars.mood  = clamp(applyNonLinearDecay(org.bars.mood,  DECAY.mood_per_sec,  dt), 0, MOOD_MAX);

  const hungerFactor = clamp01(1 - org.bars.food);
  const dirtFactor   = clamp01(1 - org.bars.clean);
  const sadness      = clamp01(1 - org.bars.mood);

  const hpLoss = (DECAY.base_hp_per_sec + (0.55*hungerFactor + 0.35*dirtFactor + 0.20*sadness) / 3600) * dt;
  org.bars.hp = clamp(org.bars.hp - hpLoss, 0, BAR_MAX);

  const stress = clamp01((hungerFactor + dirtFactor + sadness + clamp01(1-org.bars.hp)) / 4);
  const neglectStress = stress > 0.25 ? stress : 0;
  org.care.neglect += dt * (0.00012 * neglectStress);

    // (v2.2) Evolution gating is handled by evoSpeed/stasis (see simulate).
}

function allBarsZero(org){
  const b = org?.bars || {};
  return (b.food ?? 0) <= 0 && (b.clean ?? 0) <= 0 && (b.hp ?? 0) <= 0 && (b.mood ?? 0) <= 0;
}

// =====================
// Visual-only saturation
// =====================
// Requirement:
// - When overall stats < 65%, creature loses colorfulness down to 25% at 0% stats.
// - When stats recover, saturation rises back, but caps at 100% already at 65% stats.
// - Step = 5% (quantized).
// Purely visual, per organism.
const VIS_SAT_FULL_AT = 0.65; // 65% (on 0..1 scale)
const VIS_SAT_MIN = 0.25;     // 25%
const VIS_SAT_STEP = 0.05;    // 5%

function avgBars01(org){
  const b = org?.bars || {};
  // Bars can be up to 140% (BAR_MAX=1.4). For this visual effect we treat everything above 100% as 100%.
  const f = clamp01(b.food ?? 0);
  const c = clamp01(b.clean ?? 0);
  const h = clamp01(b.hp ?? 0);
  const m = clamp01(b.mood ?? 0);
  return (f + c + h + m) / 4;
}

function quantizeStep(v, step){
  if (!Number.isFinite(v) || !Number.isFinite(step) || step <= 0) return v;
  return Math.round(v / step) * step;
}

function updateVisualSaturation(org){
  if (!org) return;
  const avg = avgBars01(org);
  let sat = 1;
  if (avg < VIS_SAT_FULL_AT){
    const t = clamp01(avg / VIS_SAT_FULL_AT); // 0..1
    sat = VIS_SAT_MIN + t * (1 - VIS_SAT_MIN);
  }
  sat = clamp(sat, VIS_SAT_MIN, 1);
  sat = quantizeStep(sat, VIS_SAT_STEP);
  sat = clamp(sat, VIS_SAT_MIN, 1);
  org.visual = org.visual || {};
  org.visual.saturation = sat;
}

export function simulate(state, deltaSec){
  if (deltaSec <= 0) return { deltaSec: 0, mutations: 0, budMutations: 0, queuedCatchup: 0, eaten: 0, skipped: 0, dueSteps: 0 };

  const now = (state.lastSeen || nowSec()) + deltaSec;
  pruneExpiredCarrots(state, now);
  pruneExpiredCoins(state, now);
  const isOffline = deltaSec >= 15; // same threshold as UI offline summary

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

  // Counters (must be initialized before any per-step processing).
  let eaten = 0;

  // v2.2: Baits are eaten BETWEEN mutations (not inside applyMutationEvent).
  // Run this once per simulation step so close baits resolve quickly (≈1s delay).
  const tNow = now;
  for (const org of orgs){
    if (!org) continue;
    eaten += processCarrotsTick(state, org, tNow);
  }
  eaten += processCoinsTick(state, tNow);


  // Track block deltas for offline report.
  const countBlocks = (org)=>{
    if (!org) return 0;
    const bodyN = Array.isArray(org.body?.cells) ? org.body.cells.length : 0;
    const mods = Array.isArray(org.modules) ? org.modules : [];
    let modN = 0;
    for (const m of mods){
      if (Array.isArray(m?.cells)) modN += m.cells.length;
    }
    return bodyN + modN;
  };
  const blocksBefore = orgs.map(countBlocks);

  // Decay:
  // - Online: apply as a single step (cheap).
  // - Offline: apply along the simulated timeline (inside applySteps) so the hunger
  //   gate doesn't pause "retroactively".
  if (!isOffline){
    for (const org of orgs) applyDecayStep(org, deltaSec);
  }

  
  // =====================
  // New balance v2.2: continuous per-organism evolution (no evoIntervalMin ticks)
  // =====================

  // Ensure per-organism persistent fields exist.
  for (const org of orgs){
    if (!org) continue;
    if (!Number.isFinite(org.evoProgress)) org.evoProgress = 0;
    if (!Number.isFinite(org.mutationDebt)) org.mutationDebt = 0;
    // v2.2 economy: persist per-organism mutation-to-coin accumulator.
    if (!Number.isFinite(org.coinEarnAcc)){
      if (Number.isFinite(org._coinEarnAcc)) org.coinEarnAcc = org._coinEarnAcc;
      else org.coinEarnAcc = 0;
    }
    if (org._coinEarnAcc !== undefined) delete org._coinEarnAcc;

    // v2.2: smooth offline catch-up queue (events to play back on return).
    if (!Number.isFinite(org.offlineCatchup)) org.offlineCatchup = 0;
    if (!Number.isFinite(org.offlineCatchupAcc)) org.offlineCatchupAcc = 0;
    if (!Number.isFinite(org.coinEarnAcc)) org.coinEarnAcc = 0;
    if (!Number.isFinite(org._shrinkAccSec)) org._shrinkAccSec = 0;
  }

  // Reset per-second "ticks" (legacy counters used by mods).
  // NOTE: New balance removes hard per-tick placement limits; we keep these counters only for backward compatibility.
  const secTickId = Math.floor((state.lastSeen || nowSec()) + deltaSec);
  if (!state.carrotTick) state.carrotTick = { id: secTickId, used: 0 };
  if (state.carrotTick.id !== secTickId){
    state.carrotTick.id = secTickId;
    state.carrotTick.used = 0;
  }
  if (!state.coinTick) state.coinTick = { id: secTickId, used: 0 };
  if (state.coinTick.id !== secTickId){
    state.coinTick.id = secTickId;
    state.coinTick.used = 0;
  }

  let mutations = 0;
  let budMutations = 0;
  let queuedCatchup = 0; // v2.2 offline catch-up events queued for smooth playback
  // `eaten` is initialized earlier (before bait processing) to avoid TDZ issues.
  let skipped = 0;
  let dueSteps = 0;
  let simShrinks = 0;

  // Context shared between mutations in the same "moment bucket".
  const getMutationContext = (momentSec)=>{
    const base = Math.max(1, Number(EVO.baseIntervalSec) || 25);
    const tickIndex = Math.floor(momentSec / base);
    if (!state._mutationContext || state._mutationContext.tickIndex !== tickIndex){
      state._mutationContext = {
        tickIndex,
        appendageBudget: 200,
        offlineSim: isOffline,
        offlineRollup: false,
      };
    } else {
      // Update offline flag (can switch if the user returns mid-session).
      state._mutationContext.offlineSim = isOffline;
    }
    return state._mutationContext;
  };

const applyShrinkIfNeeded = (org, dt)=>{
  if (!org || !(dt > 0)) return 0;
  const b = org.bars || {};

  // Усыхание только при глубоком истощении: хотя бы один core-бар <= 0
  if ((b.food ?? 0) > 0 && (b.clean ?? 0) > 0 && (b.hp ?? 0) > 0) return 0;

  org._shrinkAccSec = (org._shrinkAccSec || 0) + dt;

  const stepSec = 10 * 60; // 1 шаг усыхания ~ каждые 10 минут
  const steps = Math.floor(org._shrinkAccSec / stepSec);
  if (steps <= 0) return 0;

  // списываем ТОЛЬКО то, что реально превратилось в "шаги"
  org._shrinkAccSec -= steps * stepSec;

  // ВАЖНО: не применяем shrink тут.
  // Только копим "долг" на применение в общем блоке ниже (с логом и учётом статистики).
  org._offlineShrinks = (org._offlineShrinks || 0) + steps;

  return steps; // вернём сколько шагов начислили (для отладки, если надо)
};

  const maxPerTick = Math.max(1, Math.floor(EVO.maxMutationsPerTick || 2));

  const applyMutationEvent = (org, momentSec, isRollup)=>{
    if (!org) return 0;

    // Movement lock: do not mutate now, convert to debt.
    if (org.__moving){
      org.mutationDebt = Math.max(0, (org.mutationDebt || 0) + 1);
      return 0;
    }

    // Gate by stasis (avg(food,clean,hp) <= sleepThreshold).
    const speedInfo = computeEvoSpeed(org, orgs.length);
    if (speedInfo.inStasis) return 0;

    // Feeding/eating happens between mutations, so do it immediately BEFORE mutating (legacy behavior).

    // Apply mutation (+ optional debt, up to maxPerTick).
    let applied = 0;
    const applyOnce = (rollup)=>{
      org._mutationContext = getMutationContext(momentSec);
      org._mutationContext.offlineRollup = !!rollup;
      org._mutationContext.offlineCatchup = !!org.__offlineCatchupNow;
      applyMutation(org, momentSec);
      applied += 1;

      // Economy v2.2: every 14 mutations of each organism -> +1 coin.
      org.coinEarnAcc = (org.coinEarnAcc || 0) + 1;
      if (org.coinEarnAcc >= 14){
        const n = Math.floor(org.coinEarnAcc / 14);
        org.coinEarnAcc -= n * 14;
        state.inv = state.inv || {};
        state.inv.coins = (state.inv.coins || 0) + n;
      }
    };

    applyOnce(false);

    let debt = Number.isFinite(org.mutationDebt) ? org.mutationDebt : 0;
    const budget = Math.max(0, maxPerTick - applied);
    if (debt > 0 && budget > 0){
      const extra = Math.min(debt, budget);
      for (let i = 0; i < extra; i++){
        applyOnce(!!isRollup);
      }
      org.mutationDebt = Math.max(0, debt - extra);
    }

    return applied;
  };

  // Apply evolution for each organism.
  const MAX_EVENTS_PER_ORG = 200; // safety cap (v2.2)
  const CATCHUP_INTERVAL_SEC = 2.5; // v2.2: 'форсировано, но плавно' on return
  const endT = now;

  for (const org of orgs){
    if (!org) continue;

    if (!isOffline){
      // ONLINE: one continuous update, then apply up to MAX_EVENTS_PER_ORG events.
      const info = computeEvoSpeed(org, orgs.length);
      org.evoSpeed = info.evoSpeed;
      org.inStasis = info.inStasis;

if (info.inStasis){
  // No evolution; queue shrink debt if exhausted.
  org.evoProgress = 0;
  applyShrinkIfNeeded(org, deltaSec);
  continue;
}

      // v2.2: smooth offline catch-up playback (1 event per ~2–3 sec).
      if ((org.offlineCatchup|0) > 0){
        org.offlineCatchupAcc = (org.offlineCatchupAcc || 0) + (deltaSec / CATCHUP_INTERVAL_SEC);
        // Important: never apply multiple catch-up mutations in a single simulate() call.
        // Otherwise a large deltaSec (tab resume / hiccup) creates a burst of mutations at the same timestamp.
        let n = Math.min(org.offlineCatchup|0, Math.min(1, Math.floor(org.offlineCatchupAcc)));
        if (n > 0){
          org.offlineCatchupAcc -= n;
          let appliedTotal = 0;
          for (let i=0; i<n && appliedTotal < MAX_EVENTS_PER_ORG; i++){
            org.__offlineCatchupNow = true;
            const applied = applyMutationEvent(org, endT, false);
            org.__offlineCatchupNow = false;
            if (applied > 0){
              appliedTotal += applied;
              if (org === state) mutations += applied; else budMutations += applied;
            } else {
              skipped += 1;
            }
            org.offlineCatchup = Math.max(0, (org.offlineCatchup|0) - 1);
          }
        }
        // While catch-up is pending, we do not accumulate normal evoProgress to avoid double-speed.
        if ((org.offlineCatchup|0) > 0) continue;
      }

      const intervalSec = evoIntervalSecFromSpeed(info.evoSpeed);
      if (!Number.isFinite(intervalSec) || intervalSec <= 0) continue;

      org.evoProgress += deltaSec / intervalSec;

      let events = 0;
      while (org.evoProgress >= 1 && events < MAX_EVENTS_PER_ORG){
        org.evoProgress -= 1;
        dueSteps += 1;
        const applied = applyMutationEvent(org, endT, false);
        if (applied > 0){
          events += applied;
          if (org === state) mutations += applied; else budMutations += applied;
        } else {
          // If we couldn't apply (e.g., moving), count as skipped/debt already.
          skipped += 1;
          events += 1;
        }
      }
    } else {
      // OFFLINE: simulate along the timeline so evolution stops when stats run out.
      let t = (state.lastSeen || nowSec());
      let events = 0;

      // Make sure cursor starts at the offline start for correct decay.
      if (!Number.isFinite(org._decayCursor)) org._decayCursor = t;

      while (t < endT && events < MAX_EVENTS_PER_ORG){
        // Compute speed at the current moment.
        const info = computeEvoSpeed(org, orgs.length);
        org.evoSpeed = info.evoSpeed;
        org.inStasis = info.inStasis;

if (info.inStasis){
  // Apply decay for the remaining time, then queue shrink debt if needed.
  const dt = Math.max(0, endT - t);
  if (dt > 0) applyDecayStep(org, dt);
  applyShrinkIfNeeded(org, dt);
  t = endT;
  break;
}

        const intervalSec = evoIntervalSecFromSpeed(info.evoSpeed);
        if (!Number.isFinite(intervalSec) || intervalSec <= 0) break;

        // Advance to next event boundary (or to end).
        const nextT = Math.min(endT, t + intervalSec);
        const dt = Math.max(0, nextT - t);
        if (dt > 0) applyDecayStep(org, dt);
        t = nextT;
        org._decayCursor = t;

        if (t >= endT) break;

        // Queue one catch-up event (do not apply instantly; play back smoothly after return).
        dueSteps += 1;
        org.offlineCatchup = Math.min(MAX_EVENTS_PER_ORG, (org.offlineCatchup|0) + 1);
        queuedCatchup += 1;
        events += 1;
      }

      // If we hit the cap, we intentionally do NOT accumulate debt; v2.2 wants safety cap.
      if (events >= MAX_EVENTS_PER_ORG) skipped += 0;
    }
  }

  // Keep compatibility fields used by old UI/offline summary.
  state.lastMutationAt = now;
const blocksAfterMutations = orgs.map(countBlocks);

// Apply accumulated shrink steps.
// Done AFTER time fast-forward, so shrink does not interfere with per-tick mutation placement.
for (const org of orgs){
  const pending = (org && org._offlineShrinks) ? (org._offlineShrinks|0) : 0;
  if (pending <= 0) continue;

  // Safety cap per simulate() call (чтобы не вырубить огромным dt)
  const cap = Math.min(pending, 20);

  let applied = 0;
  for (let i = 0; i < cap; i++){
    if (applyShrinkDecay(org, org.lastMutationAt || now)) applied++;
    else break;
  }

  if (applied > 0){
    simShrinks += applied;
    pushLog(org, `Организм усыхает (-${applied} блок.)`, "alert");
  }

  // ВАЖНО: остаток НЕ сжигаем — оставляем долг на следующий simulate()
  org._offlineShrinks = Math.max(0, pending - applied);
}

  // Repair invariant after offline catch-up: no floating modules disconnected from body.
  // Offline fast-forward can produce detached appendages due to skipped intermediate growth/placement.
  repairDetachedModules(state);
  if (Array.isArray(state.buds)){
    for (const bud of state.buds){
      repairDetachedModules(bud);
    }
  }

  // Сначала объединяем организмы (это может сильно изменить геометрию тела)
  mergeTouchingOrganisms(state);

  // Пододвигаем все внешние органы к новому периметру тела,
  // чтобы "старые" длинные органы не торчали из недр.
  reanchorModulesToPerimeter(state, state);
  if (Array.isArray(state.buds)){
    for (const bud of state.buds){
      if (!bud) continue;
      reanchorModulesToPerimeter(bud, state);
    }
  }


  // Reward: +1 coin when any organism reaches perfect (140%) food+clean+hp.
  rewardCoinForMaxedBars(state);

  state.lastSeen = now;

  // Update visual-only derived fields once per simulate() step.
  // (Render must not compute game logic.)
  for (const org of orgs) updateVisualSaturation(org);


  // Block delta summary (parent + buds). Used in offline report.
  // Важно: рост и усыхание считаем РАЗДЕЛЬНО:
  //  - grownBlocks  = что успело вырасти ДО начала усыхания
  //  - shrunkBlocks = что потеряно ИМЕННО усыханием (после роста)
  const blocksAfterFinal = orgs.map(countBlocks);
  let grownBlocks = 0;
  let shrunkBlocks = 0;
  for (let i=0;i<blocksBefore.length;i++){
    const before = (blocksBefore[i] || 0);
    const mid    = (blocksAfterMutations[i] || 0);
    const after  = (blocksAfterFinal[i] || 0);

    const g = mid - before;
    if (g > 0) grownBlocks += g;

    const s = mid - after;
    if (s > 0) shrunkBlocks += s;
  }


  return { deltaSec, mutations, budMutations, queuedCatchup, eaten, skipped, dueSteps, shrinks: simShrinks, grownBlocks, shrunkBlocks };
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
  const ttlSec = 30 * 60;
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

// ===== Coins (interactive lure) =====
function pruneExpiredCoins(state, now){
  if (!Array.isArray(state.coins) || !state.coins.length) return;
  const ttlSec = 3 * 60;
  const kept = [];
  for (const c of state.coins){
    if (!Number.isFinite(c.t)){
      c.t = now;
      kept.push(c);
      continue;
    }
    if ((now - c.t) <= ttlSec) kept.push(c);
  }
  state.coins = kept;
}

function coinCells(coin){
  const out = [];
  const w = (coin.w ?? COIN.w ?? 3);
  const h = (coin.h ?? COIN.h ?? 3);
  const offsets = coinCellOffsets(w, h);
  for (const [dx, dy] of offsets){
    out.push([coin.x + dx, coin.y + dy]);
  }
  return out;
}

function coreHitsCoin(org, coin){
  // Новое правило: монетка считается "съеденной",
  // если ЛЮБАЯ клетка ТЕЛА (body) подошла к монетке на <= 4 блока.
  // (модули не учитываем — по твоей формулировке "телом")

  const body = org?.body?.cells;
  if (!Array.isArray(body) || body.length === 0) return false;

  const w = ((coin.w ?? COIN.w ?? 3) | 0);
  const h = ((coin.h ?? COIN.h ?? 3) | 0);

  const x0 = (coin.x | 0);
  const y0 = (coin.y | 0);
  const x1 = x0 + w - 1;
  const y1 = y0 + h - 1;

  const R = 4; // радиус в блоках (v2.2: "пересечение телом" ~4 блока)

  // Быстрая проверка: если клетка тела попадает в расширенный AABB (прямоугольник монетки + R)
  // — считаем, что "пересечение телом" произошло.
  const ex0 = x0 - R, ey0 = y0 - R, ex1 = x1 + R, ey1 = y1 + R;

  for (let i = 0; i < body.length; i++){
    const c = body[i];
    if (!c) continue;
    const cx = c[0] | 0;
    const cy = c[1] | 0;
    if (cx >= ex0 && cx <= ex1 && cy >= ey0 && cy <= ey1) return true;
  }

  return false;
}


function addMoodFromCoin(state, org, coin){
  const baseSeed = (state.seed || 1) >>> 0;
  const prng = mulberry32(hash32(baseSeed, 7777, (coin.id || 0) >>> 0, (coin.x|0), (coin.y|0), (org.__orgTag ?? -1) + 10));
  const add = COIN.moodMin + prng() * (COIN.moodMax - COIN.moodMin);
  org.bars.mood = clamp(org.bars.mood + add, 0, MOOD_MAX);
  pushLog(org, `Монетка: +${Math.round(add*100)}% к настроению.`, "care");
}

function processCoinsTick(state, tNow){
  if (!Array.isArray(state.coins) || !state.coins.length) return 0;
  const orgs = [state, ...(Array.isArray(state.buds) ? state.buds : [])];
  const nowT = Number.isFinite(tNow) ? tNow : nowSec();

  let eaten = 0;
  const remaining = [];
  for (const coin of state.coins){
    let hitOrg = null;
    for (let i = 0; i < orgs.length; i++){
      const org = orgs[i];
      if (!org) continue;
      if (coreHitsCoin(org, coin)){
        hitOrg = org;
        break;
      }
    }

    if (!hitOrg){
      // Lost contact: reset timer.
      coin._eatAt = null;
      coin._eatBy = null;
      remaining.push(coin);
      continue;
    }

    const eaterKey = (hitOrg.__orgTag ?? (hitOrg === state ? 0 : 1)) | 0;

    if (coin._eatBy !== eaterKey || !Number.isFinite(coin._eatAt)){
      coin._eatBy = eaterKey;
      coin._eatAt = nowT + 1.0; // v2.2: 1s delay before "eat"
      remaining.push(coin);
      continue;
    }

    if (nowT >= coin._eatAt){
      addMoodFromCoin(state, hitOrg, coin);
      eaten++;
    } else {
      remaining.push(coin);
    }
  }
  state.coins = remaining;
  return eaten;
}


// Player gets +1 coin each time ANY organism reaches 140% for (food, clean, hp).
// Reward triggers only on the transition into the "all max" state.
function rewardCoinForMaxedBars(rootState){
  if (!rootState) return 0;
  const orgs = [rootState, ...(Array.isArray(rootState.buds) ? rootState.buds : [])];
  let gained = 0;
  for (let i = 0; i < orgs.length; i++){
    const org = orgs[i];
    if (!org?.bars) continue;
    const allMax = (org.bars.food >= BAR_MAX - 1e-6) && (org.bars.clean >= BAR_MAX - 1e-6) && (org.bars.hp >= BAR_MAX - 1e-6);
    if (allMax){
      if (!org._coinRewardedMax){
        org._coinRewardedMax = true;
                rootState.inv = rootState.inv || {};

        // IMPORTANT: inventory must be fully initialized (otherwise feeding/wash/heal become locked)
        if (!Number.isFinite(rootState.inv.food))  rootState.inv.food  = INV_DEFAULTS.food;
        if (!Number.isFinite(rootState.inv.water)) rootState.inv.water = INV_DEFAULTS.water;
        if (!Number.isFinite(rootState.inv.heal))  rootState.inv.heal  = INV_DEFAULTS.heal;
        if (!Number.isFinite(rootState.inv.coins)) rootState.inv.coins = INV_DEFAULTS.coins;

        rootState.inv.coins = Math.max(0, (rootState.inv.coins|0) + 1);
        gained += 1;

        const who = (i === 0) ? (rootState.name || "родитель") : (org.name || `почка ${i}`);
        pushLog(rootState, `Монетка: +1 (идеальное состояние: ${who}). Теперь: ${rootState.inv.coins|0}.`, "coin");
      }
    } else {
      org._coinRewardedMax = false;
    }
  }
  return gained;
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

function processCarrotsTick(state, org = state, tNow = null){
  if (!Array.isArray(state.carrots) || !state.carrots.length){
    org.growthTarget = null;
    org.growthTargetMode = null;
    org.growthTargetPower = 0;
    return 0;
  }
  const nowT = Number.isFinite(tNow) ? tNow : nowSec();


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
  function rotDirByHeading(org, dir){
    const a = (org && Number.isFinite(org.headingDeg)) ? (org.headingDeg * Math.PI / 180) : 0;
    if (!a) return dir;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [dir[0]*c - dir[1]*s, dir[0]*s + dir[1]*c];
  }
  function moduleSeesTarget(m, tx, ty){
    if (!m) return false;
    const appendage = m.movable || appendageTypes.has(m.type);
    if (!appendage) return false;
    // Use persisted heading angle (org.headingDeg) so "vision" matches
    // what the player sees when organism is rotated.
    const rawDir = m.growDir || m.baseDir;
    if (!rawDir) return false;
    const dir = rotDirByHeading(org, rawDir);
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
      const eaterKey = (org.__orgTag ?? (org === state ? 0 : 1)) | 0;

      if (car._eatBy !== eaterKey || !Number.isFinite(car._eatAt)){
        car._eatBy = eaterKey;
        car._eatAt = nowT + 1.0; // v2.2: 1s delay before "eat"
        remaining.push(car);
      } else if (nowT >= car._eatAt){
        org.bars.food = clamp(org.bars.food + 0.22, 0, BAR_MAX);
        org.bars.mood = clamp(org.bars.mood + 0.06, 0, MOOD_MAX);
        pushLog(org, `Кормление: морковка съедена.`, "care");
        eaten++;
      } else {
        remaining.push(car);
      }
    } else {
      // Lost contact: reset timer.
      car._eatAt = null;
      car._eatBy = null;
      remaining.push(car);
    }
  }
  state.carrots = remaining;
  if (eaten > 0) updateVisualSaturation(org);

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
    let nearestModuleD = Infinity;
    for (const m of (org.modules || [])){
      const moduleCells = m?.cells || [];
      const moduleD = minDistToCells(moduleCells, tx, ty);
      if (moduleD < nearestModuleD) nearestModuleD = moduleD;
      if (!moduleSeesTarget(m, tx, ty)) continue;
      const d = moduleD;
      if (d < seeingModuleD) seeingModuleD = d;
    }
    const closestD = Math.min(bodyD, seeingModuleD);
    if (closestD > maxRange) continue;

    const hasSeeingBetween = seeingModuleD < bodyD;
    const hasSeeingModule = seeingModuleD < Infinity;
    let mode = null;
    let activeDist = Infinity;
    if (nearestModuleD < bodyD && nearestModuleD <= maxRange){
      mode = "appendage";
      activeDist = nearestModuleD;
    } else if (nearestModuleD <= bodyRange && nearestModuleD <= maxRange){
      // If the carrot is close enough to *any* appendage, prefer a mixed target.
      // Otherwise a large body would constantly classify close carrots as "body" targets,
      // preventing appendages from being biased towards the carrot.
      mode = "mixed";
      activeDist = nearestModuleD;
    } else if (bodyD <= bodyRange && !hasSeeingBetween){
      mode = hasSeeingModule ? "body" : "mixed";
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

function addBar(target, key, add){
  const before = target.bars[key];
  const after  = clamp(before + add, 0, BAR_MAX);
  target.bars[key] = after;
  return after - before; // реальный прирост (0 если упёрлись в кап)
}

function applyCareAction(rootState, target, kind, rng, logFn, label){
  if (!target || !target.bars || !target.care) return 0;
  const add = addRandom01(rng);

  // Inventory gating (balance v2.2): consumables are global for the save.
  const inv = rootState?.inv;
  const spend = (key, n)=>{
    if (!inv) return true;

    // If inventory exists but is not fully initialized, patch it in-place.
    if (key === "food"  && !Number.isFinite(inv.food))  inv.food  = INV_DEFAULTS.food;
    if (key === "water" && !Number.isFinite(inv.water)) inv.water = INV_DEFAULTS.water;
    if (key === "heal"  && !Number.isFinite(inv.heal))  inv.heal  = INV_DEFAULTS.heal;

    const cur = (inv[key] ?? 0) | 0;
    if (cur < n) return false;
    inv[key] = cur - n;
    return true;
  };

  if (kind === "feed"){
    if (!spend("food", 1)){
      logFn?.(`Кормление${label || ""}: нет еды.`);
      return 0;
    }
    const real = addBar(target, "food", add);
    target.bars.mood = clamp(target.bars.mood + real * 0.35, 0, MOOD_MAX);
    target.care.feed += 1.0;
    logFn?.(`Кормление${label || ""}: +${Math.round(real * 100)}% к еде.`);
    return real;
  }
  if (kind === "wash"){
    if (!spend("water", 1)){
      logFn?.(`Мытьё${label || ""}: нет воды.`);
      return 0;
    }
    const real = addBar(target, "clean", add);
    target.bars.mood = clamp(target.bars.mood + real * 0.20, 0, MOOD_MAX);
    target.care.wash += 1.0;
    logFn?.(`Мытьё${label || ""}: +${Math.round(real * 100)}% к чистоте.`);
    return real;
  }
  if (kind === "heal"){
    if (!spend("heal", 1)){
      logFn?.(`Лечение${label || ""}: нет лечения.`);
      return 0;
    }
    const real = addBar(target, "hp", add);
    target.bars.mood = clamp(target.bars.mood + real * 0.15, 0, MOOD_MAX);
    target.care.heal += 1.0;
    logFn?.(`Лечение${label || ""}: +${Math.round(real * 100)}% к HP.`);
    return real;
  }
  return 0;
}

export function act(state, kind){
  const rng = mulberry32(hash32(state.seed, nowSec()));

  applyCareAction(state, state, kind, rng, (msg)=>pushLog(state, msg, "care"), "");

  // Update visual-only derived fields immediately so UI reacts without waiting for the next simulate tick.
  updateVisualSaturation(state);

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

  // Inventory cost (v2.2)
  const inv = rootState.inv || (rootState.inv = {});
  if (kind === "wash"){
    inv.water = inv.water|0;
    if (inv.water <= 0){
      pushLog(rootState, `Нет воды для мытья.${label}`, "care");
      return;
    }
    inv.water -= 1;
  }
  if (kind === "heal"){
    inv.heal = inv.heal|0;
    if (inv.heal <= 0){
      pushLog(rootState, `Нет лечения.${label}`, "care");
      return;
    }
    inv.heal -= 1;
  }

  applyCareAction(rootState, target, kind, rng, withTargetLog, label);

  // Immediate reward check (so UI actions can grant coins without waiting for the next simulate tick).
  rewardCoinForMaxedBars(rootState);

  // Update visual-only derived fields immediately.
  updateVisualSaturation(target);
  const t = nowSec();
  rootState.lastSeen = t;
  if (target) target.lastSeen = t;
  saveGame(rootState);
}