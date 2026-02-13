// js/FX/noise_overlay.js
// Очень аккуратный "мощный" эффект: лёгкий grain + мягкий overlay.
//
// Смысл: добавить глубины и "магии" без разрушения пиксельного изображения.
// Это НЕ должен быть шум как на старом ТВ. Это микротекстура.

function clamp01(v){
  v = +v;
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export const NOISE_DEFAULTS = {
  // Сила зерна (0..1). Рекомендуется 0.02..0.08.
  grain: 0.045,
  // Скорость анимации зерна.
  grainSpeed: 1.2,
  // Мягкий цветовой overlay (0..1). Это не "плашка", а очень лёгкая модуляция.
  overlay: 0.035,
};

export function computeGrain(cfg){
  const g = Number.isFinite(cfg?.grain) ? cfg.grain : NOISE_DEFAULTS.grain;
  return clamp01(g);
}

export function computeOverlay(cfg){
  const o = Number.isFinite(cfg?.overlay) ? cfg.overlay : NOISE_DEFAULTS.overlay;
  return clamp01(o);
}

export function computeGrainSpeed(cfg){
  const s = Number.isFinite(cfg?.grainSpeed) ? cfg.grainSpeed : NOISE_DEFAULTS.grainSpeed;
  return Math.max(0, s);
}
