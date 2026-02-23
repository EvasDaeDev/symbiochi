// js/render.js
import { escapeHtml, barPct, clamp, key } from "./util.js";
import { getOrgMotion } from "./moving.js";
import { IdleWarpConfig, renderBodyWithIdleWarp } from "./render_idleWarp.js";
import { CARROT, carrotCellOffsets } from "./mods/carrots.js";
import { COIN, coinCellOffsets } from "./mods/coins.js";
import { getFxPipeline } from "./FX/pipeline.js";
import { getOrganDef, organLabel } from "./organs/index.js";
import { wormOffset as wormOffsetAnim } from "./organs/worm.js";
import { tentacleOffset as tentacleOffsetAnim } from "./organs/tentacle.js";
import { getStageName, getTotalBlocks } from "./creature.js";
import { RULES } from "./rules-data.js";
import { moodEmoji, stateEmoji } from "../content/icons.js";

/**
 * Canvas pixel-block renderer (procedural, no sprites).
 * - 1 block = --cellSize CSS px (default 4)
 * - Zoom wheel changes view.zoom in [-3..+3], does NOT change world units
 * - Core is 8x8 px base and grows with body but is limited to ~10% of body area
 * - Each organism breathes with unique phase, amplitude 1 px in Y
 * - Selection glow is outside boundary and moves with animations
 * - Corner smoothing removes lonely 1px outer corners
 * - Growth animation: new blocks extrude (scale-in) over 0.7s
 */

// =====================
// Config
// =====================
const MIN_GRID_W = 20;
const MIN_GRID_H = 12;

const BREATH_PERIOD_SEC = 3.0;   // cycle
const BREATH_AMPL_PX = 1.5;      // requested: 1 pixel (now 1.5x)

const GROW_DUR_SEC = 0.7;        // requested: 0.7s extrusion
const GLOW_PX = 3;               // requested: ~3px glow thickness

// Parallax: render grid overlay with a slightly "farther" camera so it drifts vs organism
// 0.85..0.95 (smaller = stronger separation)
const GRID_PARALLAX = 0.90;

// =====================
// Color helpers (Hue tuning)
// =====================
function hexToRgb(hex){
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return {r:255,g:255,b:255};
  const n = parseInt(m[1], 16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
}
function rgbToHsl(r,g,b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h=0,s=0;
  const l=(max+min)/2;
  const d=max-min;
  if (d!==0){
    s = d / (1 - Math.abs(2*l-1));
    switch(max){
      case r: h = ((g-b)/d) % 6; break;
      case g: h = (b-r)/d + 2; break;
      case b: h = (r-g)/d + 4; break;
    }
    h *= 60;
    if (h<0) h += 360;
  }
  return {h, s: s*100, l: l*100};
}

// HSL (0..360, 0..100, 0..100) -> RGB 0..255
function hslToRgb(h,s,l){
  const hh = ((h%360)+360)%360;
  const ss = clamp(s,0,100)/100;
  const ll = clamp(l,0,100)/100;
  const c = (1 - Math.abs(2*ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh/60) % 2) - 1));
  const m = ll - c/2;
  let r1=0,g1=0,b1=0;
  if (hh < 60){ r1=c; g1=x; b1=0; }
  else if (hh < 120){ r1=x; g1=c; b1=0; }
  else if (hh < 180){ r1=0; g1=c; b1=x; }
  else if (hh < 240){ r1=0; g1=x; b1=c; }
  else if (hh < 300){ r1=x; g1=0; b1=c; }
  else { r1=c; g1=0; b1=x; }
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255
  };
}
function hslCss(h,s,l){
  const hh = ((h%360)+360)%360;
  return `hsl(${hh.toFixed(1)},${clamp(s,0,100).toFixed(1)}%,${clamp(l,0,100).toFixed(1)}%)`;
}
function getPartBaseHex(org, part){
  const def = getOrganDef(part);
  if (part === "body") return org?.partColor?.body || org?.palette?.body || def?.initialColor || "#1f2937";
  if (part === "eye") return org?.partColor?.eye || org?.palette?.eye || def?.initialColor || "#f472b6";
  return org?.partColor?.[part] || def?.initialColor || "#cbd5e1";
}
function getPartColor(org, part, hueShiftDeg){
  const baseHex = getPartBaseHex(org, part);
  if (!Number.isFinite(hueShiftDeg) || hueShiftDeg === 0) return baseHex;
  const {r,g,b} = hexToRgb(baseHex);
  const hsl = rgbToHsl(r,g,b);
  const rr = hslToRgb(hsl.h + hueShiftDeg, hsl.s, hsl.l);
  return rgbToHex(rr.r, rr.g, rr.b);
}

// =====================
// Per-organism saturation (FAST, no ctx.filter)
// =====================
const _SAT_CACHE = new Map();
function _quantSat(sat){
  if (!Number.isFinite(sat)) return 1;
  // state.js already quantizes, but keep render robust
  const step = 0.05;
  return clamp(Math.round(sat/step)*step, 0.15, 1);
}
function satColorHex(hex, sat){
  if (!hex || typeof hex !== "string" || hex[0] !== "#") return hex;
  const ss = _quantSat(sat);
  if (ss >= 0.999) return hex;
  const k = `${hex}|${ss}`;
  const hit = _SAT_CACHE.get(k);
  if (hit) return hit;
  const c = hexToRgb(hex);
  const hsl = rgbToHsl(c.r, c.g, c.b);
  const rr = hslToRgb(hsl.h, hsl.s * ss, hsl.l);
  const out = rgbToHex(rr.r, rr.g, rr.b);
  _SAT_CACHE.set(k, out);
  return out;
}

// =====================
// Small utils (local, robust)
// =====================
function getBaseBlockPx(){
  const v = getComputedStyle(document.documentElement).getPropertyValue("--cellSize").trim();
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 2 ? n : 4;
}




// zoom: -3..+3 → blockPx ~ 1..7 (for base 4)
// keep integer pixels for crispness
function zoomToBlockPx(basePx, zoom){
  const z = clamp(Number.isFinite(zoom) ? zoom : 0, -3, 3);
  const scale = 1 + z * 0.25; // -3 → 0.25x, +3 → 1.75x
  return Math.max(1, Math.min(24, Math.round(basePx * scale)));
}

function rgbToHex(r,g,b){
  const to = (x)=>Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,"0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function mix(hexA, hexB, t){
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return rgbToHex(
    a.r + (b.r-a.r)*t,
    a.g + (b.g-a.g)*t,
    a.b + (b.b-a.b)*t
  );
}

// small brightness tweak (-0.2..+0.2)
function brighten(hex, amt){
  const c = hexToRgb(hex);
  const k = 0.90 + amt;
  return rgbToHex(c.r*k, c.g*k, c.b*k);
}

function scaleBrightness(hex, factor){
  const c = hexToRgb(hex);
  return rgbToHex(c.r * factor, c.g * factor, c.b * factor);
}

// cheap deterministic hash → [0..1)
function hash01(str){
  let h = 2166136261;
  for (let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // unsigned → 0..1
  return (h >>> 0) / 4294967296;
}

// =====================
// View sizing / Canvas sync
// =====================
export function computeGridSize(gridEl, view){
  const basePx = getBaseBlockPx();
  const blockPx = zoomToBlockPx(basePx, view?.zoom ?? 0);

  const rect = gridEl.getBoundingClientRect();
  const gridW = Math.max(MIN_GRID_W, Math.floor(rect.width / Math.max(1, blockPx)));
  const gridH = Math.max(MIN_GRID_H, Math.floor(rect.height / Math.max(1, blockPx)));

  if (view){
    view.blockPx = blockPx;
    view.gridW = gridW;
    view.gridH = gridH;
  }

  return { gridW, gridH, blockPx };
}

export function syncCanvas(canvas, gridEl, view){
  // Compute grid size first
  computeGridSize(gridEl, view);

  const rect = gridEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  // match CSS size
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  const needW = Math.max(1, Math.floor(rect.width * dpr));
  const needH = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== needW || canvas.height !== needH){
    canvas.width = needW;
    canvas.height = needH;
  }

  // IMPORTANT:
  // Do NOT grab a 2D context on the visible canvas here.
  // If we do, the browser will lock the canvas to 2D and WebGL post-FX
  // (CRT distortion, chromatic aberration) won't be able to attach.
  //
  // The 2D transform (DPR) is instead applied to the offscreen scene context
  // obtained from FX pipeline (`fx.begin(...)`) inside `renderGrid`.

  view.dpr = dpr;
  view.rectW = rect.width;
  view.rectH = rect.height;
}

// =====================
// Camera + bounds
// =====================
function getOrgBounds(org){
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;

  const add = (x,y)=>{
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };

  if (org?.body?.cells){
    for (const [x,y] of org.body.cells) add(x,y);
  }
  if (org?.modules){
    for (const m of org.modules){
      for (const [x,y] of (m.cells || [])) add(x,y);
    }
  }

  if (!isFinite(minX)) return {minX:0,minY:0,maxX:0,maxY:0};
  return {minX,minY,maxX,maxY};
}

function getColonyBounds(state){
  let b = getOrgBounds(state);
  if (Array.isArray(state?.buds)){
    for (const bud of state.buds){
      const bb = getOrgBounds(bud);
      b = {
        minX: Math.min(b.minX, bb.minX),
        minY: Math.min(b.minY, bb.minY),
        maxX: Math.max(b.maxX, bb.maxX),
        maxY: Math.max(b.maxY, bb.maxY),
      };
    }
  }
  return b;
}

function clampCamera(cam, bounds, gridW, gridH, minOverlap=2){
  const Vx = (gridW - 1) / 2;
  const Vy = (gridH - 1) / 2;

  const width  = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;

  const ovX = Math.min(minOverlap, Math.max(1, width));
  const ovY = Math.min(minOverlap, Math.max(1, height));

  const loX = bounds.minX + (ovX - 1) - Vx;
  const hiX = bounds.maxX - (ovX - 1) + Vx;

  const loY = bounds.minY + (ovY - 1) - Vy;
  const hiY = bounds.maxY - (ovY - 1) + Vy;

  cam.ox = clamp(cam.ox, loX, hiX);
  cam.oy = clamp(cam.oy, loY, hiY);
}

function worldToScreenPx(cam, wx, wy, view){
  const Vx = (view.gridW - 1) / 2;
  const Vy = (view.gridH - 1) / 2;
  const vx = (wx - cam.ox) + Vx;
  const vy = (wy - cam.oy) + Vy;

  return {
    x: Math.round(vx * view.blockPx),
    y: Math.round(vy * view.blockPx),
  };
}

