import { fmtAgeSeconds, escapeHtml, barPct, mulberry32, hash32, clamp, nowSec } from "./util.js";
import { pushLog, MAX_DEBUG_LOG } from "./log.js";
import { saveGame, deleteSave, actOn } from "./state.js";
import { extractGenome, encodeGenome } from "./mods/merge.js";
import { applySymbiosisMerge } from "./state_mutation.js";
import { getFxPipeline } from "./FX/pipeline.js";
import { addRipple, RIPPLE_KIND } from "./FX/ripples.js";

function getActiveOrg(state){
  // Selection model:
  // - state.active === -1 OR null/undefined -> parent
  // - 0..N-1 -> bud index
  const a = state?.active;
  if (Number.isFinite(a) && a >= 0 && Array.isArray(state.buds) && a < state.buds.length){
    return state.buds[a];
  }
  // parent organism lives on state itself in your project
  return state;
}

export function makeToast(){
  const el = document.getElementById("toast");

  return (msg, type)=>{
    // сброс предыдущих типов
    el.className = "toast";

    if (type){
      el.classList.add(type); // например "bad"
    }

    el.innerHTML = msg;
    el.classList.add("show");

    clearTimeout(el._t);
    el._t = setTimeout(()=>{
      el.classList.remove("show");
    }, 1200);
  };
}

// Переменная для отслеживания последней отрисованной записи (вне функции)
let lastRenderedTime = 0;

export function renderLog(state, els) {
  const root = (state && state.__logRoot) ? state.__logRoot : state;
  const log = root?.log || [];

  // 1. Находим только ТЕ записи, которых еще нет в DOM
  // Фильтруем по времени (e.t), так как записи в логе обычно идут по порядку
  const newEntries = log.filter(e => e.t > lastRenderedTime);

  if (newEntries.length > 0) {
    // Генерируем HTML только для НОВЫХ записей
    const newHtml = newEntries.map((e) => {
      const cls = 
        e.kind === "mut_ok" ? "logEntry good" :
        e.kind === "bud_ok" ? "logEntry bud" :
        e.kind === "mut_fail" ? "logEntry warn" :
        e.kind === "alert" ? "logEntry alert" : "logEntry";

      const meta = e.meta || {};
      const org = Number.isFinite(meta.org) ? meta.org : "";
      const mi = Number.isFinite(meta.mi) ? meta.mi : "";
      const part = meta.part ? String(meta.part) : "";
      const grown = Array.isArray(meta.grownModules) ? meta.grownModules.join(",") : "";

      return `
        <div class="${cls}" data-org="${org}" data-mi="${mi}" data-part="${escapeHtml(part)}" data-grown="${escapeHtml(grown)}">
          <div class="when">${new Date(e.t * 1000).toLocaleTimeString()} • ${escapeHtml(e.kind)}</div>
          <div class="msg">${escapeHtml(e.msg)}</div>
        </div>
      `;
    }).join("");

    // Вставляем новые записи в САМОЕ НАЧАЛО списка
    els.logBody.insertAdjacentHTML('afterbegin', newHtml);
    
    // Обновляем метку времени последней записи
    lastRenderedTime = Math.max(...newEntries.map(e => e.t));

    // 2. Ограничиваем длину списка в DOM (чтобы не тормозило при 180+ записях)
    while (els.logBody.children.length > 70) {
      els.logBody.lastElementChild.remove();
    }
  }

  // 3. Расчет футера (остается прежним, так как он всегда меняется)
  const total = 1e-6 + (state.care?.feed || 0) + (state.care?.wash || 0) + (state.care?.heal || 0) + (state.care?.neglect || 0);
  const pf = (state.care?.feed || 0) / total, 
        pw = (state.care?.wash || 0) / total, 
        ph = (state.care?.heal || 0) / total, 
        pn = (state.care?.neglect || 0) / total;
        
  const top = [
    ["кормить", pf], ["помыть", pw], ["лечение", ph], ["запущ", pn]
  ].sort((a, b) => b[1] - a[1])[0];

  els.logFooter.textContent = `Стиль ухода: ${top[0]} (${Math.round(top[1] * 100)}%) • лог: ${log.length}/70`;
}

