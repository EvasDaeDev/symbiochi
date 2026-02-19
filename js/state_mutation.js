import { mulberry32, hash32, clamp01, pick, key, parseKey } from "./util.js";
import { organLabel } from "./organs/index.js";
import { DIR8, PALETTES } from "./world.js";
import { BUD } from "./mods/budding.js";
import { EVO } from "./mods/evo.js";
import { pushLog } from "./log.js";
import { growBodyConnected, addModule, makeSmallConnectedBody, growPlannedModules, calcBodyPerimeter } from "./creature.js";
import { extractGenome, decodeGenome, mergeGenomes, instantiateParentFromGenome } from "./mods/merge.js";
import { BODY } from "./organs/body.js";
import { ANTENNA } from "./organs/antenna.js";
import { CLAW } from "./organs/claw.js";
import { EYE } from "./organs/eye.js";
import { FIN } from "./organs/fin.js";
import { LIMB } from "./organs/limb.js";
import { MOUTH } from "./organs/mouth.js";
import { SHELL } from "./organs/shell.js";
import { SPIKE } from "./organs/spike.js";
import { TAIL } from "./organs/tail.js";
import { TEETH } from "./organs/teeth.js";
import { TENTACLE } from "./organs/tentacle.js";
import { WORM } from "./organs/worm.js";

function getGrowthBiases(state, mode="body"){
  const biases = [];

  let carrotTarget = null;
  if (mode === "appendage"){
    if (
      (state.growthTargetMode === "appendage" || state.growthTargetMode === "mixed")
      && Array.isArray(state.growthTarget)
    ){
      carrotTarget = state.growthTarget;
    }
  } else if (Array.isArray(state.growthTarget)){
    carrotTarget = state.growthTarget;
  }

  if (carrotTarget){
    biases.push({ point: carrotTarget, weight: 3 });
  }

  return { biases, carrotTarget };
}

function blendBiasTargets(biases){
  if (!Array.isArray(biases) || !biases.length) return null;
  let sumW = 0;
  let sx = 0;
  let sy = 0;
  for (const bias of biases){
    if (!bias || !Array.isArray(bias.point)) continue;
    const w = Number.isFinite(bias.weight) ? bias.weight : 1;
    sumW += w;
    sx += bias.point[0] * w;
    sy += bias.point[1] * w;
  }
  if (!sumW) return null;
  return [Math.round(sx / sumW), Math.round(sy / sumW)];
}

/**
 * Экологическая эволюция + почкование.
 *
 * - Стиль ухода (feed/wash/heal/neglect) влияет на базовые веса.
 * - Морфология (мобильность/защита/сенсоры/размер) подстраивает веса,
 *   чтобы организм "закрывал" слабые места и не зацикливался.
 * - Почкование: отращенный длинный подвижный модуль может отделиться
 *   и стать новым организмом (state.buds[]).
 */

export async function applySymbiosisMerge(state, foreignGenomeOrString){
  try {
    const genomeRemote = await decodeGenome(foreignGenomeOrString);
    const genomeLocal = extractGenome(state);
    if (!genomeLocal || !genomeRemote) throw new Error("no genome");
    const merged = mergeGenomes(genomeLocal, genomeRemote);
    const localSeed = genomeLocal.seed | 0;
    const remoteSeed = genomeRemote.seed | 0;
    const pickFirst = localSeed <= remoteSeed;
    const chosen = pickFirst ? merged.out1 : merged.out2;
    instantiateParentFromGenome(state, chosen);
    pushLog(state, "Контакт принят. Границы перестраиваются.", "symbiosis");
    return { ok: true };
  } catch (err){
    pushLog(state, "Отпечаток не распознан.", "symbiosis");
    return { ok: false, error: err };
  }
}

export function applyShrinkDecay(state, momentSec){
  if (!state || !state.body || !Array.isArray(state.body.cells)) return false;
  const rng = mulberry32(hash32(state.seed, momentSec | 0, 7777));
  const modules = Array.isArray(state.modules) ? state.modules : [];
  const sortedModules = modules
    .map((mod, idx) => ({ mod, idx }))
    .filter(({ mod }) => Array.isArray(mod?.cells) && mod.cells.length > 0)
    .sort((a, b) => b.mod.cells.length - a.mod.cells.length);

  if (sortedModules.length > 0){
    const pickIdx = Math.floor(rng() * Math.min(3, sortedModules.length));
    const target = sortedModules[pickIdx].mod;
    target.cells.pop();
    // IMPORTANT: keep growth cursor in sync with actual geometry.
    // Offline shrink pops cells, but growth uses growPos/growStep. If we don't
    // clamp them, next growth can "continue" from an old endpoint (growing from air).
    if (Array.isArray(target.cells) && target.cells.length){
      const last = target.cells[target.cells.length - 1];
      target.growPos = [last[0], last[1]];
      if (Number.isFinite(target.growStep)){
        target.growStep = Math.min(target.growStep, Math.max(0, target.cells.length - 1));
      }
    } else {
      target.growPos = null;
      if (Number.isFinite(target.growStep)) target.growStep = 0;
    }
    if (target.cells.length === 0){
      state.modules.splice(sortedModules[pickIdx].idx, 1);
    }
    return true;
  }

  if (state.body.cells.length <= 16) return false;
  const coreKey = key(state.body.core[0], state.body.core[1]);
  const removable = state.body.cells.filter(([x, y]) => key(x, y) !== coreKey);
  if (!removable.length) return false;
  const pick = removable[Math.floor(rng() * removable.length)];
  const pickKey = key(pick[0], pick[1]);
  const remaining = state.body.cells.filter(([x, y]) => key(x, y) !== pickKey);
  if (remaining.length < 16) return false;
  state.body.cells = remaining;
  return true;
}

function weightedPick(rng, pairs){
  let sum = 0;
  for (const [,w] of pairs) sum += Math.max(0, w);
  let r = rng() * sum;
  for (const [k,w] of pairs){
    const ww = Math.max(0, w);
    if ((r -= ww) <= 0) return k;
  }
  return pairs[pairs.length - 1][0];
}

