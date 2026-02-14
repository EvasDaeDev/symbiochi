// js/FX/ripples.js
// Волны/"желе"-дисторшен в screen-space.
//
// Важно:
// - Это *view-only* слой: хранит события и формирует uniform-ы для WebGL.
// - Не трогаем state, не меняем симуляцию.

export const MAX_RIPPLES = 4;

// Типы волн для шейдера.
// TAP   — обычный тап (короткая, мягкая рябь)
// SHOCK — ударная волна (мутация / поднятие статов)
// BLAST — более мощный "взрыв" (почкование)
export const RIPPLE_KIND = {
  TAP: 0,
  SHOCK: 1,
  BLAST: 2,
};

function nowMs(){
  return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
}

function ensureRuntime(view){
  view._fxRuntime = view._fxRuntime || {};
  if (!Array.isArray(view._fxRuntime.ripples)) view._fxRuntime.ripples = [];
  if (!Number.isFinite(view._fxRuntime.t0Ms)) view._fxRuntime.t0Ms = nowMs();

  // ------------------------------
  // Накопитель «цветовой энергии» от кликов.
  // Зачем:
  // - хотим, чтобы при частых кликах "рябь" становилась более психоделичной:
  //   усиливался сдвиг тона/насыщенности.
  // Как работает:
  // - addRipple() добавляет энергию (на клике больше).
  // - buildRippleUniforms() плавно затухает энергию по времени.
  // Важно:
  // - это view-only: НЕ трогает state.
  // - pipeline.js может использовать это значение для усиления chroma/overlay.
  if (!Number.isFinite(view._fxRuntime.rippleColorEnergy)) view._fxRuntime.rippleColorEnergy = 0.0;
  if (!Number.isFinite(view._fxRuntime._rippleColorEnergyTms)) view._fxRuntime._rippleColorEnergyTms = nowMs();
  return view._fxRuntime;
}

/**
 * addRipple(view, nx, ny, kind)
 * nx,ny — нормализованные координаты 0..1 (в screen space).
 */
export function addRipple(view, nx, ny, kind){
  const rt = ensureRuntime(view);
  const t = nowMs();

  const k = (kind === RIPPLE_KIND.SHOCK || kind === RIPPLE_KIND.BLAST) ? kind : RIPPLE_KIND.TAP;
  const r = {
    x: clamp01(nx),
    y: clamp01(ny),
    kind: k,
    t0: t,
  };

  rt.ripples.push(r);

  // ------------------------------
  // НАКОПЛЕНИЕ ЦВЕТНОСТИ (чем чаще кликаешь — тем сильнее)
  //
  // Мы накапливаем отдельный scalar 0..~2.0.
  // Далее pipeline.js использует его, чтобы временно увеличить:
  // - chromaMult / chromaticPx (ощущение сдвига цвета)
  // - overlay (мягкий tint)
  //
  // Параметры подобраны так, чтобы:
  // - одиночный клик даёт легкий эффект,
  // - серия кликов "разгоняет" цвет.
  //
  // Можно легко тюнить:
  // - addTap / addShock / addBlast
  // - maxEnergy
  const maxEnergy = 2.2;
  const addTap = 0.28;
  const addShock = 0.18;
  const addBlast = 0.32;
  let add = addTap;
  if (k === RIPPLE_KIND.SHOCK) add = addShock;
  if (k === RIPPLE_KIND.BLAST) add = addBlast;
  rt.rippleColorEnergy = Math.min(maxEnergy, (rt.rippleColorEnergy || 0) + add);

  // Лимит: держим только последние MAX_RIPPLES
  if (rt.ripples.length > MAX_RIPPLES){
    rt.ripples.splice(0, rt.ripples.length - MAX_RIPPLES);
  }
}

export function clearRipples(view){
  const rt = ensureRuntime(view);
  rt.ripples.length = 0;
}

/**
 * buildRippleUniforms(view)
 * Возвращает массив vec4 длиной MAX_RIPPLES:
 *  (x, y, ageSec, kind)
 * Неактивные заполняются нулями.
 */
export function buildRippleUniforms(view){
  const rt = ensureRuntime(view);
  const t = nowMs();

  // ------------------------------
  // ЗАТУХАНИЕ «ЦВЕТОВОЙ ЭНЕРГИИ»
  //
  // Экспоненциальный decay: выглядит натурально и не зависит от FPS.
  // Чем больше rate — тем быстрее затухает.
  // Можно тюнить 1.0..2.5
  const lastT = rt._rippleColorEnergyTms || t;
  const dt = Math.max(0, (t - lastT) / 1000);
  rt._rippleColorEnergyTms = t;
  const decayRate = 1.6;
  const decay = Math.exp(-dt * decayRate);
  rt.rippleColorEnergy = (rt.rippleColorEnergy || 0) * decay;

  // Вычищаем старые по возрасту.
  // TAP живёт меньше, BLAST — дольше.
  rt.ripples = rt.ripples.filter((r)=>{
    const age = (t - r.t0) / 1000;
    if (r.kind === RIPPLE_KIND.TAP) return age < 1.6;
    if (r.kind === RIPPLE_KIND.SHOCK) return age < 1.2;
    return age < 2.2; // BLAST
  });

  // Reuse a single uniform buffer to avoid GC spikes.
  rt._rippleUniforms = rt._rippleUniforms || new Float32Array(MAX_RIPPLES * 4);
  const out = rt._rippleUniforms;
  out.fill(0);
  for (let i = 0; i < MAX_RIPPLES; i++){
    const r = rt.ripples[i];
    if (!r) continue;
    const ageSec = (t - r.t0) / 1000;
    out[i*4 + 0] = r.x;
    out[i*4 + 1] = r.y;
    out[i*4 + 2] = ageSec;
    out[i*4 + 3] = r.kind;
  }
  return out;
}

/**
 * getRippleColorEnergy(view)
 * Возвращает накопленную «цветовую энергию» от кликов (0..~2.2).
 * Это отдельный скаляр, чтобы pipeline.js мог усиливать цветовые пост-эффекты.
 */
export function getRippleColorEnergy(view){
  const rt = ensureRuntime(view);
  return +rt.rippleColorEnergy || 0.0;
}

function clamp01(v){
  v = +v;
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
