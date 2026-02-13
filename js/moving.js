// js/moving.js
// Grid-true organism movement (dir8) with smooth *render-time* gait.
//
// Key rules:
// - World geometry stays integer-cell based and is ONLY shifted by whole-cell steps.
// - Steps are executed as a "gait" animation: front moves first, back catches up.
// - No canvas rotation: heading is stored as dir8 + deg for logic/face orientation.
// - During gait, render.js deforms the drawing without changing state geometry.
// - While moving => breathMul = 2.
//
// Stored in: view.moving.org[orgId]
// where orgId = 0 for parent, orgId = i+1 for buds.

// (no util imports required here)

// Angle helpers (modulo 180°, no front/back)
function norm180(a){
  a = ((a % 180) + 180) % 180;
  if (a >= 90) a -= 180;
  return a;
}
function angleDeltaHalfTurn(fromDeg, toDeg){
  return norm180(toDeg - fromDeg);
}

function snapCell(v){ return Math.round(v); }

// dir8 helpers
// 0:E, 1:NE, 2:N, 3:NW, 4:W, 5:SW, 6:S, 7:SE
const DIR8 = [
  [ 1, 0],
  [ 1,-1],
  [ 0,-1],
  [-1,-1],
  [-1, 0],
  [-1, 1],
  [ 0, 1],
  [ 1, 1],
];

function vecToDir8(dx, dy){
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (sx === 0 && sy === 0) return null;
  // map (sx,sy) to dir8 index
  for (let i=0;i<8;i++){
    if (DIR8[i][0] === sx && DIR8[i][1] === sy) return i;
  }
  return 0;
}

function axisSteps(curAxis, wantAxis){
  const d = (wantAxis - curAxis + 4) & 3;
  if (d === 0) return 0;
  if (d === 2) return 2;
  return 1;
}

// Choose a movement dir8 that (1) progresses toward the target and (2) minimizes
// the number of required *axis* turns (mod 180°). This prevents heading jitter
// on non-cardinal targets where the naive sign-based dir can flip each cycle.
function chooseMoveDir8Stable(ddx, ddy, curHeadingDir8){
  const sx = Math.sign(ddx);
  const sy = Math.sign(ddy);
  if (sx === 0 && sy === 0) return null;

  const cur = ((curHeadingDir8|0)%8+8)%8;
  const curAxis = dir8ToAxis4(cur);

  // Candidate move vectors that reduce Chebyshev distance.
  const cand = [];
  if (sx !== 0) cand.push([sx, 0]);
  if (sy !== 0) cand.push([0, sy]);
  if (sx !== 0 && sy !== 0) cand.push([sx, sy]);

  let best = null;
  let bestCost = Infinity;

  for (const [mx, my] of cand){
    const d8 = vecToDir8(mx, my);
    if (d8 === null) continue;
    const wantAxis = dir8ToAxis4(d8);
    const turns = axisSteps(curAxis, wantAxis);
    // Progress metric: new Chebyshev distance after taking this step.
    const nd = Math.max(Math.abs(ddx - mx), Math.abs(ddy - my));
    // Prefer fewer turns strongly, then better progress, then diagonal (looks nicer).
    const diag = (mx !== 0 && my !== 0) ? -0.05 : 0;
    const cost = turns * 10 + nd + diag;
    if (cost < bestCost){
      bestCost = cost;
      best = d8;
    }
  }

  // Fallback to naive.
  return best ?? vecToDir8(ddx, ddy);
}

