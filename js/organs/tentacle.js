import { thicknessBulkyBase } from "./thickness.js";

export const TENTACLE = {
  label: "Щупальце",
  wind: true,
  growthDir: 16,
  minLen: 7,
  maxExtra: 36,
  spawnWeight: 0.15,
  growthChance: 0.9,
  width: 1,
  anim: {
    growthSec: 0.7,
    // Visual-only animation (render-space). State/geometry are NOT modified.
    // Requested: like worm, but slower and with larger amplitude.
    // "One direction" cycle: 14–18 seconds.
    wiggleSec: [14, 18],

    // Lateral offset (in *world cells*, not pixels). Amplitude grows to the tip.
    latMaxCells: 1.85,
    ampPow: 1.45,

    // More bends than worm: tentacles look more "liquid".
    bendsMin: 2.1,
    bendsMax: 3.2,

    // Mild axial motion (peristalsis feel), as a fraction of lateral amplitude.
    axialFrac: 0.26,

    // Slight extra twist helps the tip whip around.
    twistRadMax: 0.75,
    coilLen: 18
  },
  render: {
    // Visual-only thickness. Bulky base for most of the length, thin near the tip.
    thicknessLevel: (i, len) => thicknessBulkyBase(i, len, { minLen: 6, midFrac: 2/3 })
  },
  initialColor: "#fb7185",
  shapeOptions: ["wave", "curve", "spiral"],
  shapeWeights: [0.3, 0.15, 0.25]
};

function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function lerp(a,b,t){ return a + (b - a) * t; }

/**
 * Procedural tentacle wiggle (visual-only).
 * Returns *world-cell* offsets to apply at render time.
 *
 * Design goals (user request):
 * - Like worm but with larger amplitude and slower movement.
 * - Stronger at the tip, minimal at the base.
 */
export function tentacleOffset(i, len, tSec, dir, perp, seed01=0){
  if (!dir || !perp || len <= 1) return { x: 0, y: 0 };
  const cfg = TENTACLE.anim || {};

  const denom = Math.max(1, len - 1);
  const u = i / denom; // 0..1 base->tip

  // Small at base, strong at tip.
  const tipAmp = Math.pow(u, Number.isFinite(cfg.ampPow) ? cfg.ampPow : 1.45);

  // Per-organ stable cycle.
  const wiggleRange = Array.isArray(cfg.wiggleSec) ? cfg.wiggleSec : [14, 18];
  const wiggleSec = lerp(wiggleRange[0] ?? 14, wiggleRange[1] ?? 18, clamp01(seed01));
  const phase = (tSec * (2 * Math.PI / Math.max(0.1, wiggleSec))) + seed01 * 5.73;

  // Tentacles feel whippy earlier than worms.
  const coilLen = Number.isFinite(cfg.coilLen) ? cfg.coilLen : 18;
  const coilK = clamp01((len - 7) / Math.max(1, coilLen));

  const bends = lerp(cfg.bendsMin ?? 2.1, cfg.bendsMax ?? 3.2, coilK);

  // Lateral wave with harmonics.
  const wave1 = Math.sin(phase + u * (2 * Math.PI * bends));
  const wave2 = 0.45 * Math.sin(phase * 1.55 + u * (2 * Math.PI * (bends * 0.68)) + 1.9);
  const wave3 = 0.18 * Math.sin(phase * 2.35 + u * (2 * Math.PI * (bends * 1.15)) - 0.7);
  const wave = 0.62 * wave1 + 0.26 * wave2 + 0.12 * wave3;

  const latMax = Number.isFinite(cfg.latMaxCells) ? cfg.latMaxCells : 1.85;
  // Slightly larger amplitude overall than worm.
  const latAmp = latMax * (0.48 + 0.52 * coilK) * tipAmp;
  const lateral = wave * latAmp;

  const axialFrac = Number.isFinite(cfg.axialFrac) ? cfg.axialFrac : 0.26;
  const axial = Math.sin(phase * 0.78 - u * (2 * Math.PI * (bends * 0.52))) * (axialFrac * latAmp);

  // Extra twist helps the tip whip/coil visually.
  const twistMax = Number.isFinite(cfg.twistRadMax) ? cfg.twistRadMax : 0.75;
  const twist = twistMax * (0.35 + 0.65 * coilK) * Math.sin(phase * 0.61 + u * (2 * Math.PI * 1.35) + seed01 * 2.4);
  const cos = Math.cos(twist);
  const sin = Math.sin(twist);
  const rx = perp[0] * cos - perp[1] * sin;
  const ry = perp[0] * sin + perp[1] * cos;

  return {
    x: rx * lateral + dir[0] * axial,
    y: ry * lateral + dir[1] * axial
  };
}
