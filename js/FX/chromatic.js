// js/FX/chromatic.js
// Radial chromatic aberration: sample R and B from slightly shifted UVs.

export function chromaticOffsets(x, y, strength = 1.25){
  // x,y are in normalized [-1..1] space (after distortion mapping),
  // pointing from center to current pixel.
  // strength is in pixels (to be scaled to UV by the caller).
  const len = Math.hypot(x, y) || 1;
  const nx = x / len;
  const ny = y / len;

  // Red outwards, Blue inwards, Green stays.
  return {
    r: { dx:  nx * strength, dy:  ny * strength },
    g: { dx:  0,           dy:  0 },
    b: { dx: -nx * strength, dy: -ny * strength },
  };
}
