// js/FX/background_warp.js
// Perlin/FBM warp для "живого" фона.
//
// Мы не пытаемся менять сам нарисованный Canvas2D-фон.
// Вместо этого в пост-эффекте немного искажаем UV по процедурному шуму.
// Это создаёт ощущение, что мир "дышит"/"плывёт".

function clamp01(v){
  v = +v;
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export const WARP_DEFAULTS = {
  // Сила warp в пикселях (очень маленькая, чтобы не ломать пиксель-арт)
  warpPx: 5.25,
  // Скорость течения (в shader time)
  speed: 0.12,
  // Масштаб шума: чем больше — тем мельче "волокна".
  scale: 1.35,
  // Сколько добавлять warp при стрессе (низком HP)
  hpExtra: 0.0,
};

export function computeWarpPx(cfg, hp01){
  const base = Number.isFinite(cfg?.warpPx) ? cfg.warpPx : WARP_DEFAULTS.warpPx;
  const extra = Number.isFinite(cfg?.hpExtra) ? cfg.hpExtra : WARP_DEFAULTS.hpExtra;
  // Низкий HP => больше warp.
  const k = 1 + extra * (1 - clamp01(hp01));
  return Math.max(0, base * k);
}
