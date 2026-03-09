import { parseCapsuleFile, decryptCapsule, encryptCapsule, downloadCapsule, randomKey } from './arena_capsule.js';
import { ARENA_DEFAULTS, initMatch, stepArena, stepFinishedDrift, rebuildWorldCells, normalizeFromCapsule, recomputeGeom, resetArenaVfx, stepArenaVfx, stepIdlePreview } from './arena_sim.js';
import { renderArena, getTimeoutSummaryLayout } from './arena_render.js';

const els = {
  canvas: document.getElementById('arenaCanvas'),
  aName: document.getElementById('aName'),
  aBlocks: document.getElementById('aBlocks'),
  aWins: document.getElementById('aWins'),
  aHonor: document.getElementById('aHonor'),
  bName: document.getElementById('bName'),
  bBlocks: document.getElementById('bBlocks'),
  bWins: document.getElementById('bWins'),
  bHonor: document.getElementById('bHonor'),
  bottomNameA: document.getElementById('bottomNameA'),
  bottomNameB: document.getElementById('bottomNameB'),
  bottomDamageA: document.getElementById('bottomDamageA'),
  bottomDamageB: document.getElementById('bottomDamageB'),
  btnImportA: document.getElementById('btnImportA'),
  btnImportB: document.getElementById('btnImportB'),
  btnStart: document.getElementById('btnStart'),
  btnNewMatch: document.getElementById('btnNewMatch'),
  btnExportWinner: document.getElementById('btnExportWinner'),
  hudStatus: document.getElementById('hudStatus'),
  hudA: document.getElementById('hudA'),
  hudB: document.getElementById('hudB'),
  importOverlay: document.getElementById('importOverlay'),
  importTitle: document.getElementById('importTitle'),
  fileInput: document.getElementById('fileInput'),
  keyInput: document.getElementById('keyInput'),
  importErr: document.getElementById('importErr'),
  btnDoImport: document.getElementById('btnDoImport'),
  btnCancelImport: document.getElementById('btnCancelImport'),
  btnCloseImport: document.getElementById('btnCloseImport'),
  exportOverlay: document.getElementById('exportOverlay'),
  exportTitle: document.getElementById('exportTitle'),
  exportKey: document.getElementById('exportKey'),
  btnCopyExportKey: document.getElementById('btnCopyExportKey'),
  btnDownloadExport: document.getElementById('btnDownloadExport'),
  btnCloseExport: document.getElementById('btnCloseExport'),
  btnCloseExportX: document.getElementById('btnCloseExportX'),
};

const ctx = els.canvas.getContext('2d');

const CELL_PX = 4;
const worldW = Math.floor(els.canvas.width / CELL_PX);
const worldH = Math.floor(els.canvas.height / CELL_PX);

// Удобная ручная расстановка стартовых позиций.
// Единицы: клетки мира, НЕ пиксели.
// x/y — смещение от центра арены. angle — стартовый угол в радианах.
const SPAWN_PRESET = {
  A: { x: -75, y: 0, angle: 0 },
  B: { x:  75, y: 0, angle: Math.PI },
};

const arena = {
  version: 1,
  mode: 'idle',
  worldW,
  worldH,
  sun: { x: worldW / 2, y: worldH / 2 },
  spawn: null,
  fighters: [null, null],
  params: { ...ARENA_DEFAULTS },
  time: { t: 0 },
  preMatchTimer: 0,
  winnerId: null,
  resultText: '',
  timeoutSummary: null,
  timeoutSummaryClosed: false,
  vfx: { debris: [], chunks: [], blood: [] },
  camera: {
    currentExtra: 0,
    targetExtra: 0,
    focusWorldX: worldW * 0.5,
    focusWorldY: worldH * 0.5,
    targetWorldX: worldW * 0.5,
    targetWorldY: worldH * 0.5
  }
};

function setText(el, value, fallback = '—') {
  if (!el) return;
  const text = value === undefined || value === null || value === '' ? fallback : String(value);
  el.textContent = text;
}

