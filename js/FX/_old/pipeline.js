// js/FX/pipeline.js
// FX pipeline:
// - Render the world into an offscreen Canvas2D buffer.
// - Present that buffer onto the visible canvas.
//   * If FX enabled and WebGL is available: GPU post-process (barrel + chromatic).
//   * Otherwise: direct blit (no quality loss).
//
// View-only: does not modify game state.

import { WebGLPass } from "./webgl_pass.js";
import { buildRippleUniforms, addRipple, RIPPLE_KIND } from "./ripples.js";
import { computeGhostAlpha, GHOST_DEFAULTS } from "./ghosting.js";
import { computeGlowStrength, GLOW_DEFAULTS } from "./glow.js";
import { computeWarpPx, WARP_DEFAULTS } from "./background_warp.js";
import { computeGrain, computeOverlay, computeGrainSpeed, NOISE_DEFAULTS } from "./noise_overlay.js";

function makeCanvas(w, h){
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

class FxPipeline {
  constructor(){
    // Whether to apply screen effects. Presentation may still use WebGL for perf.
    this.enabled = true;

    // Дефолты делаем ЗАМЕТНЕЕ (по запросу).
    // Если захочешь обратно «тонко» — уменьши через view.fx.* (см. ниже в getFxPipeline).
    this.barrelK = 0.090;       // 0.02..0.14
    this.barrelExp = 2.10;      // 1.5..3.0 (больше => сильнее по краям)
    this.chromaticPx = 2.80;    // 0.25..4.0 (сила в пикселях)
    this.vignette = 0.18;       // 0..0.35
    this.smooth = 0.65;         // 0..1 (shader neighbor blend)

    // ---------- Новые эффекты (всё WebGL) ----------
    // Ghosting / afterimage
    // Ghosting по умолчанию делаем чуть сильнее, чтобы был очевиден.
    this.ghostAlpha = Math.max(GHOST_DEFAULTS.ghostAlpha, 0.14);
    this.ghostAlphaMovingExtra = GHOST_DEFAULTS.ghostAlphaMovingExtra;

    // Glow
    // Glow усиливаем и делаем порог ниже (в сцене много «пастельных» цветов).
    this.glowStrength = Math.max(GLOW_DEFAULTS.strength, 1.55);
    this.glowThreshold = Math.min(GLOW_DEFAULTS.threshold, 0.18);
    this.glowCurve = GLOW_DEFAULTS.curve;
    this.glowRadiusPx = Math.max(GLOW_DEFAULTS.radiusPx, 6.0);
    this.glowFoodSoftening = GLOW_DEFAULTS.foodSoftening;

    // Warp background
    // Warp делаем заметнее.
    this.warpPx = Math.max(WARP_DEFAULTS.warpPx, 5.0);
    this.warpSpeed = Math.max(WARP_DEFAULTS.speed, 0.08);
    this.warpScale = WARP_DEFAULTS.scale;
    this.warpHpExtra = WARP_DEFAULTS.hpExtra;

    // Overlay/grain
    // Grain/overlay чуть поднимаем.
//    this.grain = Math.max(NOISE_DEFAULTS.grain, 0.01);
//    this.grainSpeed = NOISE_DEFAULTS.grainSpeed;
//    this.overlay = Math.max(NOISE_DEFAULTS.overlay, 0.060);

    // Динамический буст хроматики (флэш от событий)
    this._chromaFlash = 0.0;

    // Center of distortion in normalized UV (0..1)
    this.centerX = 0.5;
    this.centerY = 0.5;

    this._scene = null;
    this._sceneCtx = null;
    this._w = 0;
    this._h = 0;

    // WebGL presenter (created lazily, may fail)
    this._glPass = null;
    this._glFailed = false;
  }

  ensureSize(w, h){
    w = w | 0;
    h = h | 0;
    if (w <= 0 || h <= 0) return;
    if (this._scene && this._w === w && this._h === h) return;

    this._w = w;
    this._h = h;
    this._scene = makeCanvas(w, h);
    this._sceneCtx = this._scene.getContext("2d", { willReadFrequently: false });
    // Keep the world render crisp (blocks are pixel-art).
    this._sceneCtx.imageSmoothingEnabled = false;
  }

  begin(visibleCanvas){
    // Always draw the world into the offscreen buffer.
    // This avoids locking the visible canvas into a 2D context,
    // so FX can be toggled on later and still use WebGL.
    this.ensureSize(visibleCanvas.width, visibleCanvas.height);
    return this._sceneCtx;
  }

  end(visibleCanvas){
    if (!this._scene || !this._sceneCtx) return;

    const w = this._w;
    const h = this._h;
    if (w !== (visibleCanvas.width|0) || h !== (visibleCanvas.height|0)){
      // size changed mid-frame
      return;
    }

    // Try WebGL presenter first (even if FX disabled: we can do a clean blit).
    if (!this._glFailed){
      if (!this._glPass){
        try {
          this._glPass = new WebGLPass(visibleCanvas);
        } catch (e){
          this._glPass = null;
          this._glFailed = true;
        }
      }

      if (this._glPass){
        const fxOn = !!this.enabled;

        // --- Динамика от состояния (low HP / сытость / события) ---
        const st = (this._view && this._view.state) ? this._view.state : null;
        const org = getActiveOrg(st);
        const hp01 = normBar(org?.bars?.hp);
        const food01 = normBar(org?.bars?.food);

        // Хроматика растёт при низком HP + от флэша событий.
        const baseMult = 1.0 + (1.0 - hp01) * 1.25;
        // флэш затухает
        this._chromaFlash = Math.max(0, this._chromaFlash - 0.05);
        const chromaMult = baseMult * (1.0 + this._chromaFlash);

        // glow мягче при высокой сытости
        const glowStrength = computeGlowStrength({
          strength: this.glowStrength,
          foodSoftening: this.glowFoodSoftening,
        }, food01);

        // warp усиливается при низком HP
        const warpPx = computeWarpPx({ warpPx: this.warpPx, hpExtra: this.warpHpExtra }, hp01);

        const ripples = buildRippleUniforms(this._view || {});

        // Оценка «движения» для ghosting (0..1).
        // Если хоть один организм сейчас в режиме движения — усиливаем afterimage.
        const movingK = anyOrgMoving(this._view) ? 1.0 : 0.0;

        const ok = this._glPass.render(this._scene, {
          barrelK: fxOn ? this.barrelK : 0.0,
          barrelExp: this.barrelExp,
          chromaticPx: fxOn ? this.chromaticPx : 0.0,
          chromaMult: fxOn ? chromaMult : 1.0,
          vignette: fxOn ? this.vignette : 0.0,
          smooth: fxOn ? this.smooth : 0.0,
          centerX: this.centerX,
          centerY: this.centerY,

          // Ghosting
          ghostAlpha: fxOn ? computeGhostAlpha({
            ghostAlpha: this.ghostAlpha,
            ghostAlphaMovingExtra: this.ghostAlphaMovingExtra,
          }, movingK) : 0.0,

          // Ripples / blasts
          ripples: fxOn ? ripples : new Float32Array(2*4),

          // Warp
          warpPx: fxOn ? warpPx : 0.0,
          warpScale: this.warpScale,
          warpSpeed: this.warpSpeed,

          // Glow
          glowStrength: fxOn ? glowStrength : 0.0,
          glowThreshold: this.glowThreshold,
          glowCurve: this.glowCurve,
          glowRadiusPx: this.glowRadiusPx,

          // Overlay / grain
          grain: fxOn ? computeGrain({ grain: this.grain }) : 0.0,
          grainSpeed: computeGrainSpeed({ grainSpeed: this.grainSpeed }),
          overlay: fxOn ? computeOverlay({ overlay: this.overlay }) : 0.0,

          // Time
          time: (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000,
        });
        if (ok) return;
        // If it failed at runtime (context lost etc) fall back.
        this._glFailed = true;
      }
    }

    // Fallback: 2D blit, full-quality.
    const ctx = visibleCanvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this._scene, 0, 0);
  }
}

// Singleton per view (so each play session keeps its buffers).
export function getFxPipeline(view, canvas){
  if (!view) return new FxPipeline();
  if (!view._fxPipeline) view._fxPipeline = new FxPipeline();

  const fxCfg = view.fx;
  const fx = view._fxPipeline;
  fx._view = view;

  if (fxCfg && typeof fxCfg === "object"){
    if (typeof fxCfg.enabled === "boolean") fx.enabled = fxCfg.enabled;
    if (Number.isFinite(fxCfg.barrelK)) fx.barrelK = fxCfg.barrelK;
    if (Number.isFinite(fxCfg.barrelExp)) fx.barrelExp = fxCfg.barrelExp;
    if (Number.isFinite(fxCfg.chromaticPx)) fx.chromaticPx = fxCfg.chromaticPx;
    if (Number.isFinite(fxCfg.vignette)) fx.vignette = fxCfg.vignette;
    if (Number.isFinite(fxCfg.smooth)) fx.smooth = fxCfg.smooth;
    if (Number.isFinite(fxCfg.centerX)) fx.centerX = fxCfg.centerX;
    if (Number.isFinite(fxCfg.centerY)) fx.centerY = fxCfg.centerY;

    // Доп. настройки: можно задавать в view.fx.*
    if (Number.isFinite(fxCfg.ghostAlpha)) fx.ghostAlpha = fxCfg.ghostAlpha;
    if (Number.isFinite(fxCfg.ghostAlphaMovingExtra)) fx.ghostAlphaMovingExtra = fxCfg.ghostAlphaMovingExtra;

    if (Number.isFinite(fxCfg.glowStrength)) fx.glowStrength = fxCfg.glowStrength;
    if (Number.isFinite(fxCfg.glowThreshold)) fx.glowThreshold = fxCfg.glowThreshold;
    if (Number.isFinite(fxCfg.glowCurve)) fx.glowCurve = fxCfg.glowCurve;
    if (Number.isFinite(fxCfg.glowRadiusPx)) fx.glowRadiusPx = fxCfg.glowRadiusPx;
    if (Number.isFinite(fxCfg.glowFoodSoftening)) fx.glowFoodSoftening = fxCfg.glowFoodSoftening;

    if (Number.isFinite(fxCfg.warpPx)) fx.warpPx = fxCfg.warpPx;
    if (Number.isFinite(fxCfg.warpSpeed)) fx.warpSpeed = fxCfg.warpSpeed;
    if (Number.isFinite(fxCfg.warpScale)) fx.warpScale = fxCfg.warpScale;
    if (Number.isFinite(fxCfg.warpHpExtra)) fx.warpHpExtra = fxCfg.warpHpExtra;

    if (Number.isFinite(fxCfg.grain)) fx.grain = fxCfg.grain;
    if (Number.isFinite(fxCfg.grainSpeed)) fx.grainSpeed = fxCfg.grainSpeed;
    if (Number.isFinite(fxCfg.overlay)) fx.overlay = fxCfg.overlay;
  }

  fx.ensureSize(canvas.width, canvas.height);
  return fx;
}

// -------------------- helpers --------------------

function normBar(v){
  // BAR_MAX = 1.4, но сюда не тащим импорт: нормируем примерно.
  if (!Number.isFinite(v)) return 1;
  const x = Math.max(0, Math.min(1.4, v));
  return x / 1.4;
}

function getActiveOrg(state){
  if (!state) return null;
  const a = state.active;
  if (a === -1 || a === undefined || a === null) return state;
  if (Array.isArray(state.buds)) return state.buds[a] || state;
  return state;
}

// Возвращает true, если в view.moving хоть один организм сейчас движется.
// Нужен только для визуального усиления ghosting.
function anyOrgMoving(view){
  const mv = view?.moving;
  const orgMap = mv?.org;
  if (!orgMap) return false;
  for (const k of Object.keys(orgMap)){
    const m = orgMap[k];
    if (m && m.moving) return true;
  }
  return false;
}

// View-side: считываем свежие лог-сообщения и рождаем FX-события (shock/blast).
// Вызывается из main/render через getFxPipeline(...) (мы уже сохранили ссылку на view в fx._view).
export function consumeLogFx(view){
  if (!view || !view.state) return;
  view._fxRuntime = view._fxRuntime || {};
  const rt = view._fxRuntime;
  const log = Array.isArray(view.state.log) ? view.state.log : [];
  const last = Number.isFinite(rt._lastLogLen) ? rt._lastLogLen : 0;
  if (log.length <= last){ rt._lastLogLen = log.length; return; }
  for (let i = last; i < log.length; i++){
    const e = log[i];
    const kind = e?.kind;
    if (kind === "mut_ok"){
      // Мутация/рост: короткий shockwave + чуть усилить хроматику
      addRipple(view, 0.5, 0.5, RIPPLE_KIND.SHOCK);
      if (view._fxPipeline) view._fxPipeline._chromaFlash = Math.min(1.25, (view._fxPipeline._chromaFlash||0) + 0.35);
    } else if (kind === "care"){
      // Поднятие статов: маленький shockwave
      addRipple(view, 0.5, 0.5, RIPPLE_KIND.SHOCK);
      if (view._fxPipeline) view._fxPipeline._chromaFlash = Math.min(1.0, (view._fxPipeline._chromaFlash||0) + 0.18);
    } else if (kind === "bud_ok"){
      // Почкование: radial blast
      addRipple(view, 0.5, 0.5, RIPPLE_KIND.BLAST);
      if (view._fxPipeline) view._fxPipeline._chromaFlash = Math.min(1.35, (view._fxPipeline._chromaFlash||0) + 0.45);
    }
  }
  rt._lastLogLen = log.length;
}
