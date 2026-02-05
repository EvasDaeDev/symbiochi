import { fmtAgeSeconds, escapeHtml, barPct, mulberry32, hash32, clamp, nowSec } from "./util.js";
import { pushLog } from "./log.js";
import { saveGame, deleteSave, actOn } from "./state.js";
import { extractGenome, encodeGenome } from "./mods/merge.js";
import { applySymbiosisMerge } from "./state_mutation.js";

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

  els.logBody.innerHTML = log.slice().reverse().map((e) => {
    const cls =
      e.kind === "mut_ok" ? "logEntry good" :
      e.kind === "bud_ok" ? "logEntry bud" :
      e.kind === "mut_fail" ? "logEntry warn" :
      e.kind === "alert" ? "logEntry alert" :
      "logEntry";

    const meta = e.meta || {};
    const org = Number.isFinite(meta.org) ? meta.org : "";
    const mi = Number.isFinite(meta.mi) ? meta.mi : "";
    const part = meta.part ? String(meta.part) : "";
    const grown = Array.isArray(meta.grownModules) ? meta.grownModules.join(",") : "";

    return `
      <div class="${cls}" data-org="${org}" data-mi="${mi}" data-part="${escapeHtml(part)}" data-grown="${escapeHtml(grown)}">
        <div class="when">${new Date(e.t*1000).toLocaleTimeString()} • ${escapeHtml(e.kind)}</div>
        <div class="msg">${escapeHtml(e.msg)}</div>
      </div>
    `;
  }).join("");

  const total = 1e-6 + state.care.feed + state.care.wash + state.care.heal + state.care.neglect;
  const pf = state.care.feed/total, pw = state.care.wash/total, ph = state.care.heal/total, pn = state.care.neglect/total;
  const top = [
    ["кормить", pf],
    ["помыть", pw],
    ["лечение", ph],
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
    const v = parseFloat(els.evoInput.value);
    view.state.evoIntervalMin = clamp(isFinite(v) ? v : 12, 0.1, 240);
	
	if (!view.state.settings) view.state.settings = {};
	view.state.settings.evoIntervalMin = view.state.evoIntervalMin;
	
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

export function attachSymbiosisUI(view, els, toast){
  if (!els.symbiosisBtn || !els.symbiosisOverlay) return;

  function openSymbiosis(){
    els.symbiosisOverlay.style.display = "grid";
    if (els.symShareOutput) els.symShareOutput.value = "";
    if (!view.state){
      if (els.symPermissionsHint){
        els.symPermissionsHint.textContent = "Сначала запусти игру, чтобы отпечаток появился.";
      }
      if (els.symShareBtn) els.symShareBtn.disabled = true;
      if (els.symApplyBtn) els.symApplyBtn.disabled = true;
    } else {
      if (els.symShareBtn) els.symShareBtn.disabled = false;
      updateApplyState();
    }
  }

  function closeSymbiosis(){
    els.symbiosisOverlay.style.display = "none";
    hideConfirm();
    if (els.symShareBtn) els.symShareBtn.disabled = false;
  }

  async function shareGenome(){
    if (!view.state){
      if (els.symPermissionsHint){
        els.symPermissionsHint.textContent = "Сначала запусти игру, чтобы отпечаток появился.";
      }
      return;
    }
    try {
      const genome = extractGenome(getActiveOrg(view.state));
      const code = await encodeGenome(genome);
      console.debug("[symbiosis] share genome code length", code.length);
      if (els.symShareOutput) els.symShareOutput.value = code;
      let copied = false;
      if (navigator.clipboard?.writeText){
        try {
          await navigator.clipboard.writeText(code);
          copied = true;
        } catch {
          copied = false;
        }
      }
      if (!copied && els.symShareOutput && document.queryCommandSupported?.("copy")){
        els.symShareOutput.focus();
        els.symShareOutput.select();
        copied = document.execCommand("copy");
      }
      if (copied){
        toast("Отпечаток скопирован.");
        if (els.symPermissionsHint) els.symPermissionsHint.textContent = "Отпечаток скопирован в буфер.";
      } else {
        throw new Error("no clipboard");
      }
    } catch (err){
      console.debug("[symbiosis] share genome failed", err);
      if (els.symPermissionsHint){
        els.symPermissionsHint.textContent = "Отпечаток не создан. Проверь консоль для деталей.";
      }
      if (els.symShareOutput){
        const message = err instanceof Error ? err.message : String(err);
        els.symShareOutput.value = `Ошибка: ${message}`;
      }
      if (els.symShareOutput){
        els.symShareOutput.focus();
        els.symShareOutput.select();
      }
      toast("Не удалось скопировать отпечаток.");
    }
  }

  function updateApplyState(){
    if (!els.symApplyBtn || !els.symReceiveInput) return;
    els.symApplyBtn.disabled = !els.symReceiveInput.value.trim();
  }

  function showConfirm(){
    if (!els.symConfirm) return;
    els.symConfirm.style.display = "grid";
  }

  function hideConfirm(){
    if (!els.symConfirm) return;
    els.symConfirm.style.display = "none";
  }

  async function applySymbiosis(){
    if (!view.state || !els.symReceiveInput) return;
    const input = els.symReceiveInput.value.trim();
    if (!input){
      toast("Отпечаток не распознан.");
      return;
    }
    const result = await applySymbiosisMerge(view.state, input);
    if (result.ok){
      toast("Симбиоз завершён. Это тело уже не прежнее.");
      closeSymbiosis();
    } else {
      toast("Отпечаток не распознан.");
    }
  }

  els.symbiosisBtn.addEventListener("click", openSymbiosis);
  if (els.symCloseBtn) els.symCloseBtn.addEventListener("click", closeSymbiosis);
  if (els.symShareBtn) els.symShareBtn.addEventListener("click", shareGenome);
  if (els.symApplyBtn) els.symApplyBtn.addEventListener("click", showConfirm);
  if (els.symConfirmYes) els.symConfirmYes.addEventListener("click", applySymbiosis);
  if (els.symConfirmNo) els.symConfirmNo.addEventListener("click", hideConfirm);
  if (els.symReceiveInput) els.symReceiveInput.addEventListener("input", updateApplyState);
  if (els.symReceiveInput) els.symReceiveInput.addEventListener("paste", () => setTimeout(updateApplyState, 0));
  if (els.symbiosisOverlay){
    els.symbiosisOverlay.addEventListener("click", (e)=>{
      if (e.target === els.symbiosisOverlay) closeSymbiosis();
    });
  }
  if (els.symConfirm){
    els.symConfirm.addEventListener("click", (e)=>{
      if (e.target === els.symConfirm) hideConfirm();
    });
  }
  updateApplyState();
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
  let currentOrg = null;

  const getSelectedOrg = ()=>{
    const root = view.state;
    if (!root) return null;
    const a = root.active;
    return (Number.isFinite(a) && a >= 0 && Array.isArray(root.buds) && a < root.buds.length)
      ? root.buds[a]
      : root;
  };

  els.legendBody.addEventListener("click", (e)=>{
    const sw = e.target?.closest?.(".swatch");
    if (!sw) return;
    const part = sw.dataset.part;
    if (!part || !view.state) return;
    const org = getSelectedOrg();
    if (!org) return;
    currentOrg = org;
    currentPart = part;
    els.huePicker.style.display = "block";
    const cur = sw.dataset.color || "";
    if (cur) els.hueRange.value = cur;
    if (els.hueTitle) els.hueTitle.textContent = `Цвет: ${part}`;

    view.flash = {
      org: -1,
      mi: null,
      part,
      grownModules: [],
      until: Date.now()/1000 + 0.35,
      strength: 2,
    };
    rerenderAll(0);
  });

  els.hueRange.addEventListener("input", ()=>{
    if (!view.state || !currentPart || !currentOrg) return;
    if (!currentOrg.partColor) currentOrg.partColor = {};
    currentOrg.partColor[currentPart] = els.hueRange.value;
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
    // then click in the field to place an orange "carrot" (3x7 blocks).
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
export function attachDragPan(view, els){
  const PAN_SENS = 0.33;
  const START_DRAG_PX = 6;

  const grid = els.grid;
  const drag = {
    tracking:false, // pointer down, но ещё не “drag”
    dragging:false, // реальный drag включён
    pid:null,
    sx:0, sy:0,
    ox:0, oy:0,
  };

  const getCellDelta = (dxPix, dyPix) => {
    const rect = grid.getBoundingClientRect();
    const cellW = rect.width / Math.max(1, view.gridW);
    const cellH = rect.height / Math.max(1, view.gridH);
    return [dxPix / cellW, dyPix / cellH];
  };

  const onDown = (e)=>{
    if (!view.state) return;

    // В режиме кормления тап должен ставить морковку — pan выключаем
    if (view.mode === "carrot") return;

    // Если активен pinch (2 пальца) — пан не стартуем
    if (view._pinchActive) return;

    drag.tracking = true;
    drag.dragging = false;
    drag.pid = e.pointerId;
    drag.sx = e.clientX;
    drag.sy = e.clientY;
    drag.ox = view.state.cam.ox;
    drag.oy = view.state.cam.oy;
  };

  const onMove = (e)=>{
    if (!drag.tracking || !view.state) return;
    if (drag.pid !== e.pointerId) return;
    if (view._pinchActive) return;

    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;

    // включаем drag только после порога
    if (!drag.dragging){
      if ((dx*dx + dy*dy) < (START_DRAG_PX*START_DRAG_PX)) return;
      drag.dragging = true;
      grid.classList.add("dragging");
      grid.setPointerCapture?.(e.pointerId);
    }

    const [dcx, dcy] = getCellDelta(dx, dy);
    view.state.cam.ox = drag.ox - dcx * PAN_SENS;
    view.state.cam.oy = drag.oy - dcy * PAN_SENS;
  };

  const onUp = (e)=>{
    if (!drag.tracking) return;
    if (drag.pid !== e.pointerId) return;
    drag.tracking = false;
    drag.pid = null;
    if (drag.dragging){
      drag.dragging = false;
      grid.classList.remove("dragging");
    }
  };

  grid.addEventListener("pointerdown", onDown);
  grid.addEventListener("pointermove", onMove);
  grid.addEventListener("pointerup", onUp);
  grid.addEventListener("pointercancel", onUp);
}

// Click a log entry to briefly highlight the organ that caused it.
// Highlight uses the same outer glow as selection, but white and lasts 0.2s.

export function attachZoomWheel(view, els, rerender){
  els.canvas.addEventListener("wheel", (e)=>{
    if (!view.state) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    view.zoom = clamp((view.zoom || 0) + dir, -3, 3);
    rerender(0);
  }, { passive:false });
}

export function attachLogFlash(view, els, rerender){
  if (!els?.logBody) return;
  if (els.logBody.__hasFlash) return;
  els.logBody.__hasFlash = true;

  els.logBody.addEventListener("click", (ev)=>{
    const row = ev.target?.closest?.(".logEntry");
    if (!row) return;
    if (!view?.state) return;

    // meta is optional; if it is missing we still flash the whole organism
    const orgRaw = row.dataset.org;
    const miRaw  = row.dataset.mi;
    const part   = row.dataset.part || null;
    const grownRaw = row.dataset.grown || "";

    const orgN = (orgRaw === "" || orgRaw == null) ? -1 : (parseInt(orgRaw, 10));
    const miN  = (miRaw === ""  || miRaw  == null) ? null : (parseInt(miRaw, 10));

    const grownModules = grownRaw
      ? grownRaw.split(",").map((v)=>parseInt(v, 10)).filter((v)=>Number.isFinite(v))
      : [];

    view.flash = {
      org: Number.isFinite(orgN) ? orgN : -1,
      mi: Number.isFinite(miN) ? miN : null,
      part,
      grownModules,
      // brighter + longer is handled in renderer; keep duration 0.2s
      until: Date.now()/1000 + 0.2,
      strength: 2, // requested: ~2x brighter
    };

    rerender(0);
  });
}

export function attachPinchZoom(view, els, rerender){
  const grid = els.grid;
  if (!grid) return;

  const pts = new Map(); // pointerId -> {x,y}
  let startDist = 0;
  let startZoom = 0;
  let active = false;

  const dist = ()=>{
    const a = [...pts.values()];
    if (a.length < 2) return 0;
    const dx = a[0].x - a[1].x;
    const dy = a[0].y - a[1].y;
    return Math.hypot(dx, dy);
  };

  const onDown = (e)=>{
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2){
      active = true;
      view._pinchActive = true;
      startDist = dist();
      startZoom = view.zoom || 0;
      grid.setPointerCapture?.(e.pointerId);
    }
  };

  const onMove = (e)=>{
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (!active || pts.size < 2) return;

    const d = dist();
    if (!startDist) return;

    // 10% изменения расстояния = шаг зума
    const ratio = d / startDist;
    let dz = 0;
    if (ratio > 1.10) dz = +1;
    else if (ratio < 0.90) dz = -1;

    if (dz !== 0){
      view.zoom = Math.max(-3, Math.min(3, startZoom + dz));
      // пересчёт blockPx обычно в render/buildFrame, но перерендерим сразу
      startZoom = view.zoom;
      startDist = d;
      rerender(0);
    }
  };

  const onUp = (e)=>{
    pts.delete(e.pointerId);
    if (pts.size < 2){
      active = false;
      view._pinchActive = false;
    }
  };

  grid.addEventListener("pointerdown", onDown);
  grid.addEventListener("pointermove", onMove);
  grid.addEventListener("pointerup", onUp);
  grid.addEventListener("pointercancel", onUp);
}

export function attachDisableDoubleTapZoom(els){
  const grid = els.grid;
  if (!grid) return;
  if (!window.matchMedia("(pointer: coarse)").matches) return;
  if (grid.__disableDoubleTap) return;
  grid.__disableDoubleTap = true;

  let lastTap = 0;
  grid.addEventListener("touchend", (e)=>{
    const now = Date.now();
    if (now - lastTap < 300){
      e.preventDefault();
    }
    lastTap = now;
  }, { passive: false });
}
