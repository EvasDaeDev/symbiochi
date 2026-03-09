import { getFxPipeline } from './FX/pipeline.js';
import { addRipple, RIPPLE_KIND, getRippleColorEnergy } from './FX/ripples.js';

const CELL_PX = 4;
const BODY_BREATH_Y = 0.65;

const FALLBACK_COLORS = {
  body: '#6ee7b7',
  core: '#fde68a',
  shell: '#93c5fd',
  spike: '#fb7185',
  eye: '#f472b6',
  fin: '#60a5fa',
  tail: '#fbbf24',
  tentacle: '#22d3ee',
  antenna: '#cbd5e1',
  claw: '#b45309',
  limb: '#a16207',
  teeth: '#e5e7eb',
  mouth: '#ef4444',
  worm: '#14b8a6',
  unknown: '#e5e7eb'
};

const FX_DEFAULTS = {
  barrelK: 0.08,
  barrelExp: 1.65,
  chromaticPx: 0.28,
  chromaMult: 0.18,
  ghostAlpha: 0.07,
  ghostAlphaMovingExtra: 0.02,
  glowStrength: 0.08,
  glowRadiusPx: 7.0,
  warpPx: 0.8,
  warpScale: 1.0,
  warpSpeed: 0.35,
  grain: 0.08,
  grainSpeed: 1.0,
  overlay: 0.02,
  ringBrightness: 0.22,
  ringWidth: 0.13,
  rippleFade: 3.0,
  vignette: 0.12,
};


function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t){ return a + (b - a) * t; }
function mixHex(a, b, t){
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(lerp(ca.r, cb.r, t), lerp(ca.g, cb.g, t), lerp(ca.b, cb.b, t));
}

