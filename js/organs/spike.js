export const SPIKE = {
  label: "Шипы",
  wind: false,
  growthDir: 8,
  // Don't allow spikes too early; they can quickly occupy the perimeter and stall early body growth.
  // This keeps the "<300 blocks" phase focused on expanding the core body.
  spawnMinBody: 90,
  minLen: 1,
  maxExtra: 4,
  maxLen: 10,
  spawnWeight: 0.08,
  growthChance: 0.9,
  width: 1,
  anim: {
    growthSec: 0.7,
    blinkSec: 3.2
  },
  initialColor: "#fb4b4b",
  shapeOptions: ["needle", "barb", "cone"],
  shapeWeights: [0.5, 0.3, 0.2]
};
