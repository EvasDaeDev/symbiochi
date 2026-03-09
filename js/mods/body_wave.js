// mods/body_wave.js
// Variant A: "волнистый радиальный фронт" для органического роста тела.
//
// Храним всё в одном месте: state.body.wave.
// Рендер не трогаем: это чисто про выбор клетки для роста.

import { clamp01, hash32, mulberry32 } from "../util.js";

export const BODY_WAVE = {
  // Требование пользователя: шум радиусом 3..9 блоков.
  ampMinBlocks: 10,
  ampMaxBlocks: 17,

  // Кол-во "лепестков" по окружности (чем больше — тем чаще смена направления).
  lobesMin: 0,
  lobesMax: 3,

  // Скорость дрейфа фазы (медленно, чтобы форма "помнила" себя)
  phaseSpeedMin: 0.010,
  phaseSpeedMax: 0.055,

  // Сколько дискретных узлов для 1D value-noise по углу
  bins: 6,

  // Слабый микро-джиттер на кандидата, чтобы не застревать в локальных паттернах
  microJitter: 0.05
};

function smoothstep(t){
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t){
  return a + (b - a) * t;
}

// Угол -> [0..1)
function angle01(dx, dy){
  let a = Math.atan2(dy, dx); // -pi..pi
  if (a < 0) a += Math.PI * 2;
  return a / (Math.PI * 2);
}

// Простая 1D value-noise (интерполяция по bins).
function valueNoise01(prng, t01, bins){
  const x = t01 * bins;
  const i0 = Math.floor(x);
  const f = x - i0;
  const i1 = i0 + 1;
  // "random" значения на узлах. Делаем устойчиво: прокручиваем prng.
  // Чтобы не ломать воспроизводимость от порядка вызовов — используем hash.
  const v0 = nodeHash01(prng.__seed, i0);
  const v1 = nodeHash01(prng.__seed, i1);
  return lerp(v0, v1, smoothstep(f));
}

function nodeHash01(seed, i){
  const h = hash32(seed, i | 0);
  return (h >>> 0) / 0xFFFFFFFF;
}

function stateWiggle(state){
  const b = state?.bars || {};
  const food = Number(b.food ?? 0);
  const clean = Number(b.clean ?? 0);
  const hp = Number(b.hp ?? 0);
  const coreMin = Math.min(food, clean, hp);
  return clamp01(1 - coreMin);
}

export function ensureBodyWave(state, rng = null){
  if (!state || !state.body) return;
  if (state.body.wave && typeof state.body.wave === "object"){
    // гарантим наличие полей (на случай старых сейвов)
    if (!Number.isFinite(state.body.wave.seed)) state.body.wave.seed = (state.seed ?? 1) | 0;
    if (!Number.isFinite(state.body.wave.phase)) state.body.wave.phase = 0;
    if (!Number.isFinite(state.body.wave.phaseSpeed)) state.body.wave.phaseSpeed = BODY_WAVE.phaseSpeedMin;
    if (!Number.isFinite(state.body.wave.ampBlocks)) state.body.wave.ampBlocks = BODY_WAVE.ampMinBlocks;
    if (!Number.isFinite(state.body.wave.lobes)) state.body.wave.lobes = BODY_WAVE.lobesMin;
    if (!Number.isFinite(state.body.wave.bins)) state.body.wave.bins = BODY_WAVE.bins;
    if (!Number.isFinite(state.body.wave.microJitter)) state.body.wave.microJitter = BODY_WAVE.microJitter;
    return;
  }

  // Инициализация: визуальный характер теперь зависит от текущего состояния,
  // а не от заранее сгенерированного плана.
  const seed = (state.seed ?? 1) | 0;
  const prng = rng || mulberry32(hash32(seed, 44011));

  const wiggle = stateWiggle(state);
  const ampBlocks = Math.round(lerp(BODY_WAVE.ampMinBlocks, BODY_WAVE.ampMaxBlocks, wiggle));
  const lobes = Math.max(1, Math.round(lerp(BODY_WAVE.lobesMin, BODY_WAVE.lobesMax, prng())));
  const phaseSpeed = lerp(BODY_WAVE.phaseSpeedMin, BODY_WAVE.phaseSpeedMax, prng());

  state.body.wave = {
    seed,
    ampBlocks,
    lobes,
    phase: prng() * 10,
    phaseSpeed,
    bins: BODY_WAVE.bins,
    microJitter: BODY_WAVE.microJitter
  };
}