function hexToRgb(hex){
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { r: 255, g: 255, b: 255 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b){
  const c = (x)=> Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function shade(hex, amt){
  const c = hexToRgb(hex);
  const k = amt >= 0 ? 255 : 0;
  const t = Math.abs(amt);
  return rgbToHex(lerp(c.r, k, t), lerp(c.g, k, t), lerp(c.b, k, t));
}
function hash01(str){
  let h = 2166136261 >>> 0;
  const s = String(str);
  for(let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) & 0xffffff) / 0xffffff;
}
function pulse(period, phase = 0){
  return Math.sin((performance.now() / 1000) * (Math.PI * 2 / period) + phase);
}

function colorForCell(c){
  const t = String(c?.type || c?.t || c?.kind || 'body').toLowerCase();
  if (t === 'body') return c?.palette?.body || FALLBACK_COLORS.body;
  if (t === 'eye') return c?.palette?.eye || FALLBACK_COLORS.eye;
  return FALLBACK_COLORS[t] || FALLBACK_COLORS.unknown;
}

function getCinematicBodyOffset(c, fighter){
  const st = fighter?.combat || {};
  const vx = Number.isFinite(fighter?.transform?.vel?.x) ? fighter.transform.vel.x : 0;
  const vy = Number.isFinite(fighter?.transform?.vel?.y) ? fighter.transform.vel.y : 0;
  const speed = Math.hypot(vx, vy);
  const cx = Number.isFinite(c?.posedLocalX) ? c.posedLocalX : c?.localX || 0;
  const cy = Number.isFinite(c?.posedLocalY) ? c.posedLocalY : c?.localY || 0;
  const ax = Number.isFinite(c?.anchorX) ? c.anchorX : 0;
  const ay = Number.isFinite(c?.anchorY) ? c.anchorY : 0;
  const rx = cx - ax;
  const ry = cy - ay;

  let dirx = 1, diry = 0;
  if (speed >= 1e-4){
    dirx = vx / speed;
    diry = vy / speed;
  } else {
    const a = Number.isFinite(fighter?.transform?.angle) ? fighter.transform.angle : 0;
    dirx = Math.cos(a);
    diry = Math.sin(a);
  }

  const along = rx * dirx + ry * diry;
  const side = rx * (-diry) + ry * dirx;
  const stretch = (st.bodyStretch || 0) * along * 0.10;
  const squash = (st.bodySquash || 0) * side * -0.08;
  const jitter = (st.impactJitter || 0) * Math.sin((performance.now() / 1000) * 22 + along * 0.12 + side * 0.25) * 0.12;

  let dentX = 0, dentY = 0;
  if (Number.isFinite(st.impactDent) && st.impactDent > 1e-4 && Number.isFinite(st.impactPointX) && Number.isFinite(st.impactPointY) && Number.isFinite(c?.worldX) && Number.isFinite(c?.worldY)) {
    const ddx = c.worldX - st.impactPointX;
    const ddy = c.worldY - st.impactPointY;
    const d = Math.hypot(ddx, ddy);
    const falloff = Math.max(0, 1 - d / 22);
    if (falloff > 0){
      const nx = d > 1e-4 ? ddx / d : -dirx;
      const ny = d > 1e-4 ? ddy / d : -diry;
      const dent = st.impactDent * falloff * 6.5;
      dentX = nx * dent;
      dentY = ny * dent;
    }
  }

  return {
    ox: dirx * stretch + (-diry) * (squash + jitter) + dentX,
    oy: diry * stretch + dirx * (squash + jitter) + dentY,
  };
}

function cellAnimOffset(c, fighter){
  const t = String(c?.type || 'body').toLowerCase();
  const mi = Number.isFinite(c?.mi) ? c.mi : 0;
  const i = Number.isFinite(c?.segIndex) ? c.segIndex : 0;
  const len = Math.max(1, c?.segLen || 1);
  const seed = mi * 0.71 + i * 0.13 + hash01(`${t}|${mi}|${i}`) * Math.PI * 2;
  let ox = 0, oy = 0;

  const vx = Number.isFinite(fighter?.transform?.vel?.x) ? fighter.transform.vel.x : 0;
  const vy = Number.isFinite(fighter?.transform?.vel?.y) ? fighter.transform.vel.y : 0;
  const speed = Math.hypot(vx, vy);

  if (t === 'body'){
    const body = getCinematicBodyOffset(c, fighter);
    ox += body.ox;
    oy += body.oy + pulse(3.8, seed) * BODY_BREATH_Y * 0.45;
  } else if (t === 'tentacle' || t === 'tail' || t === 'fin' || t === 'limb' || t === 'worm'){
    const k = len <= 1 ? 1 : i / (len - 1);
    const phase = fighter?.combat?.motionPhase || 'recover';
    const phaseAmp = phase === 'thrust' ? 1.35 : phase === 'coil' ? 0.7 : phase === 'drift' ? 1.15 : 0.9;
    const baseAmp = (0.10 + 0.30 * k) * phaseAmp * (t === 'tentacle' ? 1.4 : t === 'tail' ? 1.25 : 1.0);
    ox += pulse(t === 'tail' ? 3.0 : 4.4, seed) * baseAmp;
    oy += pulse(t === 'tentacle' ? 3.3 : 4.8, seed + 1.4) * baseAmp * 0.7;
  } else if (t === 'antenna'){
    const k = len <= 1 ? 1 : i / (len - 1);
    ox += pulse(5.2, seed) * (0.06 + 0.14 * k);
    oy += pulse(4.2, seed + 0.7) * (0.04 + 0.09 * k);
  } else if (t === 'claw'){
    const k = len <= 1 ? 1 : i / (len - 1);
    ox += pulse(4.2, seed) * (0.06 + 0.15 * k);
  } else if (t === 'eye'){
    const blink = Math.max(0, pulse(11.5, seed * 0.8));
    oy += blink > 0.96 ? 0.35 : 0;
  }

  if (speed > 8){
    const dirx = vx / speed;
    const diry = vy / speed;
    const trail = Math.min(0.9, speed / 42) * (t === 'body' ? 0.35 : 0.55);
    ox += -dirx * trail * (Number.isFinite(c?.segLen) ? Math.min(1, (i + 1) / len) : 0.6);
    oy += -diry * trail * (Number.isFinite(c?.segLen) ? Math.min(1, (i + 1) / len) : 0.6);
  }

  return { ox, oy };
}

function drawPixelBlock(ctx, x, y, size, color, alpha = 1, blinkScaleY = 1){
  const s = size;
  const inner = Math.max(1, s - 2);
  const dark = shade(color, -0.22);
  const light = shade(color, 0.14);

  ctx.save();
  ctx.globalAlpha *= alpha;

  if (blinkScaleY !== 1){
    const cx = x + s / 2;
    const cy = y + s / 2;
    ctx.translate(cx, cy);
    ctx.scale(1, blinkScaleY);
    ctx.translate(-cx, -cy);
  }

  ctx.fillStyle = dark;
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, inner, inner);

  ctx.fillStyle = light;
  ctx.fillRect(x + 1, y + 1, inner, 1);
  ctx.fillRect(x + 1, y + 1, 1, inner);

  ctx.restore();
}

