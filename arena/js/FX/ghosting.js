// js/FX/ghosting.js
// Ghosting / afterimage.
//
// Идея: смешиваем текущий кадр с предыдущим (после всех FX),
// чтобы появлялся "хвост" движения.
//
// Реализация в WebGL: у нас есть uPrevTex (предыдущий финальный кадр).
// В шейдере делаем: col = mix(current, prev, alpha).
//
// Этот модуль хранит только настройки и вычисление альфы.

function clamp01(v){
  v = +v;
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * computeGhostAlpha({ movingK? })
 *
 * movingK — опционально: 0..1 насколько "движется" сцена (если захотим привязать к скорости).
 */
export function computeGhostAlpha(cfg, movingK = 0){
  // Базовая альфа хвоста (чем больше — тем сильнее послеобраз).
  const base = Number.isFinite(cfg?.ghostAlpha) ? cfg.ghostAlpha : 0.10;
  const extra = Number.isFinite(cfg?.ghostAlphaMovingExtra) ? cfg.ghostAlphaMovingExtra : 0.06;
  return clamp01(base + extra * clamp01(movingK));
}

export const GHOST_DEFAULTS = {
  // 0..0.2 обычно достаточно (иначе картинка превращается в "кашу")
  ghostAlpha: 0.10,
  // Доп. хвост при движении (если будет источник movingK)
  ghostAlphaMovingExtra: 0.06,
};
