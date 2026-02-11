import { thicknessTail } from "./thickness.js";

export const TAIL = {
  label: "Хвост",
  wind: true,
  growthDir: 16,
  minLen: 7,
  maxExtra: 36,
  spawnWeight: 0.1,
  growthChance: 0.85,
  width: 1,
  anim: {
    growthSec: 0.7,
    swayAmp: 2.1,
    swaySec: 6
  },
  render: {
    // Visual-only thickness. Render may draw lateral "support" blocks when free.
    // Tail: becomes thick along the whole length once it is long enough.
    thicknessLevel: (i, len) => thicknessTail(i, len, { minLen: 4 })
  },
  initialColor: "#22d3ee",
  shapeOptions: ["straight", "curve", "fin"],
  shapeWeights: [0.55, 0.2, 0.15]
};
