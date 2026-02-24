// js/main.js
import { fmtAgeSeconds, nowSec, barPct, mulberry32, hash32 } from "./util.js";
import { CARROT } from "./mods/carrots.js";
import { COIN } from "./mods/coins.js";
import { migrateOrNew, saveGame, simulate } from "./state.js";
import { pushLog } from "./log.js";
import { ensureMoving, tickMoving, setMoveTarget, getOrgMotion } from "./moving.js";
import { BAR_MAX } from "./world.js";
import { addRipple, RIPPLE_KIND } from "./FX/ripples.js";
import { getFxPipeline } from "./FX/pipeline.js";
import { UI, PERF } from "./config.js";
import {
  initBioHandpan,
  setOrganismFilter,
  debugPlayTestHit,
  setBioHandpanEnabled,
  playOrganTap,
} from "./mods/audio/bio_handpan.js";

import { applyIconCssVars, moodEmoji, stateEmoji } from "../content/icons.js";


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
  attachInfoTabs,
  attachLegendHuePicker,
  attachCarrotHudInput,
  attachCoinHudInput,
  attachLogFlash,
  attachDisableDoubleTapZoom,
  attachSymbiosisUI,
  attachDebugPanel,
  attachDragPan,
  attachZoomWheel
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
  coinHudInput: document.getElementById("coinHudInput"),
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
  coin: document.getElementById("coin"),
  wash: document.getElementById("wash"),
  heal: document.getElementById("heal"),
  seedInput: document.getElementById("seedInput"),
  planInfo: document.getElementById("planInfo"),
  lenPrio: document.getElementById("lenPrio"),
  carrotsInput: document.getElementById("carrotsInput"),
  coinsInput: document.getElementById("coinsInput"),
  fxEnabled: document.getElementById("fxEnabled"),
  soundEnabled: document.getElementById("soundenabled"),  //звук
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
  
 
};

// Глобальные флаги
window._wasDrag = false;
window._pendingClearTimer = null;

applyIconCssVars();
const toast = makeToast();

const view = {
  state: null,
  cam: { ox: 0, oy: 0 },
  camTarget: null,
  moving: null,
  gridW: 60,
  gridH: 40,
  blockPx: 4,
  dpr: 1,
  zoom: 0,
  mode: null,
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
  _ro: null,
  flash: null,
};

