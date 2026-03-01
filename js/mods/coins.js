// mods/coins.js
// Интерактивные "монетки": приманка на поле, движение к монетке и бонус настроения.

export const COIN = {
  // Монетка — 3x3 блоков (9 клеток)
  w: 3,
  h: 3,

  // Инвентарь по умолчанию
  startInventory: 10,

  // Лимит постановки за один цикл мутации
  maxPerTick: 3,

  // Погрешность "намерения" (смещение вектора движения), в блоках
  aimJitter: 3,

  // Бонус настроения при достижении монетки
  moodMin: 0.10,
  moodMax: 0.17,
  
  ttlSec: 180, // 3 минуты
};

export function coinCellOffsets(w = COIN.w, h = COIN.h){
  const out = [];
  for (let dy = 0; dy < h; dy++){
    for (let dx = 0; dx < w; dx++) out.push([dx, dy]);
  }
  return out;
}