// =====================
// Animation helpers
// =====================
function breathYOffsetPx(org, orgId, baseSeed, breathMul=1){
  // unique phase per organism (offset > 1/3 cycle is naturally true with random phase)
  const tag = `${baseSeed}|breath|${orgId}|${org?.seed ?? 0}`;
  const phase = hash01(tag) * Math.PI * 2;
  const t = (Date.now() / 1000);
  const s = Math.sin((t * (Math.PI * 2) / BREATH_PERIOD_SEC) + phase);
  return (s * BREATH_AMPL_PX * (Number.isFinite(breathMul) ? breathMul : 1));
}

function spikeBlinkOn(){
  const cycle = 2.5; // 0.5s of blinks + 2s pause
  const phase = (Date.now()/1000) % cycle;
  if (phase >= 0.5) return false;
  const sub = phase % 0.25;
  return sub < 0.125;
}

function antennaPulseIndex(len){
  const speed = 5; // blocks per second
  const travel = Math.max(1, len - 1) / speed;
  const pause = 1.5;
  const cycle = travel + pause;
  const phase = (Date.now()/1000) % cycle;
  if (phase >= travel) return null;
  const pos = phase * speed;
  return Math.min(len - 1, Math.max(0, Math.round(pos)));
}

function clawRotationRad(offsetSec=0){
  const cycle = 14; // 1s rotate + 3s return + 10s pause
  const phase = ((Date.now()/1000) + offsetSec) % cycle;
  const maxDeg = 30;
  if (phase < 1){
    return (phase / 1) * (Math.PI/180) * maxDeg;
  }
  if (phase < 4){
    const t = (phase - 1) / 3;
    return (1 - t) * (Math.PI/180) * maxDeg;
  }
  return 0;
}

function limbPhalanxAngleRad(maxDeg, direction, offsetSec=0){
  const bendDur = 2 * 1.5;
  const returnDur = 2 * 1.5;
  const pauseDur = 3 * 2;
  const cycle = bendDur + returnDur + pauseDur;
  const phase = ((Date.now()/1000) + offsetSec) % cycle;
  const amp = (Math.PI/180) * maxDeg * 1.15 * direction;
  if (phase < bendDur){
    return (phase / bendDur) * amp;
  }
  if (phase < bendDur + returnDur){
    const t = (phase - bendDur) / returnDur;
    return (1 - t) * amp;
  }
  return 0;
}

function jointedLimbPositions(cells, phalanxLengths, anglesRad){
  const out = cells.map(([x, y]) => ({ x, y }));
  if (!Array.isArray(phalanxLengths) || !phalanxLengths.length) return out;
  let start = 0;
  for (let p = 0; p < phalanxLengths.length && start < out.length; p++){
    const origin = out[start];
    const angle = anglesRad?.[p] || 0;
    if (angle !== 0){
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      for (let i = start; i < out.length; i++){
        const dx = out[i].x - origin.x;
        const dy = out[i].y - origin.y;
        out[i].x = origin.x + dx * cos - dy * sin;
        out[i].y = origin.y + dx * sin + dy * cos;
      }
    }
    start += phalanxLengths[p];
  }
  return out;
}

function moduleDir(cells){
  if (!cells || cells.length < 2) return [1,0];
  const dx = cells[1][0] - cells[0][0];
  const dy = cells[1][1] - cells[0][1];
  return [Math.sign(dx), Math.sign(dy)];
}

function perpOf([dx,dy]){ return [-dy, dx]; }

function lengthAmpScale(len){
  return Math.min(4.0, 1 + Math.max(0, len - 4) * 0.08);
}

function tailAmpProfile(u){
  const smooth = u * u * (3 - 2 * u);
  return Math.pow(smooth, 1.35);
}

function windOffsetPx(i, len, blockPx, offsetSec=0, type="tail"){
  if (i < 2) return 0;
  const def = getOrganDef(type);
  const swayAmp = Number.isFinite(def?.anim?.swayAmp) ? def.anim.swayAmp : 1.0;
  const swaySec = Number.isFinite(def?.anim?.swaySec) ? def.anim.swaySec : 6.0;
  const t = (Date.now()/1000) + offsetSec;
  const denom = Math.max(1, len - 2);
  const u = Math.min(1, (i - 1) / denom);
  const amp01 = tailAmpProfile(u);
  const omega1 = 2 * Math.PI / swaySec;
  const omega2 = 2 * Math.PI / (swaySec * 0.75);
  const omega3 = 2 * Math.PI / (swaySec * 1.5);
  const phase1 = omega1 * t - u * 3.4;
  const phase2 = omega2 * t - u * 5.1 + 1.3;
  const phase3 = omega3 * t - u * 2.2 + 2.1;
  const mix = 0.6 * Math.sin(phase1) + 0.3 * Math.sin(phase2) + 0.1 * Math.sin(phase3);
  const ampPx = blockPx * 1.05 * amp01 * lengthAmpScale(len) * swayAmp;
  return mix * ampPx;
}

function windOffset(i, len, offsetSec=0, type="tail"){
  if (i < 2) return 0;
  const def = getOrganDef(type);
  const swayAmp = Number.isFinite(def?.anim?.swayAmp) ? def.anim.swayAmp : 1.0;
  const swaySec = Number.isFinite(def?.anim?.swaySec) ? def.anim.swaySec : 6.0;
  const t = (Date.now()/1000) + offsetSec;
  const denom = Math.max(1, len - 2);
  const u = Math.min(1, (i - 1) / denom);
  const amp01 = tailAmpProfile(u);
  const omega1 = 2 * Math.PI / swaySec;
  const omega2 = 2 * Math.PI / (swaySec * 0.75);
  const omega3 = 2 * Math.PI / (swaySec * 1.5);
  const phase1 = omega1 * t - u * 3.4;
  const phase2 = omega2 * t - u * 5.1 + 1.3;
  const phase3 = omega3 * t - u * 2.2 + 2.1;
  const mix = 0.6 * Math.sin(phase1) + 0.3 * Math.sin(phase2) + 0.1 * Math.sin(phase3);
  return mix * 0.57 * amp01 * lengthAmpScale(len) * swayAmp;
}

function eyeBlinkScale(orgId, baseSeed){
  const t = Date.now() / 1000;
  const seed = hash01(`${baseSeed}|eye-blink|${orgId}`);
  const eyeDef = getOrganDef("eye");
  const pauseRange = Array.isArray(eyeDef?.anim?.blinkPauseSec) ? eyeDef.anim.blinkPauseSec : [10, 17];
  const pauseMin = pauseRange[0] ?? 10;
  const pauseMax = pauseRange[1] ?? 17;
  const pause = pauseMin + (pauseMax - pauseMin) * seed;
  const blinkDur = Number.isFinite(eyeDef?.anim?.blinkDurSec) ? eyeDef.anim.blinkDurSec : 0.3;
  const cycle = pause + blinkDur * 2;
  const phase = (t + seed * 11.7) % cycle;
  if (phase >= blinkDur * 2) return 1;
  const local = phase < blinkDur ? phase : (phase - blinkDur);
  const pulse = Math.sin(Math.PI * (local / blinkDur));
  return 1 - 0.5 * pulse;
}

// growth animation: org.anim["x,y"] = {t0, dur}
function animProgress(org, wx, wy){
  const a = org?.anim?.[`${wx},${wy}`];
  if (!a) return 1;
  const now = Date.now()/1000;
  const t = (now - a.t0) / (a.dur || GROW_DUR_SEC);
  if (t >= 1){
    delete org.anim[`${wx},${wy}`];
    return 1;
  }
  return Math.max(0, Math.min(1, t));
}

// =====================
// Colors per organ instance + subtle variations
// =====================
function organBaseColor(org, type){
  const def = getOrganDef(type);
  return org?.partColor?.[type] || def?.initialColor || "#cbd5e1";
}

function organColor(org, type, orgId, organIndex, baseSeed){
  // tone variance up to ~10% by mixing towards slightly shifted warm/cool anchors
  const base = organBaseColor(org, type);
  const t = (hash01(`${baseSeed}|tone|${orgId}|${organIndex}|${type}`) - 0.5) * 0.10; // -0.05..+0.05
  // mix between slightly warm and cool
  const warm = mix(base, "#ffccaa", 0.18);
  const cool = mix(base, "#aaccff", 0.18);
  return t >= 0 ? mix(base, warm, Math.min(1, t*4)) : mix(base, cool, Math.min(1, (-t)*4));
}

// gradient along the limb (brightness ±5%)
function organSegmentColor(hex, segIndex, segLen, baseSeed, orgId, organIndex){
  if (segLen <= 1) return hex;
  const u = segIndex / (segLen-1);
  const jitter = (hash01(`${baseSeed}|grad|${orgId}|${organIndex}`) - 0.5) * 0.02; // ±1%
  const amt = (u - 0.15) * 0.10 + jitter; // ~±5%
  return brighten(hex, amt);
}

// =====================
// Block drawing (procedural shading + corner smoothing)
// =====================
function drawBlock(ctx, x, y, s, colorHex, breathK, neighMask){
  // neighMask bits: 1=N,2=E,4=S,8=W (present=1)
  const base = colorHex;

  // subtle breathe tint (very slight)
  const tint = breathK ? brighten(base, 0.04) : base;

  ctx.fillStyle = tint;
  ctx.fillRect(x, y, s, s);

  // Corner smoothing: if an outer corner is free (no neighbors on the two touching sides)
  // cut a *single pixel* (per project rules). For tiny blocks (<=2px), skip smoothing.
  const cut = (s >= 2) ? 1 : 0;
  if (cut){
    if (!(neighMask & 1) && !(neighMask & 8)) ctx.clearRect(x,         y,         cut, cut); // TL
    if (!(neighMask & 1) && !(neighMask & 2)) ctx.clearRect(x + s-cut, y,         cut, cut); // TR
    if (!(neighMask & 4) && !(neighMask & 8)) ctx.clearRect(x,         y + s-cut, cut, cut); // BL
    if (!(neighMask & 4) && !(neighMask & 2)) ctx.clearRect(x + s-cut, y + s-cut, cut, cut); // BR
  }
}

function drawBlockAnim(ctx, x, y, s, baseHex, breathK, neighMask, k){
  // k in [0..1]
  if (k >= 0.999){
    drawBlock(ctx, x, y, s, baseHex, breathK, neighMask);
    return;
  }
  const ss = Math.max(1, Math.round(s * k));
  const dx = Math.floor((s - ss)/2);
  const dy = Math.floor((s - ss)/2);
  drawBlock(ctx, x + dx, y + dy, ss, baseHex, breathK, neighMask);
}

