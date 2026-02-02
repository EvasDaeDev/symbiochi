import { BAR_MAX, clamp, clamp01, nowSec, mulberry32, hash32, pick, PALETTES } from "./util.js";
import { DECAY, ACTION_GAIN } from "./mods/stats.js";
import { EVO } from "./mods/evo.js";
import { CARROT } from "./mods/carrots.js";
import { pushLog } from "./log.js";
import { newGame, makeSmallConnectedBody, findFaceAnchor } from "./creature.js";
import { applyMutation } from "./state_mutation.js"; // injected below via export re-map

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

  // ---- Helpers: normalize any organism-like object (root or bud) ----
  function normalizeOrg(org, fallbackSeed){
    if (!org) return;
    const seed = (org.seed ?? fallbackSeed ?? 1) | 0;
    org.seed = seed;
    org.version = 6;
    org.care = org.care || { feed:0, wash:0, heal:0, neglect:0 };
    org.bars = org.bars || { food:1, clean:1, hp:1, mood:1 };
    org.palette = org.palette || pick(mulberry32(seed), PALETTES);
    org.body = org.body || makeSmallConnectedBody(seed, 9);
    org.modules = org.modules || [];
    // normalize cells that might be saved as "x,y" strings in old versions
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
    org.face = org.face || { anchor: findFaceAnchor(org.body, seed) };
    org.cam = org.cam || { ox: org.body.core[0], oy: org.body.core[1] };
    if (org.active === undefined) org.active = null;
    // UI hue shifts (used by buds)
    if (!Number.isFinite(org.hueShiftDeg)) org.hueShiftDeg = 0;
    if (!org.partHue) org.partHue = {};
  }

  // minimal migration to v6
  normalizeOrg(state, state.seed || 1);
  state.log = state.log || [];
  state.evoIntervalMin = state.evoIntervalMin || 12;
  state.lastMutationAt = state.lastMutationAt || (state.createdAt || nowSec());
  state.lastSeen = state.lastSeen || nowSec();

  // Feeding / shaping system (carrots)
  if (!Array.isArray(state.carrots)) state.carrots = [];
  state.inv = state.inv || { carrots: 10 };
  state.carrotTick = state.carrotTick || { id: 0, used: 0 };
  if (state.growthTarget === undefined) state.growthTarget = null;
  if (state.growthTargetMode === undefined) state.growthTargetMode = null;

  // UI / tuning settings
  if (!state.settings) state.settings = {};
  if (!Number.isFinite(state.settings.lengthPriority)) state.settings.lengthPriority = 0.65;
  if (!state.partHue) state.partHue = {};
  // buds may have their own hue shift, and MUST have a palette/body/etc.
  // Otherwise the renderer falls back to dark/black colors.
  if (!Array.isArray(state.buds)) state.buds = [];
  for (let i=0; i<state.buds.length; i++){
    const b = state.buds[i];
    normalizeOrg(b, hash32(state.seed||1, i+1));
    b._isBud = true; // used to disable budding from buds
    if (!Number.isFinite(b.lastMutationAt)) b.lastMutationAt = state.lastMutationAt;
    if (!Number.isFinite(b.lastSeen)) b.lastSeen = state.lastSeen;
    // inherit hue map by reference (same behavior as before)
    if (!b.partHue) b.partHue = state.partHue;
  }

  saveGame(state);
  return state;
}

export function simulate(state, deltaSec){
  if (deltaSec <= 0) return { deltaSec: 0, mutations: 0 };

  const orgs = [state, ...(Array.isArray(state.buds) ? state.buds : [])];
  for (const org of orgs){
    org.bars.food  = clamp(org.bars.food  - DECAY.food_per_sec  * deltaSec, 0, BAR_MAX);
    org.bars.clean = clamp(org.bars.clean - DECAY.clean_per_sec * deltaSec, 0, BAR_MAX);
    org.bars.mood  = clamp(org.bars.mood  - DECAY.mood_per_sec  * deltaSec, 0, BAR_MAX);

    const hungerFactor = clamp01(1 - org.bars.food);
    const dirtFactor   = clamp01(1 - org.bars.clean);
    const sadness      = clamp01(1 - org.bars.mood);

    const hpLoss = (DECAY.base_hp_per_sec + (0.55*hungerFactor + 0.35*dirtFactor + 0.20*sadness) / 3600) * deltaSec;
    org.bars.hp = clamp(org.bars.hp - hpLoss, 0, BAR_MAX);

    const stress = clamp01((hungerFactor + dirtFactor + sadness + clamp01(1-org.bars.hp)) / 4);
    org.care.neglect += deltaSec * (0.00012 * (0.5 + stress));
  }

  const intervalSec = Math.max(60, Math.floor(state.evoIntervalMin * 60));

  // Feeding tick == mutation tick. Reset per-tick carrot limit here.
  const tickId = Math.floor(state.lastSeen / intervalSec);
  if (!state.carrotTick) state.carrotTick = { id: tickId, used: 0 };
  if (state.carrotTick.id !== tickId){
    state.carrotTick.id = tickId;
    state.carrotTick.used = 0;
  }
  const MAX_MUTATIONS_PER_TICK = EVO.maxMutationsPerTick;
  let mutations = 0;

  const upTo = state.lastSeen + deltaSec;

  // parent ticks (includes carrots)
  while ((state.lastMutationAt + intervalSec) <= upTo && mutations < MAX_MUTATIONS_PER_TICK){
    state.lastMutationAt += intervalSec;
    processCarrotsTick(state);
    applyMutation(state, state.lastMutationAt);
    mutations++;
  }

  // buds get their own small evolution (no carrots, no budding)
  if (Array.isArray(state.buds)){
    for (const bud of state.buds){
      const budUpTo = bud.lastSeen + deltaSec;
      let budSteps = 0;
      while ((bud.lastMutationAt + intervalSec) <= budUpTo && budSteps < 1){
        bud.lastMutationAt += intervalSec;
        applyMutation(bud, bud.lastMutationAt);
        budSteps++;
      }
    }
  }

  return { deltaSec, mutations };

}

