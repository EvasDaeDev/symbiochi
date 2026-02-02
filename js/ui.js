import { fmtAgeSeconds, escapeHtml, barPct, mulberry32, hash32, clamp, nowSec } from "./util.js";
import { pushLog } from "./log.js";
import { saveGame, deleteSave, actOn } from "./state.js";

function getActiveOrg(state){
  // Selection model:
  // - state.active === -1 OR null/undefined -> parent
  // - 0..N-1 -> bud index
  const a = state?.active;
  if (Number.isFinite(a) && a >= 0 && Array.isArray(state.buds) && a < state.buds.length){
    return state.buds[a];
  }
  return state;
}

export function makeToast(){
  const el = document.getElementById("toast");
  return (msg)=>{
    el.innerHTML = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(()=>el.classList.remove("show"), 1200);
  };
}

export function renderLog(state, els){
  const log = state.log || [];
  els.logBody.innerHTML = log.slice().reverse().map(e => {
  const cls =
    e.kind === "mut_ok" ? "logEntry good" :
    e.kind === "bud_ok" ? "logEntry bud" :
    e.kind === "mut_fail" ? "logEntry warn" :
    "logEntry";

  return `
    <div class="${cls}">
      <div class="when">${new Date(e.t*1000).toLocaleTimeString()} • ${escapeHtml(e.kind)}</div>
      <div class="msg">${escapeHtml(e.msg)}</div>
    </div>
  `;
}).join("");


  const total = 1e-6 + state.care.feed + state.care.wash + state.care.heal + state.care.neglect;
  const pf = state.care.feed/total, pw = state.care.wash/total, ph = state.care.heal/total, pn = state.care.neglect/total;
  const top = [
    ["корм", pf],
    ["мыть", pw],
    ["леч", ph],
    ["запущ", pn]
  ].sort((a,b)=>b[1]-a[1])[0];

  els.logFooter.textContent = `Стиль: ${top[0]} (${Math.round(top[1]*100)}%) • лог: ${log.length}/${180}`;
}

export function attachSettings(view, els, toast){
  function openSettings(){
    if (!view.state) return;
    els.evoInput.value = String(view.state.evoIntervalMin || 12);
    if (els.seedInput) els.seedInput.value = String(view.state.seed ?? 0);
    if (els.lenPrio){
      const lp = Math.round(100 * (view.state.settings?.lengthPriority ?? 0.65));
      els.lenPrio.value = String(lp);
    }
    if (els.carrotsInput) els.carrotsInput.value = String(view.state.inv?.carrots ?? 0);
    els.settingsOverlay.style.display = "grid";
  }
  function closeSettings(){
    els.settingsOverlay.style.display = "none";
  }
  function saveSettings(){
    if (!view.state) return;
    const v = parseInt(els.evoInput.value, 10);
    view.state.evoIntervalMin = clamp(isFinite(v) ? v : 12, 1, 240);

    if (!view.state.settings) view.state.settings = {};
    if (els.lenPrio){
      const lp = clamp(parseInt(els.lenPrio.value, 10) / 100, 0, 1);
      view.state.settings.lengthPriority = lp;
    }

    if (els.seedInput){
      const s = parseInt(els.seedInput.value, 10);
      if (isFinite(s) && (s|0) !== (view.state.seed|0)){
        view.state.seed = (s|0);
        pushLog(view.state, `Настройки: seed = ${(view.state.seed>>>0)}.`, "system");
      }
    }

    if (els.carrotsInput){
      const c = parseInt(els.carrotsInput.value, 10);
      if (!view.state.inv) view.state.inv = { carrots: 0 };
      view.state.inv.carrots = Math.max(0, isFinite(c) ? c : 0);
    }

    pushLog(view.state, `Настройки: интервал мутации = ${view.state.evoIntervalMin} мин.`, "system");
    view.state.lastSeen = nowSec();
    saveGame(view.state);
    closeSettings();
    toast("Сохранено.");
  }

  function newCreature(){
    // "Новое Сущ." lives in settings now
    deleteSave();
    // hard reload to re-init save cleanly
    location.reload();
  }

  els.settingsBtn.addEventListener("click", openSettings);
  els.closeSettings.addEventListener("click", closeSettings);
  els.saveSettings.addEventListener("click", saveSettings);
  if (els.newCreature) els.newCreature.addEventListener("click", newCreature);
  els.settingsOverlay.addEventListener("click", (e)=>{
    if (e.target === els.settingsOverlay) closeSettings();
  });
}

export function attachInfoTabs(els){
  const root = els.infoTabs;
  if (!root) return;
  root.addEventListener("click", (e)=>{
    const btn = e.target?.closest?.(".tabBtn");
    if (!btn) return;
    const tab = btn.dataset.tab;
    for (const b of root.querySelectorAll(".tabBtn")) b.classList.toggle("isActive", b === btn);
    const bodies = [
      ["org", els.tabOrg],
      ["legend", els.tabLegend],
      ["log", els.tabLog],
      ["rules", els.tabRules],
    ];
    for (const [name, el] of bodies){
      if (!el) continue;
      el.classList.toggle("isActive", name === tab);
    }
  });
}