window.debugPlayTestHit = debugPlayTestHit;

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
  
  view._uiCache = view._uiCache || {};
  const cache = view._uiCache;

  if (!cache.rulesRendered){
    renderRules(els.rulesBody);
    cache.rulesRendered = true;
  }


  const mods = Array.isArray(selectedOrg?.modules) ? selectedOrg.modules : [];
  let modsCells = 0;
  for (const m of mods) modsCells += (m?.cells?.length || 0);
  const legendKey = `${root.active}|${mods.length}|${modsCells}`;
  if (cache.legendKey !== legendKey){
    renderLegend(selectedOrg, els.legendBody);
    cache.legendKey = legendKey;
  }

  const logRoot = (view.state && view.state.__logRoot) ? view.state.__logRoot : view.state;
  const log = (logRoot?.log || []);
  const logLen = log.length;
  const logRev = (logRoot && Number.isFinite(logRoot.__logRev)) ? logRoot.__logRev : 0;
  const logSig = logRev ? `r${logRev}` : `l${logLen}|t${(logLen ? (log[logLen-1]?.t||0) : 0)}`;
  if (cache.logSig !== logSig){
    renderLog(view.state, els);
    cache.logSig = logSig;
  }

  renderDebugLog(view, els);
  renderHud(root, selectedOrg, els, deltaSec, fmtAgeSeconds, view.zoom);
  
  if (els.orgInfo){
    const now = performance.now();
    const needOrgInfo = (cache.orgInfoActive !== root.active) || (!cache.orgInfoAt) || ((now - cache.orgInfoAt) >= (UI.ORGINFO_UPDATE_MS || 3000));
    if (needOrgInfo) {
      const buds = Array.isArray(root.buds) ? root.buds : [];
      const nowS = root.lastSeen || 0;

      const mkBlocks = (o)=> (o?.body?.cells?.length||0) + (o?.modules||[]).reduce((s,m)=>s+(m?.cells?.length||0),0);
      const mkBarsRow = (o)=>{
        const b = o?.bars || { food:1, clean:1, hp:1, mood:1 };
        const tone = (v)=>{
          if (!Number.isFinite(v)) return "";
          if (v > 0.80) return "ok";
          if (v > 0.60) return "info";
          if (v > 0.20) return "warn";
          return "bad";
        };

        const minBar = Math.min(b.food ?? 0, b.clean ?? 0, b.hp ?? 0, b.mood ?? 0);
        const statusTxt = (minBar <= 0.01) ? "усыхание" :
                          (minBar <= 0.10) ? "анабиоз" :
                          (minBar <= 0.15) ? "критично" :
                          (minBar <= 0.35) ? "плохо" :
                          (minBar <= 0.65) ? "норма" :
                          "хорошо";

        const pill = (stat, title, cls, icoText, valText)=>{
          const icoSpan = `<span class="ico">${icoText || ""}</span>`;
          const valSpan = `<span class="val">${valText}</span>`;
          return `<span class="pill stat ${cls}" data-stat="${stat}" title="${escapeHtml(title)}">${icoSpan}${valSpan}</span>`;
        };

        const f = pill("food",  `еда: ${barPct(b.food)}%`,  tone(b.food),  "", `${barPct(b.food)}%`);
        const c = pill("clean", `чист: ${barPct(b.clean)}%`, tone(b.clean), "", `${barPct(b.clean)}%`);
        const h = pill("hp",    `здор: ${barPct(b.hp)}%`,    tone(b.hp),    "", `${barPct(b.hp)}%`);
        const m = pill("mood",  `настр: ${barPct(b.mood)}%`, tone(b.mood),  moodEmoji(Math.max(0, Math.min(1, b.mood ?? 0))), `${barPct(b.mood)}%`);
        const s = pill("state", `сост: ${statusTxt}`,         tone(minBar),   stateEmoji(statusTxt), "");

        return `<div class="orgCellPills">${f}${c}${h}${m}${s}</div>`;
      };

      const mkItem = (which, o)=>{
        const isSel = (root.active === (which === -1 ? -1 : which));
        const blocks = mkBlocks(o);
        const stage = (o===root) ? 'Родитель' : 'Почка';
        const name = (o?.name || '—');
        const createdAt = (o?.createdAt ?? nowS);
        const age = Math.max(0, nowS - createdAt);
        const ageTxt = fmtAgeSeconds ? fmtAgeSeconds(age) : `${Math.floor(age)}с`;
        const cls = isSel ? 'orgCell isActive' : 'orgCell';

        return `
          <div class="${cls}" data-which="${which}">
            <div class="orgCellTop">
              <span class="orgName">${escapeHtml(name)}</span>
              <span class="orgCellStage">${stage}</span>
              <span class="orgMetaInline">блоков: ${blocks} • возраст: ${ageTxt}</span>
            </div>
            ${mkBarsRow(o)}
          </div>
        `;
      };

      const listHtml = [
        mkItem(-1, root),
        ...buds.map((b,i)=> mkItem(i, b))
      ].join('');

      els.orgInfo.innerHTML = `
        <div class="orgList">${listHtml}</div>
        <div style="color:var(--muted); font-size:11px;">Клик — выбрать, Дабл Клик центрировать камеру на ядре.</div>
      `;
      cache.orgInfoAt = now;
      cache.orgInfoActive = root.active;
    }
  }
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

  {
    const orgs = [state, ...(Array.isArray(state.buds) ? state.buds : [])];
    for (let i = 0; i < orgs.length; i++){
      const org = orgs[i];
      if (!org) continue;
      const orgId = (i === 0) ? 0 : i;
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
    toast(`Эволюций: <b>${sim.mutations|0}</b>.`);
  }
}