// === Organ type caps (per organism) ===
// Limit applies to DISTINCT organ TYPES within each group, not module count.
// (Eyes are excluded by default.)
function getUsedOrganTypesByCaps(state, caps){
  const used = { HARD: new Set(), MOBILE: new Set(), LATE: new Set() };
  if (!caps || !state) return used;
  const ex = new Set(caps.EXCLUDE || []);
  const mods = Array.isArray(state.modules) ? state.modules : [];
  for (const m of mods){
    const t = m?.type;
    if (!t || ex.has(t)) continue;
    if (caps.HARD?.types?.includes(t)) used.HARD.add(t);
    if (caps.MOBILE?.types?.includes(t)) used.MOBILE.add(t);
    if (caps.LATE?.types?.includes(t)) used.LATE.add(t);
  }
  return used;
}

function groupForOrganType(t, caps){
  if (!caps || !t) return null;
  if (caps.HARD?.types?.includes(t)) return "HARD";
  if (caps.MOBILE?.types?.includes(t)) return "MOBILE";
  if (caps.LATE?.types?.includes(t)) return "LATE";
  return null;
}

function applyOrganTypeCapsToWeights(state, baseWeights, caps){
  if (!caps) return baseWeights;
  const used = getUsedOrganTypesByCaps(state, caps);
  const mods = Array.isArray(state.modules) ? state.modules : [];
  const hasAnyModule = mods.length > 0;

  // We only cap ORGAN SPAWN weights (adding a new type).
  // If type already exists -> allow (organ can still be spawned again).
  const spawnKeysToType = {
    antenna: "antenna",
    shell: "shell",
    spike: "spike",
    limb: "limb",
    tail: "tail",
    tentacle: "tentacle",
    worm: "worm",
    claw: "claw",
    fin: "fin",
    mouth: "mouth",
    teeth: "teeth",
    // eye excluded by design
  };

  let blockedSum = 0;
  const out = baseWeights.map(([k, w]) => {
    const t = spawnKeysToType[k];
    if (!t) return [k, w];
    const group = groupForOrganType(t, caps);
    if (!group) return [k, w];
    const capN = Number.isFinite(caps[group]?.cap) ? caps[group].cap : null;
    if (capN === null) return [k, w];
    const isTypePresent = used[group].has(t);
    const isFull = used[group].size >= capN;
    if (isFull && !isTypePresent){
      blockedSum += Math.max(0, w);
      return [k, 0];
    }
    return [k, w];
  });

  // Soft compensation: if we blocked "new type" spawns, redistribute some weight
  // to growth mutations so evolution doesn't stall.
  if (blockedSum > 0){
    const toAppendage = hasAnyModule ? blockedSum * 0.65 : 0;
    const toBody = blockedSum - toAppendage;
    for (let i = 0; i < out.length; i++){
      const k = out[i][0];
      if (k === "grow_appendage" && toAppendage > 0) out[i] = [k, out[i][1] + toAppendage];
      if (k === "grow_body" && toBody > 0) out[i] = [k, out[i][1] + toBody];
    }
  }

  return out;
}

// === Perimeter cap for *new organs* ===
// New organs may not "occupy" more than 75% of the body's perimeter.
// If cap reached: do NOT spawn new organs. Instead either:
//  - grow existing organs (lengthen appendages), OR
//  - grow body to create new perimeter.
const MAX_PERIMETER_USAGE = 0.47;
const EARLY_FAST_BODY_BLOCKS = 250; // early stage grows faster

// We count *occupied perimeter anchors* (body perimeter cells that have an attached organ).
// This matches the requirement "free perimeter too low" much better than a heuristic cost sum.
//
// Implementation notes:
// - Each organ module may touch the body at multiple perimeter cells.
// - We store computed anchors on the module as `anchorKeys` (array of body-cell keys).
// - For backward compatibility with old saves, anchors are computed lazily when needed.

function bodyPerimeterSet(body){
  const set = new Set();
  if (!body || !Array.isArray(body.cells)) return set;
  const bodySet = new Set(body.cells.map(([x, y]) => key(x, y)));
  for (const [x, y] of body.cells){
    // A body cell is on the perimeter if it has at least one empty 4-neighbor.
    if (!bodySet.has(key(x + 1, y)) || !bodySet.has(key(x - 1, y)) || !bodySet.has(key(x, y + 1)) || !bodySet.has(key(x, y - 1))){
      set.add(key(x, y));
    }
  }
  return set;
}

function computeModuleAnchorKeys(state, mod, bodySet, perimSet){
  const anchors = new Set();
  if (!state?.body || !Array.isArray(state.body.cells) || !mod || !Array.isArray(mod.cells) || !mod.cells.length) return anchors;
  // Internal/face modules don't consume perimeter.
  const t = mod.type;
  if (t === "eye" || t === "core") return anchors;

  // Any body perimeter cell adjacent (4-neigh) to any module cell is considered occupied.
  for (const [x, y] of mod.cells){
    const n1 = key(x + 1, y);
    const n2 = key(x - 1, y);
    const n3 = key(x, y + 1);
    const n4 = key(x, y - 1);

    if (bodySet.has(n1) && perimSet.has(n1)) anchors.add(n1);
    if (bodySet.has(n2) && perimSet.has(n2)) anchors.add(n2);
    if (bodySet.has(n3) && perimSet.has(n3)) anchors.add(n3);
    if (bodySet.has(n4) && perimSet.has(n4)) anchors.add(n4);
  }
  return anchors;
}

