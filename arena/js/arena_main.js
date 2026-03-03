import { parseCapsuleFile, decryptCapsule, encryptCapsule, downloadCapsule, randomKey } from './arena_capsule.js';
import { ARENA_DEFAULTS, initMatch, stepArena, rebuildWorldCells, normalizeFromCapsule } from './arena_sim.js';
import { renderArena } from './arena_render.js';

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

// IMPORTANT:
// Simulation runs in *cell units* (grid units). Renderer converts cell->pixels.
// Canvas is sized in pixels, so compute world size in cells once.
const CELL_PX = 4; // must match arena_render.js
const worldW = Math.floor(els.canvas.width / CELL_PX);
const worldH = Math.floor(els.canvas.height / CELL_PX);

const arena = {
  version: 1,
  mode: 'idle',
  // world size in CELL units
  worldW,
  worldH,
  // sun position in CELL units
  sun: { x: worldW/2, y: worldH/2 },
  fighters: [null, null],
  params: { ...ARENA_DEFAULTS },
  time: { t:0 },
  winnerId: null,
  resultText: ''
};


function placeFightersIdle(){
  const cx = arena.worldW/2;
  const cy = arena.worldH/2;
  arena.sun = { x: cx, y: cy };

  const A = arena.fighters[0];
  const B = arena.fighters[1];

  // Place any loaded fighters immediately so player sees them before Start.
  if(A){
    A.transform.pos = { x: cx - 180, y: cy };
    A.transform.vel = { x: 0, y: 0 };
  }
  if(B){
    B.transform.pos = { x: cx + 220, y: cy };
    B.transform.vel = { x: 0, y: 0 };
  }

  placeFightersIdle();
  rebuildWorldCells(arena);
}

let importTarget = 0; // 0 for A, 1 for B
let lastExport = null; // { capsule, key, filename }

function toast(msg){
  els.hudStatus.textContent = msg;
  // also console
  console.log('[arena]', msg);
}

function openImport(which){
  importTarget = which;
  els.importTitle.textContent = which === 0 ? 'Import Fighter A' : 'Import Fighter B';
  els.importErr.style.display = 'none';
  els.importErr.textContent = '';
  els.fileInput.value = '';
  els.keyInput.value = '';
  els.importOverlay.style.display = 'grid';
}
function closeImport(){
  els.importOverlay.style.display = 'none';
}

function openExport(title){
  els.exportTitle.textContent = title || 'Export';
  els.exportKey.value = lastExport?.key ? String(lastExport.key) : '';
  els.btnDownloadExport.disabled = !lastExport?.capsule;
  els.exportOverlay.style.display = 'grid';
}
function closeExport(){
  els.exportOverlay.style.display = 'none';
}

els.btnImportA.addEventListener('click', ()=>openImport(0));
els.btnImportB.addEventListener('click', ()=>openImport(1));
els.btnCancelImport.addEventListener('click', closeImport);
els.btnCloseImport.addEventListener('click', closeImport);

els.btnCloseExport.addEventListener('click', closeExport);
els.btnCloseExportX.addEventListener('click', closeExport);
els.btnDownloadExport.addEventListener('click', ()=>{
  if(!lastExport?.capsule) return;
  downloadCapsule(lastExport.capsule, lastExport.filename || 'arena_export');
});
els.btnCopyExportKey.addEventListener('click', async ()=>{
  if(!lastExport?.key) return;
  try{
    await navigator.clipboard.writeText(String(lastExport.key));
    toast('Key copied');
  }catch(e){
    // fallback
    prompt('Copy key:', String(lastExport.key));
  }
});


els.btnDoImport.addEventListener('click', async ()=>{
  try{
    const file = els.fileInput.files?.[0];
    const key = String(els.keyInput.value||'').trim();
    if(!file) throw new Error('Choose a file');
    if(!key) throw new Error('Enter key');

    const cap = await parseCapsuleFile(file);
    const payload = await decryptCapsule(cap, key);

    const org = payload?.organismState;
    if(!org) throw new Error('Invalid capsule payload');

    const geom = normalizeFromCapsule(org);
    if(geom.cells.length < arena.params.minBlocksKO) throw new Error('Too small for arena');

    const name = String(payload?.meta?.name || 'Fighter').slice(0, 20);
    const wins = payload?.meta?.wins|0;
    const honor = payload?.meta?.honor|0;

    const fighter = {
      id: importTarget === 0 ? 'A' : 'B',
      name,
      mass: geom.cells.length,
      alive: true,
      geom,
      transform: { pos: {x:0,y:0}, vel: {x:0,y:0} },
      combat: { grappleTimer: 0, activeEffects: {} },
      stats: { damageDealt: 0, damageTaken: 0, contactFrames: 0 },
      meta: { wins, honor, fairPlay: payload?.meta?.fairPlay ?? true },
      // keep original organismState for export base
      organismState: org,
    };

    arena.fighters[importTarget] = fighter;

    placeFightersIdle();
    updatePanels();
    toast(`Loaded ${fighter.id}: ${fighter.name} (${fighter.mass})`);
    closeImport();
  }catch(e){
    els.importErr.style.display = 'block';
    els.importErr.textContent = String(e?.message || e);
  }
});

