import { DIR8, GRID_W, GRID_H, key, parseKey, mulberry32, hash32, pick, PALETTES } from "./util.js";

function markAnim(org, x, y, dur=0.7){
  if (!org) return;
  if (!org.anim) org.anim = {};
  org.anim[`${x},${y}`] = { t0: Date.now()/1000, dur };
}

import { pushLog } from "./log.js";

export function makeSmallConnectedBody(seed, targetCount=12){
  const rng = mulberry32(hash32(seed, 10101));
  const cx = Math.floor(GRID_W*0.55);
  const cy = Math.floor(GRID_H*0.52);

  const set = new Set();
  set.add(key(cx,cy));

  while (set.size < targetCount){
    const arr = Array.from(set);
    const [bx,by] = parseKey(arr[Math.floor(rng()*arr.length)]);
    const [dx,dy] = DIR8[Math.floor(rng()*DIR8.length)];
    set.add(key(bx + dx, by + dy));
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

  const body = makeSmallConnectedBody(seed, 12);
  const face = findFaceAnchor(body, seed);

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
    face: { anchor: face, eyeSize: 1 },
    modules: [],
    buds: [],
    // Feeding items placed by the player
    carrots: [],
    inv: { carrots: 10 },
    carrotTick: { id: 0, used: 0 }, // max 3 per feeding tick
    growthTarget: null,
    growthTargetMode: null, // "body" | "appendage"
    growthTargetPower: 0,
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

export function growBodyConnected(state, addN, rng, target=null){
  const set = bodyCellSet(state.body);
  const core = state.body.core;

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
    const tx = Array.isArray(target) ? target[0] : null;
    const ty = Array.isArray(target) ? target[1] : null;
    pool.sort((a,b)=>{
      const daCore = Math.abs(a[0]-core[0]) + Math.abs(a[1]-core[1]);
      const dbCore = Math.abs(b[0]-core[0]) + Math.abs(b[1]-core[1]);
      if (tx === null || ty === null) return daCore - dbCore;
      const daT = Math.abs(a[0]-tx) + Math.abs(a[1]-ty);
      const dbT = Math.abs(b[0]-tx) + Math.abs(b[1]-ty);
      // target dominates, core keeps silhouette cohesive
      return (daT*3 + daCore) - (dbT*3 + dbCore);
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
    const kk = key(x,y);
    if (bodySet.has(kk)) break;
    if (occupiedByModules(state, x, y)) break;
    out.push([x,y]);
  }
  return out;
}

export function addModule(state, type, rng, target=null){
  const bodySet = bodyCellSet(state.body);
  const bodyCells = state.body.cells.slice();
  const maxAppendageLen = (state.body?.cells?.length || 0) * 6;

  let anchor = null;
  let anchorCandidates = null;
  for (let tries=0; tries<60 && !anchor; tries++){
    const [ax,ay] = bodyCells[Math.floor(rng()*bodyCells.length)];
    let free = 0;
    for (const [dx,dy] of DIR8){
      const nx=ax+dx, ny=ay+dy;
      if (bodySet.has(key(nx,ny))) continue;
      if (occupiedByModules(state,nx,ny)) continue;
      free++;
    }
    if (free>0) anchor=[ax,ay];
    if (target){
      if (!anchorCandidates) anchorCandidates = [];
      if (free > 0) anchorCandidates.push([ax,ay]);
    }
  }
  if (target && anchorCandidates && anchorCandidates.length){
    anchorCandidates.sort((a,b)=>{
      const da = Math.abs(a[0]-target[0]) + Math.abs(a[1]-target[1]);
      const db = Math.abs(b[0]-target[0]) + Math.abs(b[1]-target[1]);
      return da - db;
    });
    const pickIdx = Math.floor(rng() * Math.min(6, anchorCandidates.length));
    anchor = anchorCandidates[pickIdx];
  }
  if (!anchor) return false;

  const [cx,cy] = state.body.core;
  const [ax,ay] = anchor;

  const dirs = DIR8.slice().sort((d1,d2)=>{
    const n1=[ax+d1[0], ay+d1[1]];
    const n2=[ax+d2[0], ay+d2[1]];
    if (target){
      const d1t = Math.abs(n1[0]-target[0]) + Math.abs(n1[1]-target[1]);
      const d2t = Math.abs(n2[0]-target[0]) + Math.abs(n2[1]-target[1]);
      return d1t - d2t;
    }
    const s1=(n1[0]-cx)*(n1[0]-cx)+(n1[1]-cy)*(n1[1]-cy);
    const s2=(n2[0]-cx)*(n2[0]-cx)+(n2[1]-cy)*(n2[1]-cy);
    return s2 - s1;
  });

  let baseDir = dirs[0];

// если сразу упёрлись — ищем ближайший выход
for (const d of dirs){
  const nx = anchor[0] + d[0];
  const ny = anchor[1] + d[1];
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

  if (type === "tail" || type === "tentacle"){
    movable = true;
    targetLen = 2 + Math.floor(rng()*6);
    dirForGrowth = baseDir;
    const full = buildLineFrom(anchor, baseDir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "limb"){
    movable = true;
    targetLen = 2 + Math.floor(rng()*5);
    const dir = rng()<0.65 ? [0,1] : baseDir;
    dirForGrowth = dir;
    const full = buildLineFrom(anchor, dir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "antenna"){
    movable = true;
    targetLen = 2 + Math.floor(rng()*5);
    const dir = rng()<0.7 ? [0,-1] : baseDir;
    dirForGrowth = dir;
    targetLen = Math.min(targetLen, 27);
    const full = buildLineFrom(anchor, dir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "spike"){
    movable = false;
    targetLen = 1 + Math.floor(rng()*4);
    dirForGrowth = baseDir;
    targetLen = Math.min(targetLen, 10);
    const full = buildLineFrom(anchor, baseDir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "shell"){
    movable = false;
    const [dx,dy] = baseDir;
    const ox = ax + dx, oy = ay + dy;
    const patch = [[ox,oy],[ox+1,oy],[ox,oy+1],[ox+1,oy+1]];
    cells = patch.filter(([x,y]) => !bodySet.has(key(x,y)) && !occupiedByModules(state,x,y));
  } else if (type === "eye"){
    state.face.extraEye = true;
    state.face.eyeSize = Math.min(3, Math.max(1, (state.face.eyeSize || 1) + 1));
    return true;
  } else if (type === "mouth"){
    // mouth: small 2x2 patch near face anchor (front)
    const fa = state.face?.anchor || anchor;
    const patch = [[fa[0]+1,fa[1]],[fa[0]+2,fa[1]],[fa[0]+1,fa[1]+1],[fa[0]+2,fa[1]+1]];
    cells = patch.filter(([x,y]) => !bodySet.has(key(x,y)) && !occupiedByModules(state,x,y));
    movable = false;
    targetLen = cells.length;
    dirForGrowth = baseDir;
  } else if (type === "teeth"){
    // teeth: 1-wide line in front of face anchor, grows up to 6
    movable = false;
    targetLen = 2 + Math.floor(rng()*5);
    const fa = state.face?.anchor || anchor;
    const dir = [1,0];
    dirForGrowth = dir;
    const full = buildLineFrom(fa, dir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "claw"){
    // claw: like a limb but more "hook"-like (grows longer)
    movable = true;
    targetLen = 3 + Math.floor(rng()*7);
    dirForGrowth = baseDir;
    const full = buildLineFrom(anchor, baseDir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "fin"){
    // fin: short 2-wide-ish triangle made of blocks, attached sideways
    movable = false;
    const [dx,dy] = baseDir;
    const ox = ax + dx, oy = ay + dy;
    const patch = [[ox,oy],[ox+dx,oy+dy],[ox+dx,oy+dy+1],[ox+dx,oy+dy-1]];
    cells = patch.filter(([x,y]) => !bodySet.has(key(x,y)) && !occupiedByModules(state,x,y));
    targetLen = cells.length;
    dirForGrowth = baseDir;
  } else {
    return false;
  }

  if (!cells.length) return false;
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
    pigment,
    ...styleParams
  });
    // ----- symmetry: sometimes spawn a mirrored twin organ -----
  const sym = state?.plan?.symmetry ?? 0;
  const canMirror = sym > 0.75 && rng() < 0.45;
  const linear = (type==="tail" || type==="tentacle" || type==="limb" || type==="antenna" || type==="spike" || type==="teeth" || type==="claw");

  if (canMirror && linear && dirForGrowth){
    const [cx,cy] = state.body.core;
    const ax2 = (2*cx - ax);
    const ay2 = ay;

    // mirrored anchor must exist on body
    if (bodySet.has(key(ax2, ay2))){
      const dir2 = [-dirForGrowth[0], dirForGrowth[1]];
      const full2 = buildLineFrom([ax2, ay2], dir2, targetLen, state, bodySet);
      const cells2 = full2.slice(0, Math.min(1, full2.length));

      if (cells2.length){
        for (const [x,y] of cells2) markAnim(state, x, y);
        state.modules.push({
          type,
          movable,
          cells: cells2,
          growTo: targetLen || cells2.length,
          growDir: dir2,
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
  return true;
}

export function growPlannedModules(state, rng, options = {}){
  if (!state?.modules?.length) return 0;

  const { target = null, maxGrows = Infinity, strength = null, shuffle = false } = options;
  const useTarget = Array.isArray(target);
  const bodySet = bodyCellSet(state.body);
  const maxAppendageLen = (state.body?.cells?.length || 0) * 6;
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
    let i = DIR8.findIndex(d => d[0]===dir[0] && d[1]===dir[1]);
    if (i < 0) i = 0;
    return DIR8[(i + steps + DIR8.length) % DIR8.length];
  }
  function seesCarrot(m){
    if (!hasCarrots) return true;
    const appendage =
      m.movable ||
      m.type === "tail" ||
      m.type === "tentacle" ||
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
  } else if (shuffle){
    for (let i = modules.length - 1; i > 0; i--){
      const j = Math.floor(rng() * (i + 1));
      [modules[i], modules[j]] = [modules[j], modules[i]];
    }
  }

  for (const entry of modules){
    const m = entry.m;
    const minLen = m.growTo ?? 0;
    if (!m.growDir) { m.growTo = m.cells.length; continue; }
    if (maxAppendageLen > 0 && m.cells.length >= maxAppendageLen) continue;
    if (m.type === "spike" && m.cells.length >= 10) continue;
    if (m.type === "antenna" && m.cells.length >= 27) continue;
    if (requireSight && !seesCarrot(m)) continue;

    const last = m.cells[m.cells.length - 1];
    let baseDir = m.growDir;
    const moduleInfluence = useTarget ? targetInfluence(moduleDistance(m, target[0], target[1])) : 0;

    // ⛔ У ОСНОВАНИЯ ИГНОРИРУЕМ "КРИВИЗНУ"
    let dir = baseDir;
    if (m.cells.length >= 3){
      if (m.growStyle === "zigzag"){
        dir = (m.growStep % 2 === 0)
          ? baseDir
          : [baseDir[1], -baseDir[0]];
        m.growStep++;
      }
      else if (m.growStyle === "curve"){
        if (rng() < (m.turnChance || 0.2)){
          baseDir = rotateDir(baseDir, m.curveSign || 1);
          m.growDir = baseDir;
        }
        dir = baseDir;
      }
    }

    // 🔍 ПРОБУЕМ ОБОЙТИ ПРЕПЯТСТВИЕ
    const tryDirs = [];
    const pushDir = (d)=>{
      if (!d) return;
      if (tryDirs.some(([x,y]) => x === d[0] && y === d[1])) return;
      tryDirs.push(d);
    };
    const appendage =
      m.movable ||
      m.type === "tail" ||
      m.type === "tentacle" ||
      m.type === "limb" ||
      m.type === "antenna" ||
      m.type === "claw";

    if (appendage) pushDir(baseDir);
    pushDir(dir);
    pushDir(rotateDir(dir, 1));
    pushDir(rotateDir(dir, -1));
    pushDir(rotateDir(dir, 2));
    pushDir(rotateDir(dir, -2));
    pushDir(rotateDir(dir, 3));
    pushDir(rotateDir(dir, -3));

    if (useTarget && moduleInfluence > 0){
      const [tx, ty] = target;
      const ordered = tryDirs.map((dir, index) => ({ dir, index }));
      ordered.sort((a,b)=>{
        const da = Math.abs(last[0] + a.dir[0] - tx) + Math.abs(last[1] + a.dir[1] - ty);
        const db = Math.abs(last[0] + b.dir[0] - tx) + Math.abs(last[1] + b.dir[1] - ty);
        const scoreA = a.index * (1 - moduleInfluence) + da * moduleInfluence;
        const scoreB = b.index * (1 - moduleInfluence) + db * moduleInfluence;
        return scoreA - scoreB;
      });
      tryDirs.length = 0;
      for (const entry of ordered) tryDirs.push(entry.dir);
    }

    let placed = false;

    for (const [dx,dy] of tryDirs){
      const nx = last[0] + dx;
      const ny = last[1] + dy;
      const k = key(nx, ny);

      // ❗ у основания разрешаем рост рядом с телом
      const nearBody = bodySet.has(k);
      if (nearBody && m.cells.length >= 3) continue;

      if (bodySet.has(k)) continue;
      if (occupiedByModules(state, nx, ny)) continue;

      m.cells.push([nx, ny]);
      markAnim(state, nx, ny);
      grew++;
      placed = true;
      if (grew >= maxGrows) return grew;
      break;
    }

    // ❌ если совсем некуда — прекращаем рост этого модуля
    if (!placed){
      continue;
    }
  }

  return grew;
}
