// js/main.js
import { fmtAgeSeconds, nowSec, barPct } from "./util.js";
import { CARROT } from "./mods/carrots.js";
import { migrateOrNew, saveGame, simulate } from "./state.js";
import { pushLog } from "./log.js";
import { ensureMoving, tickMoving, setMoveTarget, getOrgMotion } from "./moving.js";
import { BAR_MAX } from "./world.js";

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
  renderDebugLog,
  attachSettings,
  attachActions,
  attachDragPan,
  attachInfoTabs,
  attachZoomWheel,
  attachPinchZoom,
  attachLegendHuePicker,
  attachCarrotHudInput,
  attachLogFlash,
  attachDisableDoubleTapZoom,
  attachSymbiosisUI,
  attachDebugPanel
} from "./ui.js";

const els = {
  dbgPanel: document.getElementById("dbgPanel"),
  dbgTail: document.getElementById("dbgTail"),
  dbgBody: document.getElementById("dbgBody"),
  dbgCount: document.getElementById("dbgCount"),

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
  lifePill: document.getElementById("lifePill"),
  gpuStat: document.getElementById("gpuStat"),
  cpuStat: document.getElementById("cpuStat"),
  fpsStat: document.getElementById("fpsStat"),
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
  planInfo: document.getElementById("planInfo"),
  lenPrio: document.getElementById("lenPrio"),
  carrotsInput: document.getElementById("carrotsInput"),
  fxEnabled: document.getElementById("fxEnabled"),
  newCreature: document.getElementById("newCreature"),
  symbiosisBtn: document.getElementById("symbiosisBtn"),
  symbiosisOverlay: document.getElementById("symbiosisOverlay"),
  symShowHint: document.getElementById("symShowHint"),
  symShareBtn: document.getElementById("symShareBtn"),
  symShareOutput: document.getElementById("symShareOutput"),
  symReceiveInput: document.getElementById("symReceiveInput"),
  symApplyBtn: document.getElementById("symApplyBtn"),
  symCloseBtn: document.getElementById("symCloseBtn"),
  symPermissionsHint: document.getElementById("symPermissionsHint"),
  symConfirm: document.getElementById("symConfirm"),
  symConfirmYes: document.getElementById("symConfirmYes"),
  symConfirmNo: document.getElementById("symConfirmNo"),

  // left screen log (debug)
  dbgPanel: document.getElementById("dbgPanel"),
  dbgTail: document.getElementById("dbgTail"),
  dbgBody: document.getElementById("dbgBody"),
  dbgCount: document.getElementById("dbgCount"),
};

const toast = makeToast();

const view = {
  state: null,

  // Camera (world coords in blocks). View-only: not stored in save.
  cam: { ox: 0, oy: 0 },
  // Smooth camera centering target (view-only)
  camTarget: null, // {x,y}

  // Moving module state (view-only)
  moving: null,


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

  perf: {
    lastFrameAt: 0,
    lastStatAt: 0,
    frameCount: 0,
    fps: 0,
    smoothedFrame: 16.7,
    smoothedRender: 0,
  },
  lastActive: null,

  // resize observer
  _ro: null,
};

function stopLoops(){
  if (view.renderTimer){
    cancelAnimationFrame(view.renderTimer);
    view.renderTimer = null;
  }
  if (view.autoTimer){
    clearInterval(view.autoTimer);
    view.autoTimer = null;
  }
}

function syncToSize(){
  // returns true if something changed
  return syncCanvas(els.canvas, els.grid, view);
}