function drawFighter(ctx, f){
  const cells = f?.worldCells || [];
  if (!cells.length) return;

  const halo = f.id === 'A' ? '#7dd3fc' : '#fca5a5';
  const health = clamp((f.mass || 1) / Math.max(1, f?.combat?.baseMass || f.mass || 1), 0, 1.2);
  const glowAlpha = 0.035 + 0.05 * health;
  ctx.save();
  ctx.globalAlpha = glowAlpha;
  ctx.fillStyle = halo;
  for (const c of cells){
    const a = cellAnimOffset(c, f);
    ctx.fillRect(c.px + a.ox - 1, c.py + a.oy - 1, CELL_PX + 2, CELL_PX + 2);
  }
  ctx.restore();

  for (const c of cells){
    const t = String(c?.type || 'body').toLowerCase();
    const a = cellAnimOffset(c, f);
    const x = c.px + a.ox;
    const y = c.py + a.oy;
    let color = colorForCell(c);
    let alpha = 1;
    let blinkScaleY = 1;

    if (t === 'shell') color = shade(color, -0.06);
    else if (t === 'spike' || t === 'teeth') color = shade(color, 0.10);
    else if (t === 'claw') color = shade(color, -0.04);
    else if (t === 'eye'){
      const mi = Number.isFinite(c?.mi) ? c.mi : 0;
      const seed = hash01(`eye|${f.id}|${mi}`) * Math.PI * 2;
      const blink = Math.max(0, pulse(11.5, seed));
      blinkScaleY = blink > 0.97 ? 0.20 : 1;
    }

    drawPixelBlock(ctx, x, y, CELL_PX, color, alpha, blinkScaleY);
  }
}

function getFxView(canvas, arena){
  const view = arena._fxView || (arena._fxView = {});
  view.dpr = 1;
  view.rectW = canvas.width;
  view.rectH = canvas.height;
  view.blockPx = CELL_PX;
  view.gridW = canvas.width / CELL_PX;
  view.gridH = canvas.height / CELL_PX;
  view.cam = { ox: 0, oy: 0 };
  view.hp01 = (()=>{
    const arr = (arena?.fighters || []).filter(Boolean);
    if (!arr.length) return 1;
    let s = 0;
    for (const f of arr){ s += clamp((f.mass || 1) / Math.max(1, f?.combat?.baseMass || f.mass || 1), 0, 1); }
    return s / arr.length;
  })();
  return view;
}


