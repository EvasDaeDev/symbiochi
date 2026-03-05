export const FIN = {
  label: "Плавник",
  wind: true,
  minLen: 3,
  maxExtra: 25,
  maxLen: 10,
  spawnWeight: 0.08,
  growthChance: 0.5,
  width: 2,
  growthDir: 16,
  offsets: [
    [1, 0],
    [1, 1],
    [1, -1],
    [2, 1],
    [2, -1]
  ],

  anim: {
    growthSec: 0.7,
    flutterSec: 5.2
  },
  initialColor: "#60a5fa",
  shapeOptions: ["fan", "kite", "leaf"],
  shapeWeights: [0.5, 0.5, 0.5]
};