function rerenderAll(deltaSec){
  if (!view.state) return;

  syncToSize();

  const root = view.state;
  const a = root.active;
  const selectedOrg = (Number.isFinite(a) && a >= 0 && Array.isArray(root.buds) && a < root.buds.length)
    ? root.buds[a]
    : root;
  renderRules(els.rulesBody);
  renderLegend(selectedOrg, els.legendBody);
  renderLog(view.state, els);
  renderDebugLog(view, els);
  renderHud(root, selectedOrg, els, deltaSec, fmtAgeSeconds, view.zoom);
  // organism info tab
  if (els.orgInfo){
    const root = view.state;
    const buds = Array.isArray(root.buds) ? root.buds : [];

    const mkBlocks = (o)=> (o?.body?.cells?.length||0) + (o?.modules||[]).reduce((s,m)=>s+(m?.cells?.length||0),0);
    const mkBarsRow = (o)=>{
      const b = o?.bars || {};
      const tone = (v)=>{
        if (!Number.isFinite(v)) return "";
        if (v > 0.80) return "ok";
        if (v > 0.60) return "info";
        if (v > 0.20) return "warn";
        if (v > 0.00) return "bad";
        return "bad";
      };

      // Show exactly like the top HUD: same labels, same % conversion, same tone classes.
      const items = [
        ["еда",  b.food],
        ["чист", b.clean],
        ["здор", b.hp],
        ["настр", b.mood],
      ];
      return `
        <div class="orgCellPills">
          ${items.map(([k,v])=>{
            const p = barPct(v);
            const cls = tone(v);
            return `<span class="pill ${cls}">${k}: ${p}%</span>`;
          }).join("")}
        </div>`;
    };
    const mkItem = (which, o)=>{
      const isSel = (root.active === (which === -1 ? -1 : which));
      const blocks = mkBlocks(o);
      const stage = (o===root) ? 'Родитель' : 'Почка';
      const name = (o?.name || '—');
      const now = root.lastSeen || 0;
      const createdAt = (o?.createdAt ?? now);
      const age = Math.max(0, now - createdAt);
      const ageTxt = fmtAgeSeconds ? fmtAgeSeconds(age) : `${Math.floor(age)}с`;
      const cls = isSel ? 'orgCell isActive' : 'orgCell';
      return `
        <div class="${cls}" data-which="${which}">
          <div class="orgCellTop">${escapeHtml(name)}<span class="orgCellStage">${stage}</span></div>
          <div class="orgCellMeta">блоков: ${blocks} • жизнь: ${ageTxt}</div>
          ${mkBarsRow(o)}
        </div>`;
    };

    const listHtml = [
      mkItem(-1, root),
      ...buds.map((b,i)=> mkItem(i, b))
    ].join('');

    els.orgInfo.innerHTML = `
      <div class="orgList">${listHtml}</div>
      <div style="color:var(--muted); font-size:11px;">Клик — выбрать, Дабл Клик центрировать камеру на ядре. Дабл-клик по полю — отправить путь.</div>
    `;
  }
  renderGrid(view.state, els.canvas, els.grid, view);
}

