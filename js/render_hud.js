// js/render_hud.js
// HUD renderer extracted from render.js for safety and maintainability.
// IMPORTANT: This module must remain render-only (no state mutation).

import { barPct } from "./util.js";
import { getStageName } from "./creature.js";
import { moodEmoji, stateEmoji } from "../content/icons.js";
import { EVO } from "./mods/evo.js";

// Keep local copies to avoid circular deps with render.js
function barToneCls(v){
  if (!isFinite(v)) return "";
  if (v > 0.80) return "ok";
  if (v > 0.60) return "info";
  if (v > 0.20) return "warn";
  if (v > 0.00) return "bad";
  return "bad";
}

function barStatus(org){
  const bars = org?.bars || {food:1,clean:1,hp:1,mood:1};
  const minBar = Math.min(bars.food, bars.clean, bars.hp, bars.mood);
  if (minBar <= 0.01) return { txt:"усыхание", cls:"bad" };
  if (minBar <= 0.1) return { txt:"анабиоз", cls:"bad" };
  if (minBar <= 0.15) return { txt:"критично", cls:"bad" };
  if (minBar <= 0.35) return { txt:"плохо", cls:"bad" };
  if (minBar <= 0.65) return { txt:"норма", cls:"" };
  return { txt:"хорошо", cls:"ok" };
}

function stateEmojiSafe(txt){
  try { return stateEmoji(txt); } catch { return "•"; }
}

export function renderHud(state, org, els, deltaSec, fmtAgeSeconds, zoom){
  const target = org || state;
  const status = barStatus(target);

  if (els.hudName) els.hudName.textContent = target.name;
  if (els.hudStage) els.hudStage.textContent = `• ${getStageName(target)}`;

  if (els.hudMeta){
    els.hudMeta.innerHTML = `
      <span class="pill stat ${barToneCls(target.bars.food)}" data-stat="food" title="сытость: ${barPct(target.bars.food)}%"><span class="ico"></span><span class="val">${barPct(target.bars.food)}%</span></span>
      <span class="pill stat ${barToneCls(target.bars.clean)}" data-stat="clean" title="чистота: ${barPct(target.bars.clean)}%"><span class="ico"></span><span class="val">${barPct(target.bars.clean)}%</span></span>
      <span class="pill stat ${barToneCls(target.bars.hp)}" data-stat="hp" title="здоровье: ${barPct(target.bars.hp)}%"><span class="ico"></span><span class="val">${barPct(target.bars.hp)}%</span></span>
      <span class="pill stat ${barToneCls(target.bars.mood)}" data-stat="mood" title="настроение: ${barPct(target.bars.mood)}%"><span class="ico">${moodEmoji(target.bars.mood)}</span><span class="val">${barPct(target.bars.mood)}%</span></span>
      <span class="pill stat ${status.cls}" data-stat="state" title="состояние: ${status.txt}"><span class="ico">${stateEmojiSafe(status.txt)}</span></span>
    `;
  }

  if (els.lifePill){
    const now = state.lastSeen || target.lastSeen || 0;
    const age = Math.max(0, now - (target.createdAt || now));
    els.lifePill.textContent = `☀: ${fmtAgeSeconds(age)}`; //возраст
  }

  // Keep compatibility with old HUD inputs if present
  if (els.carrotHudInput && document.activeElement !== els.carrotHudInput){
    const v = state.inv?.carrots ?? 0;
    els.carrotHudInput.value = String(Math.max(0, v|0));
  }
  if (els.coinHudInput && document.activeElement !== els.coinHudInput){
    const v = state.inv?.coins ?? 0;
    els.coinHudInput.value = String(Math.max(0, v|0));
  }

  if (els.hudMeta2){
    const carrotCount = Array.isArray(state.carrots) ? state.carrots.length : 0;
    const coinCount = Array.isArray(state.coins) ? state.coins.length : 0;

    const inv = state.inv || {};
    const food  = inv.food  ?? inv.carrots ?? 0;
    const water = inv.water ?? 0;
    const heal  = inv.heal  ?? 0;
    const coins = inv.coins ?? 0;

    const t = Array.isArray(target.growthTarget) ? target.growthTarget : null;
    const mode = target.growthTargetMode;
    const power = Number.isFinite(target.growthTargetPower) ? target.growthTargetPower : 0;

    const modeTxt =
      mode === "appendage" ? "орган" :
      mode === "body" ? "тело" :
      mode === "mixed" ? "смеш" :
      ((carrotCount + coinCount) > 0 ? "ожид" : "—");

    const pTxt = t ? `${Math.round(power*100)}%` : "";

    els.hudMeta2.innerHTML = `
      <span class="invItem"><span class="hudIco" style="--ico: var(--ico-coin)"></span><span class="invVal">:${Math.max(0, coins|0)}</span></span>
      <span class="invItem"><span class="hudIco" style="--ico: var(--ico-drop)"></span><span class="invVal">:${Math.max(0, water|0)}</span></span>
	  <span class="invItem"><span class="hudIco" style="--ico: var(--ico-cross)"></span><span class="invVal">:${Math.max(0, heal|0)}</span></span>
	  <span class="invItem"><span class="hudIco" style="--ico: var(--ico-carrot)"></span><span class="invVal">:${Math.max(0, food|0)}</span>

    `;
  }
//      <span class="pill"> - тянет ${modeTxt}${pTxt ? ` - ${pTxt}` : ""}</span> - показывает статус цели морковки, вставить в hudMeta2


  if (els.footerInfo){
    const active = state.active;
    const selBud =
      Number.isFinite(active) && Array.isArray(state.buds) && active >= 0 && active < state.buds.length
        ? state.buds[active]
        : null;
    const org2 = selBud || state;

    const base = Number.isFinite(EVO?.baseIntervalSec) ? EVO.baseIntervalSec : 25;
    const speed = Number.isFinite(org2?.evoSpeed) ? org2.evoSpeed : 0;
    const inStasis = !!org2?.inStasis || speed <= 0;

    // If we are playing back offline catch-up, show that explicitly (v2.2 UX).
    const catchupLeft = (org2?.offlineCatchup|0);
    const catchupInterval = 1.0;
    if (!inStasis && catchupLeft > 0){
      const acc = Number.isFinite(org2?.offlineCatchupAcc) ? org2.offlineCatchupAcc : 0;
      const untilCatch = Math.max(0, (1 - (acc % 1)) * catchupInterval);
      const name = selBud ? (selBud.name || `Почка #${active+1}`) : (state.name || "Организм");
      els.footerInfo.innerHTML =
  `${name}: <span class="offlineCatch">догоняем оффлайн - осталось ${catchupLeft}</span> • ${fmtAgeSeconds(Math.round(untilCatch))} • zoom:${zoom ?? ""}`;
      return;
    }
    const intervalSec = inStasis ? Infinity : (Math.max(1e-6, base) / Math.max(1e-6, speed));
    const prog = Number.isFinite(org2?.evoProgress) ? org2.evoProgress : 0;
    const until = inStasis ? Infinity : Math.max(0, (1 - prog) * intervalSec);

    const name = selBud ? (selBud.name || `Почка #${active+1}`) : (state.name || "Организм");
els.footerInfo.innerHTML =
  inStasis
    ? `${name}: <span class="stasisWarn">!СТАЗИС!</span> • zoom:${zoom ?? ""}`
    : `${name}: эволюция через: ${fmtAgeSeconds(Math.round(until))} (интервал: ${Math.round(intervalSec)}с) • zoom:${zoom ?? ""}`;
  }
}
