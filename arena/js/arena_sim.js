// Arena simulation: orbital physics + contact damage + honor.

import { cellPx } from './arena_render.js';

export const ARENA_DEFAULTS = {
  sunG: 3800,
  bodyG: 900,
  spaceDrag: 0.002,
  contactDrag: 0.04,
  // Grapple / tentacles
  grappleBase: 0.8,
  tentacleHoldBoost: 0.9,
  tentacleDragBoost: 0.9,
  // Damage
  kDamage: 0.22,
  v0: 60,
  speedCap: 2.0,
  spikeDamageMult: 1.25,
  shellDamageReduction: 0.7,
  // Tail impulse (orbit kick)
  tailImpulse: 18,
  // Contact response
  restitution: 0.10, // small bounce
  separation: 8.0,   // positional push-out strength

  minBlocksKO: 20,
  honorWin: 100,
  honorDamage: 0.06,
};

export function initMatch(arena){
  arena.mode = 'match';
  arena.resultText = '';
  arena.time.t = 0;

  const cx = arena.worldW/2;
  const cy = arena.worldH/2;
  // Sun in CELL units
  arena.sun = { x: cx, y: cy };

  const A = arena.fighters[0];
  const B = arena.fighters[1];

  // Starting orbits
  const startRA = 180;
  const startRB = 220;

  // Positions are in CELL units
  A.transform.pos = { x: cx - startRA, y: cy };
  B.transform.pos = { x: cx + startRB, y: cy };

  // Velocity perpendicular for orbit-ish motion
// === ORBITAL SPEED CALC ===
const dxA = A.transform.pos.x - cx;
const dyA = A.transform.pos.y - cy;
const rA2 = dxA*dxA + dyA*dyA;
const rA = Math.sqrt(rA2);

const dxB = B.transform.pos.x - cx;
const dyB = B.transform.pos.y - cy;
const rB2 = dxB*dxB + dyB*dyB;
const rB = Math.sqrt(rB2);

// v = sqrt(G / r)
const vA = Math.sqrt(arena.params.sunG / Math.max(1, rA));
const vB = Math.sqrt(arena.params.sunG / Math.max(1, rB));

// tangent vectors (perpendicular to radius)
A.transform.vel = {
  x: -dyA / rA * vA,
  y:  dxA / rA * vA
};

B.transform.vel = {
  x: -dyB / rB * vB,
  y:  dxB / rB * vB
};
  resetCombat(A);
  resetCombat(B);

  rebuildWorldCells(arena);
}

function orbitSpeedScale(mass){
  // small faster, big slower
  return clamp(1.15 - Math.log10(Math.max(10,mass))/4, 0.55, 1.15);
}

function resetCombat(f){
  f.alive = true;
  f.stats.damageDealt = 0;
  f.stats.damageTaken = 0;
  f.stats.contactFrames = 0;
  f.combat.grappleTimer = 0;
  f.combat.contactDragMult = 1.0;
  f.combat.damageCarry = 0;
}

export function stepArena(arena, dt){
  if(arena.mode !== 'match') return;
  arena.time.t += dt;

  const A = arena.fighters[0];
  const B = arena.fighters[1];
  if(!A?.alive || !B?.alive){
    finish(arena);
    return;
  }

  // Physics
  applyForces(arena, A, B, dt);
  applyForces(arena, B, A, dt);

  // Integrate
  integrate(A, dt, arena);
  integrate(B, dt, arena);

  // Contact + damage
  const contact = detectContact(arena, A, B);
  if(contact.contactPairs > 0){
    resolveContact(arena, A, B, contact, dt);
  }

  // KO check
  if(A.mass <= arena.params.minBlocksKO){ A.alive = false; }
  if(B.mass <= arena.params.minBlocksKO){ B.alive = false; }

  if(!A.alive || !B.alive){
    finish(arena);
  }

  rebuildWorldCells(arena);
}