export function attachLegendHuePicker(view, els, rerenderAll){
  if (!els.legendBody || !els.huePicker || !els.hueRange) return;

  let currentPart = null;

  els.legendBody.addEventListener("click", (e)=>{
    const sw = e.target?.closest?.(".swatch");
    if (!sw) return;
    const part = sw.dataset.part;
    if (!part || !view.state) return;
    currentPart = part;
    els.huePicker.style.display = "block";
    const cur = view.state.partHue?.[part];
    els.hueRange.value = String(Number.isFinite(cur) ? cur : 0);
    if (els.hueTitle) els.hueTitle.textContent = `Тон: ${part}`;
  });

  els.hueRange.addEventListener("input", ()=>{
    if (!view.state || !currentPart) return;
    if (!view.state.partHue) view.state.partHue = {};
    view.state.partHue[currentPart] = parseInt(els.hueRange.value, 10) || 0;
    view.state.lastSeen = nowSec();
    saveGame(view.state);
    rerenderAll(0);
  });
}

export function attachCarrotHudInput(view, els, rerenderAll){
  if (!els.carrotHudInput) return;
  els.carrotHudInput.addEventListener("input", ()=>{
    if (!view.state) return;
    const v = parseInt(els.carrotHudInput.value, 10);
    if (!view.state.inv) view.state.inv = { carrots: 0 };
    view.state.inv.carrots = Math.max(0, isFinite(v) ? v : 0);
    view.state.lastSeen = nowSec();
    saveGame(view.state);
    rerenderAll(0);
  });
}

export function attachActions(view, els, toast, rerenderAll){
  els.feed.addEventListener("click", ()=>{
    if (!view.state) return;
    // Feeding is now interactive: click "КОРМ" to enter carrot-throw mode,
    // then click in the field to place an orange "carrot" (7x3 blocks).
    view.mode = (view.mode === "carrot") ? null : "carrot";
    els.feed.classList.toggle("isActive", view.mode === "carrot");
    toast(view.mode === "carrot" ? "Брось морковку в поле." : "Кормление: выкл.");
    rerenderAll(0);
  });
  els.wash.addEventListener("click", ()=>{
    if (!view.state) return;
    actOn(view.state, getActiveOrg(view.state), "wash");
    toast("Чисто.");
    rerenderAll(0);
  });
  els.heal.addEventListener("click", ()=>{
    if (!view.state) return;
    actOn(view.state, getActiveOrg(view.state), "heal");
    toast("Полегчало.");
    rerenderAll(0);
  });
}

// reset button removed: "Новое Сущ." is in settings

/**
 * Drag/pan с ограниченной скоростью.
 * PAN_SENS = 0.33 => ~в 3 раза медленнее, питомец не “улетает”.
 */
export function attachDragPan(view, els, onTap){
  const PAN_SENS = 0.33;

  // IMPORTANT: не берём pointer-capture сразу — иначе обычный клик
  // (для выделения организма) может “съедаться” drag-pan.
  const drag = { on:false, moved:false, pid:null, sx:0, sy:0, ox:0, oy:0 };
  const grid = els.grid;

  const getCellDelta = (dxPix, dyPix) => {
    const rect = grid.getBoundingClientRect();
    const cellW = rect.width / Math.max(1, view.gridW);
    const cellH = rect.height / Math.max(1, view.gridH);
    return [dxPix / cellW, dyPix / cellH];
  };

  const onDown = (e)=>{
    if (!view.state) return;
    // When feeding mode is active, the user must be able to click the canvas to place carrots.
    // Pointer-capture on the grid would swallow the click, so disable drag-pan in this mode.
    if (view.mode === "carrot") return;
    drag.on = true;
    drag.moved = false;
    drag.pid = e.pointerId;
    grid.classList.add("dragging");
    drag.sx = e.clientX;
    drag.sy = e.clientY;
    drag.ox = view.state.cam.ox;
    drag.oy = view.state.cam.oy;
  };

  const onMove = (e)=>{
    if (!drag.on || !view.state) return;

    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;

    // начинаем именно “перетаскивание” только после небольшого порога
    if (!drag.moved){
      if ((dx*dx + dy*dy) < 16) return; // 4px
      drag.moved = true;
      grid.setPointerCapture?.(drag.pid);
    }
    const [dcx, dcy] = getCellDelta(dx, dy);

    view.state.cam.ox = drag.ox - dcx * PAN_SENS;
    view.state.cam.oy = drag.oy - dcy * PAN_SENS;

    // clampCamera теперь вызывается из render (buildFrame), тут не обязательно
  };

  const onUp = (e)=>{
    if (!drag.on) return;
    const wasMove = drag.moved;
    drag.on = false;
    drag.moved = false;
    drag.pid = null;
    grid.classList.remove("dragging");

    // если это был просто клик (не drag) — передаём наверх, чтобы выделить организм
    if (!wasMove && typeof onTap === 'function'){
      onTap(e);
    }
  };

  grid.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}