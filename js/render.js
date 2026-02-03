// js/render.js
import { escapeHtml, barPct, clamp, key } from "./util.js";
import { organLabel } from "./mods/labels.js";
import { PARTS } from "./mods/parts.js";
import { CRYSTAL_GLOW } from "./mods/glow.js";
import { CARROT } from "./mods/carrots.js";
import { ORGAN_COLORS } from "./mods/colors.js";
import { getStageName, getTotalBlocks } from "./creature.js";

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
const BREATH_AMPL_PX = 1;        // requested: 1 pixel

const GROW_DUR_SEC = 0.7;        // requested: 0.7s extrusion
const GLOW_PX = 3;               // requested: ~3px glow thickness

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
function hslCss(h,s,l){
  const hh = ((h%360)+360)%360;
  return `hsl(${hh.toFixed(1)},${clamp(s,0,100).toFixed(1)}%,${clamp(l,0,100).toFixed(1)}%)`;
}
function getPartBaseHex(part, palette){
  if (part === "body") return palette?.body || "#1f2937";
  if (part === "eye") return ORGAN_COLORS.eye || palette?.eye || "#f472b6";
  return ORGAN_COLORS[part] || "#cbd5e1";
}
function getPartColor(state, part, hueShiftDeg){
  const baseHex = getPartBaseHex(part, state.palette);
  const {r,g,b} = hexToRgb(baseHex);
  const hsl = rgbToHsl(r,g,b);
  const userHue = state.partHue?.[part];
  const h = Number.isFinite(userHue) ? userHue : hsl.h;
  return hslCss(h + (hueShiftDeg||0), hsl.s, hsl.l);
}

// =====================
// Small utils (local, robust)
// =====================
function getBaseBlockPx(){
  const v = getComputedStyle(document.documentElement).getPropertyValue("--cellSize").trim();
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 2 ? n : 4;
}

// =====================
// Crystal border glow (jagged/fractal)
// =====================
function _noise01(i, seed){
  const x = Math.sin((i*12.9898 + seed*78.233) ) * 43758.5453;
  return x - Math.floor(x);
}
function drawCrystalPerimeter(ctx, w, h, px, strength01, seed){
  const inset = 10;
  const x0 = inset, y0 = inset;
  const x1 = w - inset, y1 = h - inset;
  const seg = 6; // segment size in px
  ctx.save();
  ctx.globalAlpha = 0.08 + 0.30 * strength01;
  ctx.shadowColor = "rgba(255,105,180,0.85)";
  ctx.shadowBlur = 10 + px;
  ctx.lineWidth = Math.max(2, Math.min(10, Math.round(px/2)));
  ctx.strokeStyle = "rgba(255,105,180,0.65)";

  // draw 4 sides as noisy paths with a ragged inner edge
  const drawSide = (ax, ay, bx, by, nx, ny, idxBase)=>{
    const len = Math.max(1, Math.hypot(bx-ax, by-ay));
    const steps = Math.max(8, Math.floor(len / seg));
    ctx.beginPath();
    for (let i=0;i<=steps;i++){
      const t = i/steps;
      const x = ax + (bx-ax)*t;
      const y = ay + (by-ay)*t;
      // fractal-ish: combine 3 octaves
      const n1 = _noise01(idxBase + i, seed);
      const n2 = _noise01(idxBase + i*3.1, seed ^ 0x9e3779b9);
      const n3 = _noise01(idxBase + i*7.7, seed ^ 0x85ebca6b);
      const n = (0.55*n1 + 0.30*n2 + 0.15*n3);
      const jitter = (0.35 + 0.65*n) * px;
      const xx = x + nx * jitter;
      const yy = y + ny * jitter;
      if (i===0) ctx.moveTo(xx,yy);
      else ctx.lineTo(xx,yy);
    }
    ctx.stroke();

    // add crystalline spikes
    ctx.globalAlpha *= 0.65;
    for (let i=0;i<steps;i++){
      if (_noise01(idxBase + i*11.3, seed) < 0.14) continue;
      const t = i/steps;
      const x = ax + (bx-ax)*t;
      const y = ay + (by-ay)*t;
      const n = _noise01(idxBase + i*5.9, seed);
      const spike = (0.35 + 0.65*n) * px * 0.9;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + nx*spike, y + ny*spike);
      ctx.stroke();
    }
    ctx.globalAlpha /= 0.65;
  };

  // normals point inward
  drawSide(x0,y0, x1,y0, 0, +1, 1000);
  drawSide(x1,y0, x1,y1, -1, 0, 2000);
  drawSide(x1,y1, x0,y1, 0, -1, 3000);
  drawSide(x0,y1, x0,y0, +1, 0, 4000);

  ctx.restore();
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
  const k = 1 + amt;
  return rgbToHex(c.r*k, c.g*k, c.b*k);
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

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px
  ctx.imageSmoothingEnabled = false;

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
function breathYOffsetPx(org, orgId, baseSeed){
  // unique phase per organism (offset > 1/3 cycle is naturally true with random phase)
  const tag = `${baseSeed}|breath|${orgId}|${org?.seed ?? 0}`;
  const phase = hash01(tag) * Math.PI * 2;
  const t = (Date.now() / 1000);
  const s = Math.sin((t * (Math.PI * 2) / BREATH_PERIOD_SEC) + phase);
  return Math.round(s * BREATH_AMPL_PX);
}