function collectOccupiedPerimeterAnchors(state){
  const occupied = new Set();
  if (!state?.body || !Array.isArray(state.body.cells)) return occupied;
  const bodySet = new Set(state.body.cells.map(([x, y]) => key(x, y)));
  const perimSet = bodyPerimeterSet(state.body);

  for (const m of (state.modules || [])){
    if (!m) continue;
    // recompute each time because the body perimeter changes as the body grows
    // (cached anchors may become interior or new adjacency points may appear).
    const anchors = computeModuleAnchorKeys(state, m, bodySet, perimSet);
    const keys = Array.from(anchors);
    // cache for debugging / UI / persistence
    m.anchorKeys = keys;
    for (const k of keys){
      if (perimSet.has(k)) occupied.add(k);
    }
  }
  return occupied;
}

function perimeterUsage(state){
  const total = calcBodyPerimeter(state?.body);
  if (!total) return 0;
  const used = collectOccupiedPerimeterAnchors(state).size;
  return used / total;
}

function canSpawnNewOrgan(state){
  return perimeterUsage(state) < MAX_PERIMETER_USAGE;
}

function bodyBounds(body){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const [x,y] of body.cells){
    if (x<minX) minX=x; if (y<minY) minY=y;
    if (x>maxX) maxX=x; if (y>maxY) maxY=y;
  }
  if (!isFinite(minX)) return {minX:0,minY:0,maxX:0,maxY:0};
  return {minX,minY,maxX,maxY};
}

function getParentBodySize(state){
  const b = bodyBounds(state.body);
  return Math.max(1, Math.max(b.maxX-b.minX+1, b.maxY-b.minY+1));
}

function occupiedSet(state){
  const set = new Set();
  for (const [x,y] of state.body.cells) set.add(key(x,y));
  for (const m of state.modules){
    for (const [x,y] of m.cells) set.add(key(x,y));
  }
  // buds тоже считаем занятыми, чтобы не наслаивались
  if (Array.isArray(state.buds)){
    for (const bud of state.buds){
      for (const [x,y] of bud.body.cells) set.add(key(x,y));
      for (const m of bud.modules || []){
        for (const [x,y] of m.cells) set.add(key(x,y));
      }
    }
  }
  return set;
}

function translateCells(cells, dx, dy){
  return cells.map(([x,y]) => [x+dx, y+dy]);
}

function isFree(cells, occ){
  for (const [x,y] of cells){
    if (occ.has(key(x,y))) return false;
  }
  return true;
}

function clampDir(dx,dy){
  return [Math.sign(dx), Math.sign(dy)];
}

function pickBuddingModule(state, rng){
  const candidates = [];
  for (let i=0;i<state.modules.length;i++){
    const m = state.modules[i];
    if (!m.movable) continue;
    if (m.type !== "tail" && m.type !== "tentacle" && m.type !== "worm" && m.type !== "limb" && m.type !== "antenna") continue;
    const len = m.cells.length;
    if (len >= (BUD.minLen|0)) candidates.push([i, len]);
  }
  if (!candidates.length) return -1;
  // чаще выбираем самый длинный
  candidates.sort((a,b)=>b[1]-a[1]);
  const pickIdx = Math.floor(rng() * Math.min(2, candidates.length)); // топ-1..2
  return candidates[pickIdx][0];
}

function createBudFromModule(state, modIdx, rng, triesMult=1){
  if (!Array.isArray(state.buds)) state.buds = [];

  const parentSize = getParentBodySize(state);
  const occ = occupiedSet(state);

  const m = state.modules[modIdx];
  const cells = m.cells.slice();
  const len = cells.length;

  // отрезаем "почку": не ближе чем 2/3 длины от отростка (от крепления),
  // при этом у родителя остаётся хотя бы несколько сегментов.
  // Минимум 4 клетки в почке.
  const minCut = Math.max(2, Math.ceil(len * (2/3)));
  const maxCut = len - 4;
  if (minCut > maxCut) return false;
  const cut = (minCut === maxCut)
    ? minCut
    : (minCut + Math.floor(rng() * (maxCut - minCut + 1)));
  const budSeg = cells.slice(cut);
  // Safety: sometimes module.cells can be malformed or contain holes during movement/regen.
  // If we can't get a valid bud segment, fail gracefully instead of crashing the whole tick.
  if (!Array.isArray(budSeg) || budSeg.length < 4) return false;

  // Дизайн-правило: отпрыск НЕ наследует органы и НЕ получает "мини-тело".
  // Его тело — это только отделившийся сегмент отростка.
  const budSeed = (rng() * 2**31) | 0;
  // Keep only valid [x,y] pairs (guards against undefined entries)
  let budBodyCells = budSeg
    .filter(c => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([x,y]) => [x,y]);
  if (budBodyCells.length < 4) return false;
  const first = budBodyCells[0];
  if (!first) return false;
  const [tx,ty] = first;
  const budCore = [tx, ty];

  // направление, куда "сдвигать" почку, чтобы отделилась от родителя.
  // Для больших организмов пробуем больше направлений (выше шанс успешного размещения).
  const [ax,ay] = cells[0]; // старая точка крепления к телу
  let dir0 = clampDir(budCore[0]-ax, budCore[1]-ay);
  if (dir0[0]===0 && dir0[1]===0) dir0 = pick(rng, DIR8);
  const dirPool = [dir0, ...DIR8];

  // пробуем сместить буд от родителя, но так, чтобы расстояние между ядрами
  // не превышало размера тела родителя
  const [pcx,pcy] = state.body.core;

  // сначала убираем клетки буда из occ (мы ещё не разместили)
  // (на всякий случай - occ уже содержит исходные клетки, но буд пока не добавлен)
  // просто будем проверять free относительно текущего occ.
  let placed = false;
  let finalDx=0, finalDy=0;

  const maxDirs = Math.max(1, Math.min(dirPool.length, 2 * Math.max(1, triesMult)));
  for (let di=0; di<maxDirs && !placed; di++){
    const dir = dirPool[di];
    for (let step=1; step<=parentSize; step++){
      const dx = dir[0]*step;
      const dy = dir[1]*step;

    const shifted = translateCells(budBodyCells, dx, dy);

    // расстояние между ядрами
    const budCx = budCore[0] + dx;
    const budCy = budCore[1] + dy;
    const dist = Math.max(Math.abs(budCx-pcx), Math.abs(budCy-pcy));
    if (dist > parentSize) continue;

      if (isFree(shifted, occ)){
        placed = true;
        finalDx = dx; finalDy = dy;
        budBodyCells = shifted;
        budCore[0] += dx; budCore[1] += dy;
        break;
      }
    }
  }

  if (!placed) return false;

  // палитра: наследуем, чуть варьируем акцент
  const pal = { ...state.palette };
  if (rng() < 0.35){
    const alt = pick(rng, PALETTES);
    pal.accent = alt.accent;
  }

  const bud = {
    version: state.version,
    seed: budSeed,
    createdAt: state.lastSeen,
    lastSeen: state.lastSeen,
	mutationDebt: 0,
    lastMutationAt: state.lastSeen,
    evoIntervalMin: state.evoIntervalMin,
    name: pick(rng, ["Почка", "Отпрыск", "Доча", "Малыш", "Клон"]),
    palette: pal,
    care: { feed: 0, wash: 0, heal: 0, neglect: 0 },
    bars: {
      food: Math.max(0.6, state.bars?.food ?? 1.0),
      clean: Math.max(0.6, state.bars?.clean ?? 1.0),
      hp: Math.max(0.6, state.bars?.hp ?? 1.0),
      mood: Math.max(0.6, state.bars?.mood ?? 1.0),
    },
    body: { cells: budBodyCells, core: budCore },
    modules: [],
    face: {
      anchor: budCore.slice(),
      eyeSize: 1,
      eyeShape: rng() < 0.5 ? "diamond" : "sphere",
      eyeRadius: 0
    },
    // Camera is view-only and should not be stored in organisms.
  };

  state.buds.push(bud);

  // У родителя "почка" реально отделилась: отрезаем хвост модуля,
  // оставляя у родителя базовую часть.
  const parentSeg = cells.slice(0, cut);
  if (parentSeg.length >= 4){
    m.cells = parentSeg;
    const lastCell = parentSeg[parentSeg.length - 1];
    m.growPos = [lastCell[0], lastCell[1]];
  } else {
    // если у родителя осталось слишком мало — удаляем модуль целиком
    state.modules.splice(modIdx, 1);
  }
  return true;
}

