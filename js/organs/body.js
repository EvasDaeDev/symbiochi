export const BODY = {
  growWeight: 0.92,
  appendageGrowWeight: 0.12,
  appendageGrowPerModule: 0.03,
  growBodyPenaltyMult: 0.65,
  growthChance: 0.93,
  width: 1,
  anim: {
    growthSec: 0.7,
    breatheSec: 6
  },
  initialColor: "#1f2937",
  shapeOptions: ["compact", "amoeboid", "elongated"],
  shapeWeights: [0.5, 0.5, 0.5]
};

export const CORE = {
  sizeScale: 1,
  anim: {
    pulseSec: 5
  },
  initialColor: "#34d399",
  colors: {
    good: "#34d399",
    ok: "#fbbf24",
    bad: "#fb7185"
  }
};
