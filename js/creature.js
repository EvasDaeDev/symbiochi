import { key, parseKey, mulberry32, hash32, pick } from "./util.js";
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
import { DIR8, GRID_W, GRID_H, PALETTES } from "./world.js";

function markAnim(org, x, y, dur=0.7){
  if (!org) return;
  if (!org.anim) org.anim = {};
  org.anim[`${x},${y}`] = { t0: Date.now()/1000, dur };
}

import { pushLog } from "./log.js";

const ANGLE_STEP_DEG = 5;
const ANGLE_STEP_RAD = (Math.PI / 180) * ANGLE_STEP_DEG;
const ANGLE_DIRS = Array.from({ length: 360 / ANGLE_STEP_DEG }, (_, i) => {
  const angle = i * ANGLE_STEP_RAD;
  return { angle, dir: [Math.cos(angle), Math.sin(angle)] };
});

function angleDiff(a, b){
  const diff = Math.atan2(Math.sin(a - b), Math.cos(a - b));
  return Math.abs(diff);
}

function dirFromAngle(angle){
  return [Math.cos(angle), Math.sin(angle)];
}

function rotateDir(dir, steps){
  const angle = Math.atan2(dir[1], dir[0]) + steps * ANGLE_STEP_RAD;
  return dirFromAngle(angle);
}

function quantizeDirTo8(dir){
  if (!dir) return dir;
  const len = Math.hypot(dir[0], dir[1]) || 1;
  let best = DIR8[0];
  let bestDot = -Infinity;
  for (const d of DIR8){
    const dot = (dir[0] * d[0] + dir[1] * d[1]) / len;
    if (dot > bestDot){
      bestDot = dot;
      best = d;
    }
  }
  return [best[0], best[1]];
}

function rotateDir8(dir, steps){
  if (!dir) return dir;
  const q = quantizeDirTo8(dir);
  let idx = 0;
  for (let i = 0; i < DIR8.length; i++){
    if (DIR8[i][0] === q[0] && DIR8[i][1] === q[1]){ idx = i; break; }
  }
  const next = (idx + steps + DIR8.length) % DIR8.length;
  return [DIR8[next][0], DIR8[next][1]];
}

function stepFromDir(pos, dir){
  const nextPos = [pos[0] + dir[0], pos[1] + dir[1]];
  return {
    pos: nextPos,
    cell: [Math.round(nextPos[0]), Math.round(nextPos[1])]
  };
}

export function makeSmallConnectedBody(seed, targetCount=12){
  const rng = mulberry32(hash32(seed, 10101));
  const cx = Math.floor(GRID_W*0.55);
  const cy = Math.floor(GRID_H*0.52);

  const set = new Set();
  set.add(key(cx,cy));

  while (set.size < targetCount){
    const candidates = new Map();
    for (const k of set){
      const [bx, by] = parseKey(k);
      for (const [dx, dy] of DIR8){
        const nx = bx + dx;
        const ny = by + dy;
        const kk = key(nx, ny);
        if (set.has(kk)) continue;
        if (!candidates.has(kk)) candidates.set(kk, [nx, ny]);
      }
    }
    const pool = Array.from(candidates.values());
    pool.sort((a, b) => {
      const da = Math.abs(a[0] - cx) + Math.abs(a[1] - cy);
      const db = Math.abs(b[0] - cx) + Math.abs(b[1] - cy);
      if (da !== db) return da - db;
      let na = 0;
      let nb = 0;
      for (const [dx, dy] of DIR8){
        if (set.has(key(a[0] + dx, a[1] + dy))) na++;
        if (set.has(key(b[0] + dx, b[1] + dy))) nb++;
      }
      return nb - na;
    });
    const pickIdx = Math.floor(rng() * Math.min(6, pool.length));
    const [px, py] = pool[pickIdx];
    set.add(key(px, py));
  }

  return { core:[cx,cy], cells:Array.from(set).map(parseKey) };
}

export function bodyCellSet(body){
  const s = new Set();
  for (const [x,y] of body.cells) s.add(key(x,y));
  return s;
}

export function findFaceAnchor(body, seed){
  const rng = mulberry32(hash32(seed, 20202));
  const cells = body.cells.slice().sort((a,b)=>b[0]-a[0]);
  return cells[Math.floor(rng()*Math.min(3, cells.length))] || body.core;
}

export function getTotalBlocks(state){
  let n = state.body.cells.length;
  for (const m of state.modules) n += m.cells.length;
  return n;
}

export function getStageName(state){
  const blocks = getTotalBlocks(state);
  if (blocks <= 12) return "Клетка";
  if (blocks <= 25) return "Существо";
  if (blocks <= 45) return "Организм";
  if (blocks <= 70) return "Вид";
  return "Форма жизни";
}