function tickCamera(view, dtSec){
  if (!view || !view.cam || !view.camTarget) return;
  const dt = Math.max(0, dtSec || 0);
  if (dt <= 0) return;
  const tx = view.camTarget.x;
  const ty = view.camTarget.y;
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;

  const k = 8;
  const a = 1 - Math.exp(-k * dt);
  view.cam.ox += (tx - view.cam.ox) * a;
  view.cam.oy += (ty - view.cam.oy) * a;

  if (Math.abs(tx - view.cam.ox) < 0.02 && Math.abs(ty - view.cam.oy) < 0.02){
    view.cam.ox = tx;
    view.cam.oy = ty;
    view.camTarget = null;
  }
}

function startLoops(){
  const frame = ()=>{
    if (!view.state) return;
    const now = performance.now();
    const perf = view.perf;

    const delta = Math.max(0, now - (perf.lastFrameAt || now));
    perf.lastFrameAt = now;
    perf.smoothedFrame = perf.smoothedFrame * 0.9 + delta * 0.1;
    perf.frameCount += 1;

    const dtSec = Math.min(0.05, Math.max(0, delta) / 1000);
    tickMoving(view, view.state, dtSec);
    tickCamera(view, dtSec);


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
      const gpuLoad = Math.min(100, Math.max(0, Math.round((perf.smoothedFrame / (1000/60)) * 100)));

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
    view.autoTimer = setInterval(autoTick, UI.AUTO_TICK_MS || 1000);
  }
}

function setupResizeObserver(){
  if (view._ro) return;

  let t = null;
  view._ro = new ResizeObserver(() => {
    if (!view.state) return;
    if (t) clearTimeout(t);
    t = setTimeout(()=>{
      t = null;
      const w = els.mainPanel.clientWidth;
      const h = els.mainPanel.clientHeight;
      document.documentElement.style.setProperty('--gameW', `${w}px`);
      document.documentElement.style.setProperty('--gameH', `${h}px`);
      syncToSize();
      rerenderAll(0);
    }, UI.RESIZE_DEBOUNCE_MS || 80);
  });

  view._ro.observe(els.mainPanel);
}

function occHas(org, wx, wy) {
  if (!org || !org.body) return false;
  const packXY = (x, y) => (((x & 0xffff) << 16) | (y & 0xffff));

  const bc = org?.body?.cells;
  const mc = org?.modules;
  const bLen = Array.isArray(bc) ? bc.length : 0;
  const mLen = Array.isArray(mc) ? mc.length : 0;
  let mCells = 0;
  let lastMx = 0, lastMy = 0;
  if (mLen) {
    for (const m of mc) {
      const cells = m?.cells;
      if (!Array.isArray(cells) || !cells.length) continue;
      mCells += cells.length;
      const last = cells[cells.length - 1];
      lastMx = last?.[0] || 0;
      lastMy = last?.[1] || 0;
    }
  }
  const lastB = (bLen && bc) ? bc[bLen - 1] : null;
  const sig = `${bLen}|${mLen}|${mCells}|${lastB?.[0] || 0},${lastB?.[1] || 0}|${lastMx},${lastMy}`;

  if (!(org._occMain instanceof Set) || org._occMainSig !== sig) {
    const set = new Set();
    if (Array.isArray(bc)) {
      for (let i = 0; i < bc.length; i++) {
        set.add(packXY(bc[i][0], bc[i][1]));
      }
    }
    if (Array.isArray(mc)) {
      for (const m of mc) {
        if (Array.isArray(m?.cells)) {
          for (const c of m.cells) set.add(packXY(c[0], c[1]));
        }
      }
    }
    org._occMain = set;
    org._occMainSig = sig;
  }

  return org._occMain.has(packXY(wx, wy));
}

