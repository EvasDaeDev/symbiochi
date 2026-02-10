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

function dir8ToDeg(d){
  const dd = ((d|0) % 8 + 8) % 8;
  return dd * 45;
}

function stepDir8Towards(cur, want){
  const c = ((cur|0)%8+8)%8;
  const w = ((want|0)%8+8)%8;
  const cw = (w - c + 8) % 8;
  const ccw = (c - w + 8) % 8;
  if (cw === 0) return c;
  return (cw <= ccw) ? ((c + 1) % 8) : ((c + 7) % 8);
}

export function ensureMoving(view){
  if (!view) return;
  if (!view.moving){
    view.moving = {
      params: { speedPxS: 5, turnDegS: 5 },
      org: Object.create(null),
    };
  }
  if (!view.moving.params) view.moving.params = { speedPxS: 5, turnDegS: 5 };
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
    pendingTarget: null, // {x,y} if move requested during mutation
    moving: false,
    // Heading is persisted into organism state as:
    // - org.headingDir8 (0..7)
    // - org.headingDeg (0..315)
    headingDir8: 0,
    angleDeg: 0,
    _initAngleFromState: false,
    // Active gait step: {dx,dy,t,dur} or null
    gait: null,
    breathMul: 1,
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
  return Number.isFinite(d) ? (((d|0)%8+8)%8) : 0;
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

export function setMoveTarget(view, state, orgId, wx, wy){
  const m = getOrgMotion(view, orgId);
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;

  // IMPORTANT: geometry is integer cell-based => snap targets to integer cells
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
  m.v = 0;
  m._lastTargetX = sx;
  m._lastTargetY = sy;
}

export function clearMove(view, orgId){
  const m = getOrgMotion(view, orgId);
  m.targetX = null;
  m.targetY = null;
  m.moving = false;
  m.breathMul = 1;
}

export function tickMoving(view, state, dtSec){
  ensureMoving(view);
  if (!state) return;
  const dt = Math.max(0, dtSec || 0);
  if (dt <= 0) return;

  const blockPx = Math.max(1, view.blockPx || 1);
  const speedCellsS = Math.max(0.25, (view.moving.params.speedPxS || 5) / blockPx);
  // turnDegS is in deg/sec. We'll snap heading by 45° steps, but we still use this
  // value to control how quickly we advance toward the desired dir8.
  const turnDegS = Math.max(30, view.moving.params.turnDegS || 120);
  // Each grid step is animated as a gait over this duration (sec).
  const stepDur = 1 / speedCellsS;

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

  // Prevent "spiral of death" on huge dt (tab inactive): cap how many cell-steps we bake per tick.
  const MAX_STEPS_PER_TICK = 12;

  for (const k of Object.keys(view.moving.org)){
    const orgId = parseInt(k, 10);
    if (!Number.isFinite(orgId)) continue;
    const m = view.moving.org[k];
    if (!m) continue;

    // Initialize view angle from persisted state once per org.
    // This prevents angle reset after reload/offline which would desync
    // growth targeting vs what the player sees.
    if (!m._initAngleFromState){
      m.headingDir8 = getPersistedHeadingDir8(state, orgId);
      const a = getPersistedHeadingDeg(state, orgId);
      m.angleDeg = Number.isFinite(a) ? (((a%360)+360)%360) : dir8ToDeg(m.headingDir8);
      m._initAngleFromState = true;
    }

    // Start pending target after mutation finishes
    if (!m.moving && m.pendingTarget){
      const org = getOrgById(state, orgId);
      if (org && !org.evoBusy){
        m.targetX = snapCell(m.pendingTarget.x);
        m.targetY = snapCell(m.pendingTarget.y);
        m.pendingTarget = null;
        m.moving = true;
        m.breathMul = 2;
      }
    }

    const org = getOrgById(state, orgId);
    if (!org) continue;

    // If not moving, just keep heading persisted.
    if (!m.moving){
      org.headingDir8 = ((m.headingDir8|0)%8+8)%8;
      org.headingDeg = dir8ToDeg(org.headingDir8);
      continue;
    }

    // Abort movement if target is invalid.
    const tx = m.targetX;
    const ty = m.targetY;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)){
      m.moving = false;
      m.breathMul = 1;
      m.gait = null;
      continue;
    }

    // If we're mid-gait, advance animation time; bake the whole-cell step when done.
    if (m.gait){
      m.gait.t += dt;
      if (m.gait.t >= m.gait.dur - 1e-6){
        // bake one cell step
        shiftOrgCells(org, m.gait.dx, m.gait.dy);
        m.gait = null;
      }
      // Keep heading persisted continuously.
      org.headingDir8 = ((m.headingDir8|0)%8+8)%8;
      org.headingDeg = dir8ToDeg(org.headingDir8);
      continue;
    }

    // Not in gait: decide whether we need another step.
    const core = getCore(org);
    const cx = (core[0] || 0);
    const cy = (core[1] || 0);
    const ddx = tx - cx;
    const ddy = ty - cy;

    // Stop if we're at target cell.
    if (Math.abs(ddx) < 0.5 && Math.abs(ddy) < 0.5){
      m.moving = false;
      m.breathMul = 1;
      m.gait = null;
      // Persist final heading.
      org.headingDir8 = ((m.headingDir8|0)%8+8)%8;
      org.headingDeg = dir8ToDeg(org.headingDir8);
      continue;
    }

    // Desired dir8 from target.
    const want = vecToDir8(ddx, ddy);
    if (want === null){
      m.moving = false;
      m.breathMul = 1;
      continue;
    }

    // Smoothly rotate heading toward want (in 45° increments).
    // We can rotate multiple 45° steps per tick depending on turnDegS and dt.
    let cur = ((m.headingDir8|0)%8+8)%8;
    const stepsAllowed = Math.max(1, Math.floor((turnDegS * dt) / 45));
    for (let i=0;i<stepsAllowed;i++){
      if (cur === want) break;
      cur = stepDir8Towards(cur, want);
    }
    m.headingDir8 = cur;
    m.angleDeg = dir8ToDeg(cur);
    org.headingDir8 = cur;
    org.headingDeg = m.angleDeg;

    // Take ONE gait step in the *current* heading.
    const v = DIR8[cur];
    const sx = v[0];
    const sy = v[1];

    // Cap baked steps per tick (in case dt is large but we still want smoothness).
    m._stepsThisTick = (m._stepsThisTick|0) + 1;
    if (m._stepsThisTick > MAX_STEPS_PER_TICK) continue;

    m.gait = { dx: sx, dy: sy, t: 0, dur: stepDur };
  }

  // reset per tick counters
  for (const k of Object.keys(view.moving.org)){
    const m = view.moving.org[k];
    if (m) m._stepsThisTick = 0;
  }
}