// Choose the actual dir8 step given a dir16 "intention" direction.
// This keeps the world movement on dir8, while allowing finer control (dir16)
// for turning/intent decisions.
function chooseMoveDir8FromDir16(ddx, ddy, curHeadingDir8, wantDir16){
  if (wantDir16 === null) return chooseMoveDir8Stable(ddx, ddy, curHeadingDir8);

  const d16 = ((wantDir16|0) % 16 + 16) % 16;
  const primary = Math.floor(d16 / 2) % 8;
  const secondary = (d16 % 2) ? ((primary + 1) % 8) : null;

  const cur = ((curHeadingDir8|0)%8+8)%8;
  const curAxis = dir8ToAxis4(cur);

  const cand = [primary];
  if (secondary !== null) cand.push(secondary);

  let best = null;
  let bestCost = Infinity;
  for (const d8 of cand){
    const v = DIR8[d8];
    const mx = v[0];
    const my = v[1];
    // Must progress (reduce Chebyshev distance) to be considered.
    const nd = Math.max(Math.abs(ddx - mx), Math.abs(ddy - my));
    const cd = Math.max(Math.abs(ddx), Math.abs(ddy));
    if (nd > cd) continue;

    const wantAxis = dir8ToAxis4(d8);
    const turns = axisSteps(curAxis, wantAxis);
    const diag = (mx !== 0 && my !== 0) ? -0.05 : 0;
    const cost = turns * 10 + nd + diag;
    if (cost < bestCost){
      bestCost = cost;
      best = d8;
    }
  }

  return best ?? chooseMoveDir8Stable(ddx, ddy, curHeadingDir8);
}

function dir8ToDeg(d){
  const dd = ((d|0) % 8 + 8) % 8;
  return dd * 45;
}

// dir16 helpers (for intention only)
// 16 directions at 22.5° increments.
function dir16ToDeg(d16){
  const d = ((d16|0) % 16 + 16) % 16;
  return d * 22.5;
}

function vecToDir16(dx, dy){
  if (!dx && !dy) return null;
  // atan2: y grows downward in our world (screen-like), so use -dy to keep
  // conventional angles (0°=E, 90°=N).
  const ang = Math.atan2(-dy, dx); // -pi..pi
  let deg = ang * 180 / Math.PI;
  if (deg < 0) deg += 360;
  const idx = Math.round(deg / 22.5) % 16;
  return idx;
}

function dir16ToNearestDir8(d16){
  // Every 2 dir16 steps is 45° => one dir8.
  const d = ((d16|0) % 16 + 16) % 16;
  return (Math.round(d / 2) % 8);
}

// Axis (modulo 180°): opposite directions share the same axis.
// axis4 = dir8 & 3  => {0,4}->{0}, {1,5}->{1}, {2,6}->{2}, {3,7}->{3}
function dir8ToAxis4(d){ return ((d|0) & 3); }

function ringDist16(a, b){
  a = ((a|0)%16+16)%16;
  b = ((b|0)%16+16)%16;
  const cw = (b - a + 16) % 16;
  const ccw = (a - b + 16) % 16;
  return Math.min(cw, ccw);
}

function ringDist8(a, b){
  a = ((a|0)%8+8)%8;
  b = ((b|0)%8+8)%8;
  const cw = (b - a + 8) % 8;
  const ccw = (a - b + 8) % 8;
  return Math.min(cw, ccw);
}

function chooseSignForDelta2(curDir8, wantDir8){
  // For axis difference 2 (need two 45° turns), pick CW/CCW so the final
  // heading stays closer to the desired wantDir8 (and remains stable).
  const cur = ((curDir8|0)%8+8)%8;
  const w = ((wantDir8|0)%8+8)%8;
  const candCCW = (cur + 2) % 8;
  const candCW = (cur + 6) % 8; // -2
  const dCCW = ringDist8(candCCW, w);
  const dCW = ringDist8(candCW, w);
  return (dCCW <= dCW) ? +1 : -1; // +1 => +1 step per cycle (CCW), -1 => CW
}

export function ensureMoving(view){
  if (!view) return;
  if (!view.moving){
    view.moving = {
      // speedBlocksS — главный (физика в блоках/сек)
      // speedPxS     — только для совместимости с render.js (деформация/гейт)
      params: { speedBlocksS: 3, speedPxS: 12, turnDegS: 5 },
      org: Object.create(null),
    };
  }
  if (!view.moving.params){
    view.moving.params = { speedBlocksS: 3, speedPxS: 12, turnDegS: 5 };
  } else {
    if (!Number.isFinite(view.moving.params.speedBlocksS)) view.moving.params.speedBlocksS = 3;
    if (!Number.isFinite(view.moving.params.speedPxS)) view.moving.params.speedPxS = 12;
    if (!Number.isFinite(view.moving.params.turnDegS)) view.moving.params.turnDegS = 5;
  }
  if (!view.moving.org) view.moving.org = Object.create(null);
}


