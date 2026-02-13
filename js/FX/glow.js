// js/FX/glow.js
// Нелинейный glow (псевдо-bloom) для пиксельарта.
//
// Важно:
// - Мы НЕ делаем тяжёлый blur в несколько проходов.
// - Делаем дешёвый "соседний" blur в одном шейдере:
//   берём 8 соседей, но добавляем их только если пиксель достаточно яркий.
// - "Нелинейность": яркость усиливается через степенную кривую.
//
// Усиливаем/ослабляем glow в зависимости от "сытости" организма.

function clamp01(v){
  v = +v;
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export const GLOW_DEFAULTS = {
  // Сила glow по умолчанию.
  strength: 0.35,
  // Порог яркости (0..1): ниже — glow почти не добавляем.
  threshold: 0.55,
  // Нелинейность: 1.0 линейно, 1.6..2.4 более "неон".
  curve: 1.85,
  // Радиус в пикселях (в UV будет scaled по uRes).
  radiusPx: 2.2,

  // Влияние сытости: когда еда высокая, glow мягче (меньше strength).
  // food01 = food/BAR_MAX.
  foodSoftening: 0.20,
};

// Возвращает итоговую силу glow с учётом сытости.
export function computeGlowStrength(cfg, food01){
  const base = Number.isFinite(cfg?.strength) ? cfg.strength : GLOW_DEFAULTS.strength;
  const soften = Number.isFinite(cfg?.foodSoftening) ? cfg.foodSoftening : GLOW_DEFAULTS.foodSoftening;
  // Чем выше сытость — тем мягче glow (слегка уменьшаем силу).
  const k = 1.0 - soften * clamp01(food01);
  return Math.max(0, base * k);
}
