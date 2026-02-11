// js/organs/_thickness.js
// Visual-only thickness helpers for appendages.
// These rules MUST NOT affect simulation (growth/occupancy). Render uses them to
// optionally draw lateral "support" blocks when there is free space.

// Always thin.
export function thicknessNone(){
  return 1;
}

// Profile used for tentacles and similar appendages:
// - if len < minLen => thin
// - first `midFrac` of the length => level 2
// - rest => level 1
export function thicknessBulkyBase(i, len, opts = {}){
  const {
    minLen = 6,
    midFrac = 2/3,
    thickLevel = 2,
    thinLevel = 1
  } = opts;

  if (!Number.isFinite(len) || len < minLen) return thinLevel;
  const midZone = Math.max(1, Math.floor(len * midFrac));
  return i < midZone ? thickLevel : thinLevel;
}

// Tail-style: if it is "long enough", keep it thick along the whole length.
export function thicknessTail(i, len, opts = {}){
  const { minLen = 4, thickLevel = 2, thinLevel = 1 } = opts;
  if (!Number.isFinite(len) || len < minLen) return thinLevel;
  return thickLevel;
}

// Claw-style: thickest in the middle, thin at edges.
export function thicknessClaw(i, len, opts = {}){
  const {
    minLen = 3,
    maxThickness = 2,
    innerFrac = 0.2,
    midFrac = 0.35
  } = opts;
  if (!Number.isFinite(len) || len < minLen) return 1;

  const mid = (len - 1) / 2;
  const dist = Math.abs(i - mid);
  if (dist <= len * innerFrac) return maxThickness;
  if (dist <= len * midFrac) return Math.min(2, maxThickness);
  return 1;
}
