export const WORM = {
  minLen: 3,
  maxExtra: 7,
  maxBodyMult: 2,
  spawnWeight: 0.12,
  growthChance: 0.85,
  width: 1,
  anim: {
    growthSec: 0.7,
    peristalsisSec: 5.5
  },
  initialColor: "#8b3a2b",
  shapeOptions: ["segmented", "ribbon", "coil"],
  shapeWeights: [0.55, 0.3, 0.15]
};
