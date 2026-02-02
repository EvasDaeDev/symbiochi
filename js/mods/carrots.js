// mods/carrots.js
// Интерактивное кормление морковками и формирование внешности.

export const CARROT = {
  w: 7,
  h: 3,
  maxPerTick: 2,
  nearDist: 15,   // близко: растем телом
  farDist: 15,    // далеко: тянем отросток (если > nearDist)
};