export function renderDebugLog(view, els){
  if (!els.dbgBody || !els.dbgCount) return;
  const root = (view.state && view.state.__logRoot) ? view.state.__logRoot : view.state;
  const dbg = root?.debugLog || [];

  // Avoid heavy DOM churn: update only when changed or when panel just opened.
  const count = dbg.length;
  els.dbgCount.textContent = `${count}/${MAX_DEBUG_LOG}`;

  if (els.dbgPanel?.classList?.contains("collapsed")) return;
  if (els.dbgBody._lastCount === count) return;
  els.dbgBody._lastCount = count;

  // Render newest at the bottom (natural scroll).
  const html = dbg.map((e)=>{
    const cls =
      e.kind === "mut_ok" ? "dbgLine good" :
      e.kind === "bud_ok" ? "dbgLine bud" :
      e.kind === "mut_fail" ? "dbgLine warn" :
      e.kind === "alert" ? "dbgLine alert" :
      "dbgLine";
    const when = new Date((e.t||0)*1000).toLocaleTimeString();
    return `<div class="${cls}"><span class="when">${escapeHtml(when)}</span> <span class="kind">${escapeHtml(e.kind||"")}</span> <span class="msg">${escapeHtml(e.msg||"")}</span></div>`;
  }).join("");

  els.dbgBody.innerHTML = html;
  // Stick to bottom
  els.dbgBody.scrollTop = els.dbgBody.scrollHeight;
}

export function attachDebugPanel(view, els){
  if (!els.dbgPanel || !els.dbgTail) return;

  const setCollapsed = (collapsed)=>{
    els.dbgPanel.classList.toggle("collapsed", !!collapsed);
    els.dbgTail.title = collapsed ? "Показать лог" : "Скрыть лог";
    els.dbgTail.textContent = collapsed ? "▶" : "◀";
    // Force rerender on open
    if (!collapsed && els.dbgBody) els.dbgBody._lastCount = -1;
    try { localStorage.setItem("symbiochi_dbgCollapsed", collapsed ? "1" : "0"); } catch {}
  };

  // restore
  try {
    const v = localStorage.getItem("symbiochi_dbgCollapsed");
    if (v === "0") setCollapsed(false);
  } catch {}

  els.dbgTail.addEventListener("click", (e)=>{
    e.preventDefault();
    e.stopPropagation();
    setCollapsed(!els.dbgPanel.classList.contains("collapsed"));
    renderDebugLog(view, els);
  });
}