function applyForces(arena, self, other, dt){
  const p = self.transform.pos;
  const v = self.transform.vel;

  const toSunX = arena.sun.x - p.x;
  const toSunY = arena.sun.y - p.y;
  const r2s = toSunX*toSunX + toSunY*toSunY + 1200;
  const invRs = 1/Math.sqrt(r2s);
  const dirSx = toSunX * invRs;
  const dirSy = toSunY * invRs;

  // mutual gravity
  const toOx = other.transform.pos.x - p.x;
  const toOy = other.transform.pos.y - p.y;
  const r2o = toOx*toOx + toOy*toOy + 2400;
  const invRo = 1/Math.sqrt(r2o);
  const dirOx = toOx * invRo;
  const dirOy = toOy * invRo;

  // heavier attracts more, but acceleration divides by self.mass
  const accSun = arena.params.sunG / r2s;
  const accMut = arena.params.bodyG * (other.mass/Math.max(1,self.mass)) / r2o;

  v.x += (dirSx*accSun + dirOx*accMut) * dt;
  v.y += (dirSy*accSun + dirOy*accMut) * dt;

  // space drag
  v.x *= (1 - arena.params.spaceDrag);
  v.y *= (1 - arena.params.spaceDrag);
}

function integrate(f, dt, arena){
  const p = f.transform.pos;
  const v = f.transform.vel;

  // contact friction during grapple
  if(f.combat.grappleTimer > 0){
    const cd = arena.params.contactDrag * (Number.isFinite(f.combat.contactDragMult) ? f.combat.contactDragMult : 1.0);
    v.x *= (1 - cd);
    v.y *= (1 - cd);
    f.combat.grappleTimer = Math.max(0, f.combat.grappleTimer - dt);
    if(f.combat.grappleTimer === 0) f.combat.contactDragMult = 1.0;
  }

  p.x += v.x * dt;
  p.y += v.y * dt;

  // clamp into view (CELL units)
  p.x = clamp(p.x, 10, arena.worldW-10);
  p.y = clamp(p.y, 10, arena.worldH-10);
}


function bumpHit(hit, type){
  const t = String(type || '').toLowerCase();
  if(!t) return;
  if(t.includes('spike')) hit.spike++;
  else if(t.includes('shell')) hit.shell++;
  else if(t.includes('tentacle') || t.includes('tent') || t.includes('whip')) hit.tentacle++;
  else if(t.includes('tail')) hit.tail++;
}

