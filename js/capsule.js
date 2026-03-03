// js/capsule.js
// Offline Capsule Import/Export for buds (parent/root is not exportable).

import { nowSec } from "./util.js";
import { saveGame } from "./state.js";

const CAPSULE_FORMAT = "symbiochi-capsule";
const CAPSULE_VERSION = 1;
const MIN_SPAWN_DIST = 40; // cells

function u8ToB64(u8){
  let s = "";
  for (let i=0; i<u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
function b64ToU8(b64){
  const bin = atob(String(b64||""));
  const u8 = new Uint8Array(bin.length);
  for (let i=0; i<bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const dig = await crypto.subtle.digest("SHA-256", enc);
  const u8 = new Uint8Array(dig);
  let out = "";
  for (const b of u8) out += b.toString(16).padStart(2, "0");
  return out;
}

async function sha256HexBytes(bytes){
  const dig = await crypto.subtle.digest("SHA-256", bytes);
  const u8 = new Uint8Array(dig);
  let out = "";
  for (const b of u8) out += b.toString(16).padStart(2, "0");
  return out;
}

function randKey(len=16){
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const u8 = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (let i=0; i<len; i++) s += alphabet[u8[i] % alphabet.length];
  return s;
}

function uuidLike(){
  const u = crypto.getRandomValues(new Uint32Array(4));
  return [u[0],u[1],u[2],u[3]].map(x=>x.toString(16).padStart(8,"0")).join("-");
}

function deepCloneSerializable(obj){
  const seen = new WeakSet();
  return JSON.parse(JSON.stringify(obj, (k, v)=>{
    if (k === "__logRoot" || k === "__parent" || k === "__state") return undefined;
    if (typeof k === "string" && k.startsWith("__")) return undefined;
    if (typeof v === "function") return undefined;
    if (v && typeof v === "object"){
      if (seen.has(v)) return undefined;
      seen.add(v);
    }
    return v;
  }));
}

function countBlocks(org){
  const body = org?.body?.cells?.length || 0;
  const mods = Array.isArray(org?.modules) ? org.modules.reduce((s,m)=>s+(m?.cells?.length||0),0) : 0;
  return body + mods;
}

async function deriveAesKeyFromPassword(password, saltU8, iters){
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltU8,
      iterations: iters,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptJson(payloadObj, password){
  const iters = 200000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKeyFromPassword(password, salt, iters);
  const bytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  const payloadHash = await sha256HexBytes(bytes);
  return {
    payloadEnc: u8ToB64(new Uint8Array(ct)),
    payloadIv: u8ToB64(iv),
    payloadSalt: u8ToB64(salt),
    payloadHash,
    payloadAlg: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    kdfIters: iters,
  };
}

async function decryptJson(capsule, password){
  const salt = b64ToU8(capsule.payloadSalt);
  const iv = b64ToU8(capsule.payloadIv);
  const iters = Number(capsule.kdfIters) || 200000;
  const key = await deriveAesKeyFromPassword(password, salt, iters);
  const ct = b64ToU8(capsule.payloadEnc);
  let pt;
  try {
    pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  } catch {
    return { ok: false, reason: "bad_key" };
  }
  const bytes = new Uint8Array(pt);
  const hash = await sha256HexBytes(bytes);
  if (capsule.payloadHash && hash !== capsule.payloadHash){
    return { ok: false, reason: "corrupt" };
  }
  try {
    const obj = JSON.parse(new TextDecoder().decode(bytes));
    return { ok: true, obj };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

function downloadJson(obj, filename){
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 2000);
}

function computeBounds(org){
  const pts = [];
  if (Array.isArray(org?.body?.cells)) pts.push(...org.body.cells);
  if (Array.isArray(org?.modules)){
    for (const m of org.modules){
      if (Array.isArray(m?.cells)) pts.push(...m.cells);
    }
  }
  let cx = 0, cy = 0;
  if (Array.isArray(org?.body?.core) && org.body.core.length === 2){
    cx = org.body.core[0] || 0;
    cy = org.body.core[1] || 0;
  } else if (pts.length){
    for (const p of pts){ cx += (p?.[0]||0); cy += (p?.[1]||0); }
    cx /= pts.length; cy /= pts.length;
  }
  let r = 0;
  for (const p of pts){
    const dx = (p?.[0]||0) - cx;
    const dy = (p?.[1]||0) - cy;
    const d = Math.hypot(dx, dy);
    if (d > r) r = d;
  }
  return { cx, cy, r };
}

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
      if (parts.length !== 2){ next[kk] = org.anim[kk]; continue; }
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) { next[kk] = org.anim[kk]; continue; }
      next[`${x+dx},${y+dy}`] = org.anim[kk];
    }
    org.anim = next;
  }
}


function getAllCells(org){
  const out = [];
  if (org?.body?.cells && Array.isArray(org.body.cells)){
    for (const c of org.body.cells){
      if (Array.isArray(c) && c.length >= 2) out.push(c);
    }
  }
  if (Array.isArray(org?.modules)){
    for (const m of org.modules){
      if (!m?.cells || !Array.isArray(m.cells)) continue;
      for (const c of m.cells){
        if (Array.isArray(c) && c.length >= 2) out.push(c);
      }
    }
  }
  return out;
}

function buildCellBuckets(orgs, bucketSize=16){
  const buckets = new Map(); // key -> array of [x,y]
  const bsz = Math.max(4, bucketSize|0);
  const put = (x, y)=>{
    const bx = Math.floor(x / bsz);
    const by = Math.floor(y / bsz);
    const k = bx + ":" + by;
    let arr = buckets.get(k);
    if (!arr){ arr = []; buckets.set(k, arr); }
    arr.push([x, y]);
  };

  for (const o of orgs){
    for (const c of getAllCells(o)){
      put(c[0], c[1]);
    }
  }
  return { buckets, bucketSize: bsz };
}

function hasAnyCellTooClose(bucketsPack, shiftedCells, minDist){
  const { buckets, bucketSize } = bucketsPack;
  const r = Math.max(0, minDist|0);
  const r2 = r * r;
  const reach = Math.ceil(r / bucketSize);

  for (const c of shiftedCells){
    const x = c[0], y = c[1];
    const bx = Math.floor(x / bucketSize);
    const by = Math.floor(y / bucketSize);
    for (let dx=-reach; dx<=reach; dx++){
      for (let dy=-reach; dy<=reach; dy++){
        const k = (bx+dx) + ":" + (by+dy);
        const arr = buckets.get(k);
        if (!arr) continue;
        for (let i=0; i<arr.length; i++){
          const ox = arr[i][0], oy = arr[i][1];
          const ddx = ox - x;
          const ddy = oy - y;
          if ((ddx*ddx + ddy*ddy) < r2) return true;
        }
      }
    }
  }
  return false;
}

function findSafeSpawnPos(state, orgToPlace, anchor){
  const activeOrgs = [state, ...(Array.isArray(state?.buds) ? state.buds : [])];

  // Bounds for cheap early rejection
  const otherBounds = activeOrgs.map(computeBounds);
  const bNew = computeBounds(orgToPlace);

  // Exact check buckets (cell-level) to satisfy ">= 40 cells from any body"
  const bucketsPack = buildCellBuckets(activeOrgs, 16);

  const ax = anchor?.x ?? 0;
  const ay = anchor?.y ?? 0;

  const newCells = getAllCells(orgToPlace);

  const okAt = (cx, cy)=>{
    // 1) circle reject
    for (const b of otherBounds){
      const d = Math.hypot((b.cx - cx), (b.cy - cy));
      if (d < (b.r + bNew.r + MIN_SPAWN_DIST)) return false;
    }

    // 2) exact cell-level distance
    const dx = Math.round(cx - bNew.cx);
    const dy = Math.round(cy - bNew.cy);
    const shifted = newCells.map(c=>[c[0] + dx, c[1] + dy]);
    if (hasAnyCellTooClose(bucketsPack, shifted, MIN_SPAWN_DIST)) return false;

    return true;
  };

  if (okAt(ax, ay)) return { x: ax, y: ay };

  // Spiral / rings search
  const step = 20;
  const maxR = 3000;
  for (let r = step; r <= maxR; r += step){
    const points = Math.max(8, Math.floor((2 * Math.PI * r) / step));
    for (let i=0; i<points; i++){
      const t = (i / points) * Math.PI * 2;
      const x = ax + Math.round(Math.cos(t) * r);
      const y = ay + Math.round(Math.sin(t) * r);
      if (okAt(x, y)) return { x, y };
    }
  }
  return null;
}


export async function exportSelectedBudToCapsule(view){
  const state = view?.state;
  if (!state) return { ok: false, reason: "no_state" };
  const a = state.active;
  if (!(Number.isFinite(a) && a >= 0 && Array.isArray(state.buds) && a < state.buds.length)){
    return { ok: false, reason: "not_bud" };
  }

  const bud = state.buds[a];
  if (!bud) return { ok: false, reason: "no_bud" };

  const organismId = String(bud.id || uuidLike());
  bud.id = organismId;

  const capsuleId = uuidLike();
  const createdAt = Math.floor(nowSec());
  const key = randKey(16);
  const keyHash = await sha256Hex(key);

  const budData = deepCloneSerializable(bud);
  // === NEW: read export name from overlay input ===
let exportName = "BUD" + capsuleId.slice(0, 6);

const nameInput = document.getElementById("capsuleNameInput");
if (nameInput) {
  const raw = String(nameInput.value || "").trim();
  const sanitized = raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
  if (sanitized.length > 0) {
    exportName = sanitized;
  }
}
const meta = {
  name: exportName,
  blocks: countBlocks(bud),
  createdAt,
};
  const payload = { organismState: budData, meta };
  const enc = await encryptJson(payload, key);
  const capsule = {
    format: CAPSULE_FORMAT,
    version: CAPSULE_VERSION,
    capsuleId,
    organismId,
    createdAt,
    fairPlay: true,
    ...enc,
  };

  state.departedCapsules = Array.isArray(state.departedCapsules) ? state.departedCapsules : [];
  state.departedCapsules.push({
    capsuleId,
    organismId,
    meta,
    fairPlay: true,
    key,
    keyHash,
    capsule,
    keyShown: false,
  });

  // Remove bud from active world
  state.buds.splice(a, 1);
  state.active = -1;
  saveGame(state);

  // Download file immediately
  downloadJson(capsule, `capsule_${(meta.name||"bud").replace(/[^a-z0-9_-]+/gi,"_")}_${capsuleId.slice(0,8)}.sbh`);
  return { ok: true, capsuleId, key };
}

export async function rotateDepartedCapsuleKey(state, capsuleId){
  const list = Array.isArray(state?.departedCapsules) ? state.departedCapsules : [];
  const rec = list.find(x=>x?.capsuleId === capsuleId);
  if (!rec || !rec.capsule) return { ok: false, reason: "not_found" };
  const oldKey = rec.key;
  if (!oldKey) return { ok: false, reason: "no_key" };


  // Prevent importing the same capsule multiple times into the same home.
  state.importedCapsules = Array.isArray(state.importedCapsules) ? state.importedCapsules : [];
  if (capsule.capsuleId){
    const cid = String(capsule.capsuleId);
    if (state.importedCapsules.includes(cid)) return { ok: false, reason: "already_imported" };
  }

  const dec = await decryptJson(rec.capsule, oldKey);
  if (!dec.ok) return { ok: false, reason: "bad_key" };

  const newKey = randKey(16);
  const newKeyHash = await sha256Hex(newKey);
  const enc = await encryptJson(dec.obj, newKey);

  rec.key = newKey;
  rec.keyHash = newKeyHash;
  rec.capsule = { ...rec.capsule, ...enc };
  rec.keyShown = true;

  saveGame(state);
  return { ok: true, key: newKey };
}

export function deleteDepartedCapsule(state, capsuleId){
  if (!state || !Array.isArray(state.departedCapsules)) return { ok: false };
  const n0 = state.departedCapsules.length;
  state.departedCapsules = state.departedCapsules.filter(x=>x?.capsuleId !== capsuleId);
  if (state.departedCapsules.length !== n0) saveGame(state);
  return { ok: true };
}

export function redownloadDepartedCapsule(state, capsuleId){
  const rec = Array.isArray(state?.departedCapsules) ? state.departedCapsules.find(x=>x?.capsuleId === capsuleId) : null;
  if (!rec?.capsule) return { ok: false };
  const name = rec?.meta?.name || "bud";
  downloadJson(rec.capsule, `capsule_${name.replace(/[^a-z0-9_-]+/gi,"_")}_${capsuleId.slice(0,8)}.sbh`);
  return { ok: true };
}

export async function importCapsuleFileToHome(view, file, key){
  const state = view?.state;
  if (!state) return { ok: false, reason: "no_state" };
  if (!file) return { ok: false, reason: "no_file" };
  key = String(key || "").trim();
  if (!key) return { ok: false, reason: "no_key" };

  let capsule;
  try {
    const txt = await file.text();
    capsule = JSON.parse(txt);
  } catch {
    return { ok: false, reason: "bad_file" };
  }

  if (!capsule || capsule.format !== CAPSULE_FORMAT || (capsule.version|0) !== CAPSULE_VERSION){
    return { ok: false, reason: "bad_format" };
  }
  // Prevent importing the same capsule multiple times into the same home.
  state.importedCapsules = Array.isArray(state.importedCapsules) ? state.importedCapsules : [];
  if (capsule.capsuleId){
    const cid = String(capsule.capsuleId);
    if (state.importedCapsules.includes(cid)) return { ok: false, reason: "already_imported" };
  }


  const dec = await decryptJson(capsule, key);
  if (!dec.ok) return { ok: false, reason: dec.reason };

  const payload = dec.obj;
  const bud = payload?.organismState;
  // === NEW: restore name from capsule meta ===
if (payload?.meta?.name) {
  bud.name = payload.meta.name;
}
  if (!bud || !bud.body || !Array.isArray(bud.body.cells)){
    return { ok: false, reason: "corrupt" };
  }

  // Prevent id collision in this home.
  const existingIds = new Set();
  if (Array.isArray(state.buds)){
    for (const b of state.buds){ if (b?.id) existingIds.add(String(b.id)); }
  }
  if (bud.id && existingIds.has(String(bud.id))) bud.id = uuidLike();

  // Safe spawn: anchor near camera target if available.
  const anchor = (view.camTarget && Number.isFinite(view.camTarget.x) && Number.isFinite(view.camTarget.y))
    ? { x: Math.round(view.camTarget.x), y: Math.round(view.camTarget.y) }
    : { x: 0, y: 0 };

  const pos = findSafeSpawnPos(state, bud, anchor);
  if (!pos) return { ok: false, reason: "no_space" };

  const b = computeBounds(bud);
  const dx = Math.round(pos.x - b.cx);
  const dy = Math.round(pos.y - b.cy);
  shiftOrgCells(bud, dx, dy);

  state.buds = Array.isArray(state.buds) ? state.buds : [];
  state.buds.push(bud);

  state.importedCapsules = Array.isArray(state.importedCapsules) ? state.importedCapsules : [];
  if (capsule.capsuleId){
    const cid = String(capsule.capsuleId);
    if (!state.importedCapsules.includes(cid)) state.importedCapsules.push(cid);
  }

  saveGame(state);
  return { ok: true };
}