function escapeHtml(s){
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function shorten(s, max=76){
  s = String(s ?? "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max-1)) + "…";
}
function getLogLine(entry){
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  if (typeof entry === "object"){
    return entry.msg ?? entry.text ?? entry.message ?? entry.title ?? entry.s ?? entry.m ?? "";
  }
  return String(entry);
}

function autoTick(){
  if (!view.state) return;
  const state = view.state;

  // Expose view-driven movement state to the simulation (transient, not saved).
  // Mutations are allowed only while standing; while moving they become debt.
  {
    const orgs = [state, ...(Array.isArray(state.buds) ? state.buds : [])];
    for (let i = 0; i < orgs.length; i++){
      const org = orgs[i];
      if (!org) continue;
      const orgId = (i === 0) ? 0 : i; // 0 = parent, 1.. = buds
      const m = getOrgMotion(view, orgId);
      org.__moving = !!m?.moving;
    }
  }

  const now = nowSec();
  const delta = Math.max(0, now - (state.lastSeen || now));

  if (delta <= 0){
    rerenderAll(0);
    return;
  }

  const logBefore = (state.log || []).length;
  const sim = simulate(state, delta);
  state.lastSeen = now;
  saveGame(state);
  rerenderAll(delta);

  if (delta >= 15 && sim.dueSteps > 0){
    showOfflineSummary(delta, sim);
  }

  // Informative top toast: short duplicate of the newest log line this tick.
  const logAfter = (state.log || []).length;
  const addedLogs = Math.max(0, logAfter - logBefore);
  if (addedLogs > 0){
    const last = state.log?.[logAfter - 1];
    const line = shorten(getLogLine(last), 76);
    const extras = [];
    if ((sim.mutations|0) > 1) extras.push(`×${sim.mutations|0}`);
    if (addedLogs > 1) extras.push(`+${addedLogs-1}`);
    const suffix = extras.length ? ` <span style="opacity:.7">${extras.join(" ")}</span>` : "";
    toast(`${escapeHtml(line)}${suffix}`);
  } else if ((sim.mutations|0) > 0){
    toast(`Мутаций: <b>${sim.mutations|0}</b>.`);
  }

}

function tickCamera(view, dtSec){
  if (!view || !view.cam || !view.camTarget) return;
  const dt = Math.max(0, dtSec || 0);
  if (dt <= 0) return;
  const tx = view.camTarget.x;
  const ty = view.camTarget.y;
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;

  // Exponential smoothing: ~fast, but never snaps.
  // k=8 => reaches ~95%% in ~0.4s
  const k = 8;
  const a = 1 - Math.exp(-k * dt);
  view.cam.ox += (tx - view.cam.ox) * a;
  view.cam.oy += (ty - view.cam.oy) * a;

  // Stop when close enough
  if (Math.abs(tx - view.cam.ox) < 0.02 && Math.abs(ty - view.cam.oy) < 0.02){
    view.cam.ox = tx;
    view.cam.oy = ty;
    view.camTarget = null;
  }
}


function startLoops(){
  // Hard cap for INTERNAL animation/view calculations.
  // Rendering stays on rAF for smoothness; we just don't advance
  // these calculations more often than 30Hz.
  const targetFrameMs = 1000 / 30;
  const frame = ()=>{
    if (!view.state) return;
    const now = performance.now();
    const perf = view.perf;

    const delta = perf.lastFrameAt ? Math.max(0, now - perf.lastFrameAt) : targetFrameMs;
    perf.lastFrameAt = now;
    perf.smoothedFrame = perf.smoothedFrame * 0.9 + delta * 0.1;
    perf.frameCount += 1;

    // View-only animation ticks (capped to 30Hz)
    perf.accumMs = (perf.accumMs || 0) + delta;
    // prevent spiral-of-death after tab-in
    const maxCatchUp = targetFrameMs * 4;
    if (perf.accumMs > maxCatchUp) perf.accumMs = maxCatchUp;
    while (perf.accumMs >= targetFrameMs){
      tickMoving(view, view.state, targetFrameMs/1000);
      tickCamera(view, targetFrameMs/1000);
      perf.accumMs -= targetFrameMs;
    }

    const renderStart = performance.now();
    renderGrid(view.state, els.canvas, els.grid, view);
    const renderTime = performance.now() - renderStart;
    perf.smoothedRender = perf.smoothedRender * 0.9 + renderTime * 0.1;
    if (view.lastActive !== view.state.active){
      view.lastActive = view.state.active;
      rerenderAll(0);
    }

    if (now - perf.lastStatAt >= 250){
      const span = now - perf.lastStatAt || 1;
      perf.fps = Math.min(999, Math.round((perf.frameCount * 1000) / span));
      perf.frameCount = 0;
      perf.lastStatAt = now;

      const cpuLoad = Math.min(100, Math.max(0, Math.round((perf.smoothedRender / Math.max(1, perf.smoothedFrame)) * 100)));
      // GPU-like load: how much time a frame takes compared to our 30Hz internal tick budget.
      const gpuLoad = Math.min(100, Math.max(0, Math.round((perf.smoothedFrame / targetFrameMs) * 100)));

      if (els.cpuStat) els.cpuStat.textContent = `CPU: ${cpuLoad}%`;
      if (els.gpuStat) els.gpuStat.textContent = `GPU: ${gpuLoad}%`;
      if (els.fpsStat) els.fpsStat.textContent = `FPS: ${perf.fps}`;
    }
    view.renderTimer = requestAnimationFrame(frame);
  };

  if (!view.renderTimer){
    syncToSize();
    view.perf.lastFrameAt = 0;
    view.perf.lastStatAt = performance.now();
    view.perf.frameCount = 0;
    view.renderTimer = requestAnimationFrame(frame);
  }

  if (!view.autoTimer){
    view.autoTimer = setInterval(autoTick, 1000);
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

  const wx = Math.floor((vx - Vx) + (view.cam?.ox || 0));
  const wy = Math.floor((vy - Vy) + (view.cam?.oy || 0));
  return [wx, wy];
}



function attachPickOrganism(){
  let pendingClearTimer = null;
  const cancelPendingClear = ()=>{
    if (pendingClearTimer){
      clearTimeout(pendingClearTimer);
      pendingClearTimer = null;
    }
  };

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

      // max carrots per feeding tick (same as mutation tick)
      const intervalSec = Math.max(1, Math.floor(Number(s.evoIntervalMin || 12) * 60));
      const tickId = Math.floor(nowSec() / intervalSec);
      s.carrotTick = s.carrotTick || { id: tickId, used: 0 };
      if (s.carrotTick.id !== tickId){ s.carrotTick.id = tickId; s.carrotTick.used = 0; }
      if (s.carrotTick.used >= CARROT.maxPerTick){
        toast(`Лимит: ${CARROT.maxPerTick} морковки за тик.`);
        return;
      }

      // place carrot with its 3x7 shape starting at click cell
      s.carrots = Array.isArray(s.carrots) ? s.carrots : [];
      s.carrots.push({ x: wx, y: wy, w: CARROT.w, h: CARROT.h, t: nowSec() });
      s.carrotTick.used++;
      inv.carrots--;

      pushLog(s, `Морковка: брошена. Осталось: ${Math.max(0, inv.carrots|0)}.`, "carrot");


      toast(`Морковка: (${wx},${wy}).`);

      saveGame(s);
      rerenderAll(0);
      return; // do not change selection
    }

    // Clicking on empty field should allow clearing selection.
    // But single click is also the first half of a double-click; delay clearing a bit.
    cancelPendingClear();
    pendingClearTimer = setTimeout(()=>{
      pendingClearTimer = null;
      if (!view.state) return;
      // clear selection completely
      view.state.active = null;
      saveGame(view.state);
      rerenderAll(0);
    }, 260);
  });
  // Double-click / double-tap: move selected organism to clicked point ("swim")
els.grid.addEventListener("dblclick", (e)=>{
    if (!view.state) return;
    if (view.mode === "carrot") return;

    cancelPendingClear();

    const a = view.state.active;

    // Важно: плавание — только если реально выбран организм (рамка через ячейку)
    if (a === null || a === undefined) return;

    const [wx, wy] = screenToWorld(e);

    // which: -1 (родитель) или 0..n-1 (почки)
    const which = Number.isFinite(a) ? (a|0) : null;
    if (which === null) return;

    // orgId: 0 = родитель, 1.. = почки
    const orgId = (which === -1) ? 0 : (which + 1);

    setMoveTarget(view, view.state, orgId, wx, wy);
  });

  // touch double-tap (mobile)
  const DT_MS = 280;
  const DT_DIST_PX = 18;
  let lastTap = null;
  els.grid.addEventListener("pointerup", (e)=>{
    if (e.pointerType !== "touch") return;
    if (!view.state) return;
    if (view.mode === "carrot") return;
    if (view._pinchActive) return;
	const a = view.state.active;

    // Важно: без выбора через ячейку — double-tap ничего не делает
    if (a === null || a === undefined) return;

    const sel = a;
    const now = performance.now();
    const cur = { t: now, x: e.clientX, y: e.clientY, ev: e };
    if (lastTap && (now - lastTap.t) <= DT_MS){
      const dx = cur.x - lastTap.x;
      const dy = cur.y - lastTap.y;
      if ((dx*dx + dy*dy) <= (DT_DIST_PX*DT_DIST_PX)){
        cancelPendingClear();
        const [wx, wy] = screenToWorld(e);
        const which = Number.isFinite(sel) ? (sel|0) : null;
        if (which === null) return;
        const orgId = (which === -1) ? 0 : (which + 1);
        setMoveTarget(view, view.state, orgId, wx, wy);
        lastTap = null;
        return;
      }
    }
    lastTap = cur;
  });

}

