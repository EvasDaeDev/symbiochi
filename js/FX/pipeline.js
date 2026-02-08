// js/FX/pipeline.js
// FX pipeline:
// - Render the world into an offscreen Canvas2D buffer.
// - Present that buffer onto the visible canvas.
//   * If FX enabled and WebGL is available: GPU post-process (barrel + chromatic).
//   * Otherwise: direct blit (no quality loss).
//
// View-only: does not modify game state.

import { WebGLPass } from "./webgl_pass.js";

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

    // Mild defaults (subtle, CRT-ish)
    this.barrelK = 0.060;       // 0.02..0.10
    this.barrelExp = 2.25;      // 1.5..3.0 (non-linear: less in center, more at edges)
    this.chromaticPx = 1.35;    // 0.25..1.2
    this.vignette = 0.35;       // 0..0.25
    this.smooth = 1.0;          // 0..1 (shader neighbor blend)

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
        const ok = this._glPass.render(this._scene, {
          barrelK: fxOn ? this.barrelK : 0.0,
          barrelExp: this.barrelExp,
          chromaticPx: fxOn ? this.chromaticPx : 0.0,
          vignette: fxOn ? this.vignette : 0.0,
          smooth: fxOn ? this.smooth : 0.0,
          centerX: this.centerX,
          centerY: this.centerY,
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

  if (fxCfg && typeof fxCfg === "object"){
    if (typeof fxCfg.enabled === "boolean") fx.enabled = fxCfg.enabled;
    if (Number.isFinite(fxCfg.barrelK)) fx.barrelK = fxCfg.barrelK;
    if (Number.isFinite(fxCfg.barrelExp)) fx.barrelExp = fxCfg.barrelExp;
    if (Number.isFinite(fxCfg.chromaticPx)) fx.chromaticPx = fxCfg.chromaticPx;
    if (Number.isFinite(fxCfg.vignette)) fx.vignette = fxCfg.vignette;
    if (Number.isFinite(fxCfg.smooth)) fx.smooth = fxCfg.smooth;
    if (Number.isFinite(fxCfg.centerX)) fx.centerX = fxCfg.centerX;
    if (Number.isFinite(fxCfg.centerY)) fx.centerY = fxCfg.centerY;
  }

  fx.ensureSize(canvas.width, canvas.height);
  return fx;
}
