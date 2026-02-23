// js/render_idleWarp.js
// Idle Warp Pulse (render-only) for Symbiochi: мягкий warp на мелких тайлах.

import { clamp } from "./util.js";

export const IdleWarpConfig = {
  enabled: true,

  // Пульс (секунды)
  periodSecMin: 145,
  periodSecMax: 190,
  durSecMin: 9,
  durSecMax: 18,
  
  // Усиление по осям (1 = как раньше)
  ampXScale: 1,
  ampYScale: 1.5,

  // Амплитуда vs размер
  ampNorm: 0.25,
  ampPxMin: 0.3,
  ampPxMax: 18,

  // Сетка warp (узлов по большей стороне)
  gridMin: 8,
  gridMax: 24,

  // Рендер
  smoothingDuringWarp: true,
  slicesOrMesh: "mesh",
  organAnchorMode: "B1",

  // Только в покое
  onlyWhenIdle: true,
  idleSpeedThreshold: 0.001,

  // Влияние состояния (пока не используем)
  stressInfluence: 0,
  hpInfluence: 0,

  // Маленькие организмы
  smallBodyThreshold: 15,
  smallBodyAmpScale: 0.4,

  // Шум — крупные, плавные волны
  spatialFreq: 0.016,
  timeSpeed1: 0.5,
  timeSpeed2: 0.4,

  // Debug
  debugDrawGrid: false,
  debugDrawAnchors: false,
  debugForceActive: false,
};

let _offscreenCanvas = null;

function getOffscreenCanvas(width, height){
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  if (!_offscreenCanvas){
    _offscreenCanvas = (typeof OffscreenCanvas !== "undefined")
      ? new OffscreenCanvas(w, h)
      : document.createElement("canvas");
  }
  const canvas = _offscreenCanvas;
  if (canvas.width !== w || canvas.height !== h){
    canvas.width = w;
    canvas.height = h;
  }
  return canvas;
}