function screenToWorld(e, view, gridEl) {
  const rect = gridEl.getBoundingClientRect();
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

function screenToWorldXY(clientX, clientY, view, gridEl) {
  const rect = gridEl.getBoundingClientRect();
  const px = (clientX - rect.left);
  const py = (clientY - rect.top);

  const s = Math.max(1, view.blockPx);
  const vx = px / s;
  const vy = py / s;

  const Vx = (view.gridW - 1) / 2;
  const Vy = (view.gridH - 1) / 2;

  const wx = Math.floor((vx - Vx) + (view.cam?.ox || 0));
  const wy = Math.floor((vy - Vy) + (view.cam?.oy || 0));
  return [wx, wy];
}

function tryPlayTapOrganAtPointer(e, view, gridEl, tolerancePx = 5) {
  if (!view?.state) return false;
  const s = view.state;
  const orgs = [s, ...(Array.isArray(s.buds) ? s.buds : [])];

  // Семплируем несколько точек вокруг тапа, чтобы попасть по тонкому органу.
  const samples = [];
  const steps = [-tolerancePx, 0, tolerancePx];
  for (const dx of steps) {
    for (const dy of steps) {
      samples.push([e.clientX + dx, e.clientY + dy]);
    }
  }

  for (const [cx, cy] of samples) {
    const [wx, wy] = screenToWorldXY(cx, cy, view, gridEl);

    for (let i = 0; i < orgs.length; i++) {
      const org = orgs[i];
      if (!org || !Array.isArray(org.modules)) continue;

      for (const mod of org.modules) {
        const cells = mod?.cells;
        if (!Array.isArray(cells) || cells.length === 0) continue;

        // линейная проверка — простая и надёжная (органов немного)
        for (let k = 0; k < cells.length; k++) {
          const c = cells[k];
          if (!c) continue;
          if (c[0] === wx && c[1] === wy) {
            const organLike = {
              type: mod.type || mod.kind || mod.id || mod.name || mod.part || "UNKNOWN",
              length: cells.length,
            };

            // key=mod → кулдаун и защита от спама по одному органу
            playOrganTap(org, organLike, mod);
            return true;
          }
        }
      }
    }
  }

  // --- BODY fallback: если не попали в орган, попробуем сыграть BODY по телу организма ---
  for (const [cx, cy] of samples) {
    const [wx, wy] = screenToWorldXY(cx, cy, view, gridEl);

    for (let i = 0; i < orgs.length; i++) {
      const org = orgs[i];
      if (!org) continue;

      // Попадание по телу: если у организма есть список клеток тела.
      // Подстрой под свою структуру: чаще всего это org.body / org.cells / org.bodyBlocks.
      const bodyCells = org.body?.cells || org.cells || org.bodyCells || null;
      if (!Array.isArray(bodyCells) || bodyCells.length === 0) continue;

      for (let k = 0; k < bodyCells.length; k++) {
        const c = bodyCells[k];
        if (!c) continue;
        if (c[0] === wx && c[1] === wy) {
          playOrganTap(org, { type: "BODY", length: bodyCells.length }, /*key=*/org);
          return true;
        }
      }
    }
  }

  return false;
}

function handleCarrotMode(view, wx, wy) {
  const s = view.state;
  const inv = s.inv || (s.inv = { carrots: 0 });
  if (inv.carrots <= 0) {
    toast("Нет морковок.");
    return;
  }

  const intervalSec = Math.max(1, Math.floor(Number(s.evoIntervalMin || 12) * 60));
  const tickId = Math.floor(nowSec() / intervalSec);
  s.carrotTick = s.carrotTick || { id: tickId, used: 0 };
  if (s.carrotTick.id !== tickId) { 
    s.carrotTick.id = tickId; 
    s.carrotTick.used = 0; 
  }
  if (s.carrotTick.used >= CARROT.maxPerTick) {
    toast(`Лимит: ${CARROT.maxPerTick} морковки за тик.`, "bad");
    return;
  }

  s.carrots = Array.isArray(s.carrots) ? s.carrots : [];
  s.carrots.push({ x: wx, y: wy, w: CARROT.w, h: CARROT.h, t: nowSec() });
  s.carrotTick.used++;
  inv.carrots--;

  pushLog(s, `Морковка: брошена. Осталось: ${Math.max(0, inv.carrots|0)}.`, "carrot");
  toast(`Морковка: (${wx},${wy}).`);
  
  saveGame(s);
  rerenderAll(0);
}

function handleCoinMode(view, wx, wy) {
  const s = view.state;
  const inv = s.inv || (s.inv = { carrots: 0, coins: 0 });
  if ((inv.coins|0) <= 0) {
    toast("Нет монеток.");
    return;
  }

  const intervalSec = Math.max(1, Math.floor(Number(s.evoIntervalMin || 12) * 60));
  const tickId = Math.floor(nowSec() / intervalSec);
  s.coinTick = s.coinTick || { id: tickId, used: 0 };
  if (s.coinTick.id !== tickId) { 
    s.coinTick.id = tickId; 
    s.coinTick.used = 0; 
  }
  if (s.coinTick.used >= COIN.maxPerTick) {
    toast(`Лимит: ${COIN.maxPerTick} монетки за тик.`, "bad");
    return;
  }

  s.coins = Array.isArray(s.coins) ? s.coins : [];
  const t = nowSec();
  const id = ((t & 0xffff) << 16) ^ ((wx & 0xff) << 8) ^ (wy & 0xff);
  s.coins.push({ x: wx, y: wy, w: COIN.w, h: COIN.h, t, id });
  s.coinTick.used++;
  inv.coins--;

  const orgs = [s, ...(Array.isArray(s.buds) ? s.buds : [])];
  let bestId = 0;
  let bestD = Infinity;
  const tx = wx + 1;
  const ty = wy + 1;
  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i];
    if (!org) continue;
    const core = org?.body?.core || org?.body?.cells?.[0] || [0, 0];
    const cx = (core[0] || 0);
    const cy = (core[1] || 0);
    const d = Math.abs(tx - cx) + Math.abs(ty - cy);
    if (d < bestD) { bestD = d; bestId = i; }
  }

  const prng = mulberry32(hash32(s.seed || 1, 60606, t, wx, wy, inv.coins|0));
  const j = COIN.aimJitter|0;
  const offX = Math.round((prng()*2 - 1) * j);
  const offY = Math.round((prng()*2 - 1) * j);

  setMoveTarget(view, s, bestId, tx, ty, {
    stopTolBlocks: 0,
    intentJitter: j,
    intentOffsetX: offX,
    intentOffsetY: offY,
  });

  pushLog(s, `Монетка: поставлена. Осталось: ${Math.max(0, inv.coins|0)}.`, "coin");
  toast(`Монетка: (${wx},${wy}) → цель: ${bestId === 0 ? "родитель" : `почка ${bestId}`}.`);
  
  saveGame(s);
  rerenderAll(0);
}

