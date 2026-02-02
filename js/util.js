export const GRID_W = 36;
export const GRID_H = 18;

export const BAR_MAX = 1.4;
export const MAX_LOG = 180;

export const PALETTES = [
  { body: "#fbbf24", accent: "#22d3ee", eye: "#a3e635", core: "#f472b6" },
  { body: "#60a5fa", accent: "#fca5a5", eye: "#fef08a", core: "#34d399" },
  { body: "#fda4af", accent: "#c4b5fd", eye: "#67e8f9", core: "#f59e0b" },
  { body: "#a7f3d0", accent: "#fde68a", eye: "#fda4af", core: "#93c5fd" },
  { body: "#fde68a", accent: "#93c5fd", eye: "#f472b6", core: "#34d399" },
];

export const DIR8 = [
  [1,0],[-1,0],[0,1],[0,-1],
  [1,1],[1,-1],[-1,1],[-1,-1]
];


export function mulberry32(seed) {
  let t = seed >>> 0;
  return function() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash32(seed, n){
  let x = (seed ^ (n*0x9E3779B1)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

export function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }
export function clamp01(x){ return clamp(x,0,1); }
export function nowSec(){ return Math.floor(Date.now()/1000); }
export function pick(rng, arr){ return arr[Math.floor(rng()*arr.length)]; }

export function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

export function fmtAgeSeconds(sec){
  if (sec < 60) return `${sec}с`;
  const m = Math.floor(sec/60);
  if (m < 60) return `${m}м`;
  const h = Math.floor(m/60);
  const mm = m%60;
  return `${h}ч ${mm}м`;
}

export function key(x,y){ return `${x},${y}`; }
export function parseKey(k){ const [x,y]=k.split(",").map(Number); return [x,y]; }

export function barPct(x){
  return Math.round(clamp(x, 0, BAR_MAX)*100);
}
