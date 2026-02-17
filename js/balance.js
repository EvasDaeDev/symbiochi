// js/balance.js
// Relaxed Balance (Budget-Driven Evolution)
// Source of truth: new_balance.docx (Relaxed Balance v2)

export const BALANCE = {
  version: 2,

  barsMax: 1.4,

  // Budget curve
  budget: {
    maxCellsPerCycle: 8,
    wExponent: 1.8,
  },

  // Organ spawning (separate event)
  organ: {
    wThreshold: 0.75,
    perimeterMax: 0.52,
    cooldownMin: 3,
    offlineMax: 1,
  },

  // Budding progress system
  budding: {
    wThreshold: 0.8,
    stressMax: 0.3,
    targetHours: 8,
    cooldownHours: 12,
    offlineEnabled: false,
  },

  // Offline aggregation
  offline: {
    stepHours: 1,
    maxCells: 100,
    maxOrgans: 1,
    allowBudding: false,
  },

  // Decay per hour (bars are stored in 0..1.4 range)
  // NOTE: tuned for current gameplay: without care, primary bars should drain ~to zero in ~2 hours.
  // Bars are stored in 0..barsMax (default 1.4). So 0.70/hour drains 1.4 in ~2 hours.
  decay: {
    foodPerHour: 0.70,
    cleanPerHour: 0.55,
    moodPerHour: 0.45,
    hpPerHourGood: 0.12,
    hpPerHourBad: 0.35,
    // Threshold is expressed in normalized 0..1 (food/barsMax, clean/barsMax)
    hpBadThresholdAvgFoodClean: 0.55,
  },

  // Growth distribution
  growth: {
    maxBodyPerAttempt: 2,
    maxAppendagePerAttempt: 3,
    priority: "body_first",
  },
};