function detectContact(arena, A, B){
  // quick circle check
  const dx0 = (A.transform.pos.x + A.geom.center.x) - (B.transform.pos.x + B.geom.center.x);
  const dy0 = (A.transform.pos.y + A.geom.center.y) - (B.transform.pos.y + B.geom.center.y);
  const d2 = dx0*dx0 + dy0*dy0;
  const r0 = A.geom.radius + B.geom.radius + 6;
  if(d2 > r0*r0){
    return {
      contactPairs: 0,
      pairs: [],
      hitA: { spike:0, shell:0, tentacle:0, tail:0 },
      hitB: { spike:0, shell:0, tentacle:0, tail:0 },
      normal: {x:0,y:0},
      vIn: 0
    };
  }

  // cell-level contact using buckets for B
  const bucketSize = 8; // in cells
  const map = new Map();
  for(const c of B.geom.cells){
    const wx = Math.round(c.x + B.transform.pos.x);
    const wy = Math.round(c.y + B.transform.pos.y);
    const bx = Math.floor(wx / bucketSize);
    const by = Math.floor(wy / bucketSize);
    const key = bx+','+by;
    let arr = map.get(key);
    if(!arr){ arr=[]; map.set(key,arr); }
    arr.push([wx,wy,c]);
  }

  let pairs = 0;
  let nx=0, ny=0;
  const outPairs = [];
  const hitA = { spike:0, shell:0, tentacle:0, tail:0 };
  const hitB = { spike:0, shell:0, tentacle:0, tail:0 };

  for(const ca of A.geom.cells){
    const ax = Math.round(ca.x + A.transform.pos.x);
    const ay = Math.round(ca.y + A.transform.pos.y);
    const bx0 = Math.floor(ax / bucketSize);
    const by0 = Math.floor(ay / bucketSize);

    let found = null;
    for(let dxB=-1; dxB<=1 && !found; dxB++){
      for(let dyB=-1; dyB<=1 && !found; dyB++){
        const arr = map.get((bx0+dxB)+','+(by0+dyB));
        if(!arr) continue;
        for(const [bx,by,cb] of arr){
          const md = manhattan(ax,ay,bx,by);
          if(md === 0 || md === 1){
            found = { ax, ay, bx, by, ca, cb };
            break;
          }
        }
      }
    }

    if(found){
      pairs++;
      nx += (found.ax - found.bx);
      ny += (found.ay - found.by);
      outPairs.push(found);

      // collect organ hit stats (per-side contact cells)
      bumpHit(hitA, found.ca?.type || found.ca?.t || found.ca?.kind);
      bumpHit(hitB, found.cb?.type || found.cb?.t || found.cb?.kind);
    }
  }

  if(pairs === 0){
    return {
      contactPairs: 0,
      pairs: [],
      hitA: { spike:0, shell:0, tentacle:0, tail:0 },
      hitB: { spike:0, shell:0, tentacle:0, tail:0 },
      normal: {x:0,y:0},
      vIn: 0
    };
  }

  // normal based on average direction A->B
  const inv = 1/Math.max(1, Math.hypot(nx,ny));
  const normal = { x: nx*inv, y: ny*inv };

  const rvx = A.transform.vel.x - B.transform.vel.x;
  const rvy = A.transform.vel.y - B.transform.vel.y;
  const vIn = Math.max(0, rvx*normal.x + rvy*normal.y);

  // downsample pairs to keep damage selection fast
  const MAX_PAIRS = 64;
  let pairsLite = outPairs;
  if(outPairs.length > MAX_PAIRS){
    const step = Math.ceil(outPairs.length / MAX_PAIRS);
    pairsLite = [];
    for(let i=0;i<outPairs.length;i+=step) pairsLite.push(outPairs[i]);
  }

  return { contactPairs: pairs, pairs: pairsLite, hitA, hitB, normal, vIn };
}
function resolveContact(arena, A, B, contact, dt){
  A.stats.contactFrames++;
  B.stats.contactFrames++;

  const attackMultA = 1 + clamp(contact.vIn / arena.params.v0, 0, arena.params.speedCap);
  const attackMultB = 1 + clamp(contact.vIn / arena.params.v0, 0, arena.params.speedCap);

  // Organ mods (PvP):
  // - spikes: bonus only if spikes were in the contact cells
  // - shell: reduces damage only if shell cells were hit
  const modA = getAttackMod(A, contact.hitA, arena) * getDefenseMod(B, contact.hitB, arena);
  const modB = getAttackMod(B, contact.hitB, arena) * getDefenseMod(A, contact.hitA, arena);

  const rawToB = (contact.contactPairs * arena.params.kDamage * attackMultA * modA);
  const rawToA = (contact.contactPairs * arena.params.kDamage * attackMultB * modB);

  // Carry fractional damage so low-speed clinches still deal damage over time.
  B.combat.damageCarry = (B.combat.damageCarry || 0) + rawToB;
  A.combat.damageCarry = (A.combat.damageCarry || 0) + rawToA;
  const dmgToB = Math.floor(B.combat.damageCarry);
  const dmgToA = Math.floor(A.combat.damageCarry);
  if(dmgToB>0) B.combat.damageCarry -= dmgToB;
  if(dmgToA>0) A.combat.damageCarry -= dmgToA;

  if(dmgToB>0) applyDamage(arena, B, dmgToB, contact, 'B');
  if(dmgToA>0) applyDamage(arena, A, dmgToA, contact, 'A');

  A.stats.damageDealt += dmgToB;
  B.stats.damageTaken += dmgToB;
  B.stats.damageDealt += dmgToA;
  A.stats.damageTaken += dmgToA;

  // === Grapple / hold (tentacles) ===
  const tentacleInvolved = (contact.hitA.tentacle > 0) || (contact.hitB.tentacle > 0);
  if(contact.contactPairs > 0 && tentacleInvolved){
    const base = arena.params.grappleBase;
    const extra = arena.params.tentacleHoldBoost;
    const t = base + extra;
    A.combat.grappleTimer = Math.max(A.combat.grappleTimer, t);
    B.combat.grappleTimer = Math.max(B.combat.grappleTimer, t);

    // increase contact drag when tentacles are involved
    const mult = tentacleInvolved ? (1 + arena.params.tentacleDragBoost) : 1.0;
    A.combat.contactDragMult = Math.max(A.combat.contactDragMult || 1.0, mult);
    B.combat.contactDragMult = Math.max(B.combat.contactDragMult || 1.0, mult);
  }

  // === Tail orbit-kick ===
  // If tail cell is in contact (attacker side), apply tangential impulse to the OTHER fighter.
  if(contact.hitA.tail > 0) applyTailKick(arena, A, B, contact);
  if(contact.hitB.tail > 0) applyTailKick(arena, B, A, contact);

  // === Contact response: slide + tiny bounce + push-out ===
  const nx = contact.normal.x;
  const ny = contact.normal.y;

  const rvx = A.transform.vel.x - B.transform.vel.x;
  const rvy = A.transform.vel.y - B.transform.vel.y;

  // relative normal velocity (A vs B)
  const vn = rvx*nx + rvy*ny;

  // 1) Cancel inward motion to enable sliding, add small bounce (restitution)
  if(vn < 0){
    // Remove penetration velocity fully, then bounce a bit
    const e = arena.params.restitution;
    const j = -(1 + e) * vn;

    // Mass-weighted impulse distribution
    const invMA = 1/Math.max(1, A.mass);
    const invMB = 1/Math.max(1, B.mass);
    const invSum = invMA + invMB;

    const jA = j * (invMA / invSum);
    const jB = j * (invMB / invSum);

    A.transform.vel.x += nx * jA;
    A.transform.vel.y += ny * jA;

    B.transform.vel.x -= nx * jB;
    B.transform.vel.y -= ny * jB;
  }

  // 2) Positional push-out so they don't "glue" via overlap
  // We don't have exact penetration depth, so we push a tiny amount per contact frame.
  const push = arena.params.separation * clamp(contact.contactPairs / 24, 0.25, 2.0);

  const invMA2 = 1/Math.max(1, A.mass);
  const invMB2 = 1/Math.max(1, B.mass);
  const invSum2 = invMA2 + invMB2;

  const pA = push * (invMA2 / invSum2);
  const pB = push * (invMB2 / invSum2);

  A.transform.pos.x += nx * pA * dt;
  A.transform.pos.y += ny * pA * dt;

  B.transform.pos.x -= nx * pB * dt;
  B.transform.pos.y -= ny * pB * dt;
}
function getAttackMod(f, hit, arena){
  // Spikes: bonus ONLY if spike cells were in contact on attacker side.
  if(hit?.spike > 0) return arena.params.spikeDamageMult;
  return 1.0;
}