export function getOrgMotion(view, orgId){
  ensureMoving(view);
  const k = String(orgId|0);
  const m = view.moving.org[k];
  if (m) return m;
  const init = {
    targetX: null,
    targetY: null,
    pendingTarget: null,
    moving: false,
    headingDir8: 0,
    angleDeg: 0,
    turnDebt: 0,
    turnSign: 0,
    _turnWantAxis: 0,
    _want16: null,
    _initAngleFromState: false,
    gait: null,
    breathMul: 1,

    // NEW: start distance of this move (Chebyshev), used to freeze turning in the final half.
    startDist: 0,
  };
  view.moving.org[k] = init;
  return init;
}

function getPersistedHeadingDeg(state, orgId){
  const org = getOrgById(state, orgId);
  const a = org?.headingDeg;
  return Number.isFinite(a) ? a : 0;
}

function getPersistedHeadingDir8(state, orgId){
  const org = getOrgById(state, orgId);
  const d = org?.headingDir8;
  return Number.isFinite(d) ? ((((d|0)%8+8)%8) & 3) : 0;
}

function getOrgById(state, orgId){
  if (!state) return null;
  if ((orgId|0) === 0) return state;
  const idx = (orgId|0) - 1;
  if (!Array.isArray(state.buds)) return null;
  return state.buds[idx] || null;
}

function getCore(org){
  const c = org?.body?.core;
  if (Array.isArray(c) && c.length === 2) return c;
  const first = org?.body?.cells?.[0];
  if (Array.isArray(first) && first.length === 2) return first;
  return [0, 0];
}

export function setMoveTarget(view, state, orgId, wx, wy, opts = null){
  const m = getOrgMotion(view, orgId);
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;

  const sx = snapCell(wx);
  const sy = snapCell(wy);

  const org = getOrgById(state, orgId);
  if (org && org.evoBusy){
    m.pendingTarget = { x: sx, y: sy };
    return;
  }

  m.pendingTarget = null;
  m.targetX = sx;
  m.targetY = sy;
  m.moving = true;
  m.breathMul = 2;
  m.turnDebt = 0;
  m.turnSign = 0;
  m._want16 = null;
  m.v = 0;
  m._lastTargetX = sx;
  m._lastTargetY = sy;

  // Optional movement tuning
  m.stopTolBlocks = (opts && Number.isFinite(opts.stopTolBlocks)) ? Math.max(0, opts.stopTolBlocks) : 10;

  // Optional "intent" jitter: bias the movement direction but keep the same destination.
  // This is used for coins ("move with an error up to N blocks").
  if (opts && Number.isFinite(opts.intentJitter) && opts.intentJitter > 0){
    const j = Math.floor(opts.intentJitter);
    const ox = (opts.intentOffsetX != null) ? (opts.intentOffsetX|0) : 0;
    const oy = (opts.intentOffsetY != null) ? (opts.intentOffsetY|0) : 0;
    m.intentOffX = clampInt(ox, -j, j);
    m.intentOffY = clampInt(oy, -j, j);
  } else {
    m.intentOffX = 0;
    m.intentOffY = 0;
  }

  // NEW: capture starting distance (Chebyshev) for "turn only in first half".
  const core = getCore(org);
  const cx = (core[0] || 0);
  const cy = (core[1] || 0);
  m.startDist = Math.max(Math.abs(sx - cx), Math.abs(sy - cy));
}

function clampInt(v, a, b){
  v = v|0;
  if (v < a) return a;
  if (v > b) return b;
  return v;
}