function formatDamage(fighter) {
  return fighter ? `dmg ${fighter.stats.damageDealt | 0}` : '—';
}

function updateFighterInfo(fighter, side) {
  const isA = side === 'A';
  const bottomNameEl = isA ? els.bottomNameA : els.bottomNameB;
  const bottomDamageEl = isA ? els.bottomDamageA : els.bottomDamageB;
  const srHudEl = isA ? els.hudA : els.hudB;

  if (!fighter) {
    setText(bottomNameEl, '—');
    setText(bottomDamageEl, '—');
    setText(srHudEl, '—');
    return;
  }

  const honor = (fighter.meta.honor | 0) + Math.floor(fighter.stats?.kingHonorAcc || 0);
  const damage = formatDamage(fighter);

  setText(bottomNameEl, fighter.name);
  setText(bottomDamageEl, damage);
  setText(srHudEl, `${fighter.name} ${fighter.mass} (${damage})`);
}

function updatePanels() {
  updateFighterInfo(arena.fighters[0], 'A');
  updateFighterInfo(arena.fighters[1], 'B');
}

function rebuildSpawnSlots() {
  const cx = arena.worldW * 0.5;
  const cy = arena.worldH * 0.5;
  arena.spawn = {
    A: {
      x: cx + (Number.isFinite(SPAWN_PRESET.A?.x) ? SPAWN_PRESET.A.x : -36),
      y: cy + (Number.isFinite(SPAWN_PRESET.A?.y) ? SPAWN_PRESET.A.y : 0),
      angle: Number.isFinite(SPAWN_PRESET.A?.angle) ? SPAWN_PRESET.A.angle : 0,
    },
    B: {
      x: cx + (Number.isFinite(SPAWN_PRESET.B?.x) ? SPAWN_PRESET.B.x : 36),
      y: cy + (Number.isFinite(SPAWN_PRESET.B?.y) ? SPAWN_PRESET.B.y : 0),
      angle: Number.isFinite(SPAWN_PRESET.B?.angle) ? SPAWN_PRESET.B.angle : Math.PI,
    },
  };
}

function getSpawnSlot(side) {
  if (!arena.spawn) rebuildSpawnSlots();
  return side === 'B' ? arena.spawn.B : arena.spawn.A;
}

function applySpawnToFighter(fighter, side) {
  const slot = getSpawnSlot(side);
  if (!fighter || !slot) return;
  fighter.transform.pos = { x: slot.x, y: slot.y };
  fighter.transform.vel = { x: 0, y: 0 };
  fighter.transform.angle = Number.isFinite(slot.angle) ? slot.angle : 0;
  fighter.transform.angularVel = 0;
  fighter.alive = true;
  fighter.combat.grappleTimer = 0;
}

function estimateFrontAngleFromGeom(geom) {
  const cells = Array.isArray(geom?.cells) ? geom.cells : [];
  const cx = Number.isFinite(geom?.center?.x) ? geom.center.x : 0;
  const cy = Number.isFinite(geom?.center?.y) ? geom.center.y : 0;
  let sx = 0, sy = 0;
  for (const c of cells) {
    const t = String(c?.type || 'body').toLowerCase();
    const dx = (c?.x || 0) - cx;
    const dy = (c?.y || 0) - cy;
    let w = 0.08;
    if (t === 'eye' || t === 'mouth' || t === 'teeth') w = 2.8;
    else if (t === 'claw') w = 2.2;
    else if (t === 'antenna') w = 1.4;
    else if (t === 'spike') w = 1.1;
    else if (t === 'tail' || t === 'worm') w = -2.0;
    sx += dx * w;
    sy += dy * w;
  }
  if (Math.hypot(sx, sy) < 1e-4) return 0;
  return Math.atan2(sy, sx);
}