export function newGame(){
  const seed = (Math.random() * 2**31) | 0;
  const rng = mulberry32(seed);
  const pal = pick(rng, PALETTES);

  const baseBodySize = 12;
  const targetBodySize = baseBodySize * (2 + Math.floor(rng() * 3));
  const body = makeSmallConnectedBody(seed, targetBodySize);
  const face = findFaceAnchor(body, seed);
  const eyeShape = rng() < 0.5 ? "diamond" : "sphere";

 const plan = {
    // предпочитаемое направление роста (силуэт)
    axisDir: pick(rng, DIR8),
    // 0..1: стремление к симметрии (парные органы)
    symmetry: rng(),
    // 0..1: насколько "кривые" будут отростки (прямые/зигзаг/дуга)
    wiggle: rng(),
    // простой "экотип" — даёт разный стиль тела
    ecotype: pick(rng, ["crawler","swimmer","sentinel","tank"])
  };
  const state = {
    version: 6,
    seed,
    createdAt: Math.floor(Date.now()/1000),
    lastSeen: Math.floor(Date.now()/1000),
    lastMutationAt: Math.floor(Date.now()/1000),
	mutationDebt: 0,
    evoIntervalMin: 2,
    name: pick(rng, ["Пип", "Зуз", "Крош", "Мок", "Люм", "Флин", "Бип", "Руф", "Тик", "Нок", "Плюм", "Зо", "Мип", "Фло", "Нюк", "Бру", "Топ", "Луф", "Кеп", "Мокси", "Рум", "Ик"]),
    palette: pal,
	plan,
    care: { feed: 0, wash: 0, heal: 0, neglect: 0 },
    bars: { food: 1.00, clean: 1.00, hp: 1.00, mood: 1.00 },
    body,
    face: { anchor: face, eyeSize: 1, eyeShape, eyeRadius: 0 },
    modules: [],
    buds: [],
    // Feeding items placed by the player
    carrots: [],
    inv: { carrots: 10 },
    carrotTick: { id: 0, used: 0 }, // max 3 per feeding tick
    growthTarget: null,
    growthTargetMode: null, // "body" | "appendage"
    growthTargetPower: 0,
    growthQueueIndex: 0,
    active: null,
    log: [],
    cam: { ox: body.core[0], oy: body.core[1] },
  };

  pushLog(state, `Вылупился питомец "${state.name}".`, "system");
  return state;
}

export function occupiedByModules(state, x, y){
  for (const m of state.modules){
    for (const c of m.cells){
      if (c[0]===x && c[1]===y) return true;
    }
  }
  return false;
}

export function growBodyConnected(state, addN, rng, target=null, biases=null){
  const set = bodyCellSet(state.body);
  const core = state.body.core;
  const biasList = [];
  if (Array.isArray(target)) biasList.push({ point: target, weight: 3 });
  if (Array.isArray(biases)) biasList.push(...biases);
  const plan = state?.plan || {};
  const axisDir = Array.isArray(plan.axisDir) ? plan.axisDir : null;
  const axisLen = axisDir ? (Math.hypot(axisDir[0], axisDir[1]) || 1) : 1;
  const axisUnit = axisDir ? [axisDir[0] / axisLen, axisDir[1] / axisLen] : null;
  let axisScale = 1;
  switch (plan.ecotype){
    case "swimmer":
      axisScale = 1.6;
      break;
    case "crawler":
      axisScale = 1.35;
      break;
    case "sentinel":
      axisScale = 1.1;
      break;
    case "tank":
      axisScale = 0.9;
      break;
    default:
      axisScale = 1.15;
  }
  if (Number.isFinite(plan.symmetry)){
    axisScale += (plan.symmetry - 0.5) * 0.2;
    axisScale = Math.max(0.75, Math.min(1.9, axisScale));
  }
  const wiggle = Number.isFinite(plan.wiggle) ? plan.wiggle : 0;
  const noiseWeight = 0.08 + 0.22 * wiggle;

  function anisotropicDistance(x, y, origin){
    const dx = x - origin[0];
    const dy = y - origin[1];
    if (!axisUnit) return Math.hypot(dx, dy);
    const proj = dx * axisUnit[0] + dy * axisUnit[1];
    const perp = -dx * axisUnit[1] + dy * axisUnit[0];
    return Math.hypot(proj / axisScale, perp * axisScale);
  }
  function jitterScore(x, y){
    const seed = (state?.seed ?? 1) | 0;
    const h = hash32(seed, (x * 73856093) ^ (y * 19349663));
    return ((h & 1023) / 1023) * noiseWeight;
  }

  for (let i=0;i<addN;i++){
    const candidates = [];
    for (const k of set){
      const [x,y] = parseKey(k);
      for (const [dx,dy] of DIR8){
        const nx=x+dx, ny=y+dy;
        const kk = key(nx,ny);
        if (set.has(kk)) continue;
        const blockedByModule = occupiedByModules(state, nx, ny);
        candidates.push([nx, ny, blockedByModule]);
      }
    }
    if (!candidates.length) return false;
    const freeCandidates = candidates.filter((c) => !c[2]);
    const pool = freeCandidates.length ? freeCandidates : candidates;

    // If a growth target is provided (e.g. "carrot"), bias growth towards it,
    // otherwise bias towards the core for compact connected bodies.
    pool.sort((a,b)=>{
      const daCore = anisotropicDistance(a[0], a[1], core) + jitterScore(a[0], a[1]);
      const dbCore = anisotropicDistance(b[0], b[1], core) + jitterScore(b[0], b[1]);
      if (!biasList.length) return daCore - dbCore;
      let scoreA = daCore;
      let scoreB = dbCore;
      for (const bias of biasList){
        if (!bias || !Array.isArray(bias.point)) continue;
        const w = Number.isFinite(bias.weight) ? bias.weight : 1;
        const daT = Math.hypot(a[0] - bias.point[0], a[1] - bias.point[1]);
        const dbT = Math.hypot(b[0] - bias.point[0], b[1] - bias.point[1]);
        scoreA += daT * w;
        scoreB += dbT * w;
      }
      return scoreA - scoreB;
    });

    const pickIdx = Math.floor(rng()*Math.min(12, pool.length));
    const [px,py] = pool[pickIdx];
    set.add(key(px,py));
  }

  state.body.cells = Array.from(set).map(parseKey);
  return true;
}