function getDefenseMod(target, hit, arena){
  // Shell: reduce damage ONLY if the impact landed on shell cells of the target.
  if(hit?.shell > 0) return arena.params.shellDamageReduction;
  return 1.0;
}

function applyTailKick(arena, attacker, other, contact){
  // Tangent around the sun at OTHER position.
  const ox = other.transform.pos.x + other.geom.center.x;
  const oy = other.transform.pos.y + other.geom.center.y;
  const toSunX = arena.sun.x - ox;
  const toSunY = arena.sun.y - oy;
  const len = Math.max(1e-6, Math.hypot(toSunX, toSunY));
  // tangent (perp to radius)
  const tx = -toSunY / len;
  const ty =  toSunX / len;

  // decide direction based on relative motion along tangent
  const rvx = attacker.transform.vel.x - other.transform.vel.x;
  const rvy = attacker.transform.vel.y - other.transform.vel.y;
  const sign = Math.sign(rvx*tx + rvy*ty) || 1;

  const kick = arena.params.tailImpulse * clamp(contact.vIn / Math.max(1, arena.params.v0), 0, 1) * sign;

  other.transform.vel.x += tx * kick;
  other.transform.vel.y += ty * kick;

  // slight counter-impulse for stability (optional)
  attacker.transform.vel.x -= tx * kick * 0.15;
  attacker.transform.vel.y -= ty * kick * 0.15;
}

function applyDamage(arena, target, dmg, contact, targetId){
  const n = Math.min(dmg, target.geom.cells.length);
  if(n <= 0) return;

  // Build list of contact points for THIS target in world coords.
  // contact.pairs contains entries {ax,ay,bx,by,ca,cb}
  const pts = [];
  for(const p of (contact?.pairs || [])){
    if(targetId === 'A'){
      // target is A => use ax,ay
      pts.push([p.ax, p.ay]);
    }else{
      // target is B => use bx,by
      pts.push([p.bx, p.by]);
    }
  }
  // Fallback: if for some reason no points, just remove from "front" along normal.
  // But in normal flow pts should exist when dmg>0.
  removeCellsNearWorldPoints(target, pts, n);

  target.mass = target.geom.cells.length;
  pruneIslands(target.geom);
  recomputeGeom(target.geom);
}

