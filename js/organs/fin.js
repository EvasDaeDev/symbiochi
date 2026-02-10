export const FIN = {
  label: "Плавник",
  wind: true,
  growthDir: 16,
  offsets: [
    [1, 0],
    [1, 1],
    [1, -1],
    [2, 1],
    [2, -1]
  ],
  spawnWeight: 0.06,
  growthChance: 0.8,
  width: 2,
  anim: {
    growthSec: 0.7,
    flutterSec: 5.2
  },
  initialColor: "#60a5fa",
  shapeOptions: ["fan", "kite", "leaf"],
  shapeWeights: [0.5, 0.3, 0.2]
};
