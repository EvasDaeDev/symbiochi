export const ANTENNA = {
  label: "Антенна",
  wind: false,
  growthDir: 8,
  minLen: 2,
  maxExtra: 5,
  maxLen: 27,
  upBias: 0.7,
  spawnWeight: 0.12,
  growthChance: 0.95,
  width: 1,
  anim: {
    growthSec: 0.7,
    swayAmp: 1.2,
    swaySec: 6
  },
  initialColor: "#cbd5e1",
  shapeOptions: ["straight", "zigzag", "curve"],
  shapeWeights: [0.65, 0.2, 0.15]
};