function buildLineFrom(anchor, dir, len, state, bodySet){
  const [ax,ay] = anchor;
  const [dx,dy] = dir;
  const out = [];
  let x=ax, y=ay;
  for (let i=0;i<len;i++){
    x += dx; y += dy;
    const nx = Math.round(x);
    const ny = Math.round(y);
    const kk = key(nx,ny);
    if (bodySet.has(kk)) break;
    if (occupiedByModules(state, nx, ny)) break;
    out.push([nx,ny]);
  }
  return out;
}

function buildLimbPlan(rng, baseDir){
  const count = LIMB.phalanxCountMin + Math.floor(rng() * (LIMB.phalanxCountMax - LIMB.phalanxCountMin + 1));
  const lengths = Array.from({ length: count }, () => (
    LIMB.phalanxLenMin + Math.floor(rng() * (LIMB.phalanxLenMax - LIMB.phalanxLenMin + 1))
  ));
  const turnSteps = Array.from({ length: count - 1 }, () => 0);
  const base = quantizeDirTo8(baseDir);
  const dirs = Array.from({ length: count }, () => [base[0], base[1]]);
  const angles = Array.from({ length: count }, () => (
    LIMB.animAngleMin + Math.floor(rng() * (LIMB.animAngleMax - LIMB.animAngleMin + 1))
  ));
  const animDirection = rng() < 0.5 ? -1 : 1;
  return {
    lengths,
    dirs,
    turnSteps,
    totalLength: lengths.reduce((sum, len) => sum + len, 0),
    anim: { direction: animDirection, angles }
  };
}

function buildEyeOffsets(radius, shape){
  const out = [];
  const r = Math.max(0, radius | 0);
  for (let dy = -r; dy <= r; dy++){
    for (let dx = -r; dx <= r; dx++){
      if (shape === "sphere"){
        if ((dx * dx + dy * dy) <= r * r) out.push([dx, dy]);
      } else {
        if (Math.abs(dx) + Math.abs(dy) <= r) out.push([dx, dy]);
      }
    }
  }
  if (out.length === 0) out.push([0, 0]);
  return out;
}