function applyFxSettings(view, arena, fx){
  const src = arena?.fxEnabled || arena?.params?.fxEnabled || arena?.renderFx || null;
  if (src && typeof src === 'object') fx.fxEnabled = { ...fx.fxEnabled, ...src };

  const num = (v)=> Number.isFinite(v) ? v : null;
  const picks = [arena || {}, arena?.params || {}, arena?.renderFxParams || {}];
  const assign = (prop, keys)=>{
    for (const obj of picks){
      if (!obj) continue;
      for (const k of keys){
        const v = num(obj[k]);
        if (v !== null){ fx[prop] = v; return true; }
      }
    }
    return false;
  };

  const enabled = fx.fxEnabled || {};

  if (!assign('barrelK', ['fxBarrelK','barrelK'])) fx.barrelK = enabled.barrel ? FX_DEFAULTS.barrelK : 0;
  if (!assign('barrelExp', ['fxBarrelExp','barrelExp'])) fx.barrelExp = FX_DEFAULTS.barrelExp;

  if (!assign('chromaticPx', ['fxChromaticPx','chromaticPx'])) fx.chromaticPx = enabled.chroma ? FX_DEFAULTS.chromaticPx : 0;
  if (!assign('chromaMult', ['fxChromaMult','chromaMult'])) fx.chromaMult = FX_DEFAULTS.chromaMult;

  if (!assign('ghostAlpha', ['fxGhostAlpha','ghostAlpha'])) fx.ghostAlpha = enabled.ghosting ? FX_DEFAULTS.ghostAlpha : 0;
  if (!assign('ghostAlphaMovingExtra', ['fxGhostAlphaMovingExtra','ghostAlphaMovingExtra'])) fx.ghostAlphaMovingExtra = enabled.ghosting ? FX_DEFAULTS.ghostAlphaMovingExtra : 0;

  if (!assign('glowStrength', ['fxGlowStrength','glowStrength'])) fx.glowStrength = enabled.glow ? FX_DEFAULTS.glowStrength : 0;
  if (!assign('glowRadiusPx', ['fxGlowRadiusPx','glowRadiusPx'])) fx.glowRadiusPx = FX_DEFAULTS.glowRadiusPx;

  if (!assign('warpPx', ['fxWarpPx','warpPx'])) fx.warpPx = enabled.warp ? FX_DEFAULTS.warpPx : 0;
  if (!assign('warpScale', ['fxWarpScale','warpScale'])) fx.warpScale = FX_DEFAULTS.warpScale;
  if (!assign('warpSpeed', ['fxWarpSpeed','warpSpeed'])) fx.warpSpeed = FX_DEFAULTS.warpSpeed;

  if (!assign('grain', ['fxGrain','grain'])) fx.grain = enabled.grain ? FX_DEFAULTS.grain : 0;
  if (!assign('grainSpeed', ['fxGrainSpeed','grainSpeed'])) fx.grainSpeed = FX_DEFAULTS.grainSpeed;

  if (!assign('overlay', ['fxOverlay','overlay'])) fx.overlay = enabled.overlay ? FX_DEFAULTS.overlay : 0;

  if (!assign('ringBrightness', ['fxRingBrightness','ringBrightness'])) fx.ringBrightness = enabled.rippleColor ? FX_DEFAULTS.ringBrightness : 0;
  if (!assign('ringWidth', ['fxRingWidth','ringWidth'])) fx.ringWidth = FX_DEFAULTS.ringWidth;
  if (!assign('rippleFade', ['fxRippleFade','rippleFade'])) fx.rippleFade = FX_DEFAULTS.rippleFade;
  if (!assign('vignette', ['fxVignette','vignette'])) fx.vignette = FX_DEFAULTS.vignette;
}

function pumpArenaRipples(view, arena){
  if (!view || !arena) return;
  const st = view._rippleFeed || (view._rippleFeed = { bloodSeen: 0, chunksSeen: 0, lastHitX: NaN, lastHitY: NaN, lastHitT: 0 });
  const blood = Array.isArray(arena?.vfx?.blood) ? arena.vfx.blood : [];
  const chunks = Array.isArray(arena?.vfx?.chunks) ? arena.vfx.chunks : [];
  const cam = arena?.camera || null;
  const now = performance.now ? performance.now() : Date.now();

  if (blood.length > st.bloodSeen){
    const fresh = blood.slice(Math.max(0, blood.length - Math.min(8, blood.length - st.bloodSeen)));
    for (const b of fresh){
      const nx = (b.x * CELL_PX) / Math.max(1, view.rectW);
      const ny = (b.y * CELL_PX) / Math.max(1, view.rectH);
      addRipple(view, nx, ny, RIPPLE_KIND.SHOCK);
      st.lastHitX = nx; st.lastHitY = ny; st.lastHitT = now;
    }
  }
  if (chunks.length > st.chunksSeen){
    const fresh = chunks.slice(Math.max(0, chunks.length - Math.min(4, chunks.length - st.chunksSeen)));
    for (const ch of fresh){
      const nx = (ch.x * CELL_PX) / Math.max(1, view.rectW);
      const ny = (ch.y * CELL_PX) / Math.max(1, view.rectH);
      addRipple(view, nx, ny, RIPPLE_KIND.BLAST);
      st.lastHitX = nx; st.lastHitY = ny; st.lastHitT = now;
    }
  }
  if (cam && Number.isFinite(cam.targetWorldX) && Number.isFinite(cam.targetWorldY) && now - st.lastHitT > 120){
    const nx = (cam.targetWorldX * CELL_PX) / Math.max(1, view.rectW);
    const ny = (cam.targetWorldY * CELL_PX) / Math.max(1, view.rectH);
    const dx = nx - st.lastHitX;
    const dy = ny - st.lastHitY;
    if (!Number.isFinite(st.lastHitX) || (dx*dx + dy*dy) > 0.0008){
      addRipple(view, nx, ny, RIPPLE_KIND.SHOCK);
      st.lastHitX = nx; st.lastHitY = ny; st.lastHitT = now;
    }
  }

  st.bloodSeen = blood.length;
  st.chunksSeen = chunks.length;
  view.getRippleColorEnergy = () => getRippleColorEnergy(view);
}