function attachOrgListClicks(){
  if (!els.orgInfo) return;
  if (els.orgInfo.__hasOrgListClicks) return;
  els.orgInfo.__hasOrgListClicks = true;

  // A single click is also the first half of a double-click.
  // If we rerender immediately on the first click, the list DOM is rebuilt and
  // the dblclick may never fire. So we defer the single-click action briefly
  // and cancel it if a dblclick happens.
  let clickTimer = null;
  let pendingWhich = null;

  els.orgInfo.addEventListener("click", (ev)=>{
    const cell = ev.target?.closest?.(".orgCell");
    if (!cell) return;
    if (!view.state) return;
    const which = parseInt(cell.dataset.which, 10);
    if (!Number.isFinite(which)) return;

    // Defer single-click select a bit so dblclick can win.
    pendingWhich = which;
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(()=>{
      clickTimer = null;
      if (!view.state) return;
      view.state.active = pendingWhich;
      saveGame(view.state);
      rerenderAll(0);
    }, 220);
  });

  // Double click: center camera on clicked organism
  els.orgInfo.addEventListener("dblclick", (ev)=>{
    if (clickTimer){ clearTimeout(clickTimer); clickTimer = null; }
    const cell = ev.target?.closest?.(".orgCell");
    if (!cell) return;
    if (!view.state) return;
    const which = parseInt(cell.dataset.which, 10);
    if (!Number.isFinite(which)) return;

    // Ensure selection matches
    view.state.active = which;
    saveGame(view.state);

    const org = (which === -1) ? view.state : (view.state.buds?.[which] || null);
    const core = org?.body?.core;
    if (Array.isArray(core) && core.length === 2){
      const orgId = (which === -1) ? 0 : (which|0) + 1;
      const m = getOrgMotion(view, orgId);
      const ox = Number.isFinite(m?.offsetX) ? m.offsetX : 0;
      const oy = Number.isFinite(m?.offsetY) ? m.offsetY : 0;
      view.camTarget = { x: (core[0] || 0) + ox, y: (core[1] || 0) + oy };
    }
    rerenderAll(0);
  });
}