// Hash string -> [0,1)
function hash01(str){
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// 2D value noise [-1,1]
function valueNoise2D(x, y, seedStr){
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const s00 = hash01(seedStr + "|" + ix + "|" + iy) * 2 - 1;
  const s10 = hash01(seedStr + "|" + (ix + 1) + "|" + iy) * 2 - 1;
  const s01 = hash01(seedStr + "|" + ix + "|" + (iy + 1)) * 2 - 1;
  const s11 = hash01(seedStr + "|" + (ix + 1) + "|" + (iy + 1)) * 2 - 1;

  const lerp = (a, b, t)=> a + (b - a) * t;

  const nx0 = lerp(s00, s10, fx);
  const nx1 = lerp(s01, s11, fx);
  return lerp(nx0, nx1, fy);
}

function computeDisplacement(x, y, t, orgSeed, ampPx, cfg){
  if (!Number.isFinite(ampPx) || ampPx <= 0) return { dx: 0, dy: 0 };

  const freq = cfg.spatialFreq || 0.01;
  const speed1 = cfg.timeSpeed1 || 0.4;
  const speed2 = cfg.timeSpeed2 || 0.6;

  const nx = x * freq;
  const ny = y * freq;

  const phase1 = t * speed1;
  const phase2 = t * speed2;

  const keyBase = String(orgSeed || 0);

  const nDx = valueNoise2D(nx + phase1, ny + phase1 * 0.5, keyBase + "|dx");
  const nDy = valueNoise2D(nx - phase2 * 0.25, ny + phase2, keyBase + "|dy");

  // Отдельное усиление по X и Y
  const ampX = ampPx * (cfg.ampXScale || 1);
  const ampY = ampPx * (cfg.ampYScale || 1);

  return {
    dx: ampX * nDx,
    dy: ampY * nDy,
  };
}

// Главная функция: рисует тело (через drawBody) с возможным idle warp.
export function renderBodyWithIdleWarp(ctx, params, drawBody){
  const cfg = IdleWarpConfig;

  if (!cfg.enabled || !ctx || typeof drawBody !== "function"){
    drawBody && drawBody(ctx);
    return { active:false, getDisplacementAt:()=>({dx:0,dy:0}), bbox:null };
  }

  const bodyCells = params?.bodyCells || [];
  const bodyCellCount = bodyCells.length;
  const bodyBBoxPx = params?.bodyBBoxPx || null;
  const gaitActive = !!params?.gaitActive;

  if (!bodyCellCount || !bodyBBoxPx){
    drawBody(ctx);
    return { active:false, getDisplacementAt:()=>({dx:0,dy:0}), bbox:null };
  }

  if (cfg.onlyWhenIdle && !cfg.debugForceActive && gaitActive){
    drawBody(ctx);
    return { active:false, getDisplacementAt:()=>({dx:0,dy:0}), bbox:bodyBBoxPx };
  }

  const nowSec = Number.isFinite(params?.globalTimeSec)
    ? params.globalTimeSec
    : Date.now() / 1000;

  const seedBase =
    (params?.org && (params.org.seed ?? params.org.id ?? params.org._id)) ??
    params?.baseSeed ??
    params?.orgId ??
    0;
  const seedStr = String(seedBase);

  const phaseOffsetSec = hash01(seedStr + "|ph") * 10000;
  const period = cfg.periodSecMin + hash01(seedStr + "|per") * (cfg.periodSecMax - cfg.periodSecMin);
  const dur = cfg.durSecMin + hash01(seedStr + "|dur") * (cfg.durSecMax - cfg.durSecMin);

  const tLocal = nowSec + phaseOffsetSec;
  const p = ((tLocal % period) + period) % period;
  const windowActive = cfg.debugForceActive || (p < dur);

  if (!windowActive){
    drawBody(ctx);
    return { active:false, getDisplacementAt:()=>({dx:0,dy:0}), bbox:bodyBBoxPx };
  }

  const u = dur > 0 ? clamp(p / dur, 0, 1) : 0;

  // Асимметричная огибающая:
  //  - 0..0.5: вдох, как раньше (smooth sin)
  //  - 0.5.. ≈0.83: выдох, в 3 раза быстрее
  //  - дальше до u=1: тишина (env=0)
  let env;
  if (u <= 0.5){
    // Вдох — оставляем исходный sin(pi*u)
    env = Math.sin(Math.PI * u);
  } else {
    // Выдох — сжимаем вторую половину синуса в 3 раза по времени
    const e = (u - 0.5) * 3; // 0..1 — "ускоренное время" выдоха

    if (e >= 1){
      // Выдох уже закончился, остаток пульса — без искажения
      env = 0;
    } else {
      // Берём ту же форму, что была бы на обычном синусе во второй половине (0.5..1),
      // но проигрываем её быстрее за счёт e
      const uOrig = 0.5 + e * 0.5; // мапим 0..1 -> 0.5..1
      env = Math.sin(Math.PI * uOrig);
    }
  }

  if (!Number.isFinite(env) || env < 1e-3) env = 0;

  if (env <= 0){
    drawBody(ctx);
    return { active:false, getDisplacementAt:()=>({dx:0,dy:0}), bbox:bodyBBoxPx };
  }

  const sizeRef = Math.sqrt(bodyCellCount || 0);
  let ampPx = cfg.ampNorm * sizeRef;
  ampPx = clamp(ampPx, cfg.ampPxMin, cfg.ampPxMax);
  ampPx *= env;

  if (bodyCellCount < cfg.smallBodyThreshold){
    const tSmall = clamp(bodyCellCount / cfg.smallBodyThreshold, 0, 1);
    const scale = cfg.smallBodyAmpScale + (1 - cfg.smallBodyAmpScale) * tSmall;
    ampPx *= scale;
  }

  if (!Number.isFinite(ampPx) || ampPx <= 0.05){
    drawBody(ctx);
    return { active:false, getDisplacementAt:()=>({dx:0,dy:0}), bbox:bodyBBoxPx };
  }

  const bbox = bodyBBoxPx;
  const width = bbox.w;
  const height = bbox.h;

  if (!(width > 1 && height > 1)){
    drawBody(ctx);
    return { active:false, getDisplacementAt:()=>({dx:0,dy:0}), bbox };
  }

  const off = getOffscreenCanvas(width, height);
  const offCtx = off.getContext("2d");
  if (!offCtx){
    drawBody(ctx);
    return { active:false, getDisplacementAt:()=>({dx:0,dy:0}), bbox };
  }

  // --- Рисуем тело в offscreen без варпа ---
  offCtx.setTransform(1, 0, 0, 1, 0, 0);
  offCtx.clearRect(0, 0, off.width, off.height);
  offCtx.save();
  offCtx.translate(-bbox.x, -bbox.y);
  const prevOffSmooth = offCtx.imageSmoothingEnabled;
  offCtx.imageSmoothingEnabled = false;
  drawBody(offCtx);
  offCtx.imageSmoothingEnabled = prevOffSmooth;
  offCtx.restore();

  // --- Мелкая сетка warp на тайлах ---

  const longSide = Math.max(width, height);
  const approxNodes = clamp(Math.round(longSide / 18), cfg.gridMin, cfg.gridMax);
  const gridX = approxNodes;
  const gridY = approxNodes;

  const cellW = width / gridX;
  const cellH = height / gridY;

  const prevSmooth = ctx.imageSmoothingEnabled;
  if (cfg.smoothingDuringWarp){
    ctx.imageSmoothingEnabled = true;
  }

  const displacementAt = (x, y) =>
    computeDisplacement(x, y, nowSec, seedStr, ampPx, cfg);

  const overlap = 0.12; // 12% расширение тайла, чтобы швы были менее заметны

  for (let gy = 0; gy < gridY; gy++){
    const sy = gy * cellH;
    const sh = (gy === gridY - 1) ? (height - sy) : cellH;

    for (let gx = 0; gx < gridX; gx++){
      const sx = gx * cellW;
      const sw = (gx === gridX - 1) ? (width - sx) : cellW;

      // Берём смещение в центре тайла (мягко, без ряби)
      const cx = bbox.x + sx + sw * 0.5;
      const cy = bbox.y + sy + sh * 0.5;

      const disp = displacementAt(cx, cy);
      const dx = clamp(disp.dx || 0, -cfg.ampPxMax, cfg.ampPxMax);
      const dy = clamp(disp.dy || 0, -cfg.ampPxMax, cfg.ampPxMax);

      // Лёгкое расширение тайла, чтобы соседние перекрывались
      const dw = sw * (1 + overlap);
      const dh = sh * (1 + overlap);
      const dstX = bbox.x + sx + dx - (dw - sw) * 0.5;
      const dstY = bbox.y + sy + dy - (dh - sh) * 0.5;

      ctx.drawImage(
        off,
        sx, sy, sw, sh,
        dstX, dstY, dw, dh
      );
    }
  }

  if (cfg.debugDrawGrid){
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(56,189,248,0.8)";
    for (let gy = 0; gy <= gridY; gy++){
      const y = bbox.y + gy * cellH;
      ctx.beginPath();
      ctx.moveTo(bbox.x, y);
      ctx.lineTo(bbox.x + width, y);
      ctx.stroke();
    }
    for (let gx = 0; gx <= gridX; gx++){
      const x = bbox.x + gx * cellW;
      ctx.beginPath();
      ctx.moveTo(x, bbox.y);
      ctx.lineTo(x, bbox.y + height);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (cfg.smoothingDuringWarp){
    ctx.imageSmoothingEnabled = prevSmooth;
  }

  return {
    active: true,
    getDisplacementAt: (x, y) => computeDisplacement(x, y, nowSec, seedStr, ampPx, cfg),
    bbox,
  };
}