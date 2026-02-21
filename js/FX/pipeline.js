// js/FX/pipeline.js
// View-only FX pipeline. Не изменяет state.

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

    // ------------------------------------------------------------
    // MASTER SWITCH (отключает ВСЁ)
    // ------------------------------------------------------------
    this.enabled = true;

    // ------------------------------------------------------------
    // Тонкая настройка включения эффектов (в одном месте)
    // ------------------------------------------------------------
    this.fxEnabled = {
      barrel: true,
      chroma: true,
      ghosting: false,
      ripples: true,
      rippleColor: true, // локальная подсветка по кольцу (можно выключить отдельно)

      warp: false,
      glow: true,
      grain: false,
      overlay: false,
    };

    // ---------------- Базовые параметры ----------------
    this.barrelK = 0.060;
    this.barrelExp = 2.25;
    this.chromaticPx = 3.35;
    this.vignette = 0.15;
    this.smooth = 0.0;

    // Ripple ring (локальная подсветка по кольцу)
    this.ringWidth = 0.15;          // толщина кольца (UV 0..1)
    this.ringBrightness = 0.20;   // +10% яркости в кольце
    this.rippleFade = 1.90;       // затухание волны: больше = быстрее

// Ghosting
    this.ghostAlpha = GHOST_DEFAULTS.ghostAlpha;
    this.ghostAlphaMovingExtra = GHOST_DEFAULTS.ghostAlphaMovingExtra;

    // Glow (периметральный, цвет наследует пиксели организма)
    this.glowStrength = GLOW_DEFAULTS.strength;
    this.glowRadiusPx = GLOW_DEFAULTS.radiusPx;

    // Порог яркости фона (ниже — фон, выше — организм)
    this.glowBgLumaCut = GLOW_DEFAULTS.bgLumaCut;

    // 3 градации по длине свечения (доли от radiusPx)
    this.glowBand1 = GLOW_DEFAULTS.band1;
    this.glowBand2 = GLOW_DEFAULTS.band2;

    // Интенсивность по зонам
    this.glowW1 = GLOW_DEFAULTS.w1;
    this.glowW2 = GLOW_DEFAULTS.w2;
    this.glowW3 = GLOW_DEFAULTS.w3;

    // Мягкость края
    this.glowSoft = GLOW_DEFAULTS.soft;

    // Влияние сытости (softening силы)
    this.glowFoodSoftening = GLOW_DEFAULTS.foodSoftening;

    // Warp
    this.warpPx = WARP_DEFAULTS.warpPx;
    this.warpSpeed = WARP_DEFAULTS.speed;
    this.warpScale = WARP_DEFAULTS.scale;
    this.warpHpExtra = WARP_DEFAULTS.hpExtra;

    // Noise
    this.grain = NOISE_DEFAULTS.grain;
    this.grainSpeed = NOISE_DEFAULTS.grainSpeed;
    this.overlay = NOISE_DEFAULTS.overlay;

    this.centerX = 0.5;
    this.centerY = 0.5;

    this._scene = null;
    this._sceneCtx = null;
    this._w = 0;
    this._h = 0;

    this._glPass = null;
    this._glFailed = false;
  }

  ensureSize(w, h){
    w |= 0; h |= 0;
    if (w<=0 || h<=0) return;
    if (this._scene && this._w===w && this._h===h) return;

    this._w = w;
    this._h = h;
    this._scene = makeCanvas(w,h);
    this._sceneCtx = this._scene.getContext("2d");
    this._sceneCtx.imageSmoothingEnabled = false;
  }

  begin(canvas){
    this.ensureSize(canvas.width, canvas.height);
    return this._sceneCtx;
  }

  end(canvas){
    if (!this._scene) return;

    // ------------------------------------------------------------
    // MASTER SWITCH (physically disables ALL FX)
    // IMPORTANT: if the main canvas already owns a WebGL context,
    // canvas.getContext('2d') returns null. In that case we do a
    // cheap WebGL blit (no FX) instead of crashing.
    // ------------------------------------------------------------
    if (!this.enabled){
      const ctx2d = canvas.getContext("2d");
      if (ctx2d){
        ctx2d.imageSmoothingEnabled = false;
        ctx2d.clearRect(0,0,this._w,this._h);
        ctx2d.drawImage(this._scene,0,0);
        return;
      }

      if (!this._glPass && !this._glFailed){
        try {
          this._glPass = new WebGLPass(canvas);
        } catch(e){
          this._glFailed = true;
        }
      }
      if (this._glPass && !this._glFailed && typeof this._glPass.blit === "function"){
        const ok = this._glPass.blit(this._scene);
        if (ok) return;
        this._glFailed = true;
      }
      return;
    }

    if (!this._glPass && !this._glFailed){
      try {
        this._glPass = new WebGLPass(canvas);
      } catch(e){
        this._glFailed = true;
      }
    }

    if (this._glPass && !this._glFailed){

      const fxOn = !!this.enabled;
      const f = this.fxEnabled || {};
      const on = (k)=> (fxOn && f[k] !== false);

      const ripples = buildRippleUniforms(this._view || {});

      const ok = this._glPass.render(this._scene, {

        barrelK: on("barrel") ? this.barrelK : 0.0,
        barrelExp: this.barrelExp,

        chromaticPx: on("chroma") ? this.chromaticPx : 0.0,
        chromaMult: on("chroma") ? 1.0 : 1.0,

        vignette: fxOn ? this.vignette : 0.0,
        smooth: fxOn ? this.smooth : 0.0,
        centerX: this.centerX,
        centerY: this.centerY,

        ghostAlpha: on("ghosting")
          ? computeGhostAlpha({
              ghostAlpha: this.ghostAlpha,
              ghostAlphaMovingExtra: this.ghostAlphaMovingExtra
            }, 0)
          : 0.0,

        ripples: on("ripples")
          ? ripples
          : (FxPipeline.ZERO_RIPPLES || (FxPipeline.ZERO_RIPPLES = new Float32Array(6*4))),

        ringWidth: this.ringWidth,

        // Локальная подсветка в кольце ripple (вместо hue-shift)
        ringBrightness: (on("ripples") && on("rippleColor")) ? this.ringBrightness : 0.0,
        rippleFade: this.rippleFade,


        warpPx: on("warp") ? this.warpPx : 0.0,
        warpScale: this.warpScale,
        warpSpeed: this.warpSpeed,

        glowStrength: on("glow") ? this.glowStrength : 0.0,
        glowRadiusPx: this.glowRadiusPx,
        glowBgLumaCut: this.glowBgLumaCut,
        glowBand1: this.glowBand1,
        glowBand2: this.glowBand2,
        glowW1: this.glowW1,
        glowW2: this.glowW2,
        glowW3: this.glowW3,
        glowSoft: this.glowSoft,

        grain: on("grain") ? computeGrain({grain:this.grain}) : 0.0,
        grainSpeed: computeGrainSpeed({grainSpeed:this.grainSpeed}),
        overlay: on("overlay") ? computeOverlay({overlay:this.overlay}) : 0.0,

        time: performance.now()/1000
      });

      if (ok) return;
      this._glFailed = true;
    }

    // fallback
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0,0,this._w,this._h);
    ctx.drawImage(this._scene,0,0);
  }
}

export function getFxPipeline(view, canvas){
  if (!view._fxPipeline)
    view._fxPipeline = new FxPipeline();

  const fx = view._fxPipeline;
  fx._view = view;
  fx.ensureSize(canvas.width, canvas.height);
  return fx;
}
