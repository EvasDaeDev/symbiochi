import { mulberry32, hash32, clamp01, pick, key, parseKey } from "./util.js";
import { organLabel } from "./mods/labels.js";
import { DIR8, PALETTES } from "./world.js";
import { BUD } from "./mods/budding.js";
import { EVO } from "./mods/evo.js";
import { pushLog } from "./log.js";
import { growBodyConnected, addModule, makeSmallConnectedBody, growPlannedModules } from "./creature.js";
import { extractGenome, decodeGenome, mergeGenomes, instantiateParentFromGenome } from "./mods/merge.js";

function getGrowthBiases(state, mode="body"){
  const biases = [];

  let carrotTarget = null;
  if (mode === "appendage"){
    if (state.growthTargetMode === "appendage" && Array.isArray(state.growthTarget)){
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
  if (budSeg.length < 4) return false;

  // в буд вставляем маленькое тело вокруг budSeg[0], чтобы было похоже на организм
  const budSeed = (rng() * 2**31) | 0;
  const baseBody = makeSmallConnectedBody(budSeed, 5);
  // переносим baseBody так, чтобы его core совпал с budSeg[0]
  const [bx0,by0] = baseBody.core;
  const [tx,ty] = budSeg[0];
  const dx0 = tx - bx0;
  const dy0 = ty - by0;

  let budBodyCells = translateCells(baseBody.cells, dx0, dy0);

  // добавляем сегменты "почки" к телу (если не пересекается с телом)
  const bodySet = new Set(budBodyCells.map(([x,y]) => key(x,y)));
  for (const [x,y] of budSeg){
    const k = key(x,y);
    if (!bodySet.has(k)){
      budBodyCells.push([x,y]);
      bodySet.add(k);
    }
  }

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
    cam: { ox: budCore[0], oy: budCore[1] },
  };

  assignGrowthPattern(bud, rng);
  state.buds.push(bud);
  state.modules.splice(modIdx, 1);
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

  // Стресс (на основе текущих баров)
  const stress = clamp01(
    (state.bars.food + state.bars.clean + state.bars.hp) / 3
  );

  const M = computeMorphology(state);
  const power = Number.isFinite(state.growthTargetPower) ? state.growthTargetPower : 0;
  const k = 0.35 + 0.65 * power;

  // Late game thresholds
  const isGiant = M.bodyBlocks >= 350;
  const isBigForBud = M.bodyBlocks >= 230;

  // Базовые веса (как раньше)
  let weights = [
    ["grow_body", 0.32 + 0.55*pf + 0.25*pw],
    ["grow_appendage", (state.modules?.length ? 0.12 + 0.03 * state.modules.length : 0)],
    ["tail",      0.10 + 0.85*pf],
    ["tentacle",  0.08 + 0.65*pf + 0.15*ph],
    ["worm",      0.06 + 0.55*pf + 0.10*ph],
    ["limb",      0.10 + 0.75*pf],
    ["antenna",   0.08 + 0.85*ph],
    ["eye",       0.08 + 0.55*ph],
    ["spike",     0.08 + 1.00*pn + 0.40*stress],
    ["shell",     0.06 + 0.85*pw + 0.25*stress]
  ];
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
    bump("limb", 0.30);
    mul("tail", 0.90);
    mul("antenna", 0.95);
  } else if (eco === "swimmer"){
    bump("tail", 0.30);
    bump("fin", 0.18);     // появится только в late-game, но пусть вес уже будет
    mul("limb", 0.85);
  } else if (eco === "sentinel"){
    bump("antenna", 0.30);
    bump("eye", 0.20);
    bump("spike", 0.10);
    mul("grow_body", 0.90);
  } else if (eco === "tank"){
    bump("shell", 0.30);
    bump("spike", 0.20);
    bump("grow_body", 0.12);
    mul("limb", 0.85);
    mul("tail", 0.85);
  }

  // === ЭКОЛОГИЯ (морфо-обратная связь) ===
  // Если тело крупнее, а "мобильность" слабая -> подталкиваем к лапам/хвостам
  const bigBody = M.bodyBlocks >= 10;
  if (bigBody && M.mobilityScore < 0.35){
    weights = weights.map(([k,w]) => {
      if (k==="limb") return [k, w + 0.55];
      if (k==="tail") return [k, w + 0.35];
      if (k==="tentacle") return [k, w + 0.25];
      if (k==="worm") return [k, w + 0.20];
      if (k==="spike") return [k, Math.max(0.02, w - 0.20)];
      return [k,w];
    });
  }

  // Если стресс высокий и защита слабая -> шипы/панцирь
  if (stress > 0.45 && M.defenseScore < 0.25){
    weights = weights.map(([k,w]) => {
      if (k==="spike") return [k, w + 0.75];
      if (k==="shell") return [k, w + 0.45];
      return [k,w];
    });
  }

  // Если "сенсоры" слабые и игрок часто лечит -> антенны/глаза
  if (ph > 0.35 && M.sensoryScore < 0.25){
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
  const canBud = bigBody && pickBuddingModule(state, rng) !== -1;
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
    weights.push(["teeth", 0.10 + 0.20*pf]);
    weights.push(["claw",  0.08 + 0.20*pf + 0.10*M.mobilityScore]);
    weights.push(["mouth", 0.06 + 0.15*pf + 0.10*ph]);
    weights.push(["fin",   0.06 + 0.20*pw]);
  }

  const targetPower = Number.isFinite(state.growthTargetPower) ? state.growthTargetPower : 0;
  const growthCount = 1 + Math.floor(rng() * 4);
  for (let step = 0; step < growthCount; step++){
    let forcedKind = null;
    if (Array.isArray(state.growthTarget) && targetPower >= 0.7){
      if (state.growthTargetMode === "appendage" && (state.modules?.length || 0) > 0){
        forcedKind = "grow_appendage";
      } else {
        forcedKind = "grow_body";
      }
    }
    const kind = forcedKind ?? weightedPick(rng, weights);
    const appendageBudget = Number.isFinite(mutationContext?.appendageBudget)
      ? mutationContext.appendageBudget
      : null;
    const shouldThrottleAppendage = appendageBudget !== null && appendageBudget <= 0 && appendageKinds.has(kind);

    // 1) Почкование
    if (kind === "bud"){
      const idx = pickBuddingModule(state, rng);
      if (idx === -1){
        // нет подходящих модулей - просто рост тела
        const addN = 1 + Math.floor(rng()*2);
        const { biases } = getGrowthBiases(state, "body");
        const grown = growBodyConnected(state, addN, rng, null, biases);
        pushLog(state, grown
          ? `Мутация: почкование не удалось → тело выросло (+${addN}).`
          : `Мутация: почкование не удалось и рост тела не удался.`,
          "mut_fail",
          { part: "body" }
        );
        continue;
      }

      const budType = state.modules[idx]?.type || "tail";

      // Large parents get extra placement attempts (boosts "success" chance).
      const ok = createBudFromModule(state, idx, rng, isBigForBud ? 2 : 1);
      if (ok){
        state.bars.food = clamp01(state.bars.food - 0.20);
        state.bars.hp = clamp01(state.bars.hp - 0.20);
        pushLog(state, `Мутация: почкование — отделился новый организм.`, "bud_ok", { part: budType, mi: idx });
      } else {
        const addN = 1 + Math.floor(rng()*2);
        const grown = growBodyConnected(state, addN, rng);
        pushLog(
          state,
          grown
            ? `Мутация: почкование не поместилось → тело выросло (+${addN}).`
            : `Мутация: почкование не поместилось и рост тела не удался.`,
          "mut_fail",
          { part: budType }
        );
      }
      continue;
    }

    // 2) Рост тела
    if (kind === "grow_body" || shouldThrottleAppendage){
      // Growth per mutation increased by ~1/3.
      const base = 1 + Math.floor(rng() * 3); // 1..3
      const addN = Math.max(1, Math.round(base * (EVO.bodyGrowMult || 1)));
      const { biases } = getGrowthBiases(state, "body");
      const grown = growBodyConnected(state, addN, rng, null, biases);

      if (grown) pushLog(state, `Мутация: тело выросло (+${addN}).`, "mut_ok", { part: "body" });
      else pushLog(state, `Мутация: рост тела не удался.`, "mut_fail", { part: "body" });
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
      const moduleBoost = Math.floor((state.modules?.length || 0) / 4); // +1 per 4 modules
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
        pushLog(state, `Мутация: отросток вырос.`, "mut_ok", {
          part: "appendage",
          mi: primaryMi,
          grownModules
        });
      } else {
        const { biases: bodyBiases } = getGrowthBiases(state, "body");
        const addN = 1 + Math.floor(rng() * 2); // +1..2
        const grownBody = growBodyConnected(state, addN, rng, null, bodyBiases);
        if (grownBody){
          pushLog(
            state,
            `Мутация: рост отростков не удался → тело выросло (+${addN}).`,
            "mut_fail",
            { part: "appendage" }
          );
        } else {
          pushLog(
            state,
            `Мутация: рост отростков не удался и рост тела не удался.`,
            "mut_fail",
            { part: "appendage" }
          );
        }
      }
      continue;
    }

    // 4) Органы (tail/limb/antenna/spike/shell/eye/...)
    const beforeN = (state.modules ? state.modules.length : 0);
    const { biases } = getGrowthBiases(state, "body");
    const target = blendBiasTargets(biases);
    const added = addModule(state, kind, rng, target);
    const afterN = (state.modules ? state.modules.length : 0);
    const newMi = (added?.ok && afterN > beforeN) ? beforeN : null;

    if (added?.ok){
      if (appendageBudget !== null && appendageKinds.has(kind)){
        mutationContext.appendageBudget = Math.max(0, appendageBudget - 1);
      }
      pushLog(state, `Мутация: появился орган (${organLabel(kind)}).`, "mut_ok", { part: kind, mi: newMi });
      continue;
    }

    const reason = added?.reason || "blocked";
    const reasonLabel = {
      type_cap: "достигнут лимит типов",
      too_close: "слишком близко к органу того же типа",
      no_anchor: "не найден якорь",
      blocked: "не поместился"
    }[reason] || "не поместился";

    // Если орган не поместился -> вместо него растим тело (+1..2)
    const addN = 1 + Math.floor(rng() * 2); // +1..2
    const grown = growBodyConnected(state, addN, rng, null, biases);

    if (grown){
      pushLog(
        state,
        `Мутация: орган (${organLabel(kind)}) ${reasonLabel} → тело выросло (+${addN}) для следующей попытки.`,
        "mut_fail",
        { part: kind }
      );
    } else {
      pushLog(
        state,
        `Мутация: орган (${organLabel(kind)}) ${reasonLabel} и рост тела не удался.`,
        "mut_fail",
        { part: kind }
      );
    }
  }
}