// =====================
// Neighbor mask utilities (for shading + smoothing + boundary)
// =====================
// NOTE: using numeric keys is much faster (avoids string allocs + GC churn).
// We pack x,y into a signed 32-bit int. This assumes world coords stay in ~16-bit range.
// If you ever expect huge coords, switch to BigInt packing.
function packXY(x, y){
  return ((x & 0xffff) << 16) | (y & 0xffff);
}

function geomSig(org){
  const bc = org?.body?.cells;
  const mc = org?.modules;
  const bLen = Array.isArray(bc) ? bc.length : 0;
  const mLen = Array.isArray(mc) ? mc.length : 0;
  let mCells = 0;
  let lastMx = 0, lastMy = 0;
  if (mLen){
    for (const m of mc){
      const cells = m?.cells;
      if (!Array.isArray(cells) || !cells.length) continue;
      mCells += cells.length;
      const last = cells[cells.length - 1];
      lastMx = last?.[0] || 0;
      lastMy = last?.[1] || 0;
    }
  }
  const lastB = (bLen && bc) ? bc[bLen - 1] : null;
  const lastBx = lastB?.[0] || 0;
  const lastBy = lastB?.[1] || 0;
  return `${bLen}|${mLen}|${mCells}|${lastBx},${lastBy}|${lastMx},${lastMy}`;
}

function getOccCached(org){
  if (!org) return { all: new Set(), body: new Set(), sig: "" };
  const sig = geomSig(org);
  // IMPORTANT: caches must never survive save/load (Sets serialize to plain objects).
  // So we validate types here and rebuild if needed.
  if (org.__occSig === sig && (org.__occAll instanceof Set) && (org.__occBody instanceof Set)){
    return { all: org.__occAll, body: org.__occBody, sig };
  }

  const all = new Set();
  const body = new Set();
  const bc = org?.body?.cells;
  if (Array.isArray(bc)){
    for (const c of bc){
      const x = c?.[0] || 0;
      const y = c?.[1] || 0;
      const k = packXY(x, y);
      all.add(k);
      body.add(k);
    }
  }
  const mc = org?.modules;
  if (Array.isArray(mc)){
    for (const m of mc){
      const cells = m?.cells;
      if (!Array.isArray(cells)) continue;
      for (const c of cells){
        const x = c?.[0] || 0;
        const y = c?.[1] || 0;
        all.add(packXY(x, y));
      }
    }
  }

  org.__occSig = sig;
  org.__occAll = all;
  org.__occBody = body;
  return { all, body, sig };
}

function getBodyBoundsCached(org){
  if (!org?.body?.cells || !Array.isArray(org.body.cells) || !org.body.cells.length){
    return { minX:0, minY:0, maxX:0, maxY:0, empty:true };
  }
  const sig = geomSig(org);
  // cache must not persist through save/load
  if (org.__boundsSig === sig && org.__bodyBounds && !org.__bodyBounds.empty) return org.__bodyBounds;

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const c of org.body.cells){
    const x = c?.[0] || 0;
    const y = c?.[1] || 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const bounds = {
    minX, minY, maxX, maxY,
    empty: !(Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY))
  };
  org.__boundsSig = sig;
  org.__bodyBounds = bounds;
  return bounds;
}

function neighMaskAt(occ, x, y){
  let m = 0;
  if (occ.has(packXY(x, y-1))) m |= 1;
  if (occ.has(packXY(x+1, y))) m |= 2;
  if (occ.has(packXY(x, y+1))) m |= 4;
  if (occ.has(packXY(x-1, y))) m |= 8;
  return m;
}

function isBoundary(occ, x, y){
  const m = neighMaskAt(occ, x, y);
  // boundary if any side missing
  return (m & 1) === 0 || (m & 2) === 0 || (m & 4) === 0 || (m & 8) === 0;
}

// =====================
// Rect packing for static cells (row runs merged vertically)
// =====================
function buildPackedRects(cells){
  if (!cells || cells.length === 0) return [];
  const rows = new Map();
  for (const [x, y] of cells){
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(x);
  }

  const runByRow = [];
  const ys = [...rows.keys()].sort((a, b) => a - b);
  for (const y of ys){
    const xs = rows.get(y).sort((a, b) => a - b);
    let start = xs[0];
    let prev = xs[0];
    for (let i = 1; i < xs.length; i++){
      const x = xs[i];
      if (x === prev + 1){
        prev = x;
        continue;
      }
      runByRow.push({ y, x0: start, x1: prev });
      start = x;
      prev = x;
    }
    runByRow.push({ y, x0: start, x1: prev });
  }

  runByRow.sort((a, b) => (a.y - b.y) || (a.x0 - b.x0));
  const active = new Map();
  const rects = [];

  for (const run of runByRow){
    const key = `${run.x0},${run.x1}`;
    const prev = active.get(key);
    if (prev && prev.y + prev.h === run.y){
      prev.h += 1;
    } else {
      const rect = { x: run.x0, y: run.y, w: run.x1 - run.x0 + 1, h: 1 };
      rects.push(rect);
      active.set(key, rect);
    }
  }

  return rects;
}

// Cached packed rects for big bodies/organs.
// obj can be an organism (org) or a module object.
function packedRectsCached(obj, cells, extraSig=""){
  if (!obj || !Array.isArray(cells) || cells.length === 0) return [];
  const last = cells[cells.length - 1] || [0,0];
  const sig = `${cells.length}|${last[0]||0},${last[1]||0}|${extraSig}`;
  if (obj._packedSig === sig && Array.isArray(obj._packedRects)) return obj._packedRects;
  const rects = buildPackedRects(cells);
  obj._packedSig = sig;
  obj._packedRects = rects;
  return rects;
}

// =====================
// Core + Eyes scaling rules
// =====================
function computeCorePx(view, bodyBlocks){
  // Core default: 3x3 blocks ("9 blocks").
  // Corners are beveled at render-time (see CORE draw below) to read as a pseudo-sphere.
  const base = Math.max(12, view.blockPx * 3);
  // limit core area <= 10% body area (in pixels)
  if (bodyBlocks < 20) return base; // allow early stages to violate
  const bodyArea = bodyBlocks * view.blockPx * view.blockPx;
  const maxCoreArea = bodyArea * 0.10;
  const maxSide = Math.max(8, Math.floor(Math.sqrt(maxCoreArea)));
  return Math.max(8, Math.min(base, maxSide));
}