function selectOrganismAt(view, wx, wy) {
  const s = view.state;
  const orgs = [s, ...(Array.isArray(s.buds) ? s.buds : [])];
  
  // Ищем организм, содержащий указанную клетку
  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i];
    if (!org) continue;
    
    if (occHas(org, wx, wy)) {
      const which = i === 0 ? -1 : i - 1;
      view.state.active = which;
      saveGame(view.state);
      rerenderAll(0);
      
      view.flash = {
        org: which,
        mi: null,
        part: null,
        grownModules: [],
        until: Date.now()/1000 + 0.2,
        strength: 2,
      };
      
      toast(`Выбран: ${which === -1 ? 'Родитель' : `Почка ${which}`}`);
      return true;
    }
  }
  return false;
}

function attachGridInteractions() {
  if (els.grid.__hasGridClicks) return;
  els.grid.__hasGridClicks = true;

  let lastTapTime = 0;
  let clickTimer = null;

  els.grid.addEventListener("pointerup", (e) => {
    if (window._wasDrag) return; // Игнорируем клик, если это был перенос камеры

    const now = Date.now();
    const isDouble = (now - lastTapTime < 300);
    lastTapTime = now;

    const [wx, wy] = screenToWorld(e, view, els.grid);

    // 1. ДВОЙНОЙ КЛИК: Всегда центрируем камеру (удобная навигация)
//     if (isDouble) {
//     if (clickTimer) clearTimeout(clickTimer);
//     view.camTarget = { x: wx, y: wy };
//     return; 
//    }

    // 2. ОДИНОЧНЫЙ КЛИК: Логика зависит от выбранного режима (view.mode)
    if (clickTimer) clearTimeout(clickTimer);

    // Если в руках морковка или монетка — ставим их мгновенно
    if (view.mode === 'carrot') {
      handleCarrotMode(view, wx, wy);
      return;
    } 
    if (view.mode === 'coin') {
      handleCoinMode(view, wx, wy);
      return;
    }

    // Если руки пустые (view.mode === null) — управляем выделением
    // Сначала пробуем сыграть орган под тапом (в любом организме), с небольшой погрешностью.
    // Не мешает выделению: оно отработает через таймер ниже.
    tryPlayTapOrganAtPointer(e, view, els.grid, 5);

    clickTimer = setTimeout(() => {
      const found = selectOrganismAt(view, wx, wy);
      
      if (!found) {
        // Кликнули в пустоту -> СБРОС выделения
        view.state.active = null; 
//        toast("Выделение снято");
      }

      // Обновляем всё: сохраняем состояние и перерисовываем интерфейс
      saveGame(view.state);
      rerenderAll(0);
    }, 250);
  });
}

