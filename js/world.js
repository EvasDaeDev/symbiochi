export const GRID_W = 36;
export const GRID_H = 18;

export const BAR_MAX = 1.4;
export const MAX_LOG = 180;

export const CARROT_BODY_RANGE = 15;

export const PALETTES = [
  { body: "#fbbf24", accent: "#22d3ee", eye: "#a3e635", core: "#f472b6" },
  { body: "#60a5fa", accent: "#fca5a5", eye: "#fef08a", core: "#34d399" },
  { body: "#fda4af", accent: "#c4b5fd", eye: "#67e8f9", core: "#f59e0b" },
  { body: "#a7f3d0", accent: "#fde68a", eye: "#fda4af", core: "#93c5fd" },
  { body: "#fde68a", accent: "#93c5fd", eye: "#f472b6", core: "#34d399" },
];

// dir8 vectors in world grid coordinates (screen-like Y grows downward)
// Index convention used across the project:
// 0:E, 1:NE, 2:N, 3:NW, 4:W, 5:SW, 6:S, 7:SE
export const DIR8 = [
  [ 1, 0],
  [ 1,-1],
  [ 0,-1],
  [-1,-1],
  [-1, 0],
  [-1, 1],
  [ 0, 1],
  [ 1, 1],
];
