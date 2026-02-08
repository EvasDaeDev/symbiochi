// moving.js
// View-only organism movement: selected organism can "swim" to a target point.
//
// Design:
// - speedPxS (pixels/sec) is converted to world-cells/sec using current view.blockPx.
// - motion.offsetX/Y (cells) shifts the entire organism during rendering.
// - motion.angleDeg is view-only and preserved after reaching target.
// - while motion.moving === true => breathMul = 2.
//
// Stored in: view.moving.org[orgId]
// where orgId = 0 for parent, orgId = i+1 for buds.

import { clamp } from "./util.js";

// Angle helpers
// The creature is considered "horizontal" at the start of the game (angle 0).
// We also treat headings as equivalent modulo 180° (no front/back), so the
// renderer always chooses the closest angle to the horizontal state regardless
// of direction (prevents continuous spinning).
function norm180(a){
  // -> [-90..90)
  a = ((a % 180) + 180) % 180;
  if (a >= 90) a -= 180;
  return a;
}

function angleDeltaHalfTurn(fromDeg, toDeg){
  // shortest delta considering modulo 180° equivalence
  return norm180(toDeg - fromDeg);
}

export function ensureMoving(view){
  if (!view) return;
  if (!view.moving){
    view.moving = {
      params: {
        speedPxS: 5,
        turnDegS: 5,
      },
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
    // Keep angle unwrapped to avoid visible jumps at -180/180.
    angleDeg: 0,
    // Smoothed speed (cells/sec) for ease-in / ease-out.
    v: 0,
    breathMul: 1,
  };
  view.moving.org[k] = init;
  return init;
}

export function setMoveTarget(view, state, orgId, wx, wy){
  const m = getOrgMotion(view, orgId);
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;

  // If a mutation is being applied right now, we don't start moving immediately.
  // Store a pending target and we'll start once evoBusy is cleared.
  const org = getOrgById(state, orgId);
  if (org && org.evoBusy){
    m.pendingTarget = { x: wx, y: wy };
    return;
  }

  m.pendingTarget = null;
  m.targetX = wx;
  m.targetY = wy;
  m.moving = true;
  m.breathMul = 2;
  m.v = 0;
  m._lastTargetX = wx;
  m._lastTargetY = wy;
}

export function clearMove(view, orgId){
  const m = getOrgMotion(view, orgId);
  m.targetX = null;
  m.targetY = null;
  m.moving = false;
  m.breathMul = 1;
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

export function tickMoving(view, state, dtSec){
  ensureMoving(view);
  if (!state) return;
  const dt = Math.max(0, dtSec || 0);
  if (dt <= 0) return;

  const blockPx = Math.max(1, view.blockPx || 1);
  const speedCellsS = (view.moving.params.speedPxS || 5) / blockPx;
  const turnDegS = (view.moving.params.turnDegS || 5);
  const accel = 5;      // how quickly speed converges (1/sec)
 // const slowRadius = 10; // cells, start slowing near target

  // Movement is view-driven, but the world has real objects (e.g. carrots) in cell coordinates.
  // To keep interactions correct, we apply integer cell shifts to the organism geometry whenever
  // the visual offset accumulates >= 1 cell, and keep only the fractional остаток in offsetX/Y.
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
      for (const m of org.modules){
        shiftCells(m?.cells);

        // Critical: growing organs use growPos as a continuation point.
        // If we shift only cells but not growPos, new segments will spawn at the old location
        // and look like "floating" detached organs.
        if (Array.isArray(m?.growPos) && m.growPos.length === 2){
          m.growPos[0] = (m.growPos[0] || 0) + dx;
          m.growPos[1] = (m.growPos[1] || 0) + dy;
        }
        // Some modules may keep an anchor position as well.
        if (Array.isArray(m?.anchor) && m.anchor.length === 2){
          m.anchor[0] = (m.anchor[0] || 0) + dx;
          m.anchor[1] = (m.anchor[1] || 0) + dy;
        }
      }
    }

    // Shift growth animation map keys (view-only, but stored on org).
    // Not shifting this doesn't break logic, but can cause "ghost" growth glows in the old place.
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

    // If move was requested during mutation, start it as soon as evoBusy is cleared.
    if (!m.moving && m.pendingTarget){
      const org = getOrgById(state, orgId);
      if (org && !org.evoBusy){
        m.targetX = m.pendingTarget.x;
        m.targetY = m.pendingTarget.y;
        m.pendingTarget = null;
        m.moving = true;
        m.breathMul = 2;
        m.v = 0;
      }
    }

    if (!m.moving) continue;

    const org = getOrgById(state, orgId);
    const core = getCore(org);

    // Current core position (world cells, float)
    const cx = (core[0] || 0) + (m.offsetX || 0);
    const cy = (core[1] || 0) + (m.offsetY || 0);

    const tx = m.targetX;
    const ty = m.targetY;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)){
      m.moving = false;
      m.breathMul = 1;
      continue;
    }

    const dx = tx - cx;
    const dy = ty - cy;
    const dist = Math.hypot(dx, dy);

    // Desired heading.
    // NOTE: we map the desired heading into [-90..90) because we treat
    // angles modulo 180° (no front/back). This matches the rule:
    // "choose the nearest angle from the horizontal state regardless of direction".
    if (dist > 1e-6){
      const desiredRaw = Math.atan2(dy, dx) * 180 / Math.PI;
      const desired = norm180(desiredRaw);
      const cur = Number.isFinite(m.angleDeg) ? m.angleDeg : 0;
      const deltaA = angleDeltaHalfTurn(cur, desired);
      const maxTurn = turnDegS * dt;
      const stepA = clamp(deltaA, -maxTurn, maxTurn);
      m.angleDeg = norm180(cur + stepA);
    }

// Smooth start ONLY (no slow-down near target):
const vDesired = speedCellsS; // <-- всегда хотим полную скорость
const a = 1 - Math.exp(-accel * dt);
const v0 = (Number.isFinite(m.v) ? m.v : 0);
m.v = v0 + (vDesired - v0) * a;

const step = Math.max(0, m.v) * dt;
if (dist <= step || dist < 1e-4){
  // Sharp stop: snap exactly to target
  m.offsetX = (tx - (core[0] || 0));
  m.offsetY = (ty - (core[1] || 0));
  m.moving = false;
  m.breathMul = 1;
  m.v = 0;
  continue;
}

    // Move core towards target by 'step'
    const nx = dx / dist;
    const ny = dy / dist;
    m.offsetX = (m.offsetX || 0) + nx * step;
    m.offsetY = (m.offsetY || 0) + ny * step;

    // Apply integer part to geometry (keeps carrots/contacts correct)
    const sx = (m.offsetX >= 1) ? Math.floor(m.offsetX) : (m.offsetX <= -1 ? Math.ceil(m.offsetX) : 0);
    const sy = (m.offsetY >= 1) ? Math.floor(m.offsetY) : (m.offsetY <= -1 ? Math.ceil(m.offsetY) : 0);
    if (sx || sy){
      shiftOrgCells(org, sx, sy);
      m.offsetX -= sx;
      m.offsetY -= sy;
    }
  }
}
