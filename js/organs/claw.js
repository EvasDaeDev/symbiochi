import { thicknessClaw } from "./_thickness.js";

export const CLAW = {
  label: "Клешня",
  wind: false,
  growthDir: 16,
  minLen: 3,
  maxExtra: 7,
  maxLen: 9,
  spawnWeight: 0.08,
  growthChance: 0.9,
  width: 1,
  anim: {
    growthSec: 0.7,
    swipeSec: 4.8
  },
  render: {
    // Visual-only thickness (middle heavier).
    thicknessLevel: (i, len) => thicknessClaw(i, len, { minLen: 3, maxThickness: 2 })
  },
  initialColor: "#b45309",
  shapeOptions: ["hook", "sickle", "fork"],
  shapeWeights: [0.5, 0.35, 0.15]
};
