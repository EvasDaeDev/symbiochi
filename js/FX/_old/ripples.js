// js/FX/ripples.js
// Волны/"желе"-дисторшен в screen-space.
//
// Важно:
// - Это *view-only* слой: хранит события и формирует uniform-ы для WebGL.
// - Не трогаем state, не меняем симуляцию.

export const MAX_RIPPLES = 6;

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

  // Вычищаем старые по возрасту.
  // TAP живёт меньше, BLAST — дольше.
  rt.ripples = rt.ripples.filter((r)=>{
    const age = (t - r.t0) / 1000;
    if (r.kind === RIPPLE_KIND.TAP) return age < 1.6;
    if (r.kind === RIPPLE_KIND.SHOCK) return age < 1.2;
    return age < 2.2; // BLAST
  });

  const out = new Float32Array(MAX_RIPPLES * 4);
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

function clamp01(v){
  v = +v;
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
