import { hash32, mulberry32, pick, key } from "./util.js";

// Add new pattern PNGs here (store files in /patterns, naming: pattern-*.png).
// Sample PNGs are not bundled; provide your own files in /patterns.
const PATTERN_FILES = [
  "patterns/pattern-x.png",
  "patterns/pattern-ring.png"
];

const PATTERN_POWER_MIN = 0.55;
const PATTERN_POWER_MAX = 0.77;

let cachedPatterns = null;

function loadImage(src){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=> resolve(img);
    img.onerror = (err)=> reject(err);
    img.src = src;
  });
}

async function loadPattern(path){
  const img = await loadImage(path);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const staticCells = [];
  const dynamicCells = [];
  const cx = Math.floor(canvas.width / 2);
  const cy = Math.floor(canvas.height / 2);
  for (let y = 0; y < canvas.height; y++){
    for (let x = 0; x < canvas.width; x++){
      const i = (y * canvas.width + x) * 4;
      const alpha = data[i + 3];
      if (alpha > 0){
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const dx = x - cx;
        const dy = y - cy;
        const isRed = r >= 200 && g <= 70 && b <= 70;
        const isBlack = r <= 40 && g <= 40 && b <= 40;
        if (isRed){
          dynamicCells.push([dx, dy]);
        } else if (isBlack){
          staticCells.push([dx, dy]);
        }
      }
    }
  }
  return {
    id: path,
    width: canvas.width,
    height: canvas.height,
    staticCells,
    dynamicCells
  };
}

export async function initGrowthPatterns(){
  if (cachedPatterns) return cachedPatterns;
  const loaded = [];
  for (const file of PATTERN_FILES){
    try{
      const pattern = await loadPattern(file);
      if (pattern.staticCells.length || pattern.dynamicCells.length) loaded.push(pattern);
    } catch (err){
      console.warn("Failed to load growth pattern", file, err);
    }
  }
  cachedPatterns = loaded;
  return loaded;
}

export function getGrowthPatterns(){
  return cachedPatterns || [];
}

export function assignGrowthPattern(org, rng){
  const patterns = getGrowthPatterns();
  if (!patterns.length || !org?.body?.core) return;
  const pattern = pick(rng, patterns);
  if (!pattern || (!pattern.staticCells.length && !pattern.dynamicCells.length)) return;
  const power = PATTERN_POWER_MIN + rng() * (PATTERN_POWER_MAX - PATTERN_POWER_MIN);
  const [ox, oy] = org.body.core;
  const remainingStatic = pattern.staticCells.map(([x, y]) => [x + ox, y + oy]);
  const remainingDynamic = pattern.dynamicCells.map(([x, y]) => [x + ox, y + oy]);
  org.growthPattern = {
    id: pattern.id,
    power,
    origin: [ox, oy],
    remainingStatic,
    remainingDynamic,
    total: remainingStatic.length + remainingDynamic.length,
    done: false
  };
}

export function ensureGrowthPattern(org){
  if (!org || org.growthPattern) return;
  const seed = (org.seed ?? 1) | 0;
  const rng = mulberry32(hash32(seed, 8191));
  assignGrowthPattern(org, rng);
}

export function syncGrowthPatternProgress(org){
  if (!org?.growthPattern || org.growthPattern.done) return false;
  const remainingStatic = Array.isArray(org.growthPattern.remainingStatic)
    ? org.growthPattern.remainingStatic
    : [];
  const remainingDynamic = Array.isArray(org.growthPattern.remainingDynamic)
    ? org.growthPattern.remainingDynamic
    : [];
  if (!remainingStatic.length && !remainingDynamic.length) return false;
  const bodyCells = org.body?.cells || [];
  if (!bodyCells.length) return false;
  const bodySet = new Set(bodyCells.map(([x, y]) => key(x, y)));
  const moduleCells = (org.modules || []).flatMap(m => m?.cells || []);
  const moduleSet = new Set(moduleCells.map(([x, y]) => key(x, y)));
  const nextStatic = remainingStatic.filter(([x, y]) => !bodySet.has(key(x, y)) && !moduleSet.has(key(x, y)));
  const nextDynamic = remainingDynamic.filter(([x, y]) => !bodySet.has(key(x, y)) && !moduleSet.has(key(x, y)));
  org.growthPattern.remainingStatic = nextStatic;
  org.growthPattern.remainingDynamic = nextDynamic;
  if (!nextStatic.length && !nextDynamic.length){
    org.growthPattern.done = true;
  }
  return true;
}

function pickNearestToCore(org, remaining){
  const core = org.body?.core || [0, 0];
  let best = remaining[0];
  let bestD = Infinity;
  for (const cell of remaining){
    const d = Math.abs(cell[0] - core[0]) + Math.abs(cell[1] - core[1]);
    if (d < bestD){
      bestD = d;
      best = cell;
    }
  }
  return best;
}

export function getGrowthPatternBias(org, mode="body"){
  if (!org?.growthPattern || org.growthPattern.done) return null;
  const remaining = mode === "appendage"
    ? (Array.isArray(org.growthPattern.remainingDynamic) ? org.growthPattern.remainingDynamic : [])
    : (Array.isArray(org.growthPattern.remainingStatic) ? org.growthPattern.remainingStatic : []);
  if (!remaining.length) return null;
  const target = pickNearestToCore(org, remaining);
  const power = Number.isFinite(org.growthPattern.power)
    ? org.growthPattern.power
    : PATTERN_POWER_MIN;
  return {
    point: target,
    weight: 3 * power
  };
}

export function isGrowthPatternActive(org){
  if (!org?.growthPattern || org.growthPattern.done) return false;
  const remainingStatic = Array.isArray(org.growthPattern.remainingStatic)
    ? org.growthPattern.remainingStatic
    : [];
  const remainingDynamic = Array.isArray(org.growthPattern.remainingDynamic)
    ? org.growthPattern.remainingDynamic
    : [];
  return remainingStatic.length > 0 || remainingDynamic.length > 0;
}

export function blendBiasTargets(biases){
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

export function normalizeGrowthPattern(org){
  if (!org || !org.growthPattern) return;
  const gp = org.growthPattern;
  gp.origin = Array.isArray(gp.origin)
    ? [gp.origin[0] | 0, gp.origin[1] | 0]
    : (org.body?.core ? [org.body.core[0] | 0, org.body.core[1] | 0] : [0, 0]);
  gp.remainingStatic = Array.isArray(gp.remainingStatic)
    ? gp.remainingStatic.map((v)=> Array.isArray(v) ? [v[0] | 0, v[1] | 0] : v)
      .filter((v)=> Array.isArray(v) && v.length >= 2)
    : [];
  if (!gp.remainingStatic.length && Array.isArray(gp.remaining)){
    gp.remainingStatic = gp.remaining.map((v)=> Array.isArray(v) ? [v[0] | 0, v[1] | 0] : v)
      .filter((v)=> Array.isArray(v) && v.length >= 2);
  }
  gp.remainingDynamic = Array.isArray(gp.remainingDynamic)
    ? gp.remainingDynamic.map((v)=> Array.isArray(v) ? [v[0] | 0, v[1] | 0] : v)
      .filter((v)=> Array.isArray(v) && v.length >= 2)
    : [];
  gp.total = Number.isFinite(gp.total)
    ? gp.total
    : gp.remainingStatic.length + gp.remainingDynamic.length;
  gp.power = Number.isFinite(gp.power) ? gp.power : PATTERN_POWER_MIN;
  gp.done = Boolean(gp.done) || (gp.remainingStatic.length === 0 && gp.remainingDynamic.length === 0);
}
