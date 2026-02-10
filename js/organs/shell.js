export const SHELL = {
  label: "Панцирь",
  wind: false,
  growthDir: 8,
  // Shell plates are strong perimeter-occupiers; delay them until the body has room.
  spawnMinBody: 130,
  size: 2,
  spawnWeight: 0.06,
  growthChance: 0.65,
  width: 2,
  anim: {
    growthSec: 0.7,
    pulseSec: 6.5
  },
  initialColor: "#64748b",
  shapeOptions: ["plate", "dome", "ridge"],
  shapeWeights: [0.55, 0.3, 0.15]
};