function computeEyeRadius(org, bodyBlocks){
  const raw = Number.isFinite(org?.face?.eyeRadius)
    ? org.face.eyeRadius
    : Math.max(0, (org?.face?.eyeSize ?? 1) - 1);
  const wanted = clamp(raw, 0, 2);
  if (bodyBlocks < 16) return 0;
  return wanted;
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

// =====================
// Selection glow
// =====================
// =====================
// Selection glow
// =====================

// Strong outer glow around selection rectangles (usually 1 rect = bounding box)
function drawSelectionGlow(ctx, rects, strength=1){
  ctx.save();

  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = clamp(strength, 0, 1);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(90,255,140,1)";
  ctx.lineWidth = 1;

  for (const r of rects){
    ctx.strokeRect(
      Math.round(r.x) + 0.5,
      Math.round(r.y) + 0.5,
      Math.round(r.w),
      Math.round(r.h)
    );
  }

  ctx.restore();
}

// Optional crisp outline (no blur). Useful for debugging.
function drawSelectionRect(ctx, rects, alpha=1){
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = alpha;
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1;
  for (const r of rects){
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
  ctx.restore();
}

function drawFlashGlow(ctx, rects){
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  for (let i = GLOW_PX; i >= 1; i--){
    const alpha = 0.10 + (i / GLOW_PX) * 0.18;
    ctx.globalAlpha = alpha;
    ctx.shadowColor = "rgba(255,255,255,0.85)";
    ctx.shadowBlur = i * 0;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1;
    for (const r of rects){
      ctx.strokeRect(r.x - i, r.y - i, r.w + i*2, r.h + i*2);
    }
  }
  ctx.restore();
}

// =====================
// Rendering one organism
// =====================
function renderOrg(ctx, cam, org, view, orgId, baseSeed, isSelected, breathMul=1, globalTimeSec=null){
  const s = view.blockPx;
  const occPack = getOccCached(org);
  const occ = occPack.all;

  // Visual-only effect: desaturate creature colors based on its own average stats.
  // Computed in state.js (render must not do game logic).
  const sat = (org && org.visual && Number.isFinite(org.visual.saturation)) ? org.visual.saturation : 1;
  const SH = (col)=>satColorHex(col, sat);
  ctx.save();

  // Smooth movement gait (render-only deformation)
  const motion = getOrgMotion(view, orgId);
  const gait = motion?.gait || null;
  const gaitPhase = gait ? clamp(gait.t / Math.max(1e-6, gait.dur), 0, 1) : 0;
  const gaitDx = gait ? (gait.dx || 0) : 0;
  const gaitDy = gait ? (gait.dy || 0) : 0;
  const gaitDist = gait ? Math.max(1, gait.dist || 1) : 1;
  // Front-first travel: back lags by up to ~60% of the step, then catches up.
  // This makes the body look like it "leans" into motion without rotating canvas.
  // Gait segmentation should be driven by the *body*, not by modules.
  // If we include modules in the range, even a 1-cell organ on the extreme
  // front/back can become its own "segment" and visually detach (it reaches
  // +2 while the body is still catching up).
  //
  // Fix:
  // - Build the score range using BODY cells only.
  // - For each module, use the module's base cell (anchor) score for all its
  //   cells, so the whole organ moves together with the attachment point.
  let gaitMinScore = 0;
  let gaitInvRange = 1;
  let gaitCoreX = 0;
  let gaitCoreY = 0;
  if (gait){
    const core = org?.body?.core || org?.body?.cells?.[0] || [0,0];
    gaitCoreX = core?.[0] || 0;
    gaitCoreY = core?.[1] || 0;
    let mn = Infinity;
    let mx = -Infinity;
    const accScore = (wx, wy)=>{
      const sc = (wx - gaitCoreX) * gaitDx + (wy - gaitCoreY) * gaitDy;
      if (sc < mn) mn = sc;
      if (sc > mx) mx = sc;
    };

    // Body drives the segmenting.
    for (const c of (org?.body?.cells || [])) accScore(c?.[0] || 0, c?.[1] || 0);

    gaitMinScore = Number.isFinite(mn) ? mn : 0;
    const range = (Number.isFinite(mx) ? mx : mn) - gaitMinScore;
    gaitInvRange = (range > 1e-6) ? (1 / range) : 1;
  }

  function gaitWFront(wx0, wy0){
    const sc = (wx0 - gaitCoreX) * gaitDx + (wy0 - gaitCoreY) * gaitDy;
    return clamp((sc - gaitMinScore) * gaitInvRange, 0, 1);
  }

  // Convert an integer-cell position to a continuous travel offset in [0..gaitDist].
  // - For dist=1: front-first ease (previous behavior)
  // - For dist=2: 3-part "caterpillar" gait:
  //   * front third moves 0->1->2
  //   * middle third follows a bit later (two-stage)
  //   * back third follows last (two-stage)
  // This creates TWO stretch points (divides the body into 3 parts), like a crawling caterpillar.
  function gaitOffsetFromIntCell(wx0, wy0, wFrontOverride=null){
    if (!gait) return gaitDist;
    const wFront = (wFrontOverride === null) ? gaitWFront(wx0, wy0) : wFrontOverride;

    // dist=1: simple front-lag smoothing
    if (gaitDist <= 1){
      const delay = (1 - wFront) * 0.60;
      const local = clamp((gaitPhase - delay) / 0.40, 0, 1);
      return local;
    }

    // dist=2: segmented timeline
    // Segment: 0=front, 1=mid, 2=back
    let seg = 2;
    if (wFront > 0.66) seg = 0;
    else if (wFront > 0.33) seg = 1;

    // Helper: two-stage ramp (0->1 then 1->2)
    const ramp2 = (p, a0, a1, b0, b1)=>{
      if (p <= a0) return 0;
      if (p < a1) return (p - a0) / Math.max(1e-6, (a1 - a0));
      if (p <= b0) return 1;
      if (p < b1) return 1 + (p - b0) / Math.max(1e-6, (b1 - b0));
      return 2;
    };

    // Timings chosen to look like: front moves (0..0.5), mid follows (0.25..0.75), back follows (0.5..1)
    if (seg === 0) return ramp2(gaitPhase, 0.00, 0.25, 0.25, 0.50);
    if (seg === 1) return ramp2(gaitPhase, 0.25, 0.50, 0.50, 0.75);
    return ramp2(gaitPhase, 0.50, 0.75, 0.75, 1.00);
  }

  function gaitPositions(wx, wy, wx0, wy0, wFrontOverride=null){
    if (!gaitActive) return [[wx, wy]];
    const o = gaitOffsetFromIntCell(wx0, wy0, wFrontOverride);
    // Distances are integer-cell based; during transition we render a union of two adjacent states.
    const out = [];
    if (gaitDist <= 1){
      if (o < 1 - 1e-6) out.push([wx, wy]);
      if (o > 1e-6) out.push([wx + gaitDx, wy + gaitDy]);
      return out;
    }

    if (o < 1e-6){
      out.push([wx, wy]);
    } else if (o < 1 - 1e-6){
      out.push([wx, wy]);
      out.push([wx + gaitDx, wy + gaitDy]);
    } else if (o < 2 - 1e-6){
      out.push([wx + gaitDx, wy + gaitDy]);
      out.push([wx + gaitDx*2, wy + gaitDy*2]);
    } else {
      out.push([wx + gaitDx*2, wy + gaitDy*2]);
    }
    return out;
  }

// For MODULES: do NOT stretch. Render only one integer position (no union bridge).
function gaitSinglePosition(wx, wy, wx0, wy0, wFrontOverride=null){
  if (!gaitActive) return [wx, wy];
  const o = gaitOffsetFromIntCell(wx0, wy0, wFrontOverride);
  if (gaitDist <= 1){
    return (o < 0.5) ? [wx, wy] : [wx + gaitDx, wy + gaitDy];
  }
  // dist=2: choose step 0/1/2 by thresholds
  if (o < 0.5) return [wx, wy];
  if (o < 1.5) return [wx + gaitDx, wy + gaitDy];
  return [wx + gaitDx*2, wy + gaitDy*2];
}


  // During gait we disable packed-rect rendering for body (otherwise you'd see
  // the entire blob jump as a rectangle).
  const gaitActive = !!gait;

  const breathY = breathYOffsetPx(org, orgId, baseSeed, breathMul);
  const breathK = (breathY !== 0); // slight tint toggle

  const boundaryRects = [];
  const boundaryCells = [];

    // BODY blocks
  const bodyColor = SH(getPartColor(org, "body", 0));
  const bodySkinColor = scaleBrightness(bodyColor, 1.15); // подсветка периметра
  const bodyCells = org?.body?.cells || [];
  const bodyOcc = occPack.body; // body-only occupancy for perimeter detection

  // Screen-space bounding box for idle warp pulse (for static body only).
  let bodyBBoxPx = null;
  if (!gaitActive && bodyCells.length){
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [wx, wy] of bodyCells){
      const p = worldToScreenPx(cam, wx, wy, view);
      const x = p.x;
      const y = p.y + breathY;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + s > maxX) maxX = x + s;
      if (y + s > maxY) maxY = y + s;
    }
    if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)){
            bodyBBoxPx = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }

  function drawBody(ctxBody){
    const ctx = ctxBody;

    if (!gaitActive){
      const staticInner = [];
      const staticSkin = [];

      for (const [wx, wy] of bodyCells){
        const nm = neighMaskAt(occ, wx, wy);
        const kGrow = animProgress(org, wx, wy);
        const isSkin = isBoundary(bodyOcc, wx, wy);
        const col = isSkin ? bodySkinColor : bodyColor;

        if (kGrow < 0.999){
          const p = worldToScreenPx(cam, wx, wy, view);
          const x = p.x;
          const y = p.y + breathY;
          drawBlockAnim(ctx, x, y, s, col, breathK, nm, kGrow);
        } else {
          (isSkin ? staticSkin : staticInner).push([wx, wy]);
        }

        if (isSelected && isBoundary(occ, wx, wy)){
          boundaryCells.push([wx, wy]);
        }
      }

      const packInner = org.__packBodyInner || (org.__packBodyInner = {});
      const packSkin  = org.__packBodySkin  || (org.__packBodySkin  = {});

      const fillPacked = (cells, col, packObj)=>{
        if (!cells.length) return;
        const rects = packedRectsCached(packObj, cells);
        ctx.fillStyle = breathK ? brighten(col, 0.04) : col;
        for (const r of rects){
          const p = worldToScreenPx(cam, r.x, r.y, view);
          const x = p.x;
          const y = p.y + breathY;
          ctx.fillRect(x, y, r.w * s, r.h * s);
          if (isSelected){
            boundaryRects.push({ x, y, w: r.w * s, h: r.h * s });
          }
        }
      };

      fillPacked(staticInner, bodyColor, packInner);
      fillPacked(staticSkin, bodySkinColor, packSkin);
    } else {
      // Gait render (бывший код из else оставляем, только переносим внутрь функции)
      const gaitTint = (col)=> (breathK ? brighten(col, 0.04) : col);

      for (const [wx0, wy0] of bodyCells){
        const isSkin = isBoundary(bodyOcc, wx0, wy0);
        const col = isSkin ? bodySkinColor : bodyColor;
        const kGrow = animProgress(org, wx0, wy0);

        // 0..gaitDist
        const o = gaitOffsetFromIntCell(wx0, wy0, null);

        // Stretch in screen pixels (integer) towards gait direction.
        const extPx = Math.max(0, Math.round(clamp(o, 0, gaitDist) * s));

        const p = worldToScreenPx(cam, wx0, wy0, view);
        let x = p.x;
        let y = p.y + breathY;

        // Scale by growth first
        let ss = s;
        let dxC = 0;
        let dyC = 0;
        if (kGrow < 0.999){
          ss = Math.max(1, Math.round(s * kGrow));
          dxC = Math.floor((s - ss) / 2);
          dyC = Math.floor((s - ss) / 2);
          x += dxC;
          y += dyC;
        }

        const ext = (kGrow < 0.999) ? Math.round(extPx * (ss / s)) : extPx;

        ctx.fillStyle = gaitTint(col);

        if (gaitDx !== 0){
          if (gaitDx > 0) ctx.fillRect(x, y, ss + ext, ss);
          else ctx.fillRect(x - ext, y, ss + ext, ss);
        } else if (gaitDy !== 0){
          if (gaitDy > 0) ctx.fillRect(x, y, ss, ss + ext);
          else ctx.fillRect(x, y - ext, ss, ss + ext);
        } else {
          ctx.fillRect(x, y, ss, ss);
        }

        if (isSelected && isBoundary(occ, wx0, wy0)){
          boundaryCells.push([wx0, wy0]);
        }
      }
    }
  }

  // Рендер тела (с idle warp pulse, если он сейчас активен)
  const idleWarpState = renderBodyWithIdleWarp(
    ctx,
    {
      org,
      orgId,
      baseSeed,
      bodyCells,
      bodyBBoxPx,
      globalTimeSec,
      gaitActive,
    },
    drawBody
  );

  // MODULES
  const modules = org?.modules || [];
  for (let mi=0; mi<modules.length; mi++){
    const m = modules[mi];
    const type = m.type || "organ";
	const def = getOrganDef(type);
    const cells = m.cells || [];
    if (cells.length === 0) continue;

    let base = organColor(org, type, orgId, mi, baseSeed);

    // Module gait phase should follow its attachment point.
    // Use base cell score for the whole module to prevent detachment.
    const baseCellForGait = (cells && cells.length) ? cells[0] : null;
    const modWFront = (gait && baseCellForGait) ? gaitWFront(baseCellForGait[0]||0, baseCellForGait[1]||0) : null;
	
    // Idle warp B1: anchor displacement (render-only, no state changes)
    let organDx = 0;
    let organDy = 0;
    if (idleWarpState && idleWarpState.active && baseCellForGait){
      const anchorWx = baseCellForGait[0] || 0;
      const anchorWy = baseCellForGait[1] || 0;
      const anchorP = worldToScreenPx(cam, anchorWx, anchorWy, view);
      const disp = idleWarpState.getDisplacementAt
        ? idleWarpState.getDisplacementAt(anchorP.x, anchorP.y + breathY)
        : null;
      if (disp){
        organDx = disp.dx || 0;
        organDy = disp.dy || 0;
      }
    }

    ctx.save();
    if (organDx !== 0 || organDy !== 0){
      ctx.translate(organDx, organDy);

      if (IdleWarpConfig.debugDrawAnchors && baseCellForGait){
        const anchorP2 = worldToScreenPx(cam, baseCellForGait[0] || 0, baseCellForGait[1] || 0, view);
        const ax = anchorP2.x;
        const ay = anchorP2.y + breathY;
        const tx = ax + organDx;
        const ty = ay + organDy;
        ctx.save();
        ctx.strokeStyle = "rgba(56,189,248,0.9)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tx, ty, 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
	
    if (type === "spike"){
      const on = spikeBlinkOn();
      const len = cells.length;

      for (let i=0;i<len;i++){
        const [wx0,wy0] = cells[i];

        // spike tip blink changes brightness
        let c = base;
        const isTip = (i === len - 1);

        c = organSegmentColor(c, i, len, baseSeed, orgId, mi);
        if (isTip && on) c = scaleBrightness(c, 2);

        const nm = neighMaskAt(occ, wx0, wy0);
        const kGrow = animProgress(org, wx0, wy0);
        {
          const [wx, wy] = gaitSinglePosition(wx0, wy0, wx0, wy0, modWFront);

          const p = worldToScreenPx(cam, wx, wy, view);
          drawBlockAnim(ctx, p.x, p.y + breathY, s, c, breathK, nm, kGrow);
          if (isSelected && isBoundary(occ, wx0, wy0)) boundaryCells.push([wx, wy]);
        }
      }
      ctx.restore(); continue;
    }

    if (type === "shell"){
      // shell draws slightly darker plates
      for (let i=0;i<cells.length;i++){
        const [wx0,wy0] = cells[i];

        let c = organSegmentColor(brighten(base, -0.05), i, cells.length, baseSeed, orgId, mi);

        const nm = neighMaskAt(occ, wx0, wy0);
        const kGrow = animProgress(org, wx0, wy0);
        {
          const [wx, wy] = gaitSinglePosition(wx0, wy0, wx0, wy0, modWFront);

          const p = worldToScreenPx(cam, wx, wy, view);
          drawBlockAnim(ctx, p.x, p.y + breathY, s, c, breathK, nm, kGrow);
          if (isSelected && isBoundary(occ, wx0, wy0)) boundaryCells.push([wx, wy]);
        }
      }
      ctx.restore(); continue;
    }

    if (type === "eye"){
      const blinkScale = eyeBlinkScale(orgId, baseSeed);
      for (let i=0;i<cells.length;i++){
        const [wx0, wy0] = cells[i];
        const nm = neighMaskAt(occ, wx0, wy0);
        const kGrow = animProgress(org, wx0, wy0);

        {
          const [wx, wy] = gaitSinglePosition(wx0, wy0, wx0, wy0, modWFront);

          const p = worldToScreenPx(cam, wx, wy, view);
          const x = p.x;
          const y = p.y + breathY;
          if (blinkScale !== 1){
            const cx = x + s / 2;
            const cy = y + s / 2;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(1, blinkScale);
            ctx.translate(-cx, -cy);
            drawBlockAnim(ctx, x, y, s, base, breathK, nm, kGrow);
            ctx.restore();
          } else {
            drawBlockAnim(ctx, x, y, s, base, breathK, nm, kGrow);
          }
          if (isSelected && isBoundary(occ, wx0, wy0)) boundaryCells.push([wx, wy]);
        }
      }
      ctx.restore(); continue;
    }

    // tails / limbs / antenna / tentacle: wind deformation on segments
    const len = cells.length;
    const dir = moduleDir(cells);
    const perp = perpOf(dir);
    const antennaPulse = (type === "antenna") ? antennaPulseIndex(len) : null;
    const offsetSec = ((orgId || 0) * 0.37 + mi) * 0.1;
    const baseCell = cells[0];
    const coreCell = org?.body?.core || baseCell;
    const isJointedLimb = type === "limb" && Array.isArray(m.phalanxLengths) && m.phalanxLengths.length;
    const limbAnim = isJointedLimb ? (m.limbAnim || {}) : null;
    const limbDirection = isJointedLimb
      ? (Number.isFinite(limbAnim?.direction)
        ? limbAnim.direction
        : (hash01(`${baseSeed}|limb-dir|${orgId}|${mi}`) < 0.5 ? -1 : 1))
      : 1;
    const limbAnglesDeg = isJointedLimb
      ? m.phalanxLengths.map((_, idx) => {
        const stored = limbAnim?.angles?.[idx];
        if (Number.isFinite(stored)) return stored;
        return 10 + Math.floor(hash01(`${baseSeed}|limb-angle|${orgId}|${mi}|${idx}`) * 18);
      })
      : null;
    const limbAnglesRad = isJointedLimb
      ? limbAnglesDeg.map((deg) => limbPhalanxAngleRad(deg, limbDirection, offsetSec))
      : null;
    const limbCells = isJointedLimb ? jointedLimbPositions(cells, m.phalanxLengths, limbAnglesRad) : null;
    const jointStarts = isJointedLimb ? (() => {
      const set = new Set();
      let acc = 0;
      for (let i = 0; i < m.phalanxLengths.length; i++){
        if (i > 0 && acc < cells.length) set.add(acc);
        acc += m.phalanxLengths[i];
        if (acc >= cells.length) break;
      }
      return set;
    })() : null;

// Visual-only thickness. Each organ can define its own profile in its organ module:
// organDef.render.thicknessLevel(i, len) => 1 (thin) or 2 (thick).
// If absent, the organ is treated as thin.
function getThicknessLevel(organDef, i, len){
  const fn = organDef?.render?.thicknessLevel;
  if (typeof fn === "function"){
    try {
      const v = fn(i, len);
      return v === 2 ? 2 : 1;
    } catch {
      return 1;
    }
  }
  return 1;
}

// Try to draw a lateral "support" block if that world-cell is free.
// Uses TRUE occupancy (occ) so we don't draw into body/modules.
// wx0/wy0 must be the real cell coords (cells[i][0], cells[i][1]), not wind-shifted.
function tryDrawSupport(wx0, wy0, sx, sy, dx, dy, col, kGrow){
  const k = `${wx0 + dx},${wy0 + dy}`;
  if (occ.has(k)) return false;

  const bx = sx + dx * s;
  const by = sy + dy * s;
  drawBlockAnim(ctx, bx, by, s, col, breathK, 0, kGrow);

  if (isSelected){
    boundaryRects.push({ x: bx, y: by, w: s, h: s });
  }
  return true;
}

function outwardPerpDir(wx0, wy0){
  const candA = [perp[0], perp[1]];
  const candB = [-perp[0], -perp[1]];
  const da = Math.abs((wx0 + candA[0]) - coreCell[0]) + Math.abs((wy0 + candA[1]) - coreCell[1]);
  const db = Math.abs((wx0 + candB[0]) - coreCell[0]) + Math.abs((wy0 + candB[1]) - coreCell[1]);
  return da >= db ? candA : candB;
}

function limbPhalanxIndex(lengths, idx){
  let acc = 0;
  for (let i = 0; i < lengths.length; i++){
    acc += lengths[i];
    if (idx < acc) return i;
  }
  return lengths.length - 1;
}

    for (let i=0;i<len;i++){
      let wx;
      let wy;
      if (isJointedLimb){
        wx = limbCells[i].x;
        wy = limbCells[i].y;
      } else {
        [wx,wy] = cells[i];
      }

      if (type === "claw" && baseCell){
        const baseX = baseCell[0];
        const baseY = baseCell[1];
        const angle = clawRotationRad(offsetSec);
        if (angle !== 0){
          const toward = Math.sign((coreCell[0]-baseX) * perp[0] + (coreCell[1]-baseY) * perp[1]) || 1;
          const a = angle * toward;
          const dx = wx - baseX;
          const dy = wy - baseY;
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          wx = baseX + dx * cos - dy * sin;
          wy = baseY + dx * sin + dy * cos;
        }
      }

      let off = 0;
      let wormShift = null;
      let tentacleShift = null;
      if (type === "worm"){
        const seed01 = hash01(`${baseSeed}|worm|${orgId}|${mi}`);
        const tSec = (Date.now()/1000) + offsetSec;
        wormShift = wormOffsetAnim(i, len, tSec, dir, perp, seed01);
      } else if (type === "tentacle"){
        const seed01 = hash01(`${baseSeed}|tentacle|${orgId}|${mi}`);
        const tSec = (Date.now()/1000) + offsetSec;
        tentacleShift = tentacleOffsetAnim(i, len, tSec, dir, perp, seed01);
      } else if (type !== "antenna" && type !== "claw" && !isJointedLimb){
        off = windOffset(i, len, offsetSec, type);
      }
      if (!isJointedLimb){
        if (wormShift){
          wx += wormShift.x;
          wy += wormShift.y;
        } else if (tentacleShift){
          wx += tentacleShift.x;
          wy += tentacleShift.y;
        } else {
          wx += perp[0] * off;
          wy += perp[1] * off;
        }
      }

      const wx0 = cells[i][0];
      const wy0 = cells[i][1];

      let c = organSegmentColor(base, i, len, baseSeed, orgId, mi);
      if (type === "antenna" && antennaPulse !== null && i === antennaPulse){
        c = scaleBrightness(c, 3);
      }

      const nm = neighMaskAt(occ, wx0, wy0); // shading based on true occupancy
      const kGrow = animProgress(org, wx0, wy0);

      // MODULES: do NOT use the 1..2 position "bridge union" during gait.
      // They must be re-attached and rendered once per tick, otherwise they visually "split".
      const [wxD, wyD] = gaitSinglePosition(wx, wy, wx0, wy0, modWFront);
      const p = worldToScreenPx(cam, wxD, wyD, view);
      const drawX = p.x;
      const drawY = p.y + breathY;
      drawBlockAnim(ctx, drawX, drawY, s, c, breathK, nm, kGrow);
      if (isSelected && isBoundary(occ, wx0, wy0)){
        if (Number.isInteger(wxD) && Number.isInteger(wyD)) boundaryCells.push([wxD, wyD]);
        else boundaryRects.push({x: drawX, y: drawY, w: s, h: s});
      }

      // Use the last drawn position as the anchor for extra decoration blocks.
      const x = drawX;
      const y = drawY;

      if (isJointedLimb && jointStarts?.has(i)){
        const shade = brighten(c, -0.04);
        const wx0 = cells[i][0];
        const wy0 = cells[i][1];
        const segIndex = limbPhalanxIndex(m.phalanxLengths, i);
        const baseDir = Array.isArray(m.phalanxDirs) ? (m.phalanxDirs[segIndex] || dir) : dir;
        const basePerp = perpOf(baseDir);
        tryDrawSupport(wx0, wy0, x, y, basePerp[0], basePerp[1], shade, kGrow);
        tryDrawSupport(wx0, wy0, x, y, -basePerp[0], -basePerp[1], shade, kGrow);
      } else if (type === "worm"){
        if (i === len - 1){
          const shade = brighten(c, -0.04);
          const wx0 = cells[i][0];
          const wy0 = cells[i][1];
          tryDrawSupport(wx0, wy0, x, y, perp[0], perp[1], shade, kGrow);
          tryDrawSupport(wx0, wy0, x, y, -perp[0], -perp[1], shade, kGrow);
        }
      } else {
        // variable thickness: tries to be thick, but can stay thin if blocked
        const lvl = getThicknessLevel(def, i, len);
        const shade = brighten(c, -0.04);

        // IMPORTANT: use real cell coords for occupancy test
        const wx0 = cells[i][0];
        const wy0 = cells[i][1];

        if (lvl === 2){
          if (type === "claw"){
            const [ox, oy] = outwardPerpDir(wx0, wy0);
            tryDrawSupport(wx0, wy0, x, y, ox, oy, shade, kGrow);
          } else {
            // thick: one-sided support if possible
            tryDrawSupport(wx0, wy0, x, y, perp[0], perp[1], shade, kGrow);
          }
        }
      }

      if (isSelected && isBoundary(occ, cells[i][0], cells[i][1])){
        if (Number.isInteger(wx) && Number.isInteger(wy)){
          boundaryCells.push([wx, wy]);
        } else {
          boundaryRects.push({x, y, w:s, h:s});
        }
      }
    }
	ctx.restore();
  }
  



  if (isSelected && boundaryCells.length){
    // Cache on the organism: boundaryCells change only when geometry changes.
    const packed = packedRectsCached(org, boundaryCells, `bnd|${org._occSig||""}`);
    for (const r of packed){
      const p = worldToScreenPx(cam, r.x, r.y, view);
      boundaryRects.push({ x: p.x, y: p.y + breathY, w: r.w * s, h: r.h * s });
    }
  }

  // CORE
  const bodyBlocks = (org?.body?.cells?.length || 0);
  const corePx = computeCorePx(view, bodyBlocks);

  const core = org?.body?.core || [0,0];
  const coreP = worldToScreenPx(cam, core[0], core[1], view);
  const coreX = coreP.x + Math.floor((s - corePx)/2);
  const coreY = coreP.y + Math.floor((s - corePx)/2) + breathY;

  // core color by condition
  const st = barStatus(org);
  const CORE_DEF = getOrganDef("core");
  const coreColors = CORE_DEF?.colors || {};
  const coreCol = (st.cls === "bad")
    ? (coreColors.bad || "#fb7185")
    : (st.txt === "норм" ? (coreColors.ok || "#fbbf24") : (coreColors.good || "#34d399"));

  ctx.save();
  ctx.fillStyle = coreCol;
  // Beveled corners (45°) to read as a pseudo-sphere while keeping 3x3-block scale.
  // We draw an octagon inscribed in the core square.
  const bevel = Math.max(1, Math.floor(corePx / 3));
  ctx.beginPath();
  ctx.moveTo(coreX + bevel, coreY);
  ctx.lineTo(coreX + corePx - bevel, coreY);
  ctx.lineTo(coreX + corePx, coreY + bevel);
  ctx.lineTo(coreX + corePx, coreY + corePx - bevel);
  ctx.lineTo(coreX + corePx - bevel, coreY + corePx);
  ctx.lineTo(coreX + bevel, coreY + corePx);
  ctx.lineTo(coreX, coreY + corePx - bevel);
  ctx.lineTo(coreX, coreY + bevel);
  ctx.closePath();
  ctx.fill();
  // tiny highlight
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  // keep highlight within beveled silhouette
  ctx.fillRect(coreX + bevel, coreY + 1, Math.max(1, Math.floor((corePx - bevel*2) * 0.35)), 1);
  ctx.restore();

  if (isSelected){
    // core also contributes to boundary glow a bit
    boundaryRects.push({x:coreX, y:coreY, w:corePx, h:corePx});
  }

    // EYES (always on top of body).
  const face = org?.face?.anchor;
  if (face){
    const eyeRadius = computeEyeRadius(org, bodyBlocks);
    const eyeColor = SH(getPartColor(org, "eye", 0) || "#e2e8f0");

    // Глаз всегда сферический
    const shape = "sphere";
    const offsets = buildEyeOffsets(eyeRadius, shape);
    const blinkScale = eyeBlinkScale(orgId, baseSeed);

    // Локальная occupancy только для глаза — чтобы corner-smoothing
    // резал углы именно у «шара» глаза, независимо от тела.
    const eyeOcc = new Set();
    const eyeCells = [];

    for (const [dx, dy] of offsets){
      const wx = face[0] + dx;
      const wy = face[1] + dy;
      // не перекрываем ядро
      if (wx === core[0] && wy === core[1]) continue;

      eyeCells.push([wx, wy]);
      eyeOcc.add(packXY(wx, wy)); // важно: Set из packXY, как у тела
    }

    for (const [wx, wy] of eyeCells){
      const p = worldToScreenPx(cam, wx, wy, view);
      const x = p.x;
      const y = p.y + breathY;

      // маска соседей внутри глаза → drawBlock режет углы под 45°
      const nm = neighMaskAt(eyeOcc, wx, wy);

      if (blinkScale !== 1){
        const cx = x + s / 2;
        const cy = y + s / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, blinkScale);
        ctx.translate(-cx, -cy);
        drawBlock(ctx, x, y, s, eyeColor, breathK, nm);
        ctx.restore();
      } else {
        drawBlock(ctx, x, y, s, eyeColor, breathK, nm);
      }
    }
  }

  // close saturation filter scope
  ctx.restore();
  return boundaryRects;
}
function collectFlashRects(cam, org, view, orgId, baseSeed, flash, breathMul=1){
  if (!org) return [];
  const s = view.blockPx;

  // дыхание должно совпадать с тем, как рисуется организм
  const breathY = breathYOffsetPx(org, orgId, baseSeed, breathMul);

  // какие клетки подсвечиваем
  const set = new Set();

  // 1) если указаны несколько модулей — подсвечиваем их
  if (Array.isArray(flash.grownModules) && flash.grownModules.length){
    for (const mi of flash.grownModules){
      const m = (org.modules || [])[mi];
      if (m && Array.isArray(m.cells)){
        for (const [x,y] of m.cells) set.add(`${x},${y}`);
      }
    }
  } else if (flash.mi !== null && Number.isFinite(flash.mi)){
    // 2) если указан индекс модуля — подсвечиваем только этот модуль
    const m = (org.modules || [])[flash.mi];
    if (m && Array.isArray(m.cells)){
      for (const [x,y] of m.cells) set.add(`${x},${y}`);
    }
  } else {
    // 3) иначе по part: "body" — тело; иначе — модуль по типу (если однозначно)
    if (flash.part === "body"){
      for (const [x,y] of (org.body?.cells || [])) set.add(`${x},${y}`);
    } else if (flash.part){
      const matches = [];
      for (let mi=0; mi<(org.modules||[]).length; mi++){
        const m = org.modules[mi];
        if (!m || m.type !== flash.part) continue;
        matches.push(m);
      }
      if (matches.length === 1){
        for (const [x,y] of (matches[0].cells || [])) set.add(`${x},${y}`);
      }
    }
  }

  if (set.size === 0) return [];

  // boundary относительно подсвеченного набора
  const rects = [];
  for (const key of set){
    const [wxS, wyS] = key.split(",").map(n=>parseInt(n,10));
    if (!Number.isFinite(wxS) || !Number.isFinite(wyS)) continue;

    // boundary если рядом нет подсвеченной клетки
    let m = 0;
    if (set.has(`${wxS},${wyS-1}`)) m |= 1;
    if (set.has(`${wxS+1},${wyS}`)) m |= 2;
    if (set.has(`${wxS},${wyS+1}`)) m |= 4;
    if (set.has(`${wxS-1},${wyS}`)) m |= 8;
    const boundary = (m & 1) === 0 || (m & 2) === 0 || (m & 4) === 0 || (m & 8) === 0;
    if (!boundary) continue;

    const p = worldToScreenPx(cam, wxS, wyS, view);
    rects.push({ x: p.x, y: p.y + breathY, w: s, h: s });
  }

  return rects;
}

