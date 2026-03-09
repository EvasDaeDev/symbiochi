// js/FX/barrel.js
// Simple CRT-like barrel distortion in screen space.
// Returns source UV (0..1) for a given output UV (0..1).
//
// IMPORTANT:
// - We compensate aspect ratio so distortion is centered and symmetric on non-square canvases.
// - Center can be shifted (e.g. if you later want distortion around a sub-viewport).

export function barrelMap(
  u,
  v,
  k = 0.06,
  aspect = 1,
  cx = 0.53,
  cy = 0.47,
){
  // Map [0..1] -> [-1..1] around custom center
  let x = (u - cx) * 2;
  let y = (v - cy) * 2;

  // Aspect compensation (so “radius” is circular in screen space)
  x *= aspect;

  const r2 = x*x + y*y;

  // Barrel distortion (inverse mapping for sampling)
  const f = 1 + k * r2;
  let sx = x / f;
  const sy = y / f;

  // Undo aspect
  sx /= aspect;

  // Back to [0..1]
  return {
    u: (sx * 0.5) + cx,
    v: (sy * 0.5) + cy,
    r2,
    // direction vector in aspect-compensated space (for radial effects like chromatic aberration)
    x: x / Math.max(1e-6, Math.sqrt(r2)),
    y: y / Math.max(1e-6, Math.sqrt(r2)),
  };
}