export function attachSettings(view, els, toast){
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

  function fmtPlan(plan){
    if (!plan || typeof plan !== "object") return "—";
    const eco = plan.ecotype ?? "—";
    const ax  = Array.isArray(plan.axisDir) ? plan.axisDir.join(",") : "—";
    const sym = Number.isFinite(plan.symmetry) ? Math.round(plan.symmetry * 100) + "%" : "—";
    const wig = Number.isFinite(plan.wiggle) ? Math.round(plan.wiggle * 100) + "%" : "—";
    return `eco: ${eco}\naxis: ${ax}\nsym: ${sym}\nwig: ${wig}`;
  }

  function openSettings(state){
    if (!state) return;

    els.evoInput.value = String(state.evoIntervalMin || 12);
    if (els.seedInput){
      els.seedInput.value = String(state.seed ?? 0);
      // informational only
      els.seedInput.readOnly = true;
      els.seedInput.disabled = true;
    }

    if (els.carrotsInput){
      const invC = state?.inv?.carrots;
      els.carrotsInput.value = String(isFinite(invC) ? (invC|0) : 0);
    }

    if (els.coinsInput){
      const invK = state?.inv?.coins;
      els.coinsInput.value = String(isFinite(invK) ? (invK|0) : 0);
    }

    if (els.lenPrio){
      const lp = state.settings?.lengthPriority ?? 0.65;
      els.lenPrio.value = String(Math.round(clamp(lp, 0, 1) * 100));
    }

    // FX toggle: when opening settings we only reflect current state into UI.
    // Do NOT apply anything here; actual apply happens on Save.
    if (els.fxEnabled){
      const cur = (state.settings?.fxEnabled !== false);
      els.fxEnabled.checked = !!cur;
    }

    if (els.planInfo){
      const org = getActiveOrg(state);
      els.planInfo.textContent = fmtPlan(org?.plan);
    }

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
      const parsed = parseInt(els.lenPrio.value, 10);
      const raw = Number.isFinite(parsed) ? parsed / 100 : (view.state.settings?.lengthPriority ?? 0.65);
      const lp = clamp(raw, 0, 1);
      view.state.settings.lengthPriority = lp;
    }

    if (els.fxEnabled){
      const en = !!els.fxEnabled.checked;
      view.state.settings.fxEnabled = en;
      // Apply immediately (real master switch)
      const fx = getFxPipeline(view, view.canvas);
      fx.enabled = en;
    }
    // seed is informational (readonly) — do not apply changes
    if (els.carrotsInput){
      const c = parseInt(els.carrotsInput.value, 10);
      if (!view.state.inv) view.state.inv = { carrots: 0, coins: 0 };
      view.state.inv.carrots = Math.max(0, isFinite(c) ? c : 0);
    }

    if (els.coinsInput){
      const k = parseInt(els.coinsInput.value, 10);
      if (!view.state.inv) view.state.inv = { carrots: 0, coins: 0 };
      view.state.inv.coins = Math.max(0, isFinite(k) ? k : 0);
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

 if (els.settingsBtn) els.settingsBtn.addEventListener("click", () => openSettings(view.state));
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
    if (!view.state.inv) view.state.inv = { carrots: 0, coins: 0 };
    view.state.inv.carrots = Math.max(0, isFinite(v) ? v : 0);
    view.state.lastSeen = nowSec();
    saveGame(view.state);
    rerenderAll(0);
  });
}