function orientFightersFaceEachOther() {
  const A = arena.fighters[0];
  const B = arena.fighters[1];
  if (!A?.transform || !B?.transform) return;
  const aFront = estimateFrontAngleFromGeom(A.geom);
  const bFront = estimateFrontAngleFromGeom(B.geom);
  const aToB = Math.atan2(
    (B.transform.pos.y + (B.geom?.center?.y || 0)) - (A.transform.pos.y + (A.geom?.center?.y || 0)),
    (B.transform.pos.x + (B.geom?.center?.x || 0)) - (A.transform.pos.x + (A.geom?.center?.x || 0))
  );
  const bToA = Math.atan2(
    (A.transform.pos.y + (A.geom?.center?.y || 0)) - (B.transform.pos.y + (B.geom?.center?.y || 0)),
    (A.transform.pos.x + (A.geom?.center?.x || 0)) - (B.transform.pos.x + (B.geom?.center?.x || 0))
  );
  A.transform.angle = aToB - aFront;
  B.transform.angle = bToA - bFront;
  A.transform.angularVel = 0;
  B.transform.angularVel = 0;
}

function placeFightersIdle() {
  rebuildSpawnSlots();
  arena.sun = { x: arena.worldW * 0.5, y: arena.worldH * 0.5 };

  const A = arena.fighters[0];
  const B = arena.fighters[1];

  if (A) applySpawnToFighter(A, 'A');
  if (B) applySpawnToFighter(B, 'B');
  if (A && B) orientFightersFaceEachOther();

  rebuildWorldCells(arena);
}

let importTarget = 0;
let lastExport = null;

function toast(msg) {
  els.hudStatus.textContent = msg;
  console.log('[arena]', msg);
}

function openImport(which) {
  importTarget = which;
  els.importTitle.textContent = which === 0 ? 'Import Fighter A' : 'Import Fighter B';
  els.importErr.style.display = 'none';
  els.importErr.textContent = '';
  els.fileInput.value = '';
  els.keyInput.value = '';
  els.importOverlay.style.display = 'grid';
}
function closeImport() {
  els.importOverlay.style.display = 'none';
}

function openExport(title) {
  els.exportTitle.textContent = title || 'Export';
  els.exportKey.value = lastExport?.key ? String(lastExport.key) : '';
  els.btnDownloadExport.disabled = !lastExport?.capsule;
  els.exportOverlay.style.display = 'grid';
}
function closeExport() {
  els.exportOverlay.style.display = 'none';
}

function closeTimeoutSummary() {
  arena.timeoutSummaryClosed = true;
}

els.canvas.addEventListener('click', (e) => {
  const layout = getTimeoutSummaryLayout(els.canvas, arena);
  if (!layout || arena.timeoutSummaryClosed) return;
  const rect = els.canvas.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (els.canvas.width / Math.max(1, rect.width));
  const sy = (e.clientY - rect.top) * (els.canvas.height / Math.max(1, rect.height));
  const inPanel = sx >= layout.x && sx <= layout.x + layout.w && sy >= layout.y && sy <= layout.y + layout.h;
  const inClose = sx >= layout.close.x && sx <= layout.close.x + layout.close.w && sy >= layout.close.y && sy <= layout.close.y + layout.close.h;
  if (inClose || !inPanel) closeTimeoutSummary();
});

els.btnImportA.addEventListener('click', () => openImport(0));
els.btnImportB.addEventListener('click', () => openImport(1));
els.btnCancelImport.addEventListener('click', closeImport);
els.btnCloseImport.addEventListener('click', closeImport);

els.btnCloseExport.addEventListener('click', closeExport);
els.btnCloseExportX.addEventListener('click', closeExport);
els.btnDownloadExport.addEventListener('click', () => {
  if (!lastExport?.capsule) return;
  downloadCapsule(lastExport.capsule, lastExport.filename || 'arena_export');
});
els.btnCopyExportKey.addEventListener('click', async () => {
  if (!lastExport?.key) return;
  try {
    await navigator.clipboard.writeText(String(lastExport.key));
    toast('Key copied');
  } catch (e) {
    prompt('Copy key:', String(lastExport.key));
  }
});

