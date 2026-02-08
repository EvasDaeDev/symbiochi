// js/moving.js
// View-only organism movement: selected organism can "swim" to a target point.
//
// Design:
// - speedPxS (pixels/sec) is converted to world-cells/sec using current view.blockPx.
// - motion.offsetX/Y (cells) shifts the organism during rendering (fractional remainder only).
// - integer offset is baked into state geometry so world-position persists in save.
// - motion.angleDeg is view-only and preserved after reaching target.
// - while motion.moving === true => breathMul = 2.
//
// Stored in: view.moving.org[orgId]
// where orgId = 0 for parent, orgId = i+1 for buds.

import { clamp } from "./util.js";

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
    offsetX: 0,
    offsetY: 0,
    targetX: null,
    targetY: null,
    pendingTarget: null, // {x,y} if move requested during mutation
    moving: false,
    angleDeg: 0,
    v: 0,
    breathMul: 1,
  };
  view.moving.org[k] = init;
  return init;
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
  const speedCellsS = (view.moving.params.speedPxS || 5) / blockPx;
  const turnDegS = (view.moving.params.turnDegS || 5);
  const accel = 5; // ease-in responsiveness (1/sec)

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

  for (const k of Object.keys(view.moving.org)){
    const orgId = parseInt(k, 10);
    if (!Number.isFinite(orgId)) continue;
    const m = view.moving.org[k];
    if (!m) continue;

    // Start pending target after mutation finishes
    if (!m.moving && m.pendingTarget){
      const org = getOrgById(state, orgId);
      if (org && !org.evoBusy){
        m.targetX = snapCell(m.pendingTarget.x);
        m.targetY = snapCell(m.pendingTarget.y);
        m.pendingTarget = null;
        m.moving = true;
        m.breathMul = 2;
        m.v = 0;
      }
    }

    if (!m.moving) continue;

    const org = getOrgById(state, orgId);
    const core = getCore(org);

    const tx = m.targetX;
    const ty = m.targetY;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)){
      m.moving = false;
      m.breathMul = 1;
      continue;
    }

    const cx = (core[0] || 0) + (m.offsetX || 0);
    const cy = (core[1] || 0) + (m.offsetY || 0);

    const dx = tx - cx;
    const dy = ty - cy;
    const dist = Math.hypot(dx, dy);

    // Turn towards desired heading (mod 180)
    if (dist > 1e-6){
      const desiredRaw = Math.atan2(dy, dx) * 180 / Math.PI;
      const desired = norm180(desiredRaw);
      const cur = Number.isFinite(m.angleDeg) ? m.angleDeg : 0;
      const deltaA = angleDeltaHalfTurn(cur, desired);
      const maxTurn = turnDegS * dt;
      m.angleDeg = norm180(cur + clamp(deltaA, -maxTurn, maxTurn));
    }

    // Smooth start only
    const a = 1 - Math.exp(-accel * dt);
    const v0 = Number.isFinite(m.v) ? m.v : 0;
    m.v = v0 + (speedCellsS - v0) * a;

    const step = Math.max(0, m.v) * dt;

    if (dist <= step || dist < 1e-4){
      // FINALIZE: bake exact cell snap into state (PERSISTENT)
      const fx = (tx - (core[0] || 0));
      const fy = (ty - (core[1] || 0));

      // tx/ty are ints => fx/fy are ints too, but round for safety
      const sx = Number.isFinite(fx) ? Math.round(fx) : 0;
      const sy = Number.isFinite(fy) ? Math.round(fy) : 0;

      if (sx || sy) shiftOrgCells(org, sx, sy);

      m.offsetX = 0;
      m.offsetY = 0;
      m.moving = false;
      m.breathMul = 1;
      m.v = 0;
      continue;
    }

    // Move fractionally
    const nx = dx / dist;
    const ny = dy / dist;
    m.offsetX = (m.offsetX || 0) + nx * step;
    m.offsetY = (m.offsetY || 0) + ny * step;

    // Bake integer part to geometry
    const ix = (m.offsetX >= 1) ? Math.floor(m.offsetX) : (m.offsetX <= -1 ? Math.ceil(m.offsetX) : 0);
    const iy = (m.offsetY >= 1) ? Math.floor(m.offsetY) : (m.offsetY <= -1 ? Math.ceil(m.offsetY) : 0);

    if (ix || iy){
      shiftOrgCells(org, ix, iy);
      m.offsetX -= ix;
      m.offsetY -= iy;
    }
  }
}
