// mods/evo.js

export const EVO = {
  // Hard cap of how many mutations may be applied in a single mutation tick.
  // Keep this small so evolution remains readable and doesn't "burst".
  maxMutationsPerTick: 2,

  // Multiplier for body growth ("grow_body") mutation.
  // 1.0 = neutral. Prefer tuning evoIntervalMin / weights first.
  bodyGrowMult: 1,
  appendageGrowMult: 1,
  organGrowthRate: {
    tail: 4/3,
    tentacle: 4/3
  }
};