function spikeBlinkOn(){
  return (Math.floor(Date.now()/500) % 2) === 0;
}

function moduleDir(cells){
  if (!cells || cells.length < 2) return [1,0];
  const dx = cells[1][0] - cells[0][0];
  const dy = cells[1][1] - cells[0][1];
  return [Math.sign(dx), Math.sign(dy)];
}

function perpOf([dx,dy]){ return [-dy, dx]; }

function windOffset(i, len){
  if (i < 3) return 0;
  const t = Date.now()/1000;
  const omega = 2*Math.PI/5; // 5 sec period
  const phase = omega*t + i*0.55;
  const denom = Math.max(1, len-3);
  const amp = Math.min(1, (i-2)/denom);
  return Math.round(Math.sin(phase)*amp); // -1/0/1 blocks
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
function organBaseColor(type){
  return ORGAN_COLORS[type] || "#cbd5e1";
}

function organColor(type, orgId, organIndex, baseSeed){
  // tone variance up to ~10% by mixing towards slightly shifted warm/cool anchors
  const base = organBaseColor(type);
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
  const amt = (u - 0.5) * 0.10 + jitter; // ~±5%
  return brighten(hex, amt);
}

// =====================
// Block drawing (procedural shading + corner smoothing)
// =====================
function drawBlock(ctx, x, y, s, colorHex, breathK, neighMask){
  // basic shaded cube feel: highlight top/left, shadow bottom/right
  // neighMask bits: 1=N,2=E,4=S,8=W (present=1)
  const base = colorHex;
  const hi = brighten(base, 0.10);
  const lo = brighten(base, -0.10);

  // subtle breathe tint (very slight)
  const tint = breathK ? brighten(base, 0.04) : base;

  ctx.fillStyle = tint;
  ctx.fillRect(x, y, s, s);

  // edges
  ctx.fillStyle = hi;
  // top edge if no neighbor north
  if (!(neighMask & 1)) ctx.fillRect(x, y, s, 1);
  // left edge if no neighbor west
  if (!(neighMask & 8)) ctx.fillRect(x, y, 1, s);

  ctx.fillStyle = lo;
  // bottom edge if no neighbor south
  if (!(neighMask & 4)) ctx.fillRect(x, y + s - 1, s, 1);
  // right edge if no neighbor east
  if (!(neighMask & 2)) ctx.fillRect(x + s - 1, y, 1, s);

  // Corner smoothing: if an outer corner is free (no neighbors on the two touching sides)
  // cut a *single pixel* (per project rules). For tiny blocks (<=2px), skip smoothing.
  const cut = (s >= 3) ? 1 : 0;
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
function buildOccupancy(org){
  const occ = new Set();
  if (org?.body?.cells){
    for (const [x,y] of org.body.cells) occ.add(`${x},${y}`);
  }
  if (org?.modules){
    for (const m of org.modules){
      for (const [x,y] of (m.cells || [])) occ.add(`${x},${y}`);
    }
  }
  return occ;
}

function neighMaskAt(occ, x, y){
  let m = 0;
  if (occ.has(`${x},${y-1}`)) m |= 1;
  if (occ.has(`${x+1},${y}`)) m |= 2;
  if (occ.has(`${x},${y+1}`)) m |= 4;
  if (occ.has(`${x-1},${y}`)) m |= 8;
  return m;
}

function isBoundary(occ, x, y){
  const m = neighMaskAt(occ, x, y);
  // boundary if any side missing
  return (m & 1) === 0 || (m & 2) === 0 || (m & 4) === 0 || (m & 8) === 0;
}

// =====================
// Core + Eyes scaling rules
// =====================
function computeCorePx(view, bodyBlocks){
  const base = Math.max(8, view.blockPx * 2); // base 8px (2 blocks at 4px)
  // limit core area <= 10% body area (in pixels)
  if (bodyBlocks < 20) return base; // allow early stages to violate
  const bodyArea = bodyBlocks * view.blockPx * view.blockPx;
  const maxCoreArea = bodyArea * 0.10;
  const maxSide = Math.max(8, Math.floor(Math.sqrt(maxCoreArea)));
  return Math.max(8, Math.min(base, maxSide));
}

function computeEyeSideBlocks(org, bodyBlocks){
  // Eyes are rendered as block-shapes (not px), up to 3x3 = 9 blocks.
  // Outer corners are rounded by the block corner-cut.
  const wanted = clamp(org?.face?.eyeSize ?? 1, 1, 3);
  // early stage: keep tiny
  if (bodyBlocks < 16) return 1;
  return wanted;
}

// =====================
// Selection glow
// =====================
function drawSelectionGlow(ctx, rects, strength=1){
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  for (let i = GLOW_PX; i >= 1; i--){
    const alpha = 0.08 + (i / GLOW_PX) * 0.14;
    ctx.globalAlpha = alpha;
    ctx.shadowColor = "rgba(90,255,140,0.70)";
    ctx.shadowBlur = i * 2.2;
    ctx.strokeStyle = "rgba(90,255,140,0.55)";
    ctx.lineWidth = 1;

    for (const r of rects){
      ctx.strokeRect(r.x - i, r.y - i, r.w + i*2, r.h + i*2);
    }
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
    ctx.shadowBlur = i * 2.6;
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
function renderOrg(ctx, cam, org, view, orgId, baseSeed, isSelected){
  const s = view.blockPx;
  const occ = buildOccupancy(org);

  const breathY = breathYOffsetPx(org, orgId, baseSeed);
  const breathK = (breathY !== 0); // slight tint toggle

  const boundaryRects = [];

  // BODY blocks
  const bodyColor = org?.palette?.body || "#60a5fa";
  const bodyCells = org?.body?.cells || [];
  for (const [wx,wy] of bodyCells){
    const p = worldToScreenPx(cam, wx, wy, view);
    const x = p.x;
    const y = p.y + breathY;

    const nm = neighMaskAt(occ, wx, wy);
    const kGrow = animProgress(org, wx, wy);
    drawBlockAnim(ctx, x, y, s, bodyColor, breathK, nm, kGrow);

    if (isSelected && isBoundary(occ, wx, wy)){
      boundaryRects.push({x, y, w:s, h:s});
    }
  }

  // MODULES
  const modules = org?.modules || [];
  for (let mi=0; mi<modules.length; mi++){
    const m = modules[mi];
    const type = m.type || "organ";
    const cells = m.cells || [];
    if (cells.length === 0) continue;

    let base = organColor(type, orgId, mi, baseSeed);

    if (type === "spike"){
      const on = spikeBlinkOn();
      const len = cells.length;
      const blinkCount = (len >= 14) ? 2 : 1;

      for (let i=0;i<len;i++){
        const [wx,wy] = cells[i];
        const p = worldToScreenPx(cam, wx, wy, view);
        const x = p.x;
        const y = p.y + breathY;

        // spike tip blink changes brightness
        let c = base;
        const isTip = (i >= len - blinkCount);
        if (isTip && on) c = brighten(c, 0.15);

        c = organSegmentColor(c, i, len, baseSeed, orgId, mi);

        const nm = neighMaskAt(occ, wx, wy);
        const kGrow = animProgress(org, wx, wy);
        drawBlockAnim(ctx, x, y, s, c, breathK, nm, kGrow);

        if (isSelected && isBoundary(occ, wx, wy)){
          boundaryRects.push({x, y, w:s, h:s});
        }
      }
      continue;
    }

    if (type === "shell"){
      // shell draws slightly darker plates
      for (let i=0;i<cells.length;i++){
        const [wx,wy] = cells[i];
        const p = worldToScreenPx(cam, wx, wy, view);
        const x = p.x;
        const y = p.y + breathY;

        let c = organSegmentColor(brighten(base, -0.05), i, cells.length, baseSeed, orgId, mi);

        const nm = neighMaskAt(occ, wx, wy);
        const kGrow = animProgress(org, wx, wy);
        drawBlockAnim(ctx, x, y, s, c, breathK, nm, kGrow);

        if (isSelected && isBoundary(occ, wx, wy)){
          boundaryRects.push({x, y, w:s, h:s});
        }
      }
      continue;
    }

    // tails / limbs / antenna / tentacle: wind deformation on segments
    const len = cells.length;
    const dir = moduleDir(cells);
    const perp = perpOf(dir);

    // thickness at base: if len >= 10 → add 1 extra block near base (2-wide) visually
    const th = (len >= 10) ? 2 : 1;

    for (let i=0;i<len;i++){
      let [wx,wy] = cells[i];

      // Antennas should NOT sway with wind (requested).
      const off = (type === "antenna") ? 0 : windOffset(i, len);
      wx += perp[0] * off;
      wy += perp[1] * off;

      const p = worldToScreenPx(cam, wx, wy, view);
      const x = p.x;
      const y = p.y + breathY;

      let c = organSegmentColor(base, i, len, baseSeed, orgId, mi);

      const nm = neighMaskAt(occ, cells[i][0], cells[i][1]); // for shading based on true occupancy
      const kGrow = animProgress(org, cells[i][0], cells[i][1]);

      drawBlockAnim(ctx, x, y, s, c, breathK, nm, kGrow);

      // base thickening: add one adjacent block near base (segments 0..1) if long
      if (th === 2 && i < 2){
        const bx = x + perp[0] * s; // expand sideways
        const by = y + perp[1] * s;
        // draw a “support” block with slight darkening
        drawBlockAnim(ctx, bx, by, s, brighten(c, -0.04), breathK, 0, kGrow);
        if (isSelected){
          boundaryRects.push({x:bx, y:by, w:s, h:s});
        }
      }

      if (isSelected && isBoundary(occ, cells[i][0], cells[i][1])){
        boundaryRects.push({x, y, w:s, h:s});
      }
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
  const coreCol = (st.cls === "bad") ? "#fb7185" : (st.txt === "норм" ? "#fbbf24" : "#34d399");

  ctx.save();
  ctx.fillStyle = coreCol;
  ctx.fillRect(coreX, coreY, corePx, corePx);
  // tiny highlight
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(coreX, coreY, Math.max(1, Math.floor(corePx*0.35)), 1);
  ctx.restore();

  if (isSelected){
    // core also contributes to boundary glow a bit
    boundaryRects.push({x:coreX, y:coreY, w:corePx, h:corePx});
  }

  // EYES (always on top of body). Size can grow up to 9 blocks (3x3).
  const face = org?.face?.anchor;
  if (face){
    const eyeSide = computeEyeSideBlocks(org, bodyBlocks);
    const eyeColor = org?.palette?.eye || "#e2e8f0";

    const sx = face[0] - Math.floor(eyeSide/2);
    const sy = face[1] - Math.floor(eyeSide/2);

    // local occ for neighbor shading within the eye blob
    const eyeOcc = new Set();
    for (let yy=0; yy<eyeSide; yy++){
      for (let xx=0; xx<eyeSide; xx++){
        eyeOcc.add(`${sx+xx},${sy+yy}`);
      }
    }

    for (let yy=0; yy<eyeSide; yy++){
      for (let xx=0; xx<eyeSide; xx++){
        const wx = sx+xx, wy = sy+yy;
        const p = worldToScreenPx(cam, wx, wy, view);
        const x = p.x;
        const y = p.y + breathY;
        const nm = neighMaskAt(eyeOcc, wx, wy);
        drawBlock(ctx, x, y, s, eyeColor, breathK, nm);
      }
    }
  }

  return boundaryRects;
}
function collectFlashRects(cam, org, view, orgId, baseSeed, flash){
  if (!org) return [];
  const s = view.blockPx;

  // дыхание должно совпадать с тем, как рисуется организм
  const breathY = breathYOffsetPx(org, orgId, baseSeed);

  // какие клетки подсвечиваем
  const set = new Set();

  // 1) если указан индекс модуля — подсвечиваем только этот модуль
  if (flash.mi !== null && Number.isFinite(flash.mi)){
    const m = (org.modules || [])[flash.mi];
    if (m && Array.isArray(m.cells)){
      for (const [x,y] of m.cells) set.add(`${x},${y}`);
    }
  } else {
    // 2) иначе по part: "body" — тело; иначе — все модули нужного типа
    if (flash.part === "body"){
      for (const [x,y] of (org.body?.cells || [])) set.add(`${x},${y}`);
    } else if (flash.part){
      for (let mi=0; mi<(org.modules||[]).length; mi++){
        const m = org.modules[mi];
        if (!m || m.type !== flash.part) continue;
        for (const [x,y] of (m.cells || [])) set.add(`${x},${y}`);
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

// =====================
// Main render entry
// =====================
export function renderGrid(state, canvas, gridEl, view){
  syncCanvas(canvas, gridEl, view);

  if (!state.cam){
    const c = state.body?.core || [0,0];
    state.cam = { ox: c[0], oy: c[1] };
  }

  // Clamp camera so colony never fully disappears
  const bounds = getColonyBounds(state);
  clampCamera(state.cam, bounds, view.gridW, view.gridH, 2);

  const ctx = canvas.getContext("2d");

  // background
  ctx.clearRect(0, 0, view.rectW, view.rectH);
  const g = ctx.createRadialGradient(
    view.rectW/2, view.rectH/2, Math.min(view.rectW,view.rectH)*0.15,
    view.rectW/2, view.rectH/2, Math.max(view.rectW,view.rectH)*0.85
  );
  g.addColorStop(0, "rgba(255,255,255,0.03)");
  g.addColorStop(1, "rgba(0,0,0,0.24)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.rectW, view.rectH);

  // Inner perimeter glow (pink crystalline, jagged/fractal edge), depends on avg condition, up to 24px.
  {
    const orgs = [state, ...(Array.isArray(state.buds) ? state.buds : [])];
    let sum = 0;
    for (const o of orgs){
      const bars = o.bars || {food:1,clean:1,hp:1,mood:1};
      sum += Math.min(bars.food, bars.clean, bars.hp, bars.mood);
    }
    const avg = sum / Math.max(1, orgs.length);
    const t = Math.max(0, Math.min(1, avg));
    const px = Math.round((CRYSTAL_GLOW.maxPx || 24) * t);
    if (px > 0){
      drawCrystalPerimeter(ctx, view.rectW, view.rectH, px, t, (state.seed||1) ^ ((state.lastSeen||0)|0));
    }
  }

  // Carrots (rect blocks, orange)
if (Array.isArray(state.carrots)){
  const sPx = view.blockPx;
  const cw = (CARROT.w|0) || 7;
  const ch = (CARROT.h|0) || 3;

  for (const car of state.carrots){
    for (let yy=0; yy<ch; yy++){
      for (let xx=0; xx<cw; xx++){
        const wx = (car.x|0) + xx;
        const wy = (car.y|0) + yy;
        const p = worldToScreenPx(state.cam, wx, wy, view);

        // neighbor mask внутри прямоугольника морковки,
        // чтобы сглаживание углов не "съедало" клетки
        let m = 0;
        if (yy > 0)      m |= 1; // N
        if (xx < cw-1)   m |= 2; // E
        if (yy < ch-1)   m |= 4; // S
        if (xx > 0)      m |= 8; // W

        drawBlock(ctx, p.x, p.y, sPx, "#fb923c", false, m);
      }
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

  // draw organisms first
  const boundaryRects = [];

  // parent
  boundaryRects.push(...renderOrg(ctx, state.cam, state, view, 0, baseSeed, selectedParent));

  // buds
  if (Array.isArray(state.buds)){
    for (let i=0;i<state.buds.length;i++){
      const bud = state.buds[i];
      if (!bud) continue;
      const isSel = (selectedBudIndex === i);
      boundaryRects.push(...renderOrg(ctx, state.cam, bud, view, i+1, baseSeed, isSel));
    }
  }

  // draw glow AFTER drawing blocks (so it is visible and "outside")
  if (selectedParent || selectedBudIndex !== null){
    // Filter boundary rects a bit (avoid huge overdraw): keep only unique rects by key
    const uniq = new Map();
    for (const r of boundaryRects){
      const k = `${r.x},${r.y},${r.w},${r.h}`;
      if (!uniq.has(k)) uniq.set(k, r);
    }
    drawSelectionGlow(ctx, [...uniq.values()], 1);
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
    } else {
      org = state;
      orgId = 0;
    }

    const rects = collectFlashRects(state.cam, org, view, orgId, baseSeed, fl);

    // чуть фильтруем дубликаты
    const uniq2 = new Map();
    for (const r of rects){
      const k = `${r.x},${r.y},${r.w},${r.h}`;
      if (!uniq2.has(k)) uniq2.set(k, r);
    }
    if (uniq2.size){
      drawFlashGlow(ctx, [...uniq2.values()]);
    }
  }
}

// =====================
// HUD / Legend / Rules (unchanged interface)
// =====================
export function barStatus(org){
  // Defensive: org can be null/undefined on some corrupted saves
  // (e.g. buds array contains empty slots). In that case, treat as "good".
  const bars = org?.bars || {food:1,clean:1,hp:1,mood:1};
  const minBar = Math.min(bars.food, bars.clean, bars.hp, bars.mood);
  if (minBar <= 0.15) return { txt:"критично", cls:"bad" };
  if (minBar <= 0.35) return { txt:"плохо", cls:"bad" };
  if (minBar <= 0.65) return { txt:"норма", cls:"" };
  return { txt:"хорошо", cls:"ok" };
}

export function renderLegend(state, legendEl){
  const items = [
    { part:"body",    title:"Тело",    desc:"Блоки биоматериала (объём/тень)." },
    { part:null,       title:"Ядро",    desc:"Центр жизненной активности. Цвет отражает текущее состояние организма." },
    { part:"eye",     title:"Глаза",   desc:"Растут вместе с телом, рисуются поверх." },

    { part:"antenna",  title:organLabel("antenna"),  desc:"Чувствительный отросток.	Формируется при попытках «лечить» и вмешиваться." },
    { part:"tentacle", title:organLabel("tentacle"), desc:"Мягкая, подвижная структура." },
    { part:"tail",     title:organLabel("tail"),     desc:"Чем лучше уход, тем дальше он тянется от тела." },
    { part:"limb",     title:organLabel("limb"),     desc:"Опора/движение (коричневый)." },
    { part:"spike",    title:organLabel("spike"),    desc:"Защитная реакция.Возникают, когда организм испытывает давление или стресс." },
    { part:"shell",    title:organLabel("shell"),    desc:"Закрытая форма. Тело пытается изолироваться." },

    // поздние органы (добавлены в PARTS)
    { part:"teeth",    title:organLabel("teeth"),    desc:"Атака (зубы)." },
    { part:"claw",     title:organLabel("claw"),     desc:"Схватить/рубить (клешня)." },
    { part:"mouth",    title:organLabel("mouth"),    desc:"Питание/атака (рот)." },
    { part:"fin",      title:organLabel("fin"),      desc:"Плавание/манёвр (плавник)." },
  ];

  legendEl.innerHTML = items.map(it => {
    const sw = it.part ? getPartColor(state, it.part, 0) : "#34d399";
    const cls = it.part ? "legendSwatch swatch" : "legendSwatch";
    const data = it.part ? `data-part="${escapeHtml(it.part)}"` : "";
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
  rulesEl.innerHTML = `
    <div style="font-weight:900; color:var(--text); margin-bottom:6px;">Правила и управление (актуально)</div>

    <div class="rule"><b>Управление</b></div>
    <div class="rule">• <b>Клик по существу</b> — выбрать (родитель/почка). <b>Клик по пустоте</b> — снять выбор.</div>
    <div class="rule">• <b>Drag</b> мышью — панорама камеры. <b>Колесо</b> — зум (−3…+3).</div>
    <div class="rule">• <b>Журнал</b>: клик по записи — короткая белая подсветка связанного органа.</div>

    <div style="height:8px"></div>
    <div class="rule"><b>Кормление морковками</b></div>
    <div class="rule">• Нажми <b>КОРМ</b> → включится режим «брось морковку». Затем <b>кликни в поле</b>, чтобы поставить морковку.</div>
    <div class="rule">• Морковки берутся из запаса (число справа в HUD). Можно менять запас в настройках/поле HUD.</div>
    <div class="rule" style="color:var(--muted);">• Если морковка <b>близко</b> к телу — чаще растёт <b>тело</b>. Если <b>далеко</b> — чаще тянется <b>отросток</b> (мобильность).</div>

    <div style="height:8px"></div>
    <div class="rule"><b>Уход и эволюция</b></div>
    <div class="rule">• <b>МЫТЬ</b> — повышает чистоту, чаще помогает появлению <b>${escapeHtml(organLabel("shell"))}</b> и «аккуратного» роста.</div>
    <div class="rule">• <b>ЛЕЧ</b> — повышает HP/настроение, чаще помогает сенсорам: <b>${escapeHtml(organLabel("antenna"))}</b> и глазам.</div>
    <div class="rule" style="color:var(--muted);">• <b>Стресс/запущенность</b> — чаще даёт защиту: <b>${escapeHtml(organLabel("spike"))}</b> и панцирь.</div>
    <div class="rule" style="color:var(--muted);">• <b>Ядро и глаза</b> растут вместе с организмом и стараются не занимать больше ~10% объёма (кроме ранней стадии).</div>
    <div class="rule" style="color:var(--muted);">• Все параметры живут в диапазоне <b>0…140%</b> — “перекорм” возможен, но даёт стресс.</div>

    <div style="height:8px"></div>
    <div class="rule"><b>Мутации и оффлайн</b></div>
    <div class="rule">• Мутации происходят раз в <b>интервал мутации</b> минут (настраивается в «Настройках»).</div>
    <div class="rule" style="color:var(--muted);">• За один тик — не более <b>2</b> мутаций. После долгого отсутствия «долг» догоняется постепенно.</div>

    <div style="height:8px"></div>
    <div class="rule"><b>Почкование (дети)</b></div>
    <div class="rule" style="color:var(--muted);">• У крупных организмов длинный хвост/лапа/антенна может отделиться и стать <b>почкой</b> рядом. Почки живут и мутируют отдельно.</div>
  `;
}

export function renderHud(state, els, deltaSec, fmtAgeSeconds, zoom){
  const status = barStatus(state);

  els.hudName.textContent = state.name;
  els.hudStage.textContent = `• ${getStageName(state)}`;
  // seed moved to settings

  els.hudMeta.innerHTML = `
    <span class="pill">еда: ${barPct(state.bars.food)}%</span>
    <span class="pill">чист: ${barPct(state.bars.clean)}%</span>
    <span class="pill">hp: ${barPct(state.bars.hp)}%</span>
    <span class="pill">настр: ${barPct(state.bars.mood)}%</span>
    <span class="pill ${status.cls}">сост: ${status.txt}</span>
    <span class="pill">блоков: ${getTotalBlocks(state)}</span>
    <span class="pill">детей: ${(state.buds?.length || 0)}</span>
  `;

  // second row: life time + carrots inventory (input is static in DOM)
  if (els.lifePill){
    const age = Math.max(0, (state.lastSeen || 0) - (state.createdAt || state.lastSeen || 0));
    els.lifePill.textContent = `жизнь: ${fmtAgeSeconds(age)}`;
  }
  if (els.carrotHudInput && document.activeElement !== els.carrotHudInput){
    const v = state.inv?.carrots ?? 0;
    els.carrotHudInput.value = String(Math.max(0, v|0));
  }

  // footer text is still set in main.js usually; keep compatible if present:
  if (els.footerInfo){
    const intervalSec = Math.max(60, Math.floor(state.evoIntervalMin * 60));
    const until = Math.max(0, (state.lastMutationAt + intervalSec) - state.lastSeen);
    els.footerInfo.textContent =
      `Мутация через ~${fmtAgeSeconds(until)} (интервал ${state.evoIntervalMin} мин) • max 140% • drag • zoom:${zoom ?? ""}`;
  }
}