export function clearMove(view, orgId){
  const m = getOrgMotion(view, orgId);
  m.targetX = null;
  m.targetY = null;
  m.moving = false;
  m.breathMul = 1;
  m.turnDebt = 0;
  m.turnSign = 0;
  m._want16 = null;
  m.startDist = 0;
}

export function tickMoving(view, state, dtSec){
  ensureMoving(view);
  if (!state) return;
  const dt = Math.max(0, dtSec || 0);
  if (dt <= 0) return;

const blockPx = Math.max(1, view.blockPx || 1);

// ✅ скорость в блоках/сек — источник истины
const speedBlocksS = Math.max(0.25, view.moving.params.speedBlocksS || 3);
const speedCellsS = speedBlocksS;

// ✅ совместимость: render.js может ожидать speedPxS
view.moving.params.speedPxS = speedBlocksS * blockPx;

const turnDegS = Math.max(30, view.moving.params.turnDegS || 120);
const baseStepDur = 1 / speedCellsS;


  const STOP_POS_TOL_BLOCKS_DEFAULT = 10;
  const STOP_ANG_TOL_DEG = 20;

  // NEW: turning is allowed only while we are in the first half of the initial distance.
  // When curDist <= startDist*0.5 => freeze turning for the remainder.
  const TURN_FIRST_HALF_RATIO = 0.5;

  function shiftOrgCells(org, dx, dy){
    if (!org || (!dx && !dy)) return;

    const shiftCells = (arr)=>{
      if (!Array.isArray(arr)) return;
      for (const c of arr){
        if (!Array.isArray(c) || c.length < 2) continue;
        c[0] = (c[0] || 0) + dx;
        c[1] = (c[1] || 0) + dy;
      }
    };

    if (Array.isArray(org.body?.core) && org.body.core.length === 2){
      org.body.core[0] = (org.body.core[0] || 0) + dx;
      org.body.core[1] = (org.body.core[1] || 0) + dy;
    }
    if (Array.isArray(org.face?.anchor) && org.face.anchor.length === 2){
      org.face.anchor[0] = (org.face.anchor[0] || 0) + dx;
      org.face.anchor[1] = (org.face.anchor[1] || 0) + dy;
    }
    shiftCells(org.body?.cells);

    if (Array.isArray(org.modules)){
      for (const mod of org.modules){
        shiftCells(mod?.cells);

        if (Array.isArray(mod?.growPos) && mod.growPos.length === 2){
          mod.growPos[0] = (mod.growPos[0] || 0) + dx;
          mod.growPos[1] = (mod.growPos[1] || 0) + dy;
        }
        if (Array.isArray(mod?.anchor) && mod.anchor.length === 2){
          mod.anchor[0] = (mod.anchor[0] || 0) + dx;
          mod.anchor[1] = (mod.anchor[1] || 0) + dy;
        }
      }
    }

    if (org.anim && typeof org.anim === "object"){
      const next = Object.create(null);
      for (const kk of Object.keys(org.anim)){
        const parts = kk.split(",");
        if (parts.length !== 2){
          next[kk] = org.anim[kk];
          continue;
        }
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)){
          next[kk] = org.anim[kk];
          continue;
        }
        next[`${x+dx},${y+dy}`] = org.anim[kk];
      }
      org.anim = next;
    }
  }

  const MAX_STEPS_PER_TICK = 12;

  for (const k of Object.keys(view.moving.org)){
    const orgId = parseInt(k, 10);
    if (!Number.isFinite(orgId)) continue;
    const m = view.moving.org[k];
    if (!m) continue;

    if (!m._initAngleFromState){
      m.headingDir8 = getPersistedHeadingDir8(state, orgId);
      const a = getPersistedHeadingDeg(state, orgId);
      m.angleDeg = Number.isFinite(a) ? (((a%360)+360)%360) : dir8ToDeg(m.headingDir8);
      m._initAngleFromState = true;
    }

    if (!m.moving && m.pendingTarget){
      const org = getOrgById(state, orgId);
      if (org && !org.evoBusy){
        m.targetX = snapCell(m.pendingTarget.x);
        m.targetY = snapCell(m.pendingTarget.y);
        m.pendingTarget = null;
        m.moving = true;
        m.breathMul = 2;

        // NEW: starting distance for this move.
        const core = getCore(org);
        const cx = (core[0] || 0);
        const cy = (core[1] || 0);
        m.startDist = Math.max(Math.abs(m.targetX - cx), Math.abs(m.targetY - cy));
      }
    }

    const org = getOrgById(state, orgId);
    if (!org) continue;

    if (!m.moving){
      org.headingDir8 = ((((m.headingDir8|0)%8+8)%8) & 3);
      org.headingDeg = dir8ToDeg(org.headingDir8);
      continue;
    }

    const tx = m.targetX;
    const ty = m.targetY;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)){
      m.moving = false;
      m.breathMul = 1;
      m.gait = null;
      continue;
    }

    if (m.gait){
      m.gait.t += dt;
      if (m.gait.t >= m.gait.dur - 1e-6){
        const dist = Math.max(1, m.gait.dist || 1);
        shiftOrgCells(org, m.gait.dx * dist, m.gait.dy * dist);
        m.gait = null;
      }
      continue;
    }

    const core = getCore(org);
    const cx = (core[0] || 0);
    const cy = (core[1] || 0);
    const ddx = tx - cx;
    const ddy = ty - cy;

    const curDist = Math.max(Math.abs(ddx), Math.abs(ddy));

    const stopTol = Number.isFinite(m.stopTolBlocks) ? m.stopTolBlocks : STOP_POS_TOL_BLOCKS_DEFAULT;
    if (curDist <= stopTol){
      // IMPORTANT: do NOT do any final alignment turns here.
      m.moving = false;
      m.breathMul = 1;
      m.gait = null;
      m.turnDebt = 0;
      m.turnSign = 0;
      continue;
    }

    // dir16 intention with hysteresis
    // Apply optional "intent" bias (coin lure): the organism tries to go *towards* the target
    // with a small offset, but still ultimately reaches the real target.
    const bdx = ddx + (m.intentOffX || 0);
    const bdy = ddy + (m.intentOffY || 0);

    let want16 = vecToDir16(bdx, bdy);
    if (want16 !== null){
      if (m._want16 === null || m._want16 === undefined){
        m._want16 = want16;
      } else {
        const rd = ringDist16(m._want16, want16);
        if (rd <= 1){
          want16 = m._want16;
        } else {
          m._want16 = want16;
        }
      }
    }

    const want = chooseMoveDir8FromDir16(bdx, bdy, m.headingDir8, want16);
    if (want === null){
      m.moving = false;
      m.breathMul = 1;
      continue;
    }

    // NOTE: We intentionally do NOT rotate/turn the organism while moving.
    // Movement direction (stretching) is driven purely by `want` below.
    // Heading (org.headingDir8 / org.headingDeg) remains whatever it was.

    // Movement direction (stretching) follows `want`, not body orientation.
    const v = DIR8[want];
    const sx = v[0];
    const sy = v[1];

    const adx = Math.abs(ddx);
    const ady = Math.abs(ddy);
    let dist = 1;
    if (sx !== 0 && sy !== 0){
      if (Math.min(adx, ady) >= 2) dist = 2;
    } else if (sx !== 0){
      if (adx >= 2) dist = 2;
    } else if (sy !== 0){
      if (ady >= 2) dist = 2;
    }
    let stepDur = baseStepDur * dist;

    // Ensure gait has enough time to render intermediate stretch frames.
    // Without this, if dt is large or speed is high, gait may complete in one tick,
    // causing a visible "tear" instead of smooth stretch.
    stepDur = Math.max(stepDur, 0.12);

    m._stepsThisTick = (m._stepsThisTick|0) + 1;
    if (m._stepsThisTick > MAX_STEPS_PER_TICK) continue;

    m.gait = { dx: sx, dy: sy, dist, t: 0, dur: stepDur, dir8: want };
  }

  for (const k of Object.keys(view.moving.org)){
    const m = view.moving.org[k];
    if (m) m._stepsThisTick = 0;
  }
}
