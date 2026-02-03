// js/main.js
import { fmtAgeSeconds, nowSec } from "./util.js";
import { CARROT } from "./mods/carrots.js";
import { migrateOrNew, saveGame, simulate } from "./state.js";

import {
  syncCanvas,
  renderRules,
  renderLegend,
  renderHud,
  renderGrid
} from "./render.js";

import {
  makeToast,
  renderLog,
  attachSettings,
  attachActions,
  attachDragPan,
  attachInfoTabs,
  attachZoomWheel,
  attachPinchZoom,
  attachLegendHuePicker,
  attachCarrotHudInput,
  attachLogFlash
} from "./ui.js";

const els = {
  startOverlay: document.getElementById("startOverlay"),
  playBtn: document.getElementById("playBtn"),

  settingsBtn: document.getElementById("settingsBtn"),
  settingsOverlay: document.getElementById("settingsOverlay"),
  evoInput: document.getElementById("evoInput"),
  saveSettings: document.getElementById("saveSettings"),
  closeSettings: document.getElementById("closeSettings"),

  hudName: document.getElementById("hudName"),
  hudStage: document.getElementById("hudStage"),
  hudMeta: document.getElementById("hudMeta"),
  hudMeta2: document.getElementById("hudMeta2"),
  hudSeed: document.getElementById("hudSeed"),
  lifePill: document.getElementById("lifePill"),
  carrotHudInput: document.getElementById("carrotHudInput"),
  footerInfo: document.getElementById("footerInfo"),

  mainPanel: document.getElementById("mainPanel"),
  grid: document.getElementById("grid"),
  canvas: document.getElementById("canvas"),

  rulesBody: document.getElementById("rulesBody"),
  legendBody: document.getElementById("legendBody"),
  huePicker: document.getElementById("huePicker"),
  hueTitle: document.getElementById("hueTitle"),
  hueRange: document.getElementById("hueRange"),

  logBody: document.getElementById("logBody"),
  logFooter: document.getElementById("logFooter"),

  infoTabs: document.getElementById("infoTabs"),
  tabOrg: document.getElementById("tab-org"),
  tabLegend: document.getElementById("tab-legend"),
  tabLog: document.getElementById("tab-log"),
  tabRules: document.getElementById("tab-rules"),
  orgInfo: document.getElementById("orgInfo"),

  feed: document.getElementById("feed"),
  wash: document.getElementById("wash"),
  heal: document.getElementById("heal"),
  // settings modal extra fields
  seedInput: document.getElementById("seedInput"),
  lenPrio: document.getElementById("lenPrio"),
  carrotsInput: document.getElementById("carrotsInput"),
  newCreature: document.getElementById("newCreature"),
};

const toast = makeToast();

const view = {
  state: null,

  // dynamic camera size in blocks
  gridW: 60,
  gridH: 40,
  blockPx: 4,
  dpr: 1,
  zoom: 0, // -3..+3 (mouse wheel)

  // interaction modes
  mode: null, // "carrot" or null


  // timers
  renderTimer: null,
  autoTimer: null,

  // resize observer
  _ro: null,
};

function stopLoops(){
  if (view.renderTimer){ clearInterval(view.renderTimer); view.renderTimer = null; }
  if (view.autoTimer){ clearInterval(view.autoTimer); view.autoTimer = null; }
}

function syncToSize(){
  // returns true if something changed
  return syncCanvas(els.canvas, els.grid, view);
}

function rerenderAll(deltaSec){
  if (!view.state) return;

  syncToSize();

  renderRules(els.rulesBody);
  renderLegend(view.state, els.legendBody);
  renderLog(view.state, els);
  renderHud(view.state, els, deltaSec, fmtAgeSeconds, view.zoom);
  // organism info tab
  if (els.orgInfo){
    const root = view.state;
    const a = root.active;
    const org = (Number.isFinite(a) && a >= 0 && Array.isArray(root.buds) && a < root.buds.length)
      ? root.buds[a]
      : root;
    const age = Math.max(0, (root.lastSeen||0) - (org.createdAt||root.createdAt||root.lastSeen||0));
    const blocks = (org.body?.cells?.length||0) + (org.modules||[]).reduce((s,m)=>s+(m.cells?.length||0),0);
    els.orgInfo.innerHTML = `
      <div><b>${org.name || "—"}</b></div>
      <div style="color:var(--muted); margin-top:6px;">Стадия: ${org===root ? "Родитель" : "Почка"} • блоков: ${blocks}</div>
      <div style="color:var(--muted);">Возраст: ${fmtAgeSeconds(age)}</div>
      <div style="color:var(--muted); margin-top:8px;">Режим кормления: ${view.mode === "carrot" ? "БРОСЬ МОРКОВКУ" : "—"}</div>
    `;
  }
  renderGrid(view.state, els.canvas, els.grid, view);
}

function autoTick(){
  if (!view.state) return;
  const state = view.state;

  const now = nowSec();
  const delta = Math.max(0, now - (state.lastSeen || now));

  if (delta <= 0){
    rerenderAll(0);
    return;
  }

  const sim = simulate(state, delta);
  state.lastSeen = now;
  saveGame(state);

  rerenderAll(delta);

  if (sim.mutations > 0){
    toast(`Мутаций: <b>${sim.mutations}</b>.`);
  }
}

