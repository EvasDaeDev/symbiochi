// mods/evo.js

export const EVO = {
  // Hard cap of how many mutations may be applied in a single mutation tick.
  // Keep this small so evolution remains readable and doesn't "burst".
  maxMutationsPerTick: 2,

  // Multiplier for body growth ("grow_body") mutation.
  // 1.0 = neutral. Prefer tuning evoIntervalMin / weights first.
  bodyGrowMult: 1,
  appendageGrowMult: 1,

  // === New balance v2.2: continuous per-organism evolution ===
  baseIntervalSec: 20,
  // If avg(food,clean,hp) <= sleepThreshold => stasis (no evolution; minEvoSpeed not applied)
  sleepThreshold: 0.15,
  // Anti-stall floor for evoSpeed when not in stasis (range 0.08..0.12)
  minEvoSpeed: 0.033,
  // Size slow-down hyperbola: sizeFactor = 1/(1+(bodyBlocks/S0)^p)
  sizeS0: 1250,
  sizeP: 1.75,
  // Global ecological pressure: 1/(1+0.3*totalOrganisms)
  ecoPressureK: 0.30,

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


// --- Helpers (pure functions) ---

export function sizeFactor(bodyBlocks, S0 = EVO.sizeS0, p = EVO.sizeP){
  const s = Math.max(0, Number(bodyBlocks) || 0);

  // ✅ Early stage: no slowdown until 250 blocks (v2.2 wants fast early growth)
  if (s <= 350) return 1;

  const s0 = Math.max(1, Number(S0) || 420);
  const pp = Math.max(0.2, Number(p) || 1.75);
  return 1 / (1 + Math.pow(s / s0, pp));
}

// Requirements:
// - avg=1.0 => 1.0
// - avg=0.5 => 0.25 (x4 slowdown)
// - avg=0.3 => 1/7  (x7 slowdown)
// - avg>1.0 => small penalty (no bonus above 100%)
// - keep imbalance penalty (balanced stats keep it at 1.0)
export function statFactor(bars, sleepThreshold = EVO.sleepThreshold){
  const f = Number(bars?.food ?? 0);
  const c = Number(bars?.clean ?? 0);
  const h = Number(bars?.hp ?? 0);

  const avg = (f + c + h) / 3;
  const st = Math.max(0, Number(sleepThreshold) || 0);

  // Stasis gate remains the same contract: below threshold => no evolution speed.
  if (!(avg > st)) return 0;

  // --- Base curve for <= 100% ---
  // This curve is calibrated to hit:
  // 0.5 -> 0.25 and 0.3 -> 1/7, while keeping 1.0 -> 1.0.
  const a = Math.max(0, avg);
  const base = Math.min(1, a);

  let sf =
    Math.pow(base, 0.673631) /
    (1 + 3.015415 * (1 - base));

  // --- Small penalty for > 100% (no bonus) ---
  if (a > 1){
    const overK = 0.35; // tweak 0.25..0.6 depending on how strong you want the "overcap tax"
    sf *= 1 / (1 + overK * (a - 1));
  }

  // --- Imbalance penalty (same spirit as your current one) ---
  const v = [f, c, h];
  const mean = avg;
  let varSum = 0;
  for (let i = 0; i < v.length; i++){
    const d = v[i] - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / v.length); // 0..~1
  const imbalance = Math.max(0, Math.min(1, std / 0.35));
  const imbalanceFactor = 1 - 0.60 * imbalance; // up to -60%

  sf *= imbalanceFactor;

  return Math.max(0, Math.min(1, sf));
}

export function globalEcoPressure(totalOrganisms, k = EVO.ecoPressureK){
  const n = Math.max(1, Math.floor(Number(totalOrganisms) || 1));
  const extra = Math.max(0, n - 1);
  const kk = Math.max(0, Number(k) || 0);
  return 1 / (1 + kk * extra);
}

export function computeEvoSpeed(org, totalOrganisms){
  const bars = org?.bars || {};
  const f = Number(bars.food ?? 0);
  const c = Number(bars.clean ?? 0);
  const h = Number(bars.hp ?? 0);
  const avg = (f + c + h) / 3;

  const st = Number(EVO.sleepThreshold) || 0.15;
  if (!(avg > st)) return { evoSpeed: 0, inStasis: true, avgStat: avg };

  const sf = statFactor(bars, st);
  const bodyBlocks = Array.isArray(org?.body?.cells) ? org.body.cells.length : 0;
  const sz = sizeFactor(bodyBlocks, EVO.sizeS0, EVO.sizeP);
  const eco = globalEcoPressure(totalOrganisms, EVO.ecoPressureK);

  let evoSpeed = sf * sz * eco;

  const minE = Math.max(0, Number(EVO.minEvoSpeed) || 0);
  evoSpeed = Math.max(minE, evoSpeed);

  return { evoSpeed, inStasis: false, avgStat: avg, statFactor: sf, sizeFactor: sz, ecoPressure: eco };
}

export function evoIntervalSecFromSpeed(evoSpeed){
  const base = Math.max(1, Number(EVO.baseIntervalSec) || 20);
  const s = Math.max(0, Number(evoSpeed) || 0);
  if (!(s > 0)) return Infinity;
  return base / s;
}