function detachAppendageAndDestroy(state, modIdx){
  const m = state.modules[modIdx];
  if (!m || !Array.isArray(m.cells)) return false;
  const cells = m.cells.slice();
  const len = cells.length;
  const minCut = Math.max(2, Math.ceil(len * (2/3)));
  const maxCut = len - 4;
  if (minCut > maxCut) return false;
  const cut = Math.min(minCut, maxCut);
  const parentSeg = cells.slice(0, cut);
  if (parentSeg.length >= 1){
    m.cells = parentSeg;
    const lastCell = parentSeg[parentSeg.length - 1];
    m.growPos = [lastCell[0], lastCell[1]];
  } else {
    state.modules.splice(modIdx, 1);
  }
  return true;
}

function computeMorphology(state){
  const bodyBlocks = state.body.cells.length;

  // total blocks (body + modules) used for analytics/telemetry
  let totalBlocks = bodyBlocks;
  for (const m of (state.modules || [])) totalBlocks += (m.cells?.length || 0);

  let tailLen=0, tentLen=0, wormLen=0, limbLen=0, antLen=0, spikeLen=0, shellCells=0, eyeCount=0;
  let movableCount=0, defenseCount=0, sensoryCount=0;

  for (const m of state.modules){
    const len = m.cells.length;
    if (m.movable) movableCount++;
    if (m.type === "tail" || m.type === "tentacle") tailLen += len;
    if (m.type === "tentacle") tentLen += len;
    if (m.type === "worm") wormLen += len;
    if (m.type === "limb") limbLen += len;
    if (m.type === "antenna") antLen += len;
    if (m.type === "spike") { spikeLen += len; defenseCount++; }
    if (m.type === "shell") { shellCells += len; defenseCount++; }
    if (m.type === "eye") eyeCount += 1;
  }

  sensoryCount = (antLen > 0 ? 1 : 0) + (state.face?.anchor ? 1 : 0) + (eyeCount > 0 ? 1 : 0);

  const mobilityScore = (tailLen + tentLen + wormLen + limbLen) / Math.max(1, bodyBlocks);   // 0..?
  const defenseScore  = (spikeLen + shellCells) / Math.max(1, bodyBlocks);
  const sensoryScore  = (antLen + (state.face?.anchor ? 1 : 0) + eyeCount) / Math.max(1, bodyBlocks);

  return {
    bodyBlocks,
    totalBlocks,
    tailLen,
    tentLen,
    wormLen,
    limbLen,
    antLen,
    spikeLen,
    shellCells,
    mobilityScore,
    defenseScore,
    sensoryScore
  };
}