els.btnDoImport.addEventListener('click', async () => {
  try {
    const file = els.fileInput.files?.[0];
    const key = String(els.keyInput.value || '').trim();
    if (!file) throw new Error('Choose a file');
    if (!key) throw new Error('Enter key');

    const cap = await parseCapsuleFile(file);
    const payload = await decryptCapsule(cap, key);

    const org = payload?.organismState;
    if (!org) throw new Error('Invalid capsule payload');

    const geom = normalizeFromCapsule(org);
    if (geom.cells.length < arena.params.minBlocksKO) throw new Error('Too small for arena');

    const name = String(payload?.meta?.name || 'Fighter').slice(0, 20);
    const wins = payload?.meta?.wins | 0;
    const honor = payload?.meta?.honor | 0;

    const fighter = {
      id: importTarget === 0 ? 'A' : 'B',
      name,
      mass: geom.cells.length,
      alive: true,
      geom,
      transform: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angularVel: 0 },
      combat: { grappleTimer: 0, activeEffects: {} },
      stats: { damageDealt: 0, damageTaken: 0, contactFrames: 0 },
      meta: { wins, honor, fairPlay: payload?.meta?.fairPlay ?? true },
      organismState: org,
    };

    arena.fighters[importTarget] = fighter;

    placeFightersIdle();
    updatePanels();
    toast(`Loaded ${fighter.id}: ${fighter.name} (${fighter.mass})`);
    closeImport();
  } catch (e) {
    els.importErr.style.display = 'block';
    els.importErr.textContent = String(e?.message || e);
  }
});

els.btnStart.addEventListener('click', () => {
  if (!arena.fighters[0] || !arena.fighters[1]) {
    toast('Import both fighters first');
    return;
  }
  arena.winnerId = null;
  arena.resultText = '';
  arena.timeoutSummary = null;
  arena.timeoutSummaryClosed = false;

  for (const f of arena.fighters) {
    f.geom = normalizeFromCapsule(f.organismState);
    f.mass = f.geom.cells.length;
    f.alive = true;
    f.stats.damageDealt = 0;
    f.stats.damageTaken = 0;
    f.stats.contactFrames = 0;
    f.combat.grappleTimer = 0;
    f.transform.angularVel = 0;
    if (!f.transform.vel) f.transform.vel = { x: 0, y: 0 };
    f.transform.vel.x = 0;
    f.transform.vel.y = 0;
  }

resetArenaVfx(arena);
placeFightersIdle();
initMatch(arena);
arena.mode = 'countdown';
  arena.preMatchTimer = arena.params.preStartCountdown;
  els.btnExportWinner.disabled = true;
  toast('Countdown started');
});

els.btnNewMatch.addEventListener('click', () => {
  arena.mode = 'idle';
  arena.winnerId = null;
  arena.resultText = '';
  arena.timeoutSummary = null;
  arena.timeoutSummaryClosed = false;
  arena.preMatchTimer = 0;

  for (const f of arena.fighters) {
    if (!f) continue;
    f.stats.damageDealt = 0;
    f.stats.damageTaken = 0;
    f.stats.contactFrames = 0;
    f.alive = true;
    f.combat.grappleTimer = 0;
    f.transform.angularVel = 0;
    if (!f.transform.vel) f.transform.vel = { x: 0, y: 0 };
    f.transform.vel.x = 0;
    f.transform.vel.y = 0;
  }

  placeFightersIdle();
  resetArenaVfx(arena);
  els.btnExportWinner.disabled = true;
  toast('Idle');
});

