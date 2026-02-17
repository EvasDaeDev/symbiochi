export const LIMB = {
  label: "Лапка",
  wind: true,
  growthDir: 16,
  phalanxCountMin: 2,
  phalanxCountMax: 5,
  phalanxLenMin: 5,
  phalanxLenMax: 7,
  downBias: 0.65,
  animAngleMin: 5,
  animAngleMax: 40,
  spawnWeight: 0.1,
  growthChance: 0.4,
  width: 1,
  anim: {
    growthSec: 0.7,
    stepSec: 3.6
  },
  initialColor: "#a16207",
  shapeOptions: ["jointed", "spade"],
  shapeWeights: [0.6, 0.25, 0.15]
};