async function startGame(){
  view.state = migrateOrNew();
  view.lastActive = view.state?.active ?? null;
  // View-only FX toggle from settings (defaults to ON)
  view.fx = view.fx || {};
  view.fx.enabled = (view.state?.settings?.fxEnabled !== false);
  ensureMoving(view);

  // Always center camera to the parent organism on game start (view-only, not persisted).
  // (Selection may be restored to a bud, but the initial framing should show the parent.)
  const c = view.state?.body?.core || [0, 0];
  view.cam = { ox: (c[0]||0), oy: (c[1]||0) };
  view.camTarget = null;

  els.startOverlay.style.display = "none";

  // hooks
  attachDebugPanel(view, els);
  attachSettings(view, els, toast);
  attachActions(view, els, toast, rerenderAll);
  attachDragPan(view, els); // drag uses els.grid size + view.gridW/H
  attachPinchZoom(view, els, rerenderAll);
  attachDisableDoubleTapZoom(els);
  attachInfoTabs(els);
  attachLogFlash(view, els, rerenderAll);
  attachLegendHuePicker(view, els, rerenderAll);
  attachCarrotHudInput(view, els, rerenderAll);
  attachZoomWheel(view, els, rerenderAll);
  attachSymbiosisUI(view, els, toast);
  attachPickOrganism();
  attachOrgListClicks();


  setupResizeObserver();

  rerenderAll(0);
  autoTick();
  startLoops();
}

function showOfflineSummary(deltaSec, sim){
  let el = document.getElementById("offlineSummary");
  if (!el){
    el = document.createElement("div");
    el.id = "offlineSummary";
    el.style.position = "fixed";
    el.style.inset = "0";
    el.style.background = "rgba(0,0,0,0.6)";
    el.style.display = "flex";
    el.style.alignItems = "center";
    el.style.justifyContent = "center";
    el.style.zIndex = "9999";
    el.innerHTML = `
      <div class="offlineCard">
        <div class="offlineTitle">Пока тебя не было…</div>
        <div id="offlineText" class="offlineText"></div>
        <button class="offlineOk" id="offlineOk">OK</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector("#offlineOk").onclick = ()=> el.remove();
  }

  const mins = Math.round(deltaSec/60);
  const mutTotal = (sim.mutations|0) + (sim.budMutations|0);
  const grown = sim.grownBlocks|0;
  const shrunk = sim.shrunkBlocks|0;

  const lines = [];
  lines.push(`Отсутствие: <b>${mins} мин</b>`);
  lines.push(`Мутаций: <b>${mutTotal}</b>`);
  lines.push(`Рост: <b>+${grown}</b> блок.`);
  lines.push(`Усыхание: <b>-${shrunk}</b> блок.`);

  el.querySelector("#offlineText").innerHTML = lines.join("<br>");
}

els.playBtn.addEventListener("click", startGame);
