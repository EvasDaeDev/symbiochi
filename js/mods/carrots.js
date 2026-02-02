// mods/carrots.js
// Интерактивное кормление морковками и формирование внешности.

export const CARROT = {
  w: 4,
  h: 3,
  maxPerTick: 2,
  nearDist: 8,   // близко: растем телом
  farDist: 8,    // далеко: тянем отросток (если > nearDist)
};