// Авто-тюнинг волны под большие тела (2000+ блоков).
// Идея: сохраняем "характер" (wiggle/seed), но плавно усиливаем лопастность и детализацию,
// при этом замедляя phaseSpeed и уменьшая microJitter, чтобы огромные тела не выглядели "желе".
//
// Важно: это НЕ меняет рендер, только приоритизацию кандидатов роста.
export function tuneBodyWaveForSize(state){
  if (!state?.body?.wave) return;
  const w = state.body.wave;

  const n = Math.max(1, state?.body?.cells?.length || 1);

  // 0..1: начинаем усиливать после 800, полностью включаем к 2000.
  const big = clamp01((n - 800) / (2000 - 800));
  if (big <= 0) return;

  // Используем состояние организма как "ручку характера" и на больших телах тоже.
  const wiggle = stateWiggle(state);

  // Целевые диапазоны для 2000+:
  // amp: 34..110 (по wiggle)
  // lobes: 3..5 (детерминировано по seed)
  // bins: 10 или 12 (детерминировано по seed)
  // phaseSpeed: 0.010..0.025
  // microJitter: 0.02
  const ampBig = Math.round(lerp(34, 110, wiggle));
  const lobesBig = 3 + ((hash32(w.seed | 0, 90210) >>> 0) % 3); // 3..5
  const binsBig = ((hash32(w.seed | 0, 1337) >>> 0) & 1) ? 12 : 10;
  const phaseSpeedBig = Math.max(0.010, Math.min(0.025, Number.isFinite(w.phaseSpeed) ? w.phaseSpeed : 0.018));
  const microJitterBig = 0.02;

  // Плавное приближение к big-настройкам.
  w.ampBlocks = Math.round(lerp(Number.isFinite(w.ampBlocks) ? w.ampBlocks : BODY_WAVE.ampMinBlocks, ampBig, big));
  w.lobes = Math.round(lerp(Number.isFinite(w.lobes) ? w.lobes : 1, lobesBig, big));
  w.bins = Math.round(lerp(Number.isFinite(w.bins) ? w.bins : BODY_WAVE.bins, binsBig, big));
  w.phaseSpeed = lerp(Number.isFinite(w.phaseSpeed) ? w.phaseSpeed : BODY_WAVE.phaseSpeedMin, phaseSpeedBig, big);
  w.microJitter = lerp(Number.isFinite(w.microJitter) ? w.microJitter : BODY_WAVE.microJitter, microJitterBig, big);
}

// Вызывай раз в "мутационный" тик, если хочешь лёгкое дыхание формы.
// (Можно не вызывать вообще: форма будет полностью стабильной.)
export function advanceBodyWave(state, dtTicks = 0){
  if (!state?.body?.wave) return;
  const w = state.body.wave;
  const step = Number.isFinite(w.phaseSpeed) ? w.phaseSpeed : BODY_WAVE.phaseSpeedMin;
  w.phase = (Number.isFinite(w.phase) ? w.phase : 0) + step * (dtTicks || 1);
}

// СКОРОВОЕ значение для сортировки кандидатов тела.
// Чем МЕНЬШЕ score, тем больше вероятность, что рост пойдёт сюда.
export function bodyWaveScore(state, x, y){
  const core = state?.body?.core || [0, 0];
  const dx = x - core[0];
  const dy = y - core[1];
  const dist = Math.hypot(dx, dy);

  // Базовый радиус от площади: R ~ sqrt(A/pi).
  const n = Math.max(1, state?.body?.cells?.length || 1);
  const baseR = Math.sqrt(n / Math.PI);

  ensureBodyWave(state);
  const w = state.body.wave;

  // Угол + фаза; lobes влияет на частоту волн.
  const t = angle01(dx, dy);
  const tLobed = (t * (w.lobes || 1) + (w.phase || 0)) % 1;

  // 1D value noise по углу (плавный 0..1)
  const prng = mulberry32(hash32(w.seed | 0, 99173));
  // хак: сохраняем seed для nodeHash01, чтобы не зависеть от порядка вызовов
  prng.__seed = hash32(w.seed | 0, 77177);
  const n01 = valueNoise01(prng, tLobed, w.bins || BODY_WAVE.bins);
  const wave = (n01 - 0.5) * 2; // -1..1

  const desiredR = baseR + (w.ampBlocks || BODY_WAVE.ampMinBlocks) * wave;

  // Скор: хотим, чтобы dist стремился к desiredR.
  // Меньше — значит "в этой стороне фронт должен быть дальше", т.е. расти туда.
  let score = dist - desiredR;

  // лёгкий микроджиттер, устойчивый по координатам
  const h = hash32(w.seed | 0, (x * 73856093) ^ (y * 19349663));
  const jitter = Number.isFinite(w.microJitter) ? w.microJitter : BODY_WAVE.microJitter;
  const j = ((h & 1023) / 1023 - 0.5) * jitter;
  score += j;

  return score;
}