export function attachCoinHudInput(view, els, rerenderAll){
  if (!els.coinHudInput) return;
  els.coinHudInput.addEventListener("input", ()=>{
    if (!view.state) return;
    const v = parseInt(els.coinHudInput.value, 10);
    if (!view.state.inv) view.state.inv = { carrots: 0, coins: 0 };
    view.state.inv.coins = Math.max(0, isFinite(v) ? v : 0);
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
    // mutual exclusivity with coin mode
    if (view.mode === "carrot"){
      if (els.coin) els.coin.classList.remove("isActive");
    }
    els.feed.classList.toggle("isActive", view.mode === "carrot");
    toast(view.mode === "carrot" ? "Брось морковку в поле." : "Кормление: выкл.");
    rerenderAll(0);
  });
  if (els.coin){
    els.coin.addEventListener("click", ()=>{
      if (!view.state) return;
      view.mode = (view.mode === "coin") ? null : "coin";
      // mutual exclusivity with carrot mode
      if (view.mode === "coin"){
        els.feed.classList.remove("isActive");
      }
      els.coin.classList.toggle("isActive", view.mode === "coin");
      toast(view.mode === "coin" ? "Поставь монетку в поле." : "Монетка: выкл.");
      rerenderAll(0);
    });
  }
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

/**
 * Drag/pan с ограниченной скоростью для мыши и тача.
 */

export function attachDragPan(el, view) {
  let isDragging = false;
  let lastPos = { x: 0, y: 0 };
  const DRAG_THRESHOLD = 8; // защита от микродвижений
  const activeTouches = new Map(); // pointerId -> { x, y }

  // pinch state
  let pinchStartDist = null;
  let pinchStartZoom = 0;
  const PINCH_SENSITIVITY = 1.0; // 1 = +1 zoom за 2x масштаб, можешь потом подрегулировать

  el.style.touchAction = "none";   // забираем себе жесты
  el.style.userSelect = "none";

  const getTouchDistance = () => {
    if (activeTouches.size < 2) return 0;
    const it = activeTouches.values();
    const p1 = it.next().value;
    const p2 = it.next().value;
    if (!p1 || !p2) return 0;
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.hypot(dx, dy);
  };

  const startDrag = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    if (e.pointerType === "touch") {
      activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activeTouches.size === 2) {
        // старт pinch-жеста
        pinchStartDist = getTouchDistance();
        pinchStartZoom = Number.isFinite(view.zoom) ? view.zoom : 0;
      }
    }

    isDragging = true;
    lastPos = { x: e.clientX, y: e.clientY };
    if (e.pointerId !== undefined) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch (_) {}
    }
    el.classList.add("dragging");
  };

  const moveDrag = (e) => {
    // --- PINCH-ZOOM логика ---
    if (e.pointerType === "touch" && activeTouches.has(e.pointerId)) {
      activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activeTouches.size >= 2 && pinchStartDist && pinchStartDist > 0) {
        const dist = getTouchDistance();
        if (dist > 0) {
          const scale = dist / pinchStartDist; // 1.0 = без изменений
          const baseZoom = pinchStartZoom;
          const deltaZoom = Math.log2(scale) * PINCH_SENSITIVITY;
          const nextZoom = clamp(baseZoom + deltaZoom, -3, 3);
          if (!Number.isNaN(nextZoom)) {
            view.zoom = nextZoom;
            // считаем это "drag", чтобы не было tap-клика
            window._wasDrag = true;
            if (view.camTarget) view.camTarget = null;
          }
        }
        // при pinch не двигаем камеру как при обычном drag
        return;
      }
    }

    // --- обычный drag / панорамирование ---
    if (!isDragging) return;

    const dx = e.clientX - lastPos.x;
    const dy = e.clientY - lastPos.y;

    // Если движение достаточно большое - это drag, а не клик
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      window._wasDrag = true;

      // отключаем автопритяжение камеры
      if (view.camTarget) view.camTarget = null;

      // если был таймер сброса выделения — отменяем
      if (window._pendingClearTimer) {
        clearTimeout(window._pendingClearTimer);
        window._pendingClearTimer = null;
      }
    }

    view.cam.ox -= dx / ((view.blockPx || 4) * 2);
    view.cam.oy -= dy / ((view.blockPx || 4) * 2);

    lastPos = { x: e.clientX, y: e.clientY };
  };

  const stopDrag = (e) => {
    if (e.pointerType === "touch") {
      activeTouches.delete(e.pointerId);
      if (activeTouches.size < 2) {
        // жест закончился
        pinchStartDist = null;
      }
    }

    if (!isDragging) return;

    isDragging = false;
    el.classList.remove("dragging");
    if (e.pointerId !== undefined) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }

    // Если это был не drag и не pinch — считаем tap и шлём ripple
    if (!window._wasDrag) {
      const rect = view.canvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      let ny = (e.clientY - rect.top) / rect.height;
      ny = 1 - ny; // как у тебя было

      addRipple(view, nx, ny, RIPPLE_KIND.TAP);
    }

    // Сбрасываем флаг drag через небольшое время
    setTimeout(() => {
      window._wasDrag = false;
    }, 50);
  };

  el.addEventListener("pointerdown", startDrag);
  el.addEventListener("pointermove", moveDrag);
  el.addEventListener("pointerup", stopDrag);
  el.addEventListener("pointercancel", stopDrag);
}

export function attachZoomWheel(el, view) {
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    view.zoom = Math.max(-3, Math.min(3, view.zoom - delta));
  }, { passive: false });
}

export function attachLogFlash(view, els, rerender){
  if (!els?.logBody) return;
  if (els.logBody.__hasFlash) return;
  els.logBody.__hasFlash = true;

  els.logBody.addEventListener("click", (ev)=>{
    const row = ev.target?.closest?.(".logEntry");
    if (!row) return;
    if (!view?.state) return;

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
      until: Date.now()/1000 + 0.2,
      strength: 2,
    };

    rerender(0);
  });
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