export function getTimeoutSummaryLayout(canvas, arena){
  if(arena?.mode !== 'finished' || !arena?.timeoutSummary) return null;
  const x = Math.max(24, canvas.width * 0.5 - 230);
  const y = Math.max(52, canvas.height * 0.5 - 110);
  const w = 460;
  const rowH = 28;
  const titleH = 34;
  const totalH = titleH + rowH * 6 + 16;
  return {
    x, y, w, h: totalH,
    close: { x: x + w - 34, y: y + 8, w: 24, h: 24 }
  };
}

function applyCamera(ctx, canvas, arena){
  const cam = arena?.camera || null;
  const zoom = 1 + Math.max(0, Number(cam?.currentExtra) || 0);
  const focusX = ((Number.isFinite(cam?.focusWorldX) ? cam.focusWorldX : arena?.worldW * 0.5) * CELL_PX);
  const focusY = ((Number.isFinite(cam?.focusWorldY) ? cam.focusWorldY : arena?.worldH * 0.5) * CELL_PX);
  ctx.translate(canvas.width * 0.5, canvas.height * 0.5);
  ctx.scale(zoom, zoom);
  ctx.translate(-focusX, -focusY);
}

function drawBackground(ctx, canvas, arena){
  const w = canvas.width, h = canvas.height;
  const grad = ctx.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.06, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
  grad.addColorStop(0, 'rgb(48, 24, 20)');
  grad.addColorStop(1, 'rgb(4, 2, 1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.beginPath();
  for(let x = 0; x < w; x += CELL_PX * 4){ ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for(let y = 0; y < h; y += CELL_PX * 4){ ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  if(arena?.sun){
    const sx = arena.sun.x * CELL_PX;
    const sy = arena.sun.y * CELL_PX;
    const hillR = Math.max(8, (arena?.params?.kingOfHillRadius || 24) * CELL_PX);
    const pulseK = 0.92 + 0.08 * Math.sin(performance.now() / 800);
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.beginPath();
    ctx.arc(sx, sy, hillR * pulseK, 0, Math.PI * 2);
    ctx.fillStyle = '#fde68a';
    ctx.fill();
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    ctx.arc(sx, sy, 40 * pulseK, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(sx - CELL_PX / 2, sy - CELL_PX / 2, CELL_PX, CELL_PX);
    ctx.restore();
  }
}


function drawFighterHud(ctx, canvas, arena){
  const A = arena?.fighters?.[0] || null;
  const B = arena?.fighters?.[1] || null;

  const leftX = 24;
  const rightX = canvas.width - 24;
  const topY = 28;
  const lineH = 20;

  const keyColor = '#ff8a3d';
  const nameColor = '#56d7ff';
  const valueColor = '#f6f7fb';
  const shadowColor = 'rgba(0,0,0,0.75)';

  const getHonor = (f) => ((f?.meta?.honor | 0) + Math.floor(f?.stats?.kingHonorAcc || 0)) | 0;

  function drawRow(side, idx, key, value, isName = false){
    const y = topY + idx * lineH;
    ctx.save();
    ctx.font = isName ? 'bold 14px system-ui' : '12px system-ui';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = shadowColor;
    ctx.fillStyle = isName ? nameColor : valueColor;

    if (side === 'left'){
      ctx.textAlign = 'left';
      ctx.strokeText(String(key), leftX, y);
      ctx.fillStyle = keyColor;
      ctx.fillText(String(key), leftX, y);

      ctx.font = isName ? 'bold 14px system-ui' : '12px system-ui';
      ctx.strokeStyle = shadowColor;
      ctx.fillStyle = isName ? nameColor : valueColor;
      ctx.strokeText(String(value), leftX + 74, y);
      ctx.fillText(String(value), leftX + 74, y);
    } else {
      ctx.textAlign = 'right';
      ctx.strokeText(String(key), rightX, y);
      ctx.fillStyle = keyColor;
      ctx.fillText(String(key), rightX, y);

      ctx.font = isName ? 'bold 14px system-ui' : '12px system-ui';
      ctx.strokeStyle = shadowColor;
      ctx.fillStyle = isName ? nameColor : valueColor;
      ctx.strokeText(String(value), rightX - 74, y);
      ctx.fillText(String(value), rightX - 74, y);
    }
    ctx.restore();
  }

  if (A){
    drawRow('left', 0, 'name', A.name || '—', true);
    drawRow('left', 1, 'blocks', A.mass ?? '—');
    drawRow('left', 2, 'wins', A.meta?.wins ?? 0);
    drawRow('left', 3, 'honor', getHonor(A));
  }
  if (B){
    drawRow('right', 0, 'name', B.name || '—', true);
    drawRow('right', 1, 'blocks', B.mass ?? '—');
    drawRow('right', 2, 'wins', B.meta?.wins ?? 0);
    drawRow('right', 3, 'honor', getHonor(B));
  }
}

function drawTopTimer(ctx, canvas, arena){
  if(arena?.mode !== 'match' && arena?.mode !== 'countdown') return;
  const left = arena?.mode === 'countdown'
    ? Math.ceil(Math.max(0, arena.preMatchTimer || 0))
    : Math.max(0, Math.ceil((arena?.params?.matchDuration || 120) - (arena?.time?.t || 0)));
  const warn = arena?.mode === 'match' && left <= (arena?.params?.finalCountdownWarn || 10);
  const txt = arena?.mode === 'countdown' ? `START ${left}` : `${left}`;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = '#000000';
  ctx.fillRect(canvas.width * 0.5 - 42, 8, 84, 30);
  ctx.globalAlpha = 1;
  ctx.fillStyle = warn ? '#fb7185' : '#e7e8ef';
  ctx.font = 'bold 20px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(txt, canvas.width * 0.5, 23);
  ctx.restore();
}

function drawCountdown(ctx, canvas, arena){
  if(arena?.mode !== 'countdown') return;
  const left = Math.ceil(Math.max(0, arena.preMatchTimer || 0));
  if(left <= 0) return;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fde68a';
  ctx.font = 'bold 84px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(left), canvas.width * 0.5, canvas.height * 0.5);
  ctx.font = 'bold 20px system-ui';
  ctx.fillStyle = '#e7e8ef';
  ctx.fillText('GET READY', canvas.width * 0.5, canvas.height * 0.5 + 56);
  ctx.restore();
}

function drawTimeoutSummary(ctx, canvas, arena){
  if(arena?.mode !== 'finished' || !arena?.timeoutSummary || arena?.timeoutSummaryClosed) return;
  const sumA = arena.timeoutSummary.A;
  const sumB = arena.timeoutSummary.B;
  if(!sumA || !sumB) return;

  const layout = getTimeoutSummaryLayout(canvas, arena);
  if(!layout) return;
  const { x, y, w, h: totalH, close } = layout;
  const rowH = 28;
  const titleH = 34;
  const winId = arena?.winnerId || null;

  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = '#05070c';
  ctx.fillRect(x, y, w, totalH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#2a3140';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, totalH);
  ctx.fillStyle = '#e7e8ef';
  ctx.font = 'bold 18px system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const summaryTitle = arena?.timeoutSummary?.reason === 'timeout' ? 'Time up — result table' : 'Match result table';
  ctx.fillText(summaryTitle, x + 14, y + 23);
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(close.x, close.y, close.w, close.h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#667085';
  ctx.strokeRect(close.x, close.y, close.w, close.h);
  ctx.strokeStyle = '#f3f4f6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(close.x + 6, close.y + 6);
  ctx.lineTo(close.x + close.w - 6, close.y + close.h - 6);
  ctx.moveTo(close.x + close.w - 6, close.y + 6);
  ctx.lineTo(close.x + 6, close.y + close.h - 6);
  ctx.stroke();

  const labelX = x + 14;
  const colAX = x + 260;
  const colBX = x + 380;
  ctx.font = 'bold 14px system-ui';
  ctx.fillStyle = winId === 'A' ? '#22c55e' : '#ef4444';
  ctx.fillText(sumA.name, colAX - 24, y + 52);
  ctx.fillStyle = winId === 'B' ? '#22c55e' : '#ef4444';
  ctx.fillText(sumB.name, colBX - 24, y + 52);

  const rows = [
    ['Damage efficiency', `${(sumA.damageEfficiency * 100).toFixed(1)}%`, `${(sumB.damageEfficiency * 100).toFixed(1)}%`],
    ['Survival ratio', `${(sumA.survivalRatio * 100).toFixed(1)}%`, `${(sumB.survivalRatio * 100).toFixed(1)}%`],
    ['Sun control share', `${(sumA.sunControlShare * 100).toFixed(1)}%`, `${(sumB.sunControlShare * 100).toFixed(1)}%`],
    ['Blocks left', `${sumA.blocksLeft}`, `${sumB.blocksLeft}`],
    ['Hill honor', `${sumA.hillHonor}`, `${sumB.hillHonor}`],
  ];

  ctx.font = '13px system-ui';
  ctx.textBaseline = 'middle';
  for(let i = 0; i < rows.length; i++) {
    const yy = y + titleH + 36 + i * rowH;
    ctx.globalAlpha = i % 2 === 0 ? 0.08 : 0.12;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 10, yy - 12, w - 20, rowH - 2);
    ctx.globalAlpha = 1;
    const [label, av, bv] = rows[i];
    ctx.fillStyle = '#d1d5db';
    ctx.fillText(label, labelX, yy + 1);
    ctx.fillStyle = winId === 'A' ? '#22c55e' : '#ef4444';
    ctx.fillText(av, colAX, yy + 1);
    ctx.fillStyle = winId === 'B' ? '#22c55e' : '#ef4444';
    ctx.fillText(bv, colBX, yy + 1);
  }

  ctx.fillStyle = '#9ca3af';
  ctx.font = '12px system-ui';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Priority: damage efficiency → survival ratio → sun control share → blocks left', x + 14, y + totalH - 10);
  ctx.restore();
}


function drawCombatFocus(ctx, arena){
  const drama = arena?.drama || null;
  const fighters = arena?.fighters || [];
  const A = fighters[0], B = fighters[1];
  if(!drama || !A || !B) return;
  const clinch = clamp(drama.clinch || 0, 0, 1);
  const dominance = clamp(drama.dominance || 0, -1, 1);
  const leader = dominance >= 0 ? A : B;
  const follower = dominance >= 0 ? B : A;
  const lx = (leader.transform.pos.x + leader.geom.center.x) * CELL_PX;
  const ly = (leader.transform.pos.y + leader.geom.center.y) * CELL_PX;
  const fx = (follower.transform.pos.x + follower.geom.center.x) * CELL_PX;
  const fy = (follower.transform.pos.y + follower.geom.center.y) * CELL_PX;
  const mx = (lx + fx) * 0.5;
  const my = (ly + fy) * 0.5;

  if(clinch > 0.02){
    const r = 26 + 18 * clinch;
    const grad = ctx.createRadialGradient(mx, my, 2, mx, my, r);
    grad.addColorStop(0, `rgba(255,244,200,${0.10 * clinch})`);
    grad.addColorStop(1, 'rgba(255,244,200,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const domAmt = Math.abs(dominance);
  if(domAmt > 0.1){
    const radius = 18 + 24 * domAmt;
    const grad = ctx.createRadialGradient(lx, ly, 4, lx, ly, radius);
    const tint = dominance >= 0 ? '120,220,255' : '255,170,170';
    grad.addColorStop(0, `rgba(${tint},${0.10 * domAmt})`);
    grad.addColorStop(1, `rgba(${tint},0)`);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lx, ly, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawArenaVfx(ctx, arena){
  const px = CELL_PX;
  const vfx = arena?.vfx || {};
  const chunks = Array.isArray(vfx.chunks) ? vfx.chunks : [];
  const debris = Array.isArray(vfx.debris) ? vfx.debris : [];
  const blood = Array.isArray(vfx.blood) ? vfx.blood : [];

  for(const ch of chunks){
    const fighter = (arena?.fighters || []).find(f => f?.id === ch.fighterId) || null;
    const palette = {
      body: fighter?.organismState?.partColor?.body || fighter?.organismState?.palette?.body || FALLBACK_COLORS.body,
      eye: fighter?.organismState?.partColor?.eye || fighter?.organismState?.palette?.eye || FALLBACK_COLORS.eye,
    };
    ctx.save();
    ctx.globalAlpha *= clamp(ch.alpha ?? 1, 0, 1) * 0.95;
    ctx.translate(ch.x * px, ch.y * px);
    ctx.rotate(ch.angle || 0);
    for(const c of ch.cells || []){
      const color = colorForCell({ ...c, palette });
      drawPixelBlock(ctx, c.ox * px, c.oy * px, px, color, 1, 1);
    }
    ctx.restore();
  }

  for(const d of debris){
    const fighter = (arena?.fighters || []).find(f => f?.id === d.fighterId) || null;
    const palette = {
      body: fighter?.organismState?.partColor?.body || fighter?.organismState?.palette?.body || FALLBACK_COLORS.body,
      eye: fighter?.organismState?.partColor?.eye || fighter?.organismState?.palette?.eye || FALLBACK_COLORS.eye,
    };
    const color = colorForCell({ ...(d.cell || {}), palette });
    ctx.save();
    ctx.globalAlpha *= clamp(d.alpha ?? 1, 0, 1);
    ctx.translate(d.x * px, d.y * px);
    ctx.rotate(d.angle || 0);
    drawPixelBlock(ctx, -px * 0.5, -px * 0.5, px, color, 1, 1);
    ctx.restore();
  }


  for(const b of blood){
    ctx.save();
    ctx.globalAlpha *= clamp(b.alpha ?? 1, 0, 1) * 0.9;
    ctx.translate(b.x * px, b.y * px);
    ctx.rotate(b.angle || 0);
    const sx = px * clamp(b.size ?? 0.6, 0.2, 1.2);
    const sy = sx * clamp(b.stretch ?? 1.2, 0.8, 2.0);
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(-sx * 0.5, -sy * 0.5, sx, sy);
    ctx.restore();
  }
}


export function renderArena(ctx2d, canvas, arena){
  const view = getFxView(canvas, arena);
  const fx = getFxPipeline(view, canvas);
  applyFxSettings(view, arena, fx);
  pumpArenaRipples(view, arena);
  const ctx = fx.begin(canvas);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;

  ctx.save();
  applyCamera(ctx, canvas, arena);
  drawBackground(ctx, canvas, arena);
  drawCombatFocus(ctx, arena);
  drawArenaVfx(ctx, arena);
  const fighters = arena?.fighters || [];
  for(const f of fighters){
    if(!f || !f.alive) continue;
    drawFighter(ctx, f);
  }
  ctx.restore();

  drawFighterHud(ctx, canvas, arena);
  drawTopTimer(ctx, canvas, arena);
  drawCountdown(ctx, canvas, arena);

  if(arena?.mode === 'finished'){
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, canvas.height - 34, canvas.width, 34);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e7e8ef';
    ctx.font = '14px system-ui';
    const txt = arena?.resultText || 'Finished';
    ctx.fillText(txt, 12, canvas.height - 12);
    ctx.restore();
  }

  drawTimeoutSummary(ctx, canvas, arena);

  fx.end(canvas);
}

export function cellPx(){ return CELL_PX; }
