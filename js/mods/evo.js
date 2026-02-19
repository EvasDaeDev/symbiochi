// mods/evo.js

export const EVO = {
  // Hard cap of how many mutations may be applied in a single mutation tick.
  // Keep this small so evolution remains readable and doesn't "burst".
  maxMutationsPerTick: 1,

  // Multiplier for body growth ("grow_body") mutation.
  // 1.0 = neutral. Prefer tuning evoIntervalMin / weights first.
  bodyGrowMult: 1,
  appendageGrowMult: 1,

  // Budding health gate.
  // Budding is allowed only when ALL bars are strictly greater than this threshold.
  // Default matches UI boundary: "плохо" <= 0.35.
  budMinBar: 0.35,

  organGrowthRate: {
    tail: 4/3,
    tentacle: 4/3
  }
};