function startLoops(){
  // Smooth-ish renderer for animations (blink/wind/breath)
  if (!view.renderTimer){
    view.renderTimer = setInterval(()=>{
      if (!view.state) return;
      syncToSize();
     renderGrid(view.state, els.canvas, els.grid, view);
	
    }, 100);
  }

  // Auto-update stats + simulate offline progress
  if (!view.autoTimer){
    view.autoTimer = setInterval(autoTick, 2000);
  }
}

function setupResizeObserver(){
  if (view._ro) return;

  view._ro = new ResizeObserver(() => {
    if (!view.state) return;

    // Пробрасываем фактический размер игрового окна в CSS-переменные,
    // чтобы соседние панели (например #infoPanel) могли рассчитывать свою высоту.
    const w = els.mainPanel.clientWidth;
    const h = els.mainPanel.clientHeight;
    document.documentElement.style.setProperty('--gameW', `${w}px`);
    document.documentElement.style.setProperty('--gameH', `${h}px`);

    syncToSize();
    rerenderAll(0);
  });

  view._ro.observe(els.mainPanel);
}


function clampZoom(z){
  return Math.max(-3, Math.min(3, z|0));
}

function occHas(org, wx, wy){
  if (!org || !org.body) return false;
  const k = `${wx},${wy}`;
  for (const [x,y] of (org.body.cells || [])) if (`${x},${y}` === k) return true;
  for (const m of (org.modules || [])){
    for (const [x,y] of (m.cells || [])) if (`${x},${y}` === k) return true;
  }
  return false;
}

function screenToWorld(e){
  const rect = els.grid.getBoundingClientRect();
  const px = (e.clientX - rect.left);
  const py = (e.clientY - rect.top);

  const s = Math.max(1, view.blockPx);
  const vx = px / s;
  const vy = py / s;

  const Vx = (view.gridW - 1) / 2;
  const Vy = (view.gridH - 1) / 2;

  const wx = Math.floor((vx - Vx) + (view.state.cam?.ox || 0));
  const wy = Math.floor((vy - Vy) + (view.state.cam?.oy || 0));
  return [wx, wy];
}



function attachPickOrganism(){
  els.grid.addEventListener("click", (e)=>{
    if (!view.state) return;

    const [wx, wy] = screenToWorld(e);
    const s = view.state;

    // Carrot-throw mode (feeding is now interactive)
    if (view.mode === "carrot"){
      const inv = s.inv || (s.inv = { carrots: 0 });
      if (inv.carrots <= 0){
        toast("Нет морковок.");
        return;
      }

      // max 2 carrots per feeding tick (same as mutation tick)
      const intervalSec = Math.max(60, Math.floor(s.evoIntervalMin * 60));
      const tickId = Math.floor(nowSec() / intervalSec);
      s.carrotTick = s.carrotTick || { id: tickId, used: 0 };
      if (s.carrotTick.id !== tickId){ s.carrotTick.id = tickId; s.carrotTick.used = 0; }
      if (s.carrotTick.used >= CARROT.maxPerTick){
        toast("Лимит: 2 морковки за тик.");
        return;
      }

      // place carrot with its 7x3 rect starting at click cell
      s.carrots = Array.isArray(s.carrots) ? s.carrots : [];
      s.carrots.push({ x: wx, y: wy, w: CARROT.w, h: CARROT.h, t: nowSec() });
      s.carrotTick.used++;
      inv.carrots--;

      saveGame(s);
      rerenderAll(0);
      return; // do not change selection
    }

    // Prefer exact hit on occupied cell
    const buds = Array.isArray(s.buds) ? s.buds : [];
    let picked = null; // -1 parent, or bud index

    // IMPORTANT: check buds first, иначе родитель "перехватывает" клики по перекрывающимся клеткам
    for (let i=0;i<buds.length;i++){
      if (occHas(buds[i], wx, wy)){ picked = i; break; }
    }
    if (picked === null && occHas(s, wx, wy)) picked = -1;

// If no exact hit, pick nearest core within 2 blocks
    if (picked === null){
      let best = { d: Infinity, which: null };
      const core = s.body?.core;
      if (core){
        const dx = core[0]-wx, dy = core[1]-wy;
        const d = dx*dx + dy*dy;
        if (d < best.d){ best = { d, which: -1 }; }
      }
      for (let i=0;i<buds.length;i++){
        const c = buds[i].body?.core;
        if (!c) continue;
        const dx = c[0]-wx, dy = c[1]-wy;
        const d = dx*dx + dy*dy;
        if (d < best.d){ best = { d, which: i }; }
      }
      if (best.d <= 4) picked = best.which; // radius 2
    }

    // Click on empty space clears selection
    if (picked === null){
      s.active = null;
      saveGame(s);
      rerenderAll(0);
      return;
    }

    // store selection: -1 = parent, 0.. = bud index
    s.active = picked;
    saveGame(s);
    rerenderAll(0);
  });
}

function startGame(){
  view.state = migrateOrNew();

  els.startOverlay.style.display = "none";

  // hooks
  attachSettings(view, els, toast);
  attachActions(view, els, toast, rerenderAll);
  attachDragPan(view, els); // drag uses els.grid size + view.gridW/H
  attachPinchZoom(view, els, rerenderAll);
  attachInfoTabs(els);
  attachLogFlash(view, els, rerenderAll);
  attachLegendHuePicker(view, els, rerenderAll);
  attachCarrotHudInput(view, els, rerenderAll);
  attachZoomWheel(view, els, rerenderAll);
  attachPickOrganism();

  setupResizeObserver();

  rerenderAll(0);
  autoTick();
  startLoops();
}

els.playBtn.addEventListener("click", startGame);
