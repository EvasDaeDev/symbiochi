import { thicknessClaw } from "./thickness.js";

export const CLAW = {
  label: "Клешня",
  wind: false,
  growthDir: 16,

  // Теперь это "steps" вдоль оси клешни (не кол-во клеток)
  minLen: 3,
  maxExtra: 15,
  maxLen: 16,

  // Насколько половинки могут расходиться в сторону (в клетках)
  maxSpread: 3,

  spawnWeight: 0.08,
  growthChance: 0.2,
  width: 2,
  anim: {
    growthSec: 0.7,
    swipeSec: 4.8
  },
  render: {
    thicknessLevel: (i, len) => thicknessClaw(i, len, { minLen: 3, maxThickness: 2 })
  },
  initialColor: "#b45309",
  shapeOptions: ["hook", "sickle", "fork"],
  shapeWeights: [0.5, 0.35, 0.35]
};