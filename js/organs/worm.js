export const WORM = {
  label: "Червь",
  wind: false,
  growthDir: 16,
  minLen: 3,
  maxExtra: 7,
  maxBodyMult: 2,
  spawnWeight: 0.12,
  growthChance: 0.34,
  width: 1,
  anim: {
    growthSec: 0.7,
    // Visual-only animation (render-space). State/geometry are NOT modified.
    // Requested: 10–13 seconds per cycle (one direction), with a stronger curl at the tip.
    wiggleSec: [0.5, 2],

    // Lateral offset (in *world cells*, not pixels). Amplitude grows to the tip.
    latMaxCells: 1.15,
    ampPow: 1.6,

    // How many "bends" along the length. Slightly increases with length.
    bendsMin: 1.6,
    bendsMax: 2.5,

    // Mild axial squish (peristalsis feel), as a fraction of lateral amplitude.
    axialFrac: 0.22,

    // Twist rotates the perpendicular vector a bit, helps "coil" around ~20 blocks.
    twistRadMax: 0.55,
    coilLen: 20
  },
  initialColor: "#8b3a2b",
  shapeOptions: ["segmented", "ribbon", "coil"],
  shapeWeights: [0.25, 0.3, 0.35]
};

function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function lerp(a,b,t){ return a + (b - a) * t; }

/**
 * Procedural worm wiggle (visual-only).
 * Returns *world-cell* offsets to apply at render time.
 *
 * @param {number} i segment index
 * @param {number} len total segments
 * @param {number} tSec absolute time in seconds
 * @param {number[]} dir unit-ish direction vector [x,y]
 * @param {number[]} perp perpendicular vector [x,y]
 * @param {number} seed01 stable 0..1 seed per organ instance
 */
export function wormOffset(i, len, tSec, dir, perp, seed01=0){
  if (!dir || !perp || len <= 1) return { x: 0, y: 0 };
  const cfg = WORM.anim || {};

  const denom = Math.max(1, len - 1);
  const u = i / denom; // 0..1 from base to tip

  // Small at the base, stronger at the tip.
  const tipAmp = Math.pow(u, Number.isFinite(cfg.ampPow) ? cfg.ampPow : 1.6);

  // Per-organ stable cycle in [10..13] seconds.
  const wiggleRange = Array.isArray(cfg.wiggleSec) ? cfg.wiggleSec : [10, 13];
  const wiggleSec = lerp(wiggleRange[0] ?? 10, wiggleRange[1] ?? 13, clamp01(seed01));
  const phase = (tSec * (2 * Math.PI / Math.max(0.1, wiggleSec))) + seed01 * 6.17;

  // Coil factor ramps up with length, so ~20 blocks can "lock" into a curl.
  const coilLen = Number.isFinite(cfg.coilLen) ? cfg.coilLen : 20;
  const coilK = clamp01((len - 6) / Math.max(1, coilLen));

  // Number of bends along the length.
  const bends = lerp(cfg.bendsMin ?? 1.6, cfg.bendsMax ?? 2.5, coilK);

  // Lateral wave: a main wave + a subtle harmonic so it looks less "perfect".
  const wave1 = Math.sin(phase + u * (2 * Math.PI * bends));
  const wave2 = 0.35 * Math.sin(phase * 1.85 + u * (2 * Math.PI * (bends * 0.72)) + 1.3);
  const wave = 0.72 * wave1 + 0.28 * wave2;

  const latMax = Number.isFinite(cfg.latMaxCells) ? cfg.latMaxCells : 1.15;
  const latAmp = latMax * (0.38 + 0.62 * coilK) * tipAmp;
  const lateral = wave * latAmp;

  // Slight axial motion (peristalsis feel). Kept subtle to avoid visual "teleport".
  const axialFrac = Number.isFinite(cfg.axialFrac) ? cfg.axialFrac : 0.22;
  const axial = Math.sin(phase * 0.92 - u * (2 * Math.PI * (bends * 0.55))) * (axialFrac * latAmp);

  // Twist rotates the perpendicular a bit: helps the tip curl in a ring.
  const twistMax = Number.isFinite(cfg.twistRadMax) ? cfg.twistRadMax : 0.55;
  const twist = twistMax * coilK * Math.sin(phase * 0.78 + u * (2 * Math.PI * 1.15) + seed01 * 3.1);
  const cos = Math.cos(twist);
  const sin = Math.sin(twist);
  const rx = perp[0] * cos - perp[1] * sin;
  const ry = perp[0] * sin + perp[1] * cos;

  return {
    x: rx * lateral + dir[0] * axial,
    y: ry * lateral + dir[1] * axial
  };
}
