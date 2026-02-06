// mods/carrots.js
// Интерактивное кормление морковками и формирование внешности.

export const CARROT = {
  w: 3,
  h: 7,
  maxPerTick: 3,
  nearDist: 7,    // близко: растем телом (если нет органа-перехватчика)
  farDist: 15,    // дальше: тянем отросток
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