export function addModule(state, type, rng, target=null){
  const bodySet = bodyCellSet(state.body);
  const bodyCells = state.body.cells.slice();
  const maxAppendageLen = (state.body?.cells?.length || 0) * 3;
  const existingTypes = new Set((state.modules || []).map((m) => m?.type).filter(Boolean));
  if (state?.face?.anchor) existingTypes.add("eye");
  if (!existingTypes.has(type) && existingTypes.size >= 7) return { ok: false, reason: "type_cap" };

  function isTooCloseToSameType(candidateCells){
    if (!candidateCells.length || !Array.isArray(state.modules)) return false;
    for (const mod of state.modules){
      if (mod?.type !== type) continue;
      for (const [cx, cy] of mod.cells || []){
        for (const [nx, ny] of candidateCells){
          const dx = Math.abs(cx - nx);
          const dy = Math.abs(cy - ny);
          if (Math.max(dx, dy) <= 1) return true;
        }
      }
    }
    return false;
  }

  function hasFreeNeighbor(ax, ay){
    for (const [dx,dy] of DIR8){
      const nx = ax + dx;
      const ny = ay + dy;
      if (bodySet.has(key(nx, ny))) continue;
      if (occupiedByModules(state, nx, ny)) continue;
      return true;
    }
    return false;
  }

  function sortAnchorsByTarget(list){
    return list.slice().sort((a, b) => {
      if (!Array.isArray(target)){
        if (a[0] !== b[0]) return a[0] - b[0];
        return a[1] - b[1];
      }
      const da = Math.abs(a[0] - target[0]) + Math.abs(a[1] - target[1]);
      const db = Math.abs(b[0] - target[0]) + Math.abs(b[1] - target[1]);
      if (da !== db) return da - db;
      if (a[0] !== b[0]) return a[0] - b[0];
      return a[1] - b[1];
    });
  }

  let anchor = null;
  let anchorCandidates = null;
  for (let tries=0; tries<60 && !anchor; tries++){
    const [ax,ay] = bodyCells[Math.floor(rng()*bodyCells.length)];
    const free = hasFreeNeighbor(ax, ay);
    if (free) anchor = [ax, ay];
    if (target){
      if (!anchorCandidates) anchorCandidates = [];
      if (free) anchorCandidates.push([ax, ay]);
    }
  }
  if (target && anchorCandidates && anchorCandidates.length){
    const sorted = sortAnchorsByTarget(anchorCandidates);
    const pickIdx = Math.floor(rng() * Math.min(6, sorted.length));
    anchor = sorted[pickIdx];
  }
  if (!anchor){
    const allCandidates = [];
    for (const [ax, ay] of bodyCells){
      if (hasFreeNeighbor(ax, ay)) allCandidates.push([ax, ay]);
    }
    if (allCandidates.length){
      const sorted = sortAnchorsByTarget(allCandidates);
      anchor = sorted[0];
    }
  }
  if (!anchor) return { ok: false, reason: "no_anchor" };

  const [cx,cy] = state.body.core;
  const [ax,ay] = anchor;

  const desiredAngle = target
    ? Math.atan2(target[1] - ay, target[0] - ax)
    : Math.atan2(ay - cy, ax - cx);
  const dirs = ANGLE_DIRS.slice().sort((a, b) => {
    return angleDiff(a.angle, desiredAngle) - angleDiff(b.angle, desiredAngle);
  });

  let baseDir = dirs[0]?.dir;

  // если сразу упёрлись — ищем ближайший выход
  for (const entry of dirs){
    const d = entry.dir;
    const nx = ax + Math.round(d[0]);
    const ny = ay + Math.round(d[1]);
    if (
      !bodySet.has(key(nx,ny)) &&
      !occupiedByModules(state, nx, ny)
    ){
      baseDir = d;
      break;
    }
  }

  let cells = [];
  let movable = false;
  let targetLen = 0;
  let dirForGrowth = null;
  let limbPlan = null;
  let eyeShape = null;
  let eyeRadius = null;

  if (type === "tail" || type === "tentacle"){
    movable = true;
    const cfg = (type === "tail") ? TAIL : TENTACLE;
    targetLen = cfg.minLen + Math.floor(rng() * cfg.maxExtra);
    dirForGrowth = baseDir;
    const full = buildLineFrom(anchor, baseDir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "worm"){
    movable = true;
    const maxWormLen = Math.max(1, Math.floor((state.body?.cells?.length || 0) * WORM.maxBodyMult));
    targetLen = WORM.minLen + Math.floor(rng() * WORM.maxExtra);
    targetLen = Math.min(targetLen, maxWormLen);
    dirForGrowth = baseDir;
    const full = buildLineFrom(anchor, baseDir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "limb"){
    movable = true;
    const dir = rng() < LIMB.downBias ? [0,1] : quantizeDirTo8(baseDir);
    limbPlan = buildLimbPlan(rng, dir);
    targetLen = limbPlan.totalLength;
    dirForGrowth = dir;
    const full = buildLineFrom(anchor, dir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "antenna"){
    movable = true;
    targetLen = ANTENNA.minLen + Math.floor(rng() * ANTENNA.maxExtra);
    const dir = rng() < ANTENNA.upBias ? [0,-1] : quantizeDirTo8(baseDir);
    dirForGrowth = dir;
    targetLen = Math.min(targetLen, ANTENNA.maxLen);
    const full = buildLineFrom(anchor, dir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "spike"){
    movable = false;
    targetLen = SPIKE.minLen + Math.floor(rng() * SPIKE.maxExtra);
    dirForGrowth = baseDir;
    targetLen = Math.min(targetLen, SPIKE.maxLen);
    const full = buildLineFrom(anchor, baseDir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "shell"){
    movable = false;
    const baseStep = stepFromDir([ax, ay], baseDir).cell;
    const dx = baseStep[0] - ax;
    const dy = baseStep[1] - ay;
    const ox = ax + dx, oy = ay + dy;
    const patch = [
      [ox, oy],
      [ox + 1, oy],
      [ox, oy + 1],
      [ox + 1, oy + 1]
    ].slice(0, SHELL.size * SHELL.size);
    cells = patch.filter(([x,y]) => !bodySet.has(key(x,y)) && !occupiedByModules(state,x,y));
  } else if (type === "eye"){
    eyeShape = rng() < EYE.shapeChance ? "diamond" : "sphere";
    eyeRadius = (state.body?.cells?.length || 0) < EYE.smallBodyThreshold
      ? 1
      : (rng() < EYE.largeRadiusChance ? 1 : 2);
    const faceAnchor = state.face?.anchor;
    const faceEyeRadius = Math.max(0, (state.face?.eyeRadius ?? ((state.face?.eyeSize ?? 1) - 1)) | 0);
    const faceEyeShape = state.face?.eyeShape || (rng() < EYE.shapeChance ? "diamond" : "sphere");
    const faceEyeSet = new Set();
    if (faceAnchor && faceEyeRadius >= 0){
      for (const [dx, dy] of buildEyeOffsets(faceEyeRadius, faceEyeShape)){
        faceEyeSet.add(key(faceAnchor[0] + dx, faceAnchor[1] + dy));
      }
    }
    const options = DIR8.slice();
    for (let i = options.length - 1; i > 0; i--){
      const j = Math.floor(rng() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    let placed = null;
    let sawTooClose = false;
    let sawBlocked = false;
    for (const d of options){
      const center = stepFromDir([ax, ay], d).cell;
    const offsets = buildEyeOffsets(eyeRadius, eyeShape);
      const candidate = offsets.map(([dx, dy]) => [center[0] + dx, center[1] + dy]);
      if (candidate.some(([x, y]) => x === state.body.core[0] && y === state.body.core[1])){ sawBlocked = true; continue; }
      if (candidate.some(([x, y]) => bodySet.has(key(x, y)))){ sawBlocked = true; continue; }
      if (candidate.some(([x, y]) => occupiedByModules(state, x, y))){ sawBlocked = true; continue; }
      if (candidate.some(([x, y]) => faceEyeSet.has(key(x, y)))){ sawBlocked = true; continue; }
      if (isTooCloseToSameType(candidate)){ sawTooClose = true; continue; }
      placed = candidate;
      break;
    }
    if (!placed) return { ok: false, reason: (sawTooClose && !sawBlocked) ? "too_close" : (sawTooClose ? "too_close" : "blocked") };
    cells = placed;
    movable = false;
    targetLen = cells.length;
    dirForGrowth = null;
  } else if (type === "mouth"){
    // mouth: small 2x2 patch near face anchor (front)
    const fa = state.face?.anchor || anchor;
    const patch = [
      [fa[0] + MOUTH.offset, fa[1]],
      [fa[0] + MOUTH.offset + 1, fa[1]],
      [fa[0] + MOUTH.offset, fa[1] + 1],
      [fa[0] + MOUTH.offset + 1, fa[1] + 1]
    ].slice(0, MOUTH.size * MOUTH.size);
    cells = patch.filter(([x,y]) => !bodySet.has(key(x,y)) && !occupiedByModules(state,x,y));
    movable = false;
    targetLen = cells.length;
    dirForGrowth = baseDir;
  } else if (type === "teeth"){
    // teeth: 1-wide line in front of face anchor, grows up to 6
    movable = false;
    targetLen = TEETH.minLen + Math.floor(rng() * TEETH.maxExtra);
    const fa = state.face?.anchor || anchor;
    const dir = [TEETH.dir[0], TEETH.dir[1]];
    dirForGrowth = dir;
    const full = buildLineFrom(fa, dir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "claw"){
    // claw: like a limb but more "hook"-like (grows longer)
    movable = true;
    targetLen = CLAW.minLen + Math.floor(rng() * CLAW.maxExtra);
    targetLen = Math.min(targetLen, CLAW.maxLen);
    dirForGrowth = baseDir;
    const full = buildLineFrom(anchor, baseDir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "fin"){
    // fin: short 2-wide-ish triangle made of blocks, attached sideways
    movable = false;
    const baseStep = stepFromDir([ax, ay], baseDir).cell;
    const dx = baseStep[0] - ax;
    const dy = baseStep[1] - ay;
    const ox = ax + dx, oy = ay + dy;
    const patch = [
      [ox, oy],
      ...FIN.offsets.map(([step, yOffset]) => [ox + dx * step, oy + dy + yOffset])
    ];
    cells = patch.filter(([x,y]) => !bodySet.has(key(x,y)) && !occupiedByModules(state,x,y));
    targetLen = cells.length;
    dirForGrowth = baseDir;
  } else {
    return { ok: false, reason: "blocked" };
  }

  if (!cells.length) return { ok: false, reason: "blocked" };
  if (isTooCloseToSameType(cells)) return { ok: false, reason: "too_close" };
  if (dirForGrowth && maxAppendageLen > 0 && targetLen){
    targetLen = Math.min(targetLen, maxAppendageLen);
  }
  for (const [x,y] of cells) markAnim(state, x, y);
  // slight per-module tone variation (±10% intended for rendering)
  const pigment = {
    tone: (rng()*0.20) - 0.10,   // -0.10..+0.10
    grad: (rng()*0.10) - 0.05    // -0.05..+0.05 (along length)
  };

 // ----- growth style (straight / zigzag / curve) -----
  const wiggle = state?.plan?.wiggle ?? 0.0;
  let growStyle = "straight";
  if (movable || type === "spike" || type === "teeth"){
    if (wiggle > 0.66) growStyle = "curve";
    else if (wiggle > 0.33) growStyle = "zigzag";
  }
  if (type === "limb"){
    growStyle = "jointed";
  }
  if (type === "antenna" || type === "spike") growStyle = "straight";

  const styleParams = {
    baseDir: dirForGrowth ? [dirForGrowth[0], dirForGrowth[1]] : null,
    growStyle,
    growStep: 0,
    zigzagSign: rng() < 0.5 ? 1 : -1,
    curveSign: rng() < 0.5 ? 1 : -1,
    turnChance: 0.15 + 0.35 * wiggle // чем выше wiggle, тем чаще повороты
  };
  
  state.modules.push({
    type,
    movable,
    cells,
    growTo: targetLen || cells.length,
    growDir: dirForGrowth,
    growPos: cells.length ? [cells[cells.length - 1][0], cells[cells.length - 1][1]] : null,
    pigment,
    phalanxLengths: limbPlan?.lengths,
    phalanxDirs: limbPlan?.dirs,
    limbAnim: limbPlan?.anim,
    eyeShape: type === "eye" ? eyeShape : undefined,
    eyeRadius: type === "eye" ? eyeRadius : undefined,
    ...styleParams
  });
    // ----- symmetry: sometimes spawn a mirrored twin organ -----
  const sym = state?.plan?.symmetry ?? 0;
  const canMirror = sym > 0.75 && rng() < 0.45;
  const linear = (type==="tail" || type==="tentacle" || type==="worm" || type==="limb" || type==="antenna" || type==="spike" || type==="teeth" || type==="claw");

  if (canMirror && linear && dirForGrowth){
    const [cx,cy] = state.body.core;
    const ax2 = (2*cx - ax);
    const ay2 = ay;

    // mirrored anchor must exist on body
    if (bodySet.has(key(ax2, ay2))){
      const dir2 = [-dirForGrowth[0], dirForGrowth[1]];
      const full2 = buildLineFrom([ax2, ay2], dir2, targetLen, state, bodySet);
      const cells2 = full2.slice(0, Math.min(1, full2.length));

      if (cells2.length && !isTooCloseToSameType(cells2)){
        for (const [x,y] of cells2) markAnim(state, x, y);
        state.modules.push({
          type,
          movable,
          cells: cells2,
          growTo: targetLen || cells2.length,
          growDir: dir2,
          growPos: cells2.length ? [cells2[cells2.length - 1][0], cells2[cells2.length - 1][1]] : null,
          pigment: { ...pigment, tone: pigment.tone * 0.8 }, // чуть отличим
          baseDir: [dir2[0], dir2[1]],
          growStyle,
          growStep: 0,
          zigzagSign: -(styleParams.zigzagSign || 1),
          curveSign: -(styleParams.curveSign || 1),
          turnChance: styleParams.turnChance
        });
      }
    }
  }
  return { ok: true };
}

export function growPlannedModules(state, rng, options = {}){
  if (!state?.modules?.length) return 0;

  const {
    target = null,
    maxGrows = Infinity,
    strength = null,
    shuffle = false,
    grownModules = null
  } = options;
  const useTarget = Array.isArray(target);
  const bodySet = bodyCellSet(state.body);
  const maxAppendageLen = (state.body?.cells?.length || 0) * 3;
  const maxWormLen = (state.body?.cells?.length || 0) * WORM.maxBodyMult;
  const carrotCenters = useTarget
    ? [target]
    : Array.isArray(state.carrots)
      ? state.carrots.map((car) => ([
        car.x + Math.floor((car.w ?? 7) / 2),
        car.y + Math.floor((car.h ?? 3) / 2)
      ]))
      : [];
  const hasCarrots = carrotCenters.length > 0;
  const cos45 = Math.SQRT1_2;
  const requireSight = !useTarget;

  function rotateDir(dir, steps){
    const angle = Math.atan2(dir[1], dir[0]) + steps * ANGLE_STEP_RAD;
    return dirFromAngle(angle);
  }
  function rotateDirForModule(m, dir, steps){
    if (m?.type === "limb" || m?.type === "antenna"){
      return rotateDir8(dir, steps);
    }
    return rotateDir(dir, steps);
  }

  function phalanxIndex(lengths, idx){
    if (!Array.isArray(lengths) || !lengths.length) return 0;
    let acc = 0;
    for (let i = 0; i < lengths.length; i++){
      acc += lengths[i];
      if (idx < acc) return i;
    }
    return lengths.length - 1;
  }
  function seesCarrot(m){
    if (!hasCarrots) return true;
    const appendage =
      m.movable ||
      m.type === "tail" ||
      m.type === "tentacle" ||
      m.type === "worm" ||
      m.type === "limb" ||
      m.type === "antenna" ||
      m.type === "claw";
    if (!appendage) return true;
    const dir = m.growDir || m.baseDir;
    if (!dir) return true;
    const base = m.cells?.[0] || m.cells?.[m.cells.length - 1];
    if (!base) return true;
    const dirLen = Math.hypot(dir[0], dir[1]) || 1;
    for (const [cx, cy] of carrotCenters){
      const vx = cx - base[0];
      const vy = cy - base[1];
      const vLen = Math.hypot(vx, vy);
    if (vLen === 0) return true;
      const dot = (vx * dir[0] + vy * dir[1]) / (vLen * dirLen);
      if (dot >= cos45) return true;
    }
    return false;
  }

  function moduleDistance(m, tx, ty){
    let best = Infinity;
    for (const [x,y] of (m.cells || [])){
      const d = Math.abs(x - tx) + Math.abs(y - ty);
      if (d < best) best = d;
    }
    return best;
  }

  function targetInfluence(dist){
    const base = Number.isFinite(strength) ? strength : 1;
    const scaled = Math.max(0, Math.min(1, 1 - dist / 45));
    return Math.pow(scaled, 2) * Math.max(0, Math.min(1, base));
  }

  let grew = 0;
  const modules = state.modules.map((m, i) => ({ m, i }));
  if (useTarget){
    const [tx, ty] = target;
    modules.sort((a,b) => {
      const da = moduleDistance(a.m, tx, ty);
      const db = moduleDistance(b.m, tx, ty);
      const ia = targetInfluence(da);
      const ib = targetInfluence(db);
      const scoreA = a.i * (1 - ia) + da * ia;
      const scoreB = b.i * (1 - ib) + db * ib;
      return scoreA - scoreB;
    });
    if (modules.length > 1){
      const rawIndex = Number.isFinite(state.growthQueueIndex) ? state.growthQueueIndex : 0;
      const start = ((rawIndex % modules.length) + modules.length) % modules.length;
      if (start){
        modules.push(...modules.splice(0, start));
      }
    }
  } else if (shuffle){
    for (let i = modules.length - 1; i > 0; i--){
      const j = Math.floor(rng() * (i + 1));
      [modules[i], modules[j]] = [modules[j], modules[i]];
    }
  }

  let lastGrownPos = null;
  for (let pos = 0; pos < modules.length; pos++){
    const entry = modules[pos];
    const m = entry.m;
    const minLen = Number.isFinite(m.growTo) ? m.growTo : 0;
    if (!m.growDir) { m.growTo = m.cells.length; continue; }
    if (!Array.isArray(m.growPos) && m.cells.length){
      const lastCell = m.cells[m.cells.length - 1];
      m.growPos = [lastCell[0], lastCell[1]];
    }
    if (minLen > 0 && m.cells.length >= minLen) continue;
    if (maxAppendageLen > 0 && m.cells.length >= maxAppendageLen) continue;
    if (m.type === "worm" && maxWormLen > 0 && m.cells.length >= maxWormLen) continue;
    if (m.type === "spike" && m.cells.length >= SPIKE.maxLen) continue;
    if (m.type === "antenna" && m.cells.length >= ANTENNA.maxLen) continue;
    if (m.type === "claw" && m.cells.length >= CLAW.maxLen) continue;
    if (requireSight && !seesCarrot(m)) continue;

    const last = m.cells[m.cells.length - 1];
    const growPos = Array.isArray(m.growPos) ? m.growPos : [last[0], last[1]];
    let baseDir = m.growDir;
    const moduleInfluence = useTarget ? targetInfluence(moduleDistance(m, target[0], target[1])) : 0;
    if (m.type === "limb" || m.type === "antenna"){
      baseDir = quantizeDirTo8(baseDir);
      m.growDir = baseDir;
    }

    if (m.type === "antenna" || m.type === "spike"){
      m.growStyle = "straight";
    }

    // ⛔ У ОСНОВАНИЯ ИГНОРИРУЕМ "КРИВИЗНУ"
    let dir = baseDir;
    let segIndex = null;
    let jointedDir = null;
    if (m.growStyle === "jointed" && Array.isArray(m.phalanxLengths) && Array.isArray(m.phalanxDirs)){
      segIndex = phalanxIndex(m.phalanxLengths, m.cells.length);
      jointedDir = m.phalanxDirs[segIndex] || baseDir;
      dir = jointedDir;
      baseDir = jointedDir;
    } else if (m.cells.length >= 3){
      // ⛔ У ОСНОВАНИЯ ИГНОРИРУЕМ "КРИВИЗНУ"
      if (m.growStyle === "zigzag"){
        dir = (m.growStep % 2 === 0)
          ? baseDir
          : [baseDir[1], -baseDir[0]];
        m.growStep++;
      }
      else if (m.growStyle === "curve"){
        if (rng() < (m.turnChance || 0.2)){
          baseDir = rotateDirForModule(m, baseDir, m.curveSign || 1);
          m.growDir = baseDir;
        }
        dir = baseDir;
      }
    }

    // 🔍 ПРОБУЕМ ОБОЙТИ ПРЕПЯТСТВИЕ
    const tryDirs = [];
    const tryDirKeys = new Set();
    const pushDir = (d)=>{
      if (!d) return;
      const k = `${Math.round(d[0] * 1000)},${Math.round(d[1] * 1000)}`;
      if (tryDirKeys.has(k)) return;
      tryDirKeys.add(k);
      tryDirs.push(d);
    };
    const appendage =
      m.movable ||
      m.type === "tail" ||
      m.type === "tentacle" ||
      m.type === "worm" ||
      m.type === "limb" ||
      m.type === "antenna" ||
      m.type === "claw";

    if (m.growStyle === "jointed"){
      pushDir(dir);
      pushDir(rotateDir8(dir, 1));
      pushDir(rotateDir8(dir, -1));
      pushDir(rotateDir8(dir, 2));
      pushDir(rotateDir8(dir, -2));
    } else {
      if (appendage) pushDir(baseDir);
      pushDir(dir);
      pushDir(rotateDirForModule(m, dir, 1));
      pushDir(rotateDirForModule(m, dir, -1));
      pushDir(rotateDirForModule(m, dir, 2));
      pushDir(rotateDirForModule(m, dir, -2));
      pushDir(rotateDirForModule(m, dir, 3));
      pushDir(rotateDirForModule(m, dir, -3));
    }

    if (useTarget && moduleInfluence > 0){
      const [tx, ty] = target;
      const ordered = tryDirs.map((dir, index) => ({ dir, index }));
      ordered.sort((a,b)=>{
        const aStep = stepFromDir(growPos, a.dir).cell;
        const bStep = stepFromDir(growPos, b.dir).cell;
        const da = Math.abs(aStep[0] - tx) + Math.abs(aStep[1] - ty);
        const db = Math.abs(bStep[0] - tx) + Math.abs(bStep[1] - ty);
        const scoreA = a.index * (1 - moduleInfluence) + da * moduleInfluence;
        const scoreB = b.index * (1 - moduleInfluence) + db * moduleInfluence;
        return scoreA - scoreB;
      });
      tryDirs.length = 0;
      for (const entry of ordered) tryDirs.push(entry.dir);
    }

    let placed = false;

    for (const dir of tryDirs){
      const step = stepFromDir(growPos, dir);
      const [nx, ny] = step.cell;
      if (nx === last[0] && ny === last[1]) continue;
      const k = key(nx, ny);

      // ❗ у основания разрешаем рост рядом с телом
      const nearBody = bodySet.has(k);
      if (nearBody && m.cells.length >= 3) continue;

      if (bodySet.has(k)) continue;
      if (occupiedByModules(state, nx, ny)) continue;

      if (m.growStyle === "jointed" && segIndex !== null && jointedDir){
        if (dir[0] !== jointedDir[0] || dir[1] !== jointedDir[1]){
          for (let i = segIndex; i < m.phalanxDirs.length; i++){
            m.phalanxDirs[i] = [dir[0], dir[1]];
          }
          jointedDir = dir;
        }
      }

      m.cells.push([nx, ny]);
      m.growPos = step.pos;
      markAnim(state, nx, ny);
      if (Array.isArray(grownModules) && !grownModules.includes(entry.i)){
        grownModules.push(entry.i);
      }
      grew++;
      placed = true;
      lastGrownPos = pos;
      if (grew >= maxGrows){
        if (lastGrownPos !== null && modules.length > 0){
          state.growthQueueIndex = (lastGrownPos + 1) % modules.length;
        }
        return grew;
      }
      break;
    }

    // ❌ если совсем некуда — прекращаем рост этого модуля
    if (!placed){
      continue;
    }
  }
  if (lastGrownPos !== null && modules.length > 0){
    state.growthQueueIndex = (lastGrownPos + 1) % modules.length;
  }

  return grew;
}