function attachOrgListClicks() {
  if (!els.orgInfo) return;
  if (els.orgInfo.__hasOrgListClicks) return;
  els.orgInfo.__hasOrgListClicks = true;

  let lastClickTime = 0;
  let lastClickWhich = null;
  let clickTimer = null;
  const DOUBLE_TAP_DELAY = 300; 

  els.orgInfo.addEventListener("click", (ev) => {
    const cell = ev.target?.closest?.(".orgCell");
    if (!cell) return;
    
    const which = parseInt(cell.dataset.which, 10);
    if (!Number.isFinite(which)) return;

    const now = Date.now();
    const isDouble = (now - lastClickTime < DOUBLE_TAP_DELAY) && (lastClickWhich === which);

    if (isDouble) {
      // ДВОЙНОЙ КЛИК / ТАП
      if (clickTimer) clearTimeout(clickTimer);
      
      view.state.active = which;
      saveGame(view.state);

      const org = (which === -1) ? view.state : (view.state.buds?.[which] || null);
      const core = org?.body?.core;
      if (Array.isArray(core) && core.length === 2) {
        const orgId = (which === -1) ? 0 : which + 1;
        const m = getOrgMotion(view, orgId);
        view.camTarget = { 
          x: core[0] + (m?.offsetX || 0), 
          y: core[1] + (m?.offsetY || 0) 
        };
        toast("Камера центрирована");
      }
      rerenderAll(0);
      lastClickTime = 0; 
    } else {
      // ОДИНОЧНЫЙ КЛИК / ТАП
      lastClickTime = now;
      lastClickWhich = which;
      if (clickTimer) clearTimeout(clickTimer);
      
      clickTimer = setTimeout(() => {
        if (view.state) {
          view.state.active = which;
          saveGame(view.state);
          rerenderAll(0);
        }
      }, DOUBLE_TAP_DELAY);
    }
  });
}

