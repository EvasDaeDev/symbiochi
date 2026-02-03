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
    evoIntervalMin: 12,
    name: pick(rng, ["Пип", "Зуз", "Крош", "Мок", "Люм", "Флин", "Бип", "Руф", "Тик", "Нок"]),
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
    carrotTick: { id: 0, used: 0 }, // max 2 per feeding tick
    growthTarget: null,
    growthTargetMode: null, // "body" | "appendage"
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
        if (occupiedByModules(state, nx, ny)) continue;
        candidates.push([nx,ny]);
      }
    }
    if (!candidates.length) return false;

    // If a growth target is provided (e.g. "carrot"), bias growth towards it,
    // otherwise bias towards the core for compact connected bodies.
    const tx = Array.isArray(target) ? target[0] : null;
    const ty = Array.isArray(target) ? target[1] : null;
    candidates.sort((a,b)=>{
      const daCore = Math.abs(a[0]-core[0]) + Math.abs(a[1]-core[1]);
      const dbCore = Math.abs(b[0]-core[0]) + Math.abs(b[1]-core[1]);
      if (tx === null || ty === null) return daCore - dbCore;
      const daT = Math.abs(a[0]-tx) + Math.abs(a[1]-ty);
      const dbT = Math.abs(b[0]-tx) + Math.abs(b[1]-ty);
      // target dominates, core keeps silhouette cohesive
      return (daT*3 + daCore) - (dbT*3 + dbCore);
    });

    const pickIdx = Math.floor(rng()*Math.min(12, candidates.length));
    const [px,py] = candidates[pickIdx];
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

export function addModule(state, type, rng){
  const bodySet = bodyCellSet(state.body);
  const bodyCells = state.body.cells.slice();

  let anchor = null;
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
  }
  if (!anchor) return false;

  const [cx,cy] = state.body.core;
  const [ax,ay] = anchor;

  const dirs = DIR8.slice().sort((d1,d2)=>{
    const n1=[ax+d1[0], ay+d1[1]];
    const n2=[ax+d2[0], ay+d2[1]];
    const s1=(n1[0]-cx)*(n1[0]-cx)+(n1[1]-cy)*(n1[1]-cy);
    const s2=(n2[0]-cx)*(n2[0]-cx)+(n2[1]-cy)*(n2[1]-cy);
    return s2 - s1;
  });

  const baseDir = dirs[0];

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
    const full = buildLineFrom(anchor, dir, targetLen, state, bodySet);
    cells = full.slice(0, Math.min(1, full.length));
  } else if (type === "spike"){
    movable = false;
    targetLen = 1 + Math.floor(rng()*4);
    dirForGrowth = baseDir;
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

export function growPlannedModules(state, rng){
  // Each call tries to extend growing modules by 1 segment.
  // If extension is impossible, we stop growth for that module.
  if (!state?.modules?.length) return 0;
  const bodySet = bodyCellSet(state.body);
  function rotateDir45(dir, sign){
    // вращаем по DIR8 на 1 шаг
    let idx = DIR8.findIndex(d => d[0]===dir[0] && d[1]===dir[1]);
    if (idx < 0) idx = 0;
    idx = (idx + (sign>0 ? 1 : -1) + DIR8.length) % DIR8.length;
    return DIR8[idx];
  }

  function perpDir(dir, sign){
    // перпендикуляр (для зигзага)
    const dx = dir[0], dy = dir[1];
    // (dx,dy) -> (dy,-dx) или (-dy,dx)
    return (sign > 0) ? [dy, -dx] : [-dy, dx];
  }
  let grew = 0;

  for (const m of state.modules){
    const target = (m.growTo ?? m.cells?.length ?? 0);
    if (!m.cells || m.cells.length >= target) continue;
    if (!m.growDir){ m.growTo = m.cells.length; continue; }

const last = m.cells[m.cells.length - 1];

    // choose direction based on style
    let dir = m.growDir;

    if (m.growStyle === "zigzag" && m.baseDir){
      const step = (m.growStep || 0);
      dir = (step % 2 === 0) ? m.baseDir : perpDir(m.baseDir, m.zigzagSign || 1);
      m.growStep = step + 1;
    } else if (m.growStyle === "curve"){
      // occasionally turn left/right by 45°
      if (rng() < (m.turnChance ?? 0.25)){
        dir = rotateDir45(dir, m.curveSign || 1);
        m.growDir = dir; // фиксируем поворот
      }
    }

    const nx = last[0] + dir[0];
    const ny = last[1] + dir[1];
    const kk = key(nx, ny);

    if (bodySet.has(kk)) { m.growTo = m.cells.length; continue; }
    if (occupiedByModules(state, nx, ny)) { m.growTo = m.cells.length; continue; }

    m.cells.push([nx, ny]);
    markAnim(state, nx, ny);
    grew++;
  }
  return grew;
}