function drawGridOverlay(ctx, view, cam){
  const step = 10;
  const Vx = (view.gridW - 1) / 2;
  const Vy = (view.gridH - 1) / 2;
  const left = Math.floor(cam.ox - Vx);
  const right = Math.ceil(cam.ox + Vx);
  const top = Math.floor(cam.oy - Vy);
  const bottom = Math.ceil(cam.oy + Vy);

  const rootStyle = getComputedStyle(document.documentElement);
  const bgHex = rootStyle.getPropertyValue("--bg").trim() || "#070a0f";
  const lineHex = scaleBrightness(bgHex, 1.15);

  const startX = Math.floor(left / step) * step;
  const startY = Math.floor(top / step) * step;

  ctx.save();
  ctx.strokeStyle = lineHex;
  ctx.lineWidth = 1;

  for (let wx = startX; wx <= right; wx += step){
    const p = worldToScreenPx(cam, wx, 0, view);
    const x = p.x + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, view.rectH);
    ctx.stroke();
  }

  for (let wy = startY; wy <= bottom; wy += step){
    const p = worldToScreenPx(cam, 0, wy, view);
    const y = p.y + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(view.rectW, y);
    ctx.stroke();
  }
  ctx.restore();
}

// =====================
// Main render entry
// =====================
export function renderGrid(state, canvas, gridEl, view){
  syncCanvas(canvas, gridEl, view);

  // Camera is view-only (not saved). If missing, init from parent core.
  if (!view.cam){
    const c = state.body?.core || [0,0];
    view.cam = { ox: c[0], oy: c[1] };
  }

  // Clamp camera so colony never fully disappears
  const bounds = getColonyBounds(state);
  clampCamera(view.cam, bounds, view.gridW, view.gridH, 2);

  // Local alias used throughout renderGrid (some helpers expect `cam` in scope)
  const cam = view.cam;
  const globalTimeSec = Date.now() / 1000;
  
  // Optional post-processing FX pipeline (view-only).
  const fx = getFxPipeline(view, canvas);

  // радиус свечения в клетках мира
  view.glowRadiusCells = 6;  // можно потом завести в конфиг/стейт

  const ctx = fx.begin(canvas);

  // Draw in CSS pixels (not device pixels), matching previous 2D setup.
  // Offscreen scene buffer has the full DPR size; this transform keeps all
  // existing drawing code working unchanged.
  ctx.setTransform(view.dpr || 1, 0, 0, view.dpr || 1, 0, 0);
  ctx.imageSmoothingEnabled = false;

  // background (cached gradient to avoid per-frame allocations / GC spikes)
  ctx.clearRect(0, 0, view.rectW, view.rectH);
  if (!view._bgGrad || view._bgGrad.w !== view.rectW || view._bgGrad.h !== view.rectH){
    const gg = ctx.createRadialGradient(
      view.rectW/2, view.rectH/2, Math.min(view.rectW,view.rectH)*0.15,
      view.rectW/2, view.rectH/2, Math.max(view.rectW,view.rectH)*0.85
    );
    gg.addColorStop(0, "rgb(38, 49, 30)");
    gg.addColorStop(1, "rgb(1, 2, 1)");
    view._bgGrad = { w: view.rectW, h: view.rectH, g: gg };
  }
  ctx.fillStyle = view._bgGrad.g;
  ctx.fillRect(0, 0, view.rectW, view.rectH);

    // Grid parallax: grid follows camera slightly slower than world objects
  const camBg = {
    ox: (cam.ox || 0) * GRID_PARALLAX,
    oy: (cam.oy || 0) * GRID_PARALLAX,
  };

  drawGridOverlay(ctx, view, camBg);

// Carrots (rect blocks, orange)
if (Array.isArray(state.carrots)){
  const sPx = view.blockPx;
  const cw = (CARROT.w|0) || 3;
  const ch = (CARROT.h|0) || 7;

  // Cache the carrot shape (offsets + neighbor set) to avoid per-frame allocations.
  view._shapeCache = view._shapeCache || {};
  const cKey = `carrot:${cw}x${ch}`;
  let cShape = view._shapeCache[cKey];
  if (!cShape){
    const offsets = carrotCellOffsets(cw, ch);
    const offsetSet = new Set(offsets.map(([dx, dy]) => `${dx},${dy}`));
    cShape = view._shapeCache[cKey] = { offsets, offsetSet };
  }
  const offsets = cShape.offsets;
  const offsetSet = cShape.offsetSet;

  for (const car of state.carrots){
    for (const [dx, dy] of offsets){
      const wx = (car.x|0) + dx;
      const wy = (car.y|0) + dy;
      const p = worldToScreenPx(view.cam, wx, wy, view);

      let m = 0;
      if (offsetSet.has(`${dx},${dy - 1}`)) m |= 1; // N
      if (offsetSet.has(`${dx + 1},${dy}`)) m |= 2; // E
      if (offsetSet.has(`${dx},${dy + 1}`)) m |= 4; // S
      if (offsetSet.has(`${dx - 1},${dy}`)) m |= 8; // W

      const color = dy === 0 ? "#22c55e" : "#fb923c";
      drawBlock(ctx, p.x, p.y, sPx, color, false, m);
    }
  }
}

// Coins (3x3 blocks, golden)
if (Array.isArray(state.coins)){
  const sPx = view.blockPx;
  const cw = (COIN.w|0) || 3;
  const ch = (COIN.h|0) || 3;

  // Cache the coin shape (offsets + neighbor set) to avoid per-frame allocations.
  view._shapeCache = view._shapeCache || {};
  const kKey = `coin:${cw}x${ch}`;
  let kShape = view._shapeCache[kKey];
  if (!kShape){
    const offsets = coinCellOffsets(cw, ch);
    const offsetSet = new Set(offsets.map(([dx, dy]) => `${dx},${dy}`));
    kShape = view._shapeCache[kKey] = { offsets, offsetSet };
  }
  const offsets = kShape.offsets;
  const offsetSet = kShape.offsetSet;

  for (const coin of state.coins){
    for (const [dx, dy] of offsets){
      const wx = (coin.x|0) + dx;
      const wy = (coin.y|0) + dy;
      const p = worldToScreenPx(view.cam, wx, wy, view);

      let m = 0;
      if (offsetSet.has(`${dx},${dy - 1}`)) m |= 1; // N
      if (offsetSet.has(`${dx + 1},${dy}`)) m |= 2; // E
      if (offsetSet.has(`${dx},${dy + 1}`)) m |= 4; // S
      if (offsetSet.has(`${dx - 1},${dy}`)) m |= 8; // W

      // slightly different highlight in the center cell so it feels more "spherical"
      const isCenter = (dx === 1 && dy === 1);
      const color = isCenter ? "#fcd34d" : "#f59e0b";
      drawBlock(ctx, p.x, p.y, sPx, color, false, m);
    }
  }
}

  const baseSeed = state.seed || 12345;

  // Determine selection
  const active = state.active;
  const selectedParent = (active === -1);
  const selectedBudIndex =
    Number.isFinite(active) && Array.isArray(state.buds) && active >= 0 && active < state.buds.length
      ? active
      : null;


  // draw organisms (with view-only movement/rotation)
  let sel = null; // {rects, pivot:{x,y}, angRad}

  const drawOne = (org, orgId, isSel)=>{
    const m = getOrgMotion(view, orgId);

    // Base (persistent) translation in world blocks (used e.g. for buds separation).
    const dx = Number.isFinite(m?.offsetX) ? m.offsetX : 0;
    const dy = Number.isFinite(m?.offsetY) ? m.offsetY : 0;

    // Smooth step translation (render-only): while logic moves in whole blocks,
    // gait makes the visual position slide continuously between them.
    const gait = m?.gait || null;
    const gaitPhase = gait ? clamp((gait.t || 0) / Math.max(1e-6, (gait.dur || 0.25)), 0, 1) : 0;
    const gaitDx = gait ? (gait.dx || 0) : 0;
    const gaitDy = gait ? (gait.dy || 0) : 0;
    const gaitDist = gait ? Math.max(1, (gait.dist || 1)) : 1;

    // Translate in world units (blocks)
    const stepK = gait ? (gaitPhase * gaitDist) : 0; // 0..1 (or 0..2 for dist=2)
    const tdx = dx + gaitDx * stepK;
    const tdy = dy + gaitDy * stepK;

    const breathMul = Number.isFinite(m?.breathMul) ? m.breathMul : 1;
    const angRad = (Number.isFinite(m?.angleDeg) ? m.angleDeg : 0) * Math.PI / 180;

    // Shift camera so organism appears translated by (tdx, tdy)
    const cam2 = { ox: (cam.ox || 0) - tdx, oy: (cam.oy || 0) - tdy };

    // Pivot is core (fallback: first body cell)
    const core = org?.body?.core || org?.body?.cells?.[0] || [0, 0];
    const pivot = worldToScreenPx(cam2, core[0] || 0, core[1] || 0, view);

    // Pleasant squash & stretch during the step (render-only).
    // Peak in the middle of the gait cycle.
    let sx = 1, sy = 1;
    if (gait){
      const phase = Math.sin(gaitPhase * Math.PI); // 0..1..0
      const k = 0.05 * phase;
      if (Math.abs(gaitDx) >= Math.abs(gaitDy)){
        sx = 1 + k;
        sy = 1 - k * 0.2;
      } else {
        sy = 1 + k;
        sx = 1 - k * 0.2;
      }
    }

    ctx.save();

    // Keep transforms consistent for body, selection, flashes.
    if (sx !== 1 || sy !== 1 || angRad !== 0){
      ctx.translate(pivot.x, pivot.y);
      // scale first (screen axes), then rotate
      if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
      if (angRad !== 0) ctx.rotate(angRad);
      ctx.translate(-pivot.x, -pivot.y);
    }

    const rects = renderOrg(ctx, cam2, org, view, orgId, baseSeed, !!isSel, breathMul, globalTimeSec);

    if (isSel){
      sel = { rects, pivot, angRad, cam2, org, orgId, breathMul, sx, sy };
    }

    ctx.restore();
  };

  // parent
  drawOne(state, 0, selectedParent);

  // buds
  if (Array.isArray(state.buds)){
    for (let i=0;i<state.buds.length;i++){
      const bud = state.buds[i];
      if (!bud) continue;
      drawOne(bud, i+1, (selectedBudIndex === i));
    }
  }

  // Selection glow drawn after blocks, using the same transform (BODY ONLY)
if (sel && sel.org){
  const bounds = getBodyBoundsCached(sel.org);
  if (!bounds.empty){
    const sPx = Number.isFinite(view.blockPx) ? view.blockPx : 4;
    const breathY = breathYOffsetPx(sel.org, sel.orgId, baseSeed, sel.breathMul);

    const pMin = worldToScreenPx(sel.cam2, bounds.minX, bounds.minY, view);
    const pMax = worldToScreenPx(sel.cam2, bounds.maxX, bounds.maxY, view);

    const minX = pMin.x;
    const minY = pMin.y + breathY;
    const maxX = pMax.x + sPx;
    const maxY = pMax.y + sPx + breathY;

    const bbox = [{ x: minX, y: minY, w: (maxX - minX), h: (maxY - minY) }];

    ctx.save();
    // Apply the same render-only deformation as the organism itself.
    if ((sel.sx && sel.sx !== 1) || (sel.sy && sel.sy !== 1) || sel.angRad !== 0){
      ctx.translate(sel.pivot.x, sel.pivot.y);
      if ((sel.sx && sel.sx !== 1) || (sel.sy && sel.sy !== 1)) ctx.scale(sel.sx || 1, sel.sy || 1);
      if (sel.angRad !== 0) ctx.rotate(sel.angRad);
      ctx.translate(-sel.pivot.x, -sel.pivot.y);
    }

    drawSelectionGlow(ctx, bbox, 1);

    ctx.restore();
  }
}

  // Flash highlight from log click (white glow, 0.2s)
  const fl = view.flash;
  const now = Date.now()/1000;
  if (fl && fl.until && fl.until > now){
    let org = state;
    let orgId = 0;
    if (Number.isFinite(fl.org) && fl.org >= 0 && Array.isArray(state.buds) && fl.org < state.buds.length){
      org = state.buds[fl.org];
      orgId = fl.org + 1;
    }

    const m = getOrgMotion(view, orgId);

    const dx = Number.isFinite(m?.offsetX) ? m.offsetX : 0;
    const dy = Number.isFinite(m?.offsetY) ? m.offsetY : 0;

    const gait = m?.gait || null;
    const gaitPhase = gait ? clamp((gait.t || 0) / Math.max(1e-6, (gait.dur || 0.25)), 0, 1) : 0;
    const gaitDx = gait ? (gait.dx || 0) : 0;
    const gaitDy = gait ? (gait.dy || 0) : 0;
    const gaitDist = gait ? Math.max(1, (gait.dist || 1)) : 1;
    const stepK = gait ? (gaitPhase * gaitDist) : 0;
    const tdx = dx + gaitDx * stepK;
    const tdy = dy + gaitDy * stepK;

    const breathMul = Number.isFinite(m?.breathMul) ? m.breathMul : 1;
    const angRad = (Number.isFinite(m?.angleDeg) ? m.angleDeg : 0) * Math.PI / 180;

    const cam2 = { ox: (cam.ox || 0) - tdx, oy: (cam.oy || 0) - tdy };
    const core = org?.body?.core || org?.body?.cells?.[0] || [0,0];
    const pivot = worldToScreenPx(cam2, core[0] || 0, core[1] || 0, view);

    const rects = collectFlashRects(cam2, org, view, orgId, baseSeed, fl, breathMul);
    const uniq2 = new Map();
    for (const r of rects){
      const k = `${r.x},${r.y},${r.w},${r.h}`;
      if (!uniq2.has(k)) uniq2.set(k, r);
    }
    if (uniq2.size){
      // Same squash/stretch as movement (render-only)
      let sx = 1, sy = 1;
      if (gait){
        const phase = Math.sin(gaitPhase * Math.PI);
        const k = 0.03 * phase;
        if (Math.abs(gaitDx) >= Math.abs(gaitDy)){
          sx = 1 + k;
          sy = 1 - k * 0.6;
        } else {
          sy = 1 + k;
          sx = 1 - k * 0.6;
        }
      }

      ctx.save();
      if (sx !== 1 || sy !== 1 || angRad !== 0){
        ctx.translate(pivot.x, pivot.y);
        if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
        if (angRad !== 0) ctx.rotate(angRad);
        ctx.translate(-pivot.x, -pivot.y);
      }
      drawFlashGlow(ctx, [...uniq2.values()]);
      ctx.restore();
    }
  }

  // Apply post-processing after the whole field is rendered.
  fx.end(canvas);
}


