// mods/parts.js
// Все модификаторы частей организма (названия, базовая тональность, поведение).

export const PARTS = {
  body:     { label: "Тело",       baseHue: 45,  wind: false },
  core:     { label: "Ядро",       baseHue: 160, wind: false },
  eye:      { label: "Глаза",      baseHue: 300, wind: false },

  antenna:  { label: "Антенна",    baseHue: 12,  wind: false }, // антенны не качаются
  tentacle: { label: "Щупальце",   baseHue: 330, wind: true  },
  tail:     { label: "Хвост",      baseHue: 175, wind: true  },
  limb:     { label: "Лапка",      baseHue: 30,  wind: true  },
  spike:    { label: "Шипы",       baseHue: 8,   wind: false },
  shell:    { label: "Панцирь",    baseHue: 210, wind: false },

  // поздние мутации
  teeth:    { label: "Зубы",       baseHue: 20,  wind: false },
  claw:     { label: "Клешня",     baseHue: 25,  wind: true  },
  mouth:    { label: "Рот",        baseHue: 57,  wind: false },
  fin:      { label: "Плавник",    baseHue: 190, wind: true  },
};

export const ORGAN_TYPES = [
  "antenna","tentacle","tail","limb","spike","shell","eye",
  "teeth","claw","mouth","fin",
];

export function partLabel(type){
  return PARTS[type]?.label || type || "Часть";
}