export function applyMutation(state, momentSec){
  // Mutations can change geometry; when combined with view-driven movement it can cause
  // desync (e.g. organs spawning detached). Mark organism as busy while applying.
  state.evoBusy = true;
  try{
  const rng = mulberry32(hash32(state.seed, momentSec | 0));
  const mutationContext = state?._mutationContext || null;
  const appendageKinds = new Set([
    "grow_appendage",
    "tail",
    "tentacle",
    "worm",
    "limb",
    "antenna",
    "claw",
    "fin"
  ]);

  if (!Array.isArray(state.buds)) state.buds = [];


  // Стиль ухода
  const f = state.care.feed;
  const w = state.care.wash;
  const h = state.care.heal;
  const n = state.care.neglect;
  const total = 1e-6 + f + w + h + n;
  const pf = f / total;
  const pw = w / total;
  const ph = h / total;
  const pn = n / total;

  // Стресс (на основе текущих баров, как в state.js)
  const hungerFactor = clamp01(1 - state.bars.food);
  const dirtFactor = clamp01(1 - state.bars.clean);
  const sadness = clamp01(1 - state.bars.mood);
  const hpLoss = clamp01(1 - state.bars.hp);
  const stress = clamp01((hungerFactor + dirtFactor + sadness + hpLoss) / 4);
  const stressCurve = stress * stress;

  const M = computeMorphology(state);
  const power = Number.isFinite(state.growthTargetPower) ? state.growthTargetPower : 0;
  const k = 0.35 + 0.65 * power;

  // Late game thresholds
  const isGiant = M.bodyBlocks >= 800;
  const isBigForBud = M.bodyBlocks >= 500;

  const bodyGrowWeight = Number.isFinite(BODY.growWeight) ? BODY.growWeight : 0.32;
  const appendageGrowBase = Number.isFinite(BODY.appendageGrowWeight) ? BODY.appendageGrowWeight : 0.12;
  const appendageGrowPerModule = Number.isFinite(BODY.appendageGrowPerModule) ? BODY.appendageGrowPerModule : 0.03;
  const growBodyPenalty = Number.isFinite(BODY.growBodyPenaltyMult) ? BODY.growBodyPenaltyMult : 0.65;

  // Базовые веса (как раньше)
  let weights = [
    ["grow_body", bodyGrowWeight + 0.55*pf + 0.25*pw],
    ["grow_appendage", (state.modules?.length ? appendageGrowBase + appendageGrowPerModule * state.modules.length : 0)],
    ["tail",      (Number.isFinite(TAIL.spawnWeight) ? TAIL.spawnWeight : 0.18) + 0.65*pf],
    ["tentacle",  (Number.isFinite(TENTACLE.spawnWeight) ? TENTACLE.spawnWeight : 0.15) + 0.65*pf + 0.15*ph],
    ["worm",      (Number.isFinite(WORM.spawnWeight) ? WORM.spawnWeight : 0.12) + 0.55*pf + 0.10*ph],
    ["limb",      (Number.isFinite(LIMB.spawnWeight) ? LIMB.spawnWeight : 0.10) + 0.35*pf],
    ["antenna",   (Number.isFinite(ANTENNA.spawnWeight) ? ANTENNA.spawnWeight : 0.12) + 0.85*ph],
    ["eye",       (Number.isFinite(EYE.spawnWeight) ? EYE.spawnWeight : 0.10) + 0.55*ph],
    ["spike",     (Number.isFinite(SPIKE.spawnWeight) ? SPIKE.spawnWeight : 0.08) + 1.00*pn + 0.40*stressCurve],
    ["shell",     (Number.isFinite(SHELL.spawnWeight) ? SHELL.spawnWeight : 0.06) + 0.85*pw + 0.25*stress]
  ];

  // Снизить приоритет роста тела на 15%.
  weights = weights.map(([k, w]) => (k === "grow_body" ? [k, w * growBodyPenalty] : [k, w]));
   // === PERSONAL PLAN (cheap but strong shape diversity) ===
  const plan = state.plan || {};
  const eco = plan.ecotype || "crawler";

  function bump(key, add){
    weights = weights.map(([k,w]) => (k===key ? [k, w + add] : [k,w]));
  }
  function mul(key, m){
    weights = weights.map(([k,w]) => (k===key ? [k, w * m] : [k,w]));
  }

  // Ecotype biases (small, but постоянные -> силуэт меняется заметно)
  if (eco === "crawler"){
    bump("limb", 0.10);
	bump("tentacle", 0.10);
    mul("tail", 0.90);
    mul("antenna", 0.95);
  } else if (eco === "swimmer"){
    bump("tail", 0.15);
    mul("limb", 0.90);
  } else if (eco === "sentinel"){
    bump("antenna", 0.10);
    bump("eye", 0.05);
    bump("spike", 0.10);
    mul("grow_body", 0.90);
  } else if (eco === "tank"){
    bump("shell", 0.10);
    bump("spike", 0.05);
    bump("grow_body", 0.12);
    mul("limb", 0.85);
    mul("tail", 0.85);
	} else if (eco === "lurker"){
  bump("tentacle", 0.10);
  bump("worm", 0.18);
  bump("eye", 0.10);
  mul("limb", 0.88);
  bump("grow_appendage", 0.14);
  } else if (eco === "seer"){
  bump("antenna", 0.10);
  bump("eye", 0.05);
  mul("spike", 0.90);
  mul("grow_body", 0.94);
  } else if (eco === "fortress"){
  bump("shell", 0.18);
  bump("spike", 0.10);
  mul("tail", 0.85);
  mul("limb", 0.85);
  bump("grow_body", 0.06);
  } else if (eco === "bloomer"){
  bump("grow_body", 0.04);
  bump("grow_appendage", 0.02);
  bump("tail", 0.10);
  mul("shell", 0.90);
  }

  // === ЭКОЛОГИЯ (морфо-обратная связь) ===
  // Если тело крупнее, а "мобильность" слабая -> подталкиваем к лапам/хвостам
  const bigBody = M.bodyBlocks >= 400;
  if (bigBody && M.mobilityScore < 0.35){
    weights = weights.map(([k,w]) => {
      if (k==="limb") return [k, w + 0.35];
      if (k==="tail") return [k, w + 0.45];
      if (k==="tentacle") return [k, w + 0.25];
      if (k==="worm") return [k, w + 0.20];
      if (k==="spike") return [k, Math.max(0.02, w - 0.20)];
      return [k,w];
    });
  }

  // Если стресс высокий и защита слабая -> шипы/панцирь
  if (stress > 0.75 && M.defenseScore < 0.25){
    weights = weights.map(([k,w]) => {
      if (k==="spike") return [k, w + 0.75];
      if (k==="shell") return [k, w + 0.45];
      return [k,w];
    });
  }

  // Если "сенсоры" слабые и игрок часто лечит -> антенны/глаза
  if (ph > 0.95 && M.sensoryScore < 0.25){
    weights = weights.map(([k,w]) => {
      if (k==="antenna") return [k, w + 0.55];
      if (k==="eye") return [k, w + 0.25];
      return [k,w];
    });
  }

  // Анти-зацикливание: если уже очень много шипов (относительно тела) — режем шанс шипов
  if (M.defenseScore > 0.95 && M.spikeLen > M.shellCells){
    weights = weights.map(([k,w]) => {
      if (k==="spike") return [k, Math.max(0.02, w - 0.55)];
      if (k==="tail") return [k, w + 0.18];
      if (k==="antenna") return [k, w + 0.18];
      return [k,w];
    });
  }

  // === Почкование (буддинг) ===
  // Чаще появляется, когда организм большой и есть длинный подвижный модуль.
  const barsNow = state.bars || { food:0, clean:0, hp:0, mood:0 };
  const minBar = Math.min(barsNow.food ?? 0, barsNow.clean ?? 0, barsNow.hp ?? 0, barsNow.mood ?? 0);
  // Budding is forbidden when the organism feels "плохо" or worse.
  // Threshold is configurable via EVO.budMinBar (default 0.35).
  const budMinBar = Number.isFinite(EVO?.budMinBar) ? EVO.budMinBar : 0.35;
  const isHealthyEnoughForBud = minBar > budMinBar;
  const isOfflineSim = !!state.__offlineSim;

  const canBud =
    bigBody &&
    !isOfflineSim &&
    isHealthyEnoughForBud &&
    pickBuddingModule(state, rng) !== -1;
  const hasLongModule = (state.modules || []).some((m) => (m?.cells?.length || 0) >= 60);
  if (canBud){
    // добавляем отдельный тип мутации
    const budBase = 0.05 + 0.20*pf + 0.10*(M.mobilityScore);
    // If parent is large enough, budding is easier/more successful in practice,
    // so we allow it to happen more often (and we'll also try harder to place it).
    const longBoost = hasLongModule ? 2.0 : 1.0;
    weights.push(["bud", budBase * (isBigForBud ? 2.0 : 1.0) * longBoost]);
  }

  // After 350+ blocks: меньше антенн/щупалец, но появляются новые мутации.
  if (isGiant){
    weights = weights.map(([k,w]) => {
      if (k === "antenna") return [k, w * 0.35];
      if (k === "tentacle") return [k, w * 0.45];
      return [k, w];
    });
    weights.push(["teeth", (Number.isFinite(TEETH.spawnWeight) ? TEETH.spawnWeight : 0.10) + 0.20*pf]);
    weights.push(["claw",  (Number.isFinite(CLAW.spawnWeight) ? CLAW.spawnWeight : 0.08) + 0.20*pf + 0.10*M.mobilityScore]);
    weights.push(["mouth", (Number.isFinite(MOUTH.spawnWeight) ? MOUTH.spawnWeight : 0.06) + 0.15*pf + 0.10*ph]);
    weights.push(["fin",   (Number.isFinite(FIN.spawnWeight) ? FIN.spawnWeight : 0.06) + 0.20*pw]);
  }

  const organGrowthRate = EVO?.organGrowthRate || {};
  const tailRate = Number.isFinite(organGrowthRate.tail) ? organGrowthRate.tail : 1;
  const tentacleRate = Number.isFinite(organGrowthRate.tentacle) ? organGrowthRate.tentacle : 1;
  if (tailRate !== 1 || tentacleRate !== 1){
    weights = weights.map(([k, w]) => {
      if (k === "tail") return [k, w * tailRate];
      if (k === "tentacle") return [k, w * tentacleRate];
      return [k, w];
    });
  }

  const targetPower = Number.isFinite(state.growthTargetPower) ? state.growthTargetPower : 0;
  const preferAppendageTarget = state.growthTargetMode === "appendage" || state.growthTargetMode === "mixed";
  if (Array.isArray(state.growthTarget) && targetPower >= 0.7){
    weights = weights.map(([k, w]) => {
      if (k === "grow_appendage"){
        return [k, w + 0.25 + 0.4 * targetPower];
      }
      if (k === "grow_body"){
        const factor = preferAppendageTarget ? 0.6 : 0.85;
        return [k, w * factor];
      }
      return [k, w];
    });
  }

  // === Late-body reweight (soft switch to organs) ===
  // After ~600 body blocks, резко уменьшаем шанс роста тела и усиливаем органные мутации.
  // Переход мягкий (600..780), чтобы не было ступеньки.
  {
    const s = M.bodyBlocks;
    const m = clamp01((s - 600) / 180); // 0..1
    const kBodyLate = 1 - 0.92 * m;     // 1.00 -> ~0.08
    const kOtherLate = 1 + 1.20 * m;    // 1.00 -> 2.20
    weights = weights.map(([kk, ww]) => {
      if (kk === "grow_body") return [kk, ww * kBodyLate];
      return [kk, ww * kOtherLate];
    });
  }

  // We want visible progress on every mutation cycle.
  // Early game (<300 body blocks) should noticeably expand the core body.
  const earlyBody = M.bodyBlocks < 300;
  const growthCount = earlyBody ? (2 + Math.floor(rng() * 3)) : (1 + Math.floor(rng() * 4));

  // Helper: body growth with early-game acceleration + consistent logging.
  function growBodyWithEarlyBoost(reasonLabel){
    // Early phase: grow faster so the player quickly reaches ~300 blocks.
    const base = earlyBody ? (3 + Math.floor(rng() * 4)) : (1 + Math.floor(rng() * 3)); // early 3..6, normal 1..3
    let addN = Math.max(1, Math.round(base * (EVO.bodyGrowMult || 1)));
    if (M.bodyBlocks < 120) addN += 2;
    else if (M.bodyBlocks < 200) addN += 1;
    const { biases } = getGrowthBiases(state, "body");
    const grown = growBodyConnected(state, addN, rng, null, biases);
    if (grown){
      pushLog(state, `Эволюция: тело выросло (+${addN})${reasonLabel ? ` — ${reasonLabel}` : ""}.`, "mut_ok", { part: "body" });
      return true;
    }
    pushLog(state, `Эволюция: рост тела не удался${reasonLabel ? ` — ${reasonLabel}` : ""}.`, "mut_fail", { part: "body" });
    return false;
  }
  for (let step = 0; step < growthCount; step++){
    let forcedKind = null;
    let forcedByPerimeter = false;
    let forcedPerimeterMode = null; // "appendage" | "body" | null

    // Early game guarantee: the first step of each mutation cycle always attempts body growth.
    if (earlyBody && step === 0){
      forcedKind = "grow_body";
    }
    if (Array.isArray(state.growthTarget) && targetPower >= 0.85){
      if (preferAppendageTarget && (state.modules?.length || 0) > 0){
        forcedKind = "grow_appendage";
      }
    }
    // Apply per-organism organ-type caps (distinct types per group).
    // Must be evaluated per-step because the organism may gain a new type mid-tick.
    const caps = EVO?.organTypeCaps || null;
    const stepWeights = applyOrganTypeCapsToWeights(state, weights, caps);
    let sumW = 0;
    for (const [, w] of stepWeights) sumW += Math.max(0, w);
    let kind = forcedKind ?? (sumW > 0 ? weightedPick(rng, stepWeights) : "grow_body");
    const appendageBudget = Number.isFinite(mutationContext?.appendageBudget)
      ? mutationContext.appendageBudget
      : null;
    const shouldThrottleAppendage = appendageBudget !== null && appendageBudget <= 0 && appendageKinds.has(kind);

    // === Perimeter cap (strict): if new organs would exceed MAX_PERIMETER_USAGE,
    // do NOT spawn new organs. Prefer lengthening existing organs, otherwise grow body.
    if (
      kind !== "grow_body" &&
      kind !== "grow_appendage" &&
      kind !== "bud" &&
      !shouldThrottleAppendage
    ){
      if (!canSpawnNewOrgan(state)){
        // Prefer extending existing modules if possible.
        if ((state.modules?.length || 0) > 0 && !shouldThrottleAppendage){
          kind = "grow_appendage";
          forcedPerimeterMode = "appendage";
        } else {
          kind = "grow_body";
          forcedPerimeterMode = "body";
        }
        forcedByPerimeter = true;
      }
    }

    // 1) Почкование
    if (kind === "bud"){
      // Hard gate: no budding offline, and no budding when "плохо" or worse.
      if (isOfflineSim || !isHealthyEnoughForBud){
        pushLog(
          state,
          isOfflineSim
            ? `Эволюция: почкование запрещено в оффлайн-режиме → растим тело.`
            : `Эволюция: почкование запрещено при состоянии "плохо" или ниже → растим тело.`,
          "mut_fail",
          { part: "bud" }
        );
        growBodyWithEarlyBoost("почкование заблокировано правилами");
        continue;
      }

      const idx = pickBuddingModule(state, rng);
      if (idx === -1){
        // нет подходящих модулей -> не тратим тик впустую: подрастим тело
        pushLog(state, `Эволюция: почкование не удалось (нет подходящего Органа).`, "mut_fail", { part: "bud" });
        growBodyWithEarlyBoost("фолбэк после неудачного почкования");
        continue;
      }

      const budType = state.modules[idx]?.type || "tail";

      // Large parents get extra placement attempts (boosts "success" chance).
      const ok = createBudFromModule(state, idx, rng, isBigForBud ? 2 : 1);
      if (ok){
        state.bars.food = clamp01(state.bars.food - 0.20);
        state.bars.hp = clamp01(state.bars.hp - 0.20);
        pushLog(state, `Эволюция: почкование — отделился новый организм.`, "bud_ok", { part: budType, mi: idx });
      } else {
        pushLog(
          state,
          `Эволюция: почкование не поместилось.`,
          "mut_fail",
          { part: budType }
        );
        // fallback: if budding placement failed, expand body to create room
        growBodyWithEarlyBoost("фолбэк после неудачного почкования");
      }
      continue;
    }

    // 2) Рост тела
    if (kind === "grow_body" || shouldThrottleAppendage){
      // Body growth per mutation (scaled by EVO.bodyGrowMult). Early stage is faster.
      const base = earlyBody ? (3 + Math.floor(rng() * 4)) : (1 + Math.floor(rng() * 3)); // early 3..6, normal 1..3
      let addN = Math.max(1, Math.round(base * (EVO.bodyGrowMult || 1)));
      if (M.bodyBlocks < 120) addN += 2;
      else if (M.bodyBlocks < 200) addN += 1;

      // If we are forced to grow body due to perimeter cap, accelerate early-stage body growth.
      if (forcedByPerimeter){
        const earlyBonus = (M.bodyBlocks < EARLY_FAST_BODY_BLOCKS) ? 2 : (M.bodyBlocks < 200 ? 1 : 0);
        addN += earlyBonus;
      }
      const { biases } = getGrowthBiases(state, "body");
      const grown = growBodyConnected(state, addN, rng, null, biases);

      if (grown){
        if (forcedByPerimeter){
          pushLog(
            state,
            `Эволюция: периметр занят ≥${Math.round(MAX_PERIMETER_USAGE*100)}% → тело выросло (+${addN}).`,
            "mut_ok",
            { part: "body" }
          );
        } else {
          pushLog(state, `Эволюция: тело выросло (+${addN}).`, "mut_ok", { part: "body" });
        }
      }
      else pushLog(state, `Эволюция: рост тела не удался.`, "mut_fail", { part: "body" });
      continue;
    }

    // 3) Рост отростков (один сегмент)
    if (kind === "grow_appendage"){
      const { biases } = getGrowthBiases(state, "appendage");
      const target = blendBiasTargets(biases);
      const carrotStrength = Number.isFinite(state.growthTargetPower) ? state.growthTargetPower : null;
      let strength = null;
      if (carrotStrength !== null){
        strength = carrotStrength;
      }
      const baseGrows = 1 + Math.floor(rng() * 2); // 1..2
      const moduleBoost = Math.floor((state.modules?.length || 0) / 7); // +1 per 4 modules
      let maxGrows = Math.max(
        1,
        Math.round((baseGrows + moduleBoost) * (EVO.appendageGrowMult || 1))
      );
      if (appendageBudget !== null){
        maxGrows = Math.min(maxGrows, appendageBudget);
      }
      const grownModules = [];
      const grew = growPlannedModules(state, rng, {
        target,
        maxGrows,
        strength,
        shuffle: !target,
        grownModules
      });
      if (grew){
        if (appendageBudget !== null){
          mutationContext.appendageBudget = Math.max(0, appendageBudget - grew);
        }
        const primaryMi = (grownModules.length === 1) ? grownModules[0] : null;
        if (forcedByPerimeter && forcedPerimeterMode === "appendage"){
          pushLog(state, `Эволюция: периметр занят ≥${Math.round(MAX_PERIMETER_USAGE*100)}% → Растут органы.`, "mut_ok", {
            part: "appendage",
            mi: primaryMi,
            grownModules
          });
        } else {
          pushLog(state, `Эволюция: орган вырос.`, "mut_ok", {
            part: "appendage",
            mi: primaryMi,
            grownModules
          });
        }
      } else {
        // Do not waste the mutation step: if appendage growth failed, expand body.
        if (forcedByPerimeter && forcedPerimeterMode === "appendage"){
          pushLog(state, `Эволюция: периметр занят ≥${Math.round(MAX_PERIMETER_USAGE*100)}% → Рост органов не удался.`, "mut_fail", { part: "appendage" });
          // Requirement: if perimeter cap reached and we couldn't extend organs, grow body.
          growBodyWithEarlyBoost("периметр занят — фолбэк на рост тела");
        } else {
          pushLog(state, `Эволюция: рост органов не удался.`, "mut_fail", { part: "appendage" });
          growBodyWithEarlyBoost("фолбэк после неудачного роста отростка");
        }
      }
      continue;
    }

    // 4) Органы (tail/limb/antenna/spike/shell/eye/...)
    const beforeN = (state.modules ? state.modules.length : 0);
    const organBiasMode = appendageKinds.has(kind) ? "appendage" : "body";
    const { biases } = getGrowthBiases(state, organBiasMode);
    const target = blendBiasTargets(biases);
    const added = addModule(state, kind, rng, target);
    const afterN = (state.modules ? state.modules.length : 0);
    const newMi = (added?.ok && afterN > beforeN) ? beforeN : null;

    if (added?.ok){
      if (appendageBudget !== null && appendageKinds.has(kind)){
        mutationContext.appendageBudget = Math.max(0, appendageBudget - 1);
      }
      pushLog(state, `Эволюция: появился орган (${organLabel(kind)}).`, "mut_ok", { part: kind, mi: newMi });
      continue;
    }

    // Не получилось добавить орган: пробуем найти ДРУГОЙ орган, который может появиться.
    // По требованию: рост тела оставляем только если причина "не поместился".
    const firstReason = added?.reason || "blocked";
    // Reasons that should trigger "make room / grow body" fallback.
    let blockedSeen = (firstReason === "blocked" || firstReason === "min_body");

    // IMPORTANT:
    // Use the *effective* weights for this step (with caps + compensation applied),
    // otherwise the fallback may spawn organ types that were intentionally blocked
    // (e.g. by organ-type caps), which can break invariants.
    const organKeys = stepWeights
      .map(([k]) => k)
      .filter((k) => k !== "grow_body" && k !== "grow_appendage" && k !== "bud");

    // Сортируем по весу (сильнее вероятные — раньше), но с небольшим шумом.
    const weightMap = new Map(stepWeights);
    const candidates = organKeys
      .filter((k) => k !== kind)
      .map((k) => ({ k, w: (weightMap.get(k) || 0) }))
      .filter((o) => (o.w || 0) > 0)
      .sort((a, b) => (b.w - a.w) || (rng() - 0.5));

    let altOk = false;
    let altKind = null;
    let altMi = null;
    let lastReason = firstReason;

    for (let i = 0; i < candidates.length; i++){
      const kk = candidates[i].k;
      const beforeAlt = state.modules ? state.modules.length : 0;
      const addedAlt = addModule(state, kk, rng, target);
      const afterAlt = state.modules ? state.modules.length : 0;

      if (addedAlt?.ok){
        altOk = true;
        altKind = kk;
        altMi = (afterAlt > beforeAlt) ? beforeAlt : null;
        if (appendageBudget !== null && appendageKinds.has(kk)){
          mutationContext.appendageBudget = Math.max(0, appendageBudget - 1);
        }
        break;
      }

      lastReason = addedAlt?.reason || lastReason;
      if ((addedAlt?.reason || "") === "blocked") blockedSeen = true;
    }

    if (altOk){
      pushLog(
        state,
        `Эволюция: орган (${organLabel(kind)}) не смог появиться → появился другой орган (${organLabel(altKind)}).`,
        "mut_ok",
        { part: altKind, mi: altMi }
      );
      continue;
    }

    const reasonLabel = {
      type_cap: "достигнут лимит типов",
      too_close: "слишком близко к органу того же типа",
      no_anchor: "не найден якорь",
      min_body: "слишком рано (тело ещё мало)",
      blocked: "не поместился"
    }[firstReason] || "не поместился";

    if (blockedSeen){
      // Fallback: if an organ couldn't be spawned due to geometry or early gating,
      // grow the body so the next mutation has new anchors/perimeter.
      const ok = growBodyWithEarlyBoost(`фолбэк после неудачи органа (${organLabel(kind)}): ${reasonLabel}`);
      if (!ok){
        // already logged in helper
      }
    } else {
      // Иначе — просто фиксируем неудачу, без раздувания тела.
      pushLog(
        state,
        `Эволюция: орган (${organLabel(kind)}) ${reasonLabel}.`,
        "mut_fail",
        { part: kind }
      );
    }
  }
  } finally {
    state.evoBusy = false;
  }
}