async function startGame(){
  view.state = migrateOrNew();
  view.lastActive = view.state?.active ?? null;
  
  // --- Bio Handpan: init + фильтр состояний организмов ---
  // Создаём AudioContext и мастер-цепочку (gain + компрессор)
  initBioHandpan();

  // --- Sound enabled toggle ---
  const sndDefault = (view.state?.settings?.soundEnabled !== false); // default ON
  if (els.soundEnabled){
    els.soundEnabled.checked = sndDefault;
    setBioHandpanEnabled(els.soundEnabled.checked);

    els.soundEnabled.addEventListener("change", () => {
      const on = !!els.soundEnabled.checked;
      view.state.settings = view.state.settings || {};
      view.state.settings.soundEnabled = on;

      setBioHandpanEnabled(on);
      saveGame(view.state);
    });
  } else {
    // если чекбокса нет — просто включаем по умолчанию
    setBioHandpanEnabled(sndDefault);
  }
  // --- end sound toggle ---

  // Организм звучит только если он "живой":
  // не в анабиозе и не в усыхании.
  //
  // Логика совпадает с mkBarsRow: там minBar <= 0.01 → "усыхание",
  // <= 0.10 → "анабиоз". Мы вырубаем звук для обоих случаев.
  setOrganismFilter((org) => {
    if (!org) return false;

    const b = org.bars || {};
    const food  = Number.isFinite(b.food)  ? b.food  : 1;
    const clean = Number.isFinite(b.clean) ? b.clean : 1;
    const hp    = Number.isFinite(b.hp)    ? b.hp    : 1;
    const mood  = Number.isFinite(b.mood)  ? b.mood  : 1;

    const minBar = Math.min(food, clean, hp, mood);

    // minBar <= 0.01  → усыхание
    // minBar <= 0.10  → анабиоз
    if (minBar <= 0.10) return false;

    return true;
  });
  // --- конец блока Bio Handpan ---

  ensureMoving(view);
  
  view.canvas = els.canvas;  
  const fx = getFxPipeline(view, els.canvas);
  fx.enabled = (view.state?.settings?.fxEnabled !== false);

  const c = view.state?.body?.core || [0, 0];
  view.cam = { ox: (c[0]||0), oy: (c[1]||0) };
  view.camTarget = null;

  if (els.startOverlay){
    els.startOverlay.classList.remove("show");
    setTimeout(()=>{ els.startOverlay.style.display = "none"; }, 200);
  }

  // hooks
  attachDebugPanel(view, els);
  attachSettings(view, els, toast);
  attachActions(view, els, toast, rerenderAll);
  attachDragPan(els.grid, view);
  attachZoomWheel(els.grid, view);
  attachDisableDoubleTapZoom(els);
  attachInfoTabs(els);
  attachLogFlash(view, els, rerenderAll);
  attachLegendHuePicker(view, els, rerenderAll);
  attachCarrotHudInput(view, els, rerenderAll);
  attachCoinHudInput(view, els, rerenderAll);
  attachSymbiosisUI(view, els, toast);
  attachGridInteractions();
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
    el.className = "overlay offlineOverlay";

    el.innerHTML = `
      <div class="offlineCard modalAnim">
        <div class="offlineHeader">
          <div class="offlineTitle">ОФФЛАЙН СВОДКА</div>
          <div class="offlineSub">Пока тебя не было, симуляция продолжалась.</div>
        </div>

        <div class="offlineBody" id="offlineText"></div>

        <div class="offlineFooter">
          <button class="btn" id="offlineOk">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(el);
    requestAnimationFrame(()=> el.classList.add("show"));

    el.querySelector("#offlineOk").onclick = ()=>{
      el.classList.remove("show");
      setTimeout(()=> el.remove(), 200);
    };
  }

  const mins = Math.round(deltaSec/60);
  const mutTotal = (sim.mutations|0) + (sim.budMutations|0);
  const grown = sim.grownBlocks|0;
  const shrunk = sim.shrunkBlocks|0;

  el.querySelector("#offlineText").innerHTML = `
    <div class="offlineRow neutral"><span class="label">Тебя не было</span><span class="value"><b>${mins} мин</b></span></div>
    <div class="offlineRow neutral"><span class="label">Циклов эволюции</span><span class="value"><b>${mutTotal}</b></span></div>
    <div class="offlineRow good"><span class="label">Появилось</span><span class="value"><b>+${grown}</b> блок.</span></div>
    <div class="offlineRow bad"><span class="label">Усохло</span><span class="value"><b>-${shrunk}</b> блок.</span></div>
  `;
}

els.playBtn.addEventListener("click", startGame);

document.addEventListener("click", (e) => {
  const pill = e.target.closest(".pill.stat");
  if (!pill) return;

  const text = pill.getAttribute("title");
  if (!text) return;

  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  
  if (isTouch) {
    e.preventDefault(); 
    toast(text); 
  } else {
    toast(text);
  }
});

requestAnimationFrame(() => {
  if (els.startOverlay) {
    els.startOverlay.classList.add("show");
  }
});