function removeCellsNearWorldPoints(target, pts, n){
  const ox = target.transform.pos.x;
  const oy = target.transform.pos.y;

  // precompute pts (cap for perf)
  const P = (pts && pts.length) ? pts.slice(0, 64) : null;

  // Score each cell by distance to nearest contact point.
  // Remove the ones with the smallest distance (i.e., right at the impact zone).
  const scored = [];
  for(let i=0;i<target.geom.cells.length;i++){
    const c = target.geom.cells[i];
    const wx = Math.round(c.x + ox);
    const wy = Math.round(c.y + oy);

    let d = 999999;
    if(P){
      for(const [px,py] of P){
        const md = Math.abs(wx-px) + Math.abs(wy-py);
        if(md < d) d = md;
        if(d === 0) break;
      }
    }else{
      // if no pts, remove outermost cells by radius from center
      const dx = c.x - target.geom.center.x;
      const dy = c.y - target.geom.center.y;
      d = -Math.hypot(dx,dy); // negative so outermost removed first
    }

    // small jitter to avoid always removing the same line
    scored.push({ i, d: d + Math.random()*0.02 });
  }

  scored.sort((a,b)=>a.d-b.d);
  const kill = new Set();
  for(let k=0;k<n && k<scored.length;k++){
    kill.add(scored[k].i);
  }
  target.geom.cells = target.geom.cells.filter((_, idx)=>!kill.has(idx));
}

function pruneIslands(geom){
  // Keep only the largest connected component (4-neighbors).
  // This matches the spec: detached islands are removed immediately.
  const cells = geom.cells;
  if(cells.length <= 1) return;

  const idxByKey = new Map();
  for(let i=0;i<cells.length;i++){
    idxByKey.set(cells[i].x+','+cells[i].y, i);
  }

  const seen = new Uint8Array(cells.length);
  const comps = [];

  for(let i=0;i<cells.length;i++){
    if(seen[i]) continue;
    const q = [i];
    seen[i]=1;
    const comp = [];
    while(q.length){
      const j = q.pop();
      comp.push(j);
      const c = cells[j];
      const nb = [
        (c.x+1)+','+c.y,
        (c.x-1)+','+c.y,
        c.x+','+(c.y+1),
        c.x+','+(c.y-1)
      ];
      for(const k of nb){
        const ni = idxByKey.get(k);
        if(ni === undefined) continue;
        if(seen[ni]) continue;
        seen[ni]=1;
        q.push(ni);
      }
    }
    comps.push(comp);
  }

  if(comps.length <= 1) return;
  comps.sort((a,b)=>b.length-a.length);
  const keep = new Set(comps[0]);
  geom.cells = cells.filter((_,i)=>keep.has(i));
}
function finish(arena){
  arena.mode = 'finished';
  const A = arena.fighters[0];
  const B = arena.fighters[1];
  const winner = (A.alive && !B.alive) ? A : ((!A.alive && B.alive) ? B : null);

  if(!winner){
    arena.resultText = 'Draw';
    arena.winnerId = null;
    return;
  }
  arena.winnerId = winner.id;

  // Honor: win + damage
  const honorAdd = arena.params.honorWin + Math.round(winner.stats.damageDealt * arena.params.honorDamage);
  winner.meta.wins = (winner.meta.wins|0) + 1;
  winner.meta.honor = (winner.meta.honor|0) + honorAdd;

  arena.resultText = `${winner.name} wins (+${honorAdd} honor)`;
}

export function rebuildWorldCells(arena){
  const px = cellPx();
  for(const f of arena.fighters){
    if(!f) continue;
    if(!f.alive){ f.worldCells = []; continue; }
    const out=[];
    const ox = f.transform.pos.x;
    const oy = f.transform.pos.y;
    for(const c of f.geom.cells){
      // treat c.x/c.y as world-cell units
      const wx = Math.round(c.x + ox);
      const wy = Math.round(c.y + oy);
      out.push({
        px: wx * px,
        py: wy * px,
        type: c.type || c.t || c.kind || 'body'
      });
    }
    f.worldCells = out;
  }
}

