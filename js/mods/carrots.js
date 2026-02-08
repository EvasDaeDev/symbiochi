// mods/carrots.js
// Интерактивное кормление морковками и формирование внешности.

export const CARROT = {
  w: 3,
  h: 7,
  maxPerTick: 3,
  // Дистанции (в блоках, Манхэттен):
  // - если тело в радиусе nearDist: растим тело
  // - иначе (но в пределах farDist): тянем отростки к морковке
  nearDist: 10,
  farDist: 60,

  // Все настройки морковок храним здесь (единый источник правды)
  startInventory: 200
};

export function carrotCellOffsets(w = CARROT.w, h = CARROT.h){
  const out = [];
  const centerX = Math.floor(w / 2);
  for (let dy = 0; dy < h; dy++){
    if (dy >= h - 2){
      out.push([centerX, dy]);
      continue;
    }
    for (let dx = 0; dx < w; dx++){
      out.push([dx, dy]);
    }
  }
  return out;
}