els.btnExportWinner.addEventListener('click', async () => {
  try {
    if (arena.mode !== 'finished' || !arena.winnerId) return;
    const winner = arena.winnerId === 'A' ? arena.fighters[0] : arena.fighters[1];
    if (!winner) return;

    const org = structuredClone(winner.organismState);
    org.body = org.body || {};

    const shifted = winner.geom.cells.map(c => ({ x: c.x, y: c.y, type: c.type || 'body' }));
    const tmpGeom = { cells: shifted, center: { x: 0, y: 0 }, radius: 0, bbox: null };
    recomputeGeom(tmpGeom);
    const shiftX = Math.round(tmpGeom.center.x);
    const shiftY = Math.round(tmpGeom.center.y);
    for (const c of shifted) {
      c.x = (c.x - shiftX) | 0;
      c.y = (c.y - shiftY) | 0;
    }

    const asPairs = Array.isArray(org?.body?.cells) && Array.isArray(org.body.cells[0]);
    const pack = (lst) => asPairs ? lst.map(c => [c.x, c.y]) : lst.map(c => ({ x: c.x, y: c.y }));

    const bodyCells = shifted.filter(c => String(c.type || 'body').toLowerCase() === 'body');
    org.body.cells = pack(bodyCells);
    org.body.core = [0, 0];

    const byType = new Map();
    for (const c of shifted) {
      const t = String(c.type || 'body').toLowerCase();
      if (t === 'body') continue;
      let arr = byType.get(t);
      if (!arr) {
        arr = [];
        byType.set(t, arr);
      }
      arr.push(c);
    }
    org.modules = Array.from(byType.entries()).map(([type, cells]) => ({ type, cells: pack(cells) }));

    const totalHonor = winner.meta.honor | 0;
    const meta = {
      name: winner.name,
      blocks: winner.geom.cells.length,
      createdAt: Math.floor(Date.now() / 1000),
      wins: winner.meta.wins | 0,
      honor: totalHonor,
      fairPlay: winner.meta.fairPlay ?? true,
    };

    const payload = { organismState: org, meta };
    const key = randomKey(16);
    const capsule = await encryptCapsule(payload, key, { capsuleId: crypto.randomUUID(), organismId: org.organismId || crypto.randomUUID() });

    lastExport = { capsule, key, filename: `${winner.name}_winner` };
    downloadCapsule(capsule, `${winner.name}_winner`);
    openExport(`Winner exported: ${winner.name}`);
    toast('Winner capsule exported');
  } catch (e) {
    alert(String(e?.message || e));
  }
});

function updateHud() {
  const A = arena.fighters[0];
  const B = arena.fighters[1];

  if (arena.mode === 'countdown') {
    els.hudStatus.textContent = `Start in ${Math.ceil(Math.max(0, arena.preMatchTimer || 0))}…`;
  } else if (arena.mode === 'match') {
    const left = Math.max(0, Math.ceil(arena.params.matchDuration - arena.time.t));
    els.hudStatus.textContent = `Match running… ${left}s`;
  } else if (arena.mode === 'finished') {
    els.hudStatus.textContent = arena.resultText || 'Finished';
  } else {
    els.hudStatus.textContent = 'Idle';
  }

  els.btnExportWinner.disabled = !(arena.mode === 'finished' && !!arena.winnerId);
  setText(els.bottomDamageA, formatDamage(A));
  setText(els.bottomDamageB, formatDamage(B));
}

let last = performance.now();
const FIXED = 1 / 60;
let acc = 0;

function loop(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  acc += dt;

  while (acc >= FIXED) {
    if (arena.mode === 'countdown') {
      stepIdlePreview(arena, FIXED);
      arena.preMatchTimer = Math.max(0, (arena.preMatchTimer || 0) - FIXED);
      if (arena.preMatchTimer <= 0) {
        arena.mode = 'match';
        toast('Match started');
      }
    } else if (arena.mode === 'finished') {
      stepFinishedDrift(arena, FIXED);
    } else if (arena.mode === 'idle') {
      stepIdlePreview(arena, FIXED);
    } else {
      stepArena(arena, FIXED);
    }
    stepArenaVfx(arena, FIXED);
    acc -= FIXED;
  }

  for (const f of arena.fighters) {
    if (!f) continue;
    f.mass = f.geom.cells.length;
  }

  updatePanels();
  updateHud();
  renderArena(ctx, els.canvas, arena);

  requestAnimationFrame(loop);
}

rebuildSpawnSlots();
placeFightersIdle();
resetArenaVfx(arena);
updatePanels();
updateHud();
requestAnimationFrame(loop);