export function recomputeGeom(geom){
  // bbox, center, radius, flags
  let minx=1e9, miny=1e9, maxx=-1e9, maxy=-1e9;
  let sx=0, sy=0;
  for(const c of geom.cells){
    if(c.x<minx) minx=c.x; if(c.y<miny) miny=c.y;
    if(c.x>maxx) maxx=c.x; if(c.y>maxy) maxy=c.y;
    sx += c.x; sy += c.y;
  }
  const n = Math.max(1, geom.cells.length);
  const cx = sx/n, cy = sy/n;
  let r=0;
  for(const c of geom.cells){
    const dx=c.x-cx, dy=c.y-cy;
    const d=Math.hypot(dx,dy);
    if(d>r) r=d;
  }
  geom.bbox = { minx, miny, maxx, maxy };
  geom.center = { x: cx, y: cy };
  geom.radius = r;
}

export function normalizeFromCapsule(organismState){
  // Convert a Symbiochi organism state into arena geom.
  // Supports cells stored as:
  //  - [{x,y}, ...]
  //  - [[x,y], ...]  (main game format)
  //  - ["x,y", ...]
  const cells = [];

  const pushCell = (x,y,type)=>{
    if(!Number.isFinite(x) || !Number.isFinite(y)) return;
    cells.push({ x: x|0, y: y|0, type: type || 'body' });
  };

  const normList = (lst, type)=>{
    if(!Array.isArray(lst)) return;
    for(const c of lst){
      if(!c) continue;
      if(Array.isArray(c) && c.length >= 2){
        pushCell(c[0], c[1], type);
      }else if(typeof c === 'object' && Number.isFinite(c.x) && Number.isFinite(c.y)){
        pushCell(c.x, c.y, type);
      }else if(typeof c === 'string'){
        const m = /^(-?\d+)\s*,\s*(-?\d+)$/.exec(c.trim());
        if(m) pushCell(m[1]|0, m[2]|0, type);
      }
    }
  };

  // body
  const bodyCells = organismState?.body?.cells || organismState?.body?.blocks || organismState?.body?.cellsPacked || [];
  normList(bodyCells, 'body');

  // modules
  const mods = Array.isArray(organismState?.modules) ? organismState.modules : [];
  let hasShell=false, hasSpike=false, hasTentacle=false, hasTail=false;

  for(const m of mods){
    const tRaw = String(m?.type || m?.t || '').toLowerCase();
    const t = tRaw || 'organ';
    if(t === 'shell') hasShell=true;
    if(t === 'spike') hasSpike=true;
    if(t.includes('tentacle') || t === 'tentacle') hasTentacle=true;
    if(t.includes('tail') || t === 'tail') hasTail=true;

    const mCells =
      (Array.isArray(m?.cells) ? m.cells :
      (Array.isArray(m?.blocks) ? m.blocks :
      (Array.isArray(m?.bodyCells) ? m.bodyCells : null)));

    if(mCells) normList(mCells, t);
  }

  // De-dup by coordinate: prefer non-body types over body
  const byKey = new Map();
  for(const c of cells){
    const k = c.x+','+c.y;
    const prev = byKey.get(k);
    if(!prev){
      byKey.set(k, c);
    }else{
      if(prev.type === 'body' && c.type !== 'body') byKey.set(k, c);
    }
  }
  const uniq = Array.from(byKey.values());

  // Recenter coordinates so fighter fits in arena.
  // Main game stores absolute coords; arena expects local coords around (0,0).
  let anchorX = 0, anchorY = 0;
  if(Array.isArray(organismState?.body?.core) && organismState.body.core.length >= 2){
    anchorX = organismState.body.core[0] | 0;
    anchorY = organismState.body.core[1] | 0;
  } else if(uniq.length){
    let sx=0, sy=0;
    for(const c of uniq){ sx += c.x; sy += c.y; }
    anchorX = Math.round(sx/uniq.length);
    anchorY = Math.round(sy/uniq.length);
  }
  for(const c of uniq){ c.x = (c.x - anchorX) | 0; c.y = (c.y - anchorY) | 0; }


  const geom = {
    cells: uniq,
    modules: mods,
    hasShell, hasSpike, hasTentacle, hasTail,
    bbox:null, center:{x:0,y:0}, radius:0
  };
  recomputeGeom(geom);
  return geom;
}
function manhattan(ax,ay,bx,by){
  return Math.abs(ax-bx) + Math.abs(ay-by);
}
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