// =====================
// HUD / Legend / Rules (unchanged interface)
// =====================
export function barStatus(org){
  // Defensive: org can be null/undefined on some corrupted saves
  // (e.g. buds array contains empty slots). In that case, treat as "good".
  const bars = org?.bars || {food:1,clean:1,hp:1,mood:1};
  const minBar = Math.min(bars.food, bars.clean, bars.hp, bars.mood);
  if (minBar <= 0.01) return { txt:"усыхание", cls:"bad" };
  if (minBar <= 0.1) return { txt:"анабиоз", cls:"bad" };
  if (minBar <= 0.15) return { txt:"критично", cls:"bad" };
  if (minBar <= 0.35) return { txt:"плохо", cls:"bad" };
  if (minBar <= 0.65) return { txt:"норма", cls:"" };
  return { txt:"хорошо", cls:"ok" };
}

function barToneCls(v){
  // v is 0..1
  if (!isFinite(v)) return "";
  if (v > 0.80) return "ok";
  if (v > 0.60) return "info";
  if (v > 0.20) return "warn";
  if (v > 0.00) return "bad";
  return "bad";
}


export function renderLegend(org, legendEl){
  const present = new Set(["body", "core"]);
  if (org?.face?.anchor) present.add("eye");
  for (const m of (org?.modules || [])){
    if (m?.type) present.add(m.type);
  }

  const items = [
    { part:"body",    title:"Тело",    desc:"Основная биомасса." },
    { part:"core",     title:"Ядро",    desc:"Цвет отражает состояние организма." },
    { part:"eye",     title:"Глаза",   desc:"Растут вместе с телом." },

    { part:"antenna",  title:organLabel("antenna"),  desc:"Чувствительный огран." },
    { part:"tentacle", title:organLabel("tentacle"), desc:"Мягкая, подвижная структура." },
    { part:"tail",     title:organLabel("tail"),     desc:"Чем лучше уход, тем дальше тянется." },
    { part:"worm",     title:organLabel("worm"),     desc:"Мягкое волнообразное движение." },
    { part:"limb",     title:organLabel("limb"),     desc:"Опора/движение." },
    { part:"spike",    title:organLabel("spike"),    desc:"Защитная реакция." },
    { part:"shell",    title:organLabel("shell"),    desc:"Тело пытается изолироваться." },

    // поздние органы (добавлены в PARTS)
    { part:"teeth",    title:organLabel("teeth"),    desc:"Атака (зубы)." },
    { part:"claw",     title:organLabel("claw"),     desc:"Клешня." },
    { part:"mouth",    title:organLabel("mouth"),    desc:"Питание/рот." },
    { part:"fin",      title:organLabel("fin"),      desc:"плавник." },
  ];

  const filtered = items.filter((it) => present.has(it.part));

  legendEl.innerHTML = filtered.map(it => {
    const CORE_DEF = getOrganDef("core");
    const sat = (org && org.visual && Number.isFinite(org.visual.saturation)) ? org.visual.saturation : 1;
    const base = (it.part === "core")
      ? (CORE_DEF?.colors?.good || "#34d399")
      : getPartColor(org, it.part, 0);
    const sw = satColorHex(base, sat);
    const cls = (it.part === "core") ? "legendSwatch" : "legendSwatch swatch";
    const data = (it.part === "core")
      ? ""
      : `data-part="${escapeHtml(it.part)}" data-color="${escapeHtml(sw)}"`;
    return `
    <div class="legendItem">
      <div class="${cls}" ${data} style="background:${escapeHtml(sw)}"></div>
      <div>
        <div style="color: var(--text); font-weight:800; font-size:10px;">${escapeHtml(it.title)}</div>
        <div>${escapeHtml(it.desc)}</div>
      </div>
    </div>
  `;
  }).join("");
}