// ===== Carrots (interactive feeding / shaping) =====
function buildOcc(org){
  const occ = new Set();
  for (const [x,y] of (org?.body?.cells || [])) occ.add(`${x},${y}`);
  for (const m of (org?.modules || [])){
    for (const [x,y] of (m?.cells || [])) occ.add(`${x},${y}`);
  }
  return occ;
}

function carrotCells(car){
  const out = [];
  const w = car.w || 7, h = car.h || 3;
  for (let dy=0; dy<h; dy++){
    for (let dx=0; dx<w; dx++){
      out.push([car.x + dx, car.y + dy]);
    }
  }
  return out;
}

function processCarrotsTick(state){
  if (!Array.isArray(state.carrots) || !state.carrots.length){
    state.growthTarget = null;
    state.growthTargetMode = null;
    return;
  }

  const occ = buildOcc(state);

  // 1) Eat if touches any occupied cell (body or appendages)
  const remaining = [];
  for (const car of state.carrots){
    let touched = false;
    for (const [x,y] of carrotCells(car)){
      if (occ.has(`${x},${y}`)) { touched = true; break; }
    }
    if (touched){
      // immediate eat
      state.bars.food = clamp(state.bars.food + 0.22, 0, BAR_MAX);
      state.bars.mood = clamp(state.bars.mood + 0.06, 0, BAR_MAX);
      pushLog(state, `Кормление: морковка съедена.`, "care");
    } else {
      remaining.push(car);
    }
  }
  state.carrots = remaining;
  if (!state.carrots.length){
    state.growthTarget = null;
    state.growthTargetMode = null;
    return;
  }

  // 2) Choose nearest carrot as a growth target
  const [cx,cy] = state.body?.core || [0,0];
  let best = null;
  let bestD = Infinity;
  for (const car of state.carrots){
    const tx = car.x + Math.floor((car.w||7)/2);
    const ty = car.y + Math.floor((car.h||3)/2);
    const d = Math.abs(tx - cx) + Math.abs(ty - cy);
    if (d < bestD){ bestD = d; best = [tx,ty]; }
  }

  state.growthTarget = best;
  // If close (10..15 blocks) grow body; if far, prefer appendages.
  state.growthTargetMode = (bestD <= 15) ? "body" : "appendage";
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

  if (kind === "feed"){
    const add = addRandom01(rng);
    target.bars.food = clamp(target.bars.food + add, 0, BAR_MAX);
    target.bars.mood = clamp(target.bars.mood + add*0.35, 0, BAR_MAX);
    target.care.feed += 1.0;
    pushLog(rootState, `Кормление${label}: +${Math.round(add*100)}% к еде.`, "care");
  } else if (kind === "wash"){
    const add = addRandom01(rng);
    target.bars.clean = clamp(target.bars.clean + add, 0, BAR_MAX);
    target.bars.mood = clamp(target.bars.mood + add*0.20, 0, BAR_MAX);
    target.care.wash += 1.0;
    pushLog(rootState, `Мытьё${label}: +${Math.round(add*100)}% к чистоте.`, "care");
  } else if (kind === "heal"){
    const add = addRandom01(rng);
    target.bars.hp = clamp(target.bars.hp + add, 0, BAR_MAX);
    target.bars.mood = clamp(target.bars.mood + add*0.15, 0, BAR_MAX);
    target.care.heal += 1.0;
    pushLog(rootState, `Лечение${label}: +${Math.round(add*100)}% к HP.`, "care");
  }

  const t = nowSec();
  rootState.lastSeen = t;
  if (target) target.lastSeen = t;
  saveGame(rootState);
}

