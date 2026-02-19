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
  },

  // === Organ type caps (per organism) ===
  // Limits apply to the NUMBER OF DISTINCT TYPES from each group, not to module count.
  // Examples:
  //  - HARD: any 2 of [ANTENNA, SHELL, SPIKE]
  //  - MOBILE: any 3 of [LIMB, TAIL, TENTACLE, WORM]
  //  - LATE: any 2 of [CLAW, FIN, MOUTH, TEETH]
  // Eyes (and core) are excluded.
  // Set to null to disable.
  organTypeCaps: {
    HARD:   { types: ["antenna", "shell", "spike"], cap: 2 },
    MOBILE: { types: ["limb", "tail", "tentacle", "worm"], cap: 3 },
    LATE:   { types: ["claw", "fin", "mouth", "teeth"], cap: 2 },
    EXCLUDE: ["eye", "core"]
  }
};