export function renderRules(rulesEl){
  const tokens = {
    shell: escapeHtml(organLabel("shell")),
    antenna: escapeHtml(organLabel("antenna")),
    spike: escapeHtml(organLabel("spike"))
  };

  const applyTokens = (text)=> text.replace(/\{\{(\w+)\}\}/g, (_, key) => tokens[key] ?? "");

  const sectionsHtml = RULES.map((section, index)=>{
    const title = `<div class="rule"><b>${escapeHtml(section.title)}</b></div>`;
    const items = (section.items || []).map((item)=>{
      const style = item.muted ? ' style="color:var(--muted);"' : "";
      return `<div class="rule"${style}>${applyTokens(item.text)}</div>`;
    }).join("");
    const spacer = index === 0 ? "" : '<div style="height:8px"></div>';
    return `${spacer}${title}${items}`;
  }).join("");

  rulesEl.innerHTML = `
    <div style="font-weight:900; color:var(--text); margin-bottom:6px;">Правила и управление (обновлено)</div>
    ${sectionsHtml}
  `;
}

export function renderHud(state, org, els, deltaSec, fmtAgeSeconds, zoom){
  const target = org || state;
  const status = barStatus(target);

  els.hudName.textContent = target.name;
  els.hudStage.textContent = `• ${getStageName(target)}`;
  // seed moved to settings

  els.hudMeta.innerHTML = `
    <span class="pill stat ${barToneCls(target.bars.food)}" data-stat="food" title="еда: ${barPct(target.bars.food)}%"><span class="ico"></span><span class="val">${barPct(target.bars.food)}%</span></span>
    <span class="pill stat ${barToneCls(target.bars.clean)}" data-stat="clean" title="чист: ${barPct(target.bars.clean)}%"><span class="ico"></span><span class="val">${barPct(target.bars.clean)}%</span></span>
    <span class="pill stat ${barToneCls(target.bars.hp)}" data-stat="hp" title="здор: ${barPct(target.bars.hp)}%"><span class="ico"></span><span class="val">${barPct(target.bars.hp)}%</span></span>
    <span class="pill stat ${barToneCls(target.bars.mood)}" data-stat="mood" title="настр: ${barPct(target.bars.mood)}%"><span class="ico">${moodEmoji(target.bars.mood)}</span><span class="val">${barPct(target.bars.mood)}%</span></span>
    <span class="pill stat ${status.cls}" data-stat="state" title="сост: ${status.txt}"><span class="ico">${stateEmoji(status.txt)}</span></span>
      `;

  // second row: life time + carrots inventory (input is static in DOM)
  if (els.lifePill){
    const now = state.lastSeen || target.lastSeen || 0;
    const age = Math.max(0, now - (target.createdAt || now));
    els.lifePill.textContent = `Возраст: ${fmtAgeSeconds(age)}`;
  }
  if (els.carrotHudInput && document.activeElement !== els.carrotHudInput){
    const v = state.inv?.carrots ?? 0;
    els.carrotHudInput.value = String(Math.max(0, v|0));
  }

  if (els.coinHudInput && document.activeElement !== els.coinHudInput){
    const v = state.inv?.coins ?? 0;
    els.coinHudInput.value = String(Math.max(0, v|0));
  }


  // Third row: carrot feedback (target + mode + strength) and field count.
  if (els.hudMeta2){
    const fieldCount = Array.isArray(state.carrots) ? state.carrots.length : 0;
    const inv = state.inv?.carrots ?? 0;
    const coins = state.inv?.coins ?? 0;

    const t = Array.isArray(target.growthTarget) ? target.growthTarget : null;
    const mode = target.growthTargetMode;
    const power = Number.isFinite(target.growthTargetPower) ? target.growthTargetPower : 0;

    const modeTxt =
      mode === "appendage" ? "отростки" :
      mode === "body" ? "тело" :
      mode === "mixed" ? "смеш" :
      (fieldCount > 0 ? "ожид" : "—");

    const tgtTxt = t ? `(${t[0]},${t[1]})` : (fieldCount > 0 ? "(выбор на тике)" : "—");
    const pTxt = t ? `${Math.round(power*100)}%` : "";

    els.hudMeta2.innerHTML = `
      <span class="pill">морковки: ${Math.max(0, inv|0)}</span>
      <span class="pill">монетки: ${Math.max(0, coins|0)}</span>
      <span class="pill">режим: ${modeTxt}${pTxt ? ` • сила ${pTxt}` : ""}</span>
    `;
  }

  // footer text is still set in main.js usually; keep compatible if present:
  if (els.footerInfo){
    const intervalSec = Math.max(1, Math.floor(state.evoIntervalMin * 60));
    const until = Math.max(0, (state.lastMutationAt + intervalSec) - state.lastSeen);
    els.footerInfo.textContent =
      `Эволюция через ~${fmtAgeSeconds(until)} (интервал ${state.evoIntervalMin} мин) zoom:${zoom ?? ""}`;
  }
}