els.btnStart.addEventListener('click', ()=>{
  if(!arena.fighters[0] || !arena.fighters[1]){
    toast('Import both fighters first');
    return;
  }
  arena.mode = 'match';
  arena.winnerId = null;
  arena.resultText = '';

  // deep reset geometry from original organismState each match
  for(const f of arena.fighters){
    f.geom = normalizeFromCapsule(f.organismState);
    f.mass = f.geom.cells.length;
    f.alive = true;
    f.stats.damageDealt = 0;
    f.stats.damageTaken = 0;
    f.stats.contactFrames = 0;
    f.combat.grappleTimer = 0;
  }

  initMatch(arena);
  els.btnExportWinner.disabled = true;
  toast('Match started');
});

els.btnNewMatch.addEventListener('click', ()=>{
  arena.mode = 'idle';
  arena.winnerId = null;
  arena.resultText = '';
  for(const f of arena.fighters){
    if(!f) continue;
    f.stats.damageDealt = 0;
    f.stats.damageTaken = 0;
    f.stats.contactFrames = 0;
    f.alive = true;
    f.combat.grappleTimer = 0;
  }
  rebuildWorldCells(arena);
  els.btnExportWinner.disabled = true;
  toast('Idle');
});

els.btnExportWinner.addEventListener('click', async ()=>{
  try{
    if(arena.mode !== 'finished' || !arena.winnerId) return;
    const winner = arena.winnerId === 'A' ? arena.fighters[0] : arena.fighters[1];
    if(!winner) return;

    // Build payload from current geometry
    // We overwrite organismState.body.cells with remaining cells (geometry updated by damage)
    const org = structuredClone(winner.organismState);
    org.body = org.body || {};
    const asPairs = Array.isArray(org?.body?.cells) && Array.isArray(org.body.cells[0]);
    org.body.cells = asPairs
      ? winner.geom.cells.map(c=>[c.x, c.y])
      : winner.geom.cells.map(c=>({x:c.x, y:c.y}));

    const meta = {
      name: winner.name,
      blocks: winner.geom.cells.length,
      createdAt: Math.floor(Date.now()/1000),
      wins: winner.meta.wins|0,
      honor: winner.meta.honor|0,
      fairPlay: winner.meta.fairPlay ?? true,
    };

    const payload = { organismState: org, meta };
    const key = randomKey(16);
    const capsule = await encryptCapsule(payload, key, { capsuleId: crypto.randomUUID(), organismId: org.organismId || crypto.randomUUID() });

    lastExport = { capsule, key, filename: `${winner.name}_winner` };
    downloadCapsule(capsule, `${winner.name}_winner`);
    openExport(`Winner exported: ${winner.name}`);
    toast('Winner capsule exported');
  }catch(e){
    alert(String(e?.message||e));
  }
});

function updatePanels(){
  const A = arena.fighters[0];
  const B = arena.fighters[1];

  els.aName.textContent = A ? A.name : '—';
  els.aBlocks.textContent = A ? String(A.mass) : '—';
  els.aWins.textContent = A ? String(A.meta.wins|0) : '—';
  els.aHonor.textContent = A ? String(A.meta.honor|0) : '—';

  els.bName.textContent = B ? B.name : '—';
  els.bBlocks.textContent = B ? String(B.mass) : '—';
  els.bWins.textContent = B ? String(B.meta.wins|0) : '—';
  els.bHonor.textContent = B ? String(B.meta.honor|0) : '—';
}

function updateHud(){
  const A = arena.fighters[0];
  const B = arena.fighters[1];

  if(arena.mode === 'match'){
    els.hudStatus.textContent = 'Match running…';
  } else if(arena.mode === 'finished'){
    els.hudStatus.textContent = arena.resultText || 'Finished';
  } else {
    els.hudStatus.textContent = 'Idle';
  }

  els.hudA.textContent = A ? `${A.name} ${A.mass} (dmg ${A.stats.damageDealt|0})` : '—';
  els.hudB.textContent = B ? `${B.name} ${B.mass} (dmg ${B.stats.damageDealt|0})` : '—';

  // Enable export when finished and winner exists
  els.btnExportWinner.disabled = !(arena.mode === 'finished' && !!arena.winnerId);
}

// Main loop
let last = performance.now();
const FIXED = 1/60;
let acc = 0;

function loop(t){
  const dt = Math.min(0.05, (t-last)/1000);
  last = t;
  acc += dt;

  while(acc >= FIXED){
    stepArena(arena, FIXED);
    acc -= FIXED;
  }

  // sync masses (geometry may shrink)
  for(const f of arena.fighters){
    if(!f) continue;
    f.mass = f.geom.cells.length;
  }

  updatePanels();
  updateHud();
  renderArena(ctx, els.canvas, arena);

  requestAnimationFrame(loop);
}

rebuildWorldCells(arena);
updatePanels();
updateHud();
requestAnimationFrame(loop);