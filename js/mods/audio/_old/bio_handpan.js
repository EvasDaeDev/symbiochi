// mods/audio/bio_handpan.js
// Процедурная handpan-аудиосистема для организмов.

import { getNoteFrequency } from "./scale.js";
import { triggerHandpanHit, getActiveVoicesCount } from "./handpan_voice.js";

export function debugPlayTestHit() {
  // если вдруг ещё не инициализировали — инициализируем
  if (!audioCtx) initBioHandpan();
  if (!audioCtx || !compressorNode) return;

  // простая нота: root, средняя октава
  const frequency = getNoteFrequency(0, 0);

  triggerHandpanHit(audioCtx, compressorNode, {
    frequency,
    velocity: 0.5, // довольно громко
    stress: 0,
    hpRatio: 1,
  });
}



// === точки настройки (экспортируемые константы) ===

export const MAX_HITS_PER_SEC = 1.4;      // было 1.4 — теперь организм может заводить кластеры чаще
export const MASTER_GAIN = 0.08;
export const COMPRESSOR_THRESHOLD = -24;
export const BASE_VELOCITY = 0.65;
export const STRESS_MULTIPLIER = 1.0;
export const UPDATE_INTERVAL_MS = 200;    // было 200 — принимаем решения чуть чаще
const GLOBAL_ACTIVITY_GAIN = 1.0;         // было 3.5 — общий буст активности

// Целевой "мягкий" темп для общего ковра
export const TARGET_BPM = 96;
const TARGET_HITS_PER_SEC = TARGET_BPM / 60; // удара/сек
const HIT_WINDOW_SEC = 4;                    // окно для измерения плотности
const ADAPT_SPEED = 0.15;                    // скорость автоподстройки плотности

let recentHits = [];
let adaptiveActivityMul = 1.0;
// Персональные фазовые сдвиги по биту для каждого организма
const organismBeatOffsets = new Map();

// === внутреннее состояние системы ===

let audioCtx = null;
let masterGainNode = null;
let compressorNode = null;

let isEnabled = true;

// AUTO проигрывание (ambient) отключено: используем только tap-to-play.
const AUTO_PLAY_ENABLED = false;
let lastDecisionTimeMs = 0;

// Global conductor: чтобы организмы не играли все одновременно
const conductor = {
  untilMs: 0,        // до какого времени “сцена занята”
  leaderOrgKey: null // кто сейчас ведущий (не обязательно, но полезно)
};

function canWorldStartPhrase(orgKey, plannedPhraseMs){
  const nowMs = performance.now();

  // если этот организм уже лидер и фраза ещё идёт — пусть продолжает
  if (conductor.leaderOrgKey === orgKey && nowMs < conductor.untilMs){
    return true;
  }

  // если сцена свободна — пускаем и бронируем
  if (nowMs >= conductor.untilMs){
    conductor.leaderOrgKey = orgKey;
    conductor.untilMs = nowMs + plannedPhraseMs;
    return true;
  }

  // сцена занята — в 25% случаев разрешаем "вход в середине"
  const remaining = conductor.untilMs - nowMs;
  const progress = 1 - (remaining / Math.max(1, plannedPhraseMs));
  const allowMid = (Math.random() < 0.25) && (progress >= 0.25) && (progress <= 0.60);

  return allowMid;
}

const organismHitTimestamps = new Map(); // per-organism hit limiter
let organismFilterFn = null;
let resumeHandlerInstalled = false;

const organHitTimestamps = new WeakMap(); // per-organism per-organ-type limiter

// Tap-to-play антиспам: кулдаун на конкретный модуль (орган)
const tapHitTimestamps = new WeakMap();

function canOrganEmitHit(orgKey, organType, minIntervalMs){
  const nowMs = performance.now();
  const type = String(organType || "").toUpperCase();

  let perOrg = organHitTimestamps.get(orgKey);
  if (!perOrg){
    perOrg = new Map();
    organHitTimestamps.set(orgKey, perOrg);
  }

  const lastMs = perOrg.get(type) ?? 0;
  if (nowMs - lastMs < minIntervalMs) return false;

  perOrg.set(type, nowMs);
  return true;
}

// Адаптивная плотность и окно последних ударов



// === утилиты ===

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function randChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Регистрация ударов в скользящем окне
function registerHit() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  recentHits.push(now);

  const cutoff = now - HIT_WINDOW_SEC;
  while (recentHits.length && recentHits[0] < cutoff) {
    recentHits.shift();
  }
}


// Мягкий "магнит" к виртуальному биту (чем ближе к доле — тем выше коэффициент)
function getBeatBias(nowMs) {
  if (!Number.isFinite(nowMs)) return 1;

  const beatMs = 60000 / TARGET_BPM;
  const phase = nowMs % beatMs;                     // позиция внутри такта
  const dist = Math.min(phase, beatMs - phase);     // расстояние до ближайшей доли
  const norm = dist / (beatMs * 0.5 || 1);          // 0 на доле, 1 в середине между долями

  // 0..1 → 1.4..0.4 (на доле — 1.4, вдалеке — 0.4)
  const bias = 1.25 - 0.75 * Math.min(1, norm);
  return bias;
}

// Персональный фазовый сдвиг организма относительно глобального бита
function getOrganismBeatOffsetMs(orgKey) {
  if (!orgKey) return 0;

  let offset = organismBeatOffsets.get(orgKey);
  if (offset == null) {
    const beatMs = 60000 / TARGET_BPM;
    // случайный сдвиг в пределах одного бита
    offset = Math.random() * beatMs;
    organismBeatOffsets.set(orgKey, offset);
  }
  return offset;
}

// === Маппинг размера тела в питч ===

// Диапазон размеров тела, в котором меняем высоту звука
const SIZE_PITCH_MIN_BLOCKS = 280;   // до этого размера высота не меняется
const SIZE_PITCH_MAX_BLOCKS = 5000;  // после этого — дальше не понижаем

// Желаемые частоты для "маленького" и "огромного" организма (концептуально)
const SIZE_PITCH_FREQ_SMALL = 146.83; // Гц
const SIZE_PITCH_FREQ_BIG   = 65.41;  // Гц

// Минимальный множитель высоты относительно базовой
const SIZE_PITCH_MIN_FACTOR = SIZE_PITCH_FREQ_BIG / SIZE_PITCH_FREQ_SMALL;

// Безопасно считаем количество клеток тела организма
function getBodyCellsCount(org){
  const cells = org?.body?.cells;
  return Array.isArray(cells) ? cells.length : 0;
}

/**
 * Линейное отображение количества блоков тела в множитель высоты.
 *  - до SIZE_PITCH_MIN_BLOCKS: 1.0 (без изменения)
 *  - между SIZE_PITCH_MIN_BLOCKS и SIZE_PITCH_MAX_BLOCKS: линейно до SIZE_PITCH_MIN_FACTOR
 *  - после SIZE_PITCH_MAX_BLOCKS: SIZE_PITCH_MIN_FACTOR (дальше не падаем)
 */
function getOrganismPitchFactor(org){
  const cells = getBodyCellsCount(org);

  if (cells <= SIZE_PITCH_MIN_BLOCKS) return 1.0;
  if (cells >= SIZE_PITCH_MAX_BLOCKS) return SIZE_PITCH_MIN_FACTOR;

  const t = (cells - SIZE_PITCH_MIN_BLOCKS) /
            (SIZE_PITCH_MAX_BLOCKS - SIZE_PITCH_MIN_BLOCKS); // 0..1

  return 1.0 + (SIZE_PITCH_MIN_FACTOR - 1.0) * t;
}

function updateAdaptiveActivity() {
  if (!audioCtx) return;
  if (!recentHits.length) {
    adaptiveActivityMul = 1.5; // лёгкий старт из тишины
    return;
  }

  const hitsPerSec = recentHits.length / HIT_WINDOW_SEC;
  const target = TARGET_HITS_PER_SEC;

  // хотим, чтобы hitsPerSec стремилось к target
  const desiredMul = target / Math.max(0.001, hitsPerSec);
  adaptiveActivityMul += (desiredMul - adaptiveActivityMul) * ADAPT_SPEED;

  adaptiveActivityMul = Math.max(0.3, Math.min(3.0, adaptiveActivityMul));
}

 // === Мелодический движок ===

 // Паттерны в терминах ступеней пентатоники D minor:
 // 0=D, 1=F, 2=G, 3=A, 4=C
 const MELODIC_PATTERNS = [
//  [0, 2, 3, 2, 0, 2, 0, 0], // D G A G D G D D
//  [0, 1, 2, 1, 0, 2, 0, 0], // D F G F D G D D
//  [0, 2, 4, 2, 0, 3, 2, 0], // D G C G D A G D
//  [0, 3, 2, 1, 0, 2, 1, 0], // D A G F D G F D
//  [0, 0, 2, 0],   // D D G D
//  [0, 2, 2, 0],   // D G G D
//  [0, 1, 0, 2],   // D F D G
  [0, 3, 3, 0],   // D A A D
 ];

 let currentPattern = null;
 let patternStep = 0;
 let lastPatternChangeMs = performance.now();

 // как часто меняем общий мотив (в миллисекундах)
 const PATTERN_CHANGE_MIN_MS = 8000;
 const PATTERN_CHANGE_MAX_MS = 20000;

 /**
  * Возвращает следующую ступень текущего мотива (0..4),
  * иногда меняя сам мотив на другой.
  */
 function pickNextMotifDegree() {
   if (!currentPattern || !currentPattern.length) {
     currentPattern = randChoice(MELODIC_PATTERNS);
     patternStep = 0;
     lastPatternChangeMs = performance.now();
   }

   const now = performance.now();
   const life = now - lastPatternChangeMs;

   // Чем дольше живёт текущий мотив, тем выше шанс его сменить
   if (
     life > PATTERN_CHANGE_MIN_MS &&
     Math.random() < (life / PATTERN_CHANGE_MAX_MS)
   ) {
     currentPattern = randChoice(MELODIC_PATTERNS);
     patternStep = 0;
     lastPatternChangeMs = now;
   }

   const deg = currentPattern[patternStep % currentPattern.length];
   patternStep = (patternStep + 1) % (currentPattern.length || 1);
   return deg;
 }

 /**
  * Выбор ступени гаммы для конкретного органа.
  * - 70% ударов стараются следовать мотиву
  * - но всё равно учитываем degrees органа
  * - делаем мягкий, взвешенный выбор вокруг ноты мотива
  */
 function pickDegreeForOrgan(cfg) {
   if (!cfg || !Array.isArray(cfg.degrees) || !cfg.degrees.length) {
     return 0;
   }

   const motifDegree = pickNextMotifDegree();

   // С шансом ~80% орган играет "по мотиву"
   const followChance = 0.8;
   if (Math.random() > followChance) {
     return randChoice(cfg.degrees);
   }

   // Пытаемся подобрать ноту ближе к мотиву
   const candidates = [];

   for (const d of cfg.degrees) {
     if (d === motifDegree) {
       candidates.push({ d, w: 3 }); // точно в мотив — самый приоритет
     } else if (d === motifDegree - 1 || d === motifDegree + 1) {
       candidates.push({ d, w: 2 }); // соседние ступени — тоже ок
     } else {
       candidates.push({ d, w: 0.2 }); // дальние — редко, но возможны
     }
   }

   // Взвешенный случайный выбор по weight
   let sum = 0;
   for (const c of candidates) sum += c.w;
   let r = Math.random() * sum;
   for (const c of candidates) {
     r -= c.w;
     if (r <= 0) return c.d;
   }
   return candidates[candidates.length - 1].d;
 }

function pickFollowerDegreeNearLeader(leaderDeg, cfg){
  const degrees = Array.isArray(cfg?.degrees) ? cfg.degrees : null;
  if (!degrees || !degrees.length) return leaderDeg;

  // аккордное окно: лидер или соседние ступени
  const wanted = [leaderDeg, leaderDeg - 1, leaderDeg + 1];

  for (const w of wanted){
    if (degrees.includes(w)) return w;
  }

  // если совсем не подходит — fallback на текущий движок
  return pickDegreeForOrgan(cfg);
}

// === Оркестровка: кто кому подпевает ===

const ENSEMBLE_FOLLOWERS = {
  EYES: {
    followers: ["TENTACLE", "WORM" , "SPIKE"],
    followerProb: 0.65,   // шанс, что каждый подходящий орган подпоёт
    velocityMul: 0.65     // фолловеры чуть тише
  },
  CORE: {
    followers: ["TAIL", "TENTACLE", "ANTENNA" , "SHELL"],
    followerProb: 0.65,
    velocityMul: 0.65
  },

  
  // можно добавить ещё связок по вкусу
};

function getFollowersForLeaderType(type) {
  const key = String(type || "").toUpperCase();
  return ENSEMBLE_FOLLOWERS[key] || null;
}

// Маппинг типов органов → музыкальные параметры
export const ORGAN_AUDIO_CONFIG = {
  CORE:     { degrees: [0],    octave: -1, baseRate: 0.080, stressBias: 1.0 },
  EYES:     { degrees: [3, 4], octave: -1, baseRate: 0.032, stressBias: 1.0 },
  ANTENNA:  { degrees: [2, 3], octave:  0, baseRate: 0.038, stressBias: 1.0 },
  TAIL:     { degrees: [1, 2], octave:  0, baseRate: 0.055, stressBias: 1.0 },
  LIMB:     { degrees: [0, 2],    octave:  0, baseRate: 0.055, stressBias: 1.0 },
  TENTACLE: { degrees: [1, 3, 1, 2], octave:  0, baseRate: 0.055, stressBias: 1.0 },
  WORM:     { degrees: [1, 3, 4],    octave:  0, baseRate: 0.055, stressBias: 1.0 },
  SHELL:    { degrees: [0],    octave: -1, baseRate: 0.064, stressBias: 1.0 },
  SPIKE:    { degrees: [2, 3, 4], octave:  0, baseRate: 0.025, stressBias: 1.0 },

  // поздние органы:
  TEETH:    { degrees: [3, 4], octave:  0, baseRate: 0.038, stressBias: 1.2 },
  CLAW:     { degrees: [2],    octave:  0, baseRate: 0.050, stressBias: 1.3 },
  FIN:      { degrees: [1, 2], octave: -1, baseRate: 0.045, stressBias: 1.0 },
  MOUTH:    { degrees: [0, 2], octave:  0, baseRate: 0.038, stressBias: 1.1 }
};

function getOrganAudioConfig(organ) {
  if (!organ) return null;
  const rawType = organ.type || organ.kind || organ.id || "";
  const type = String(rawType).toUpperCase();
  return ORGAN_AUDIO_CONFIG[type] || null;
}

// === инициализация AudioContext и мастер-цепи ===

function setupResumeOnUserGesture() {
  if (!audioCtx || resumeHandlerInstalled) return;
  resumeHandlerInstalled = true;

  const events = ["pointerdown", "keydown", "touchstart"];

  const resume = () => {
    if (audioCtx && audioCtx.state === "suspended") {
      // Пытаемся возобновить контекст при любом жесте пользователя
      audioCtx.resume().catch(() => {
        // Игнорируем ошибки (например, если браузеру всё ещё не нравится контекст)
      });
    }
    // ВАЖНО: НЕ снимаем обработчики, чтобы они работали и после оффлайна
    // events.forEach((ev) => window.removeEventListener(ev, resume, true));
  };

  events.forEach((ev) => window.addEventListener(ev, resume, true));
}

function handleVisibilityChange() {
  if (!audioCtx || !masterGainNode) return;

  const now = audioCtx.currentTime;
  masterGainNode.gain.cancelScheduledValues(now);
  masterGainNode.gain.setValueAtTime(masterGainNode.gain.value, now);

  // Раньше: (!isEnabled || document.hidden) ? 0 : MASTER_GAIN
  const target = !isEnabled ? 0 : MASTER_GAIN;
  const fadeTime = target === 0 ? 0.15 : 0.5;

  masterGainNode.gain.linearRampToValueAtTime(target, now + fadeTime);
}

/**
 * Инициализация аудиосистемы handpan.
 * Вызывать один раз при старте приложения (в startGame).
 */
export function initBioHandpan() {
  if (audioCtx) return audioCtx;

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    console.warn("[bio_handpan] Web Audio API not supported");
    return null;
  }

  audioCtx = new AudioContextCtor();

  compressorNode = audioCtx.createDynamicsCompressor();
  compressorNode.threshold.value = COMPRESSOR_THRESHOLD;
  compressorNode.knee.value = 24;
  compressorNode.ratio.value = 3.5;
  compressorNode.attack.value = 0.003;
  compressorNode.release.value = 0.25;

  masterGainNode = audioCtx.createGain();
  // Раньше: document.hidden ? 0 : MASTER_GAIN;
  masterGainNode.gain.value = MASTER_GAIN;

  compressorNode.connect(masterGainNode);
  masterGainNode.connect(audioCtx.destination);

  document.addEventListener("visibilitychange", handleVisibilityChange);
  setupResumeOnUserGesture();

  lastDecisionTimeMs = performance.now();

  return audioCtx;
}

/**
 * Включить/выключить систему handpan.
 */
export function setBioHandpanEnabled(enabled) {
  isEnabled = !!enabled;
  handleVisibilityChange();
}

/**
 * Опциональный кастомный фильтр: активен ли организм для аудио.
 * fn(organism) => true/false
 */
export function setOrganismFilter(fn) {
  organismFilterFn = typeof fn === "function" ? fn : null;
}

/**
 * Получить текущий AudioContext (если нужно шарить ещё с чем-то).
 */
export function getBioHandpanAudioContext() {
  return audioCtx;
}

/**
 * Tap-to-play: проиграть звук органа по клику/тапу.
 * @param {object} organism - объект организма (parent или bud)
 * @param {object} organ - { type, length }
 * @param {object|null} key - опциональный ключ для антиспама (обычно ссылка на модуль organ)
 */
export function playOrganTap(organism, organ, key = null) {
  if (!isEnabled) return false;

  // Фильтр активности организма (если задан)
  if (!isOrganismAudioActive(organism)) return false;

  // Инициализируем аудио при первом использовании
  if (!audioCtx) initBioHandpan();
  if (!audioCtx || !compressorNode) return false;

  // Кулдаун на конкретный модуль, чтобы повторы не накапливались в кашу
  if (key && typeof key === "object") {
    const nowMs = performance.now();
    const lastMs = tapHitTimestamps.get(key) || 0;
    if (nowMs - lastMs < 300) return false;
    tapHitTimestamps.set(key, nowMs);
  }

  const cfg = getOrganAudioConfig(organ);
  if (!cfg) return false;

  const rawLength =
    typeof organ?.length === "number"
      ? organ.length
      : (typeof organ?.size === "number" ? organ.size : 10);

  let lenFactor = rawLength / 20;
  if (!Number.isFinite(lenFactor)) lenFactor = 0.5;
  lenFactor = Math.max(0.2, Math.min(1, lenFactor));

  // Высота зависит от размера тела
  const pitchFactor = getOrganismPitchFactor(organism);

  // Стресс/HP — для тембра handpan_voice (если используется)
  const rawStress =
    typeof organism?.stress === "number"
      ? organism.stress
      : (typeof organism?.stressLevel === "number" ? organism.stressLevel : 0);

  const stress = clamp01(rawStress * STRESS_MULTIPLIER);

  const hp =
    typeof organism?.hp === "number"
      ? organism.hp
      : (typeof organism?.hpCurrent === "number"
        ? organism.hpCurrent
        : (typeof organism?.health === "number" ? organism.health : 1));

  const maxHp =
    typeof organism?.hpMax === "number"
      ? organism.hpMax
      : (typeof organism?.maxHp === "number"
        ? organism.maxHp
        : hp);

  const hpRatio = maxHp > 0 ? clamp01(hp / maxHp) : 1;

  // Дет. выбор ступени по длине (без "мотива" и без микро-вариаций)
  const degArr = Array.isArray(cfg.degrees) && cfg.degrees.length ? cfg.degrees : [0];
  const degreeIndex = degArr[Math.abs(Math.floor(rawLength)) % degArr.length] || 0;

  const baseFrequency = getNoteFrequency(degreeIndex, cfg.octave || 0);
  const frequency = baseFrequency * pitchFactor;

  const baseVelocity = BASE_VELOCITY * lenFactor;

  // Повторы: 2–3 раза, интервалы 1–2 секунды, тише на 2-м/3-м ударе
  const repeats = (Math.random() < 0.35) ? 3 : 2;
  const gains = repeats === 3 ? [1.0, 0.85, 0.72] : [1.0, 0.85];

  let delayMs = 0;
  for (let i = 0; i < repeats; i++) {
    const gain = gains[i] ?? 1.0;
    const fire = () => {
      triggerHandpanHit(audioCtx, compressorNode, {
        frequency,
        velocity: Math.max(0.02, baseVelocity * gain),
        stress,
        hpRatio
      });
      registerHit();
    };

    if (delayMs <= 0) fire();
    else setTimeout(fire, delayMs);

    // следующий повтор
    if (i < repeats - 1) {
      delayMs += 1000 + Math.random() * 1000; // 1–2 сек
    }
  }

  return true;
}


// === работа с организмами ===

function isOrganismAudioActive(org) {
  if (!org) return false;

  if (organismFilterFn) {
    return !!organismFilterFn(org);
  }

  const state = String(org.state || "").toLowerCase();

  if (
    state === "anabiosis" ||
    state === "dormant" ||
    state === "sleep" ||
    state === "sleeping"
  ) {
    return false;
  }

  if (
    state === "withering" ||
    state === "drying" ||
    state === "dead"
  ) {
    return false;
  }

  if (org.isInAnabiosis || org.anabiosis || org.isDormant) return false;
  if (org.isWithering || org.isDying || org.withering || org.drying) return false;

  return true;
}

// root + buds → массив организмов
function extractOrganisms(gameState) {
  if (!gameState) return [];

  // Уже массив организмов
  if (Array.isArray(gameState)) return gameState;

  // Альтернативные поля, если когда-то появятся
  if (Array.isArray(gameState.organisms))    return gameState.organisms;
  if (Array.isArray(gameState.organismList)) return gameState.organismList;

  // Симбио-структура: родитель + buds
  const result = [gameState];
  if (Array.isArray(gameState.buds)) {
    result.push(...gameState.buds);
  }
  return result;
}

function getOrganList(org) {
  if (!org) return [];

  // Если вдруг где-то появятся явные organs/parts — используем их
  if (Array.isArray(org.organs)) return org.organs;
  if (Array.isArray(org.parts))  return org.parts;

  const result = [];

  // 1) CORE — отдельный басовый голос, привязанный к ядру тела
  if (org.body && (org.body.core || org.body.cells)) {
    // длину ядра можно считать условной 1
    result.push({ type: "CORE", length: 1 });
  }

  // 2) modules → трактуем как органы
  const modules = org.modules;
  if (Array.isArray(modules)) {
    for (const m of modules) {
      const cells = Array.isArray(m?.cells) ? m.cells : [];
      const length = cells.length || 1;

      // Пытаемся вытащить тип, иначе LIMB
      const rawType = m.type || m.kind || m.name || "LIMB";

      result.push({
        type: rawType,  // EYES / TAIL / TENTACLE / и т.п. — если есть
        length,
      });
    }
  }

  return result;
}

function countTotalActiveAudioOrgans(organisms) {
  let count = 0;
  for (const org of organisms) {
    const organs = getOrganList(org);
    for (const organ of organs) {
      if (getOrganAudioConfig(organ)) {
        count++;
      }
    }
  }
  return count;
}

function canOrganismEmitHit(orgKey) {
  const nowMs = performance.now();
  const lastMs = organismHitTimestamps.get(orgKey) ?? 0;
  const minIntervalMs = 1000 / MAX_HITS_PER_SEC;

  if (nowMs - lastMs < minIntervalMs) {
    return false;
  }

  organismHitTimestamps.set(orgKey, nowMs);
  return true;
}

function cleanupHitTracker(activeOrganisms) {
  const activeSet = new Set(activeOrganisms);
  for (const key of organismHitTimestamps.keys()) {
    if (!activeSet.has(key)) {
      organismHitTimestamps.delete(key);
    }
  }
}

// === главный апдейт (вызывать из игрового цикла) ===

/**
 * Обновление аудио-логики.
 * Вызывать из игрового цикла, можно хоть каждый frame — внутри есть троттлинг.
 *
 * @param {Object|Array} gameState - либо state целиком, либо массив организмов
 */
export function updateBioHandpan(gameState) {
  // AUTO/ambient режим отключён (оставлено для возможного будущего другого алгоритма)
  if (!AUTO_PLAY_ENABLED) return;
  if (!audioCtx || !compressorNode || !masterGainNode) return;
  if (!isEnabled) return;
  if (document.hidden) return;

  if (audioCtx.state === "suspended") return;

  const nowMs = performance.now();
  if (nowMs - lastDecisionTimeMs < UPDATE_INTERVAL_MS) {
    return;
  }
  lastDecisionTimeMs = nowMs;

  // Обновляем адаптивный множитель активности перед генерацией ударов
  updateAdaptiveActivity();

  const organisms = extractOrganisms(gameState);
  if (!organisms.length) return;

  const activeOrganisms = organisms.filter(isOrganismAudioActive);
  if (!activeOrganisms.length) {
    cleanupHitTracker([]);
    return;
  }

  const totalActiveOrgans = countTotalActiveAudioOrgans(activeOrganisms);
  if (!totalActiveOrgans) {
    cleanupHitTracker(activeOrganisms);
    return;
  }

  const globalVoices = getActiveVoicesCount();
  const energyBudget = 1 / Math.sqrt(globalVoices + 0.7);


  for (const org of activeOrganisms) {
    maybeEmitHitForOrganism(org, totalActiveOrgans, energyBudget, nowMs);
  }

  cleanupHitTracker(activeOrganisms);
}

// === генерация ударов по формулам ===

function maybeEmitHitForOrganism(organism, totalActiveOrgans, energyBudget, nowMs) {
  const organs = getOrganList(organism);
  if (!organs.length) return;

  const rawStress =
    typeof organism.stress === "number"
      ? organism.stress
      : (typeof organism.stressLevel === "number" ? organism.stressLevel : 0);

  const stress = clamp01(rawStress * STRESS_MULTIPLIER);

  const hp =
    typeof organism.hp === "number"
      ? organism.hp
      : (typeof organism.hpCurrent === "number"
        ? organism.hpCurrent
        : (typeof organism.health === "number" ? organism.health : 1));

  const maxHp =
    typeof organism.hpMax === "number"
      ? organism.hpMax
      : (typeof organism.maxHp === "number"
        ? organism.maxHp
        : hp);

  const hpRatio = maxHp > 0 ? clamp01(hp / maxHp) : 1;

  const orgKey = organism;

  // Коэффициент высоты, зависящий от размера тела (body.cells)
  const pitchFactor = getOrganismPitchFactor(organism);

  // Персональный фазовый сдвиг для организма + "магнит" к биту
  const beatOffsetMs = getOrganismBeatOffsetMs(orgKey);
  const beatBias = getBeatBias(nowMs + beatOffsetMs);

  // --- 1) заранее проверяем, может ли организм вообще бить в этот тик ---
  if (!canOrganismEmitHit(orgKey)) {
    return;
  }

  // --- 2) собираем кандидатов с их шансами ---
  const candidates = [];
  const localDensityFactor = 1 / Math.sqrt(organs.length || 1);

  for (const organ of organs) {
    const cfg = getOrganAudioConfig(organ);
    if (!cfg) continue;

    const rawLength =
      typeof organ.length === "number"
        ? organ.length
        : (typeof organ.size === "number" ? organ.size : 10);

    let lenFactor = rawLength / 20;
    if (!Number.isFinite(lenFactor)) lenFactor = 0.5;
    lenFactor = Math.max(0.2, Math.min(1, lenFactor));

    // Глобальная плотность теперь почти не душит систему при большом количестве органов
    const densityFactor = 0.6 + 0.4 / Math.sqrt(totalActiveOrgans || 1);

    const stressFactor = 1.0 - 0.45 * stress;
    const hpActivityFactor = 0.4 + 0.6 * hpRatio;

    let P =
      cfg.baseRate *
      lenFactor *
      densityFactor *
      stressFactor *
      hpActivityFactor *
      GLOBAL_ACTIVITY_GAIN *
      adaptiveActivityMul;

    // мягкий "магнит" к биту (ближе к долям — чаще срабатывание)
    P *= beatBias;

    // safety cap — чуть выше, чем был
    P = Math.min(0.5, P);

    candidates.push({
      organ,
      cfg,
      lenFactor,
      P
    });
  }
  
  if (!candidates.length) return;

  // немного перемешиваем, чтобы не всегда один и тот же тип был лидером
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }

  let leader = null;

  for (const c of candidates) {
    if (Math.random() < c.P) {
      leader = c;
      break;
    }
  }

  if (!leader) {
    // в этот тик организм промолчал
    return;
  }

  // --- 3) удар лидера ---
  const leaderType = String(leader.organ.type || leader.organ.kind || "").toUpperCase();

  const degreeIndexLead = pickDegreeForOrgan(leader.cfg);
  const octaveLead = leader.cfg.octave;
  const baseFrequencyLead = getNoteFrequency(degreeIndexLead, octaveLead);
  const frequencyLead = baseFrequencyLead * pitchFactor;

  const velocityLead = BASE_VELOCITY * energyBudget * leader.lenFactor;

// Оценим длительность фразы (примерно по паттерну)
// Если у тебя паттерны по 4 шага и шаг ~ (60/BPM)*1000 * subdivision — можно грубо так:
const stepMs = (60_000 / TARGET_BPM);      // четверть
const phraseSteps = (currentPattern?.length || 4);
const plannedPhraseMs = Math.max(900, phraseSteps * stepMs);

// Глобальный дирижёр: только один организм ведёт фразу
// gate только на старте фразы (когда patternStep === 0)
if (patternStep === 0){
  const stepMs = (60_000 / TARGET_BPM) * 0.1; // считаем как восьмые, чтобы фразы не были "вечными"
  const phraseSteps = (currentPattern?.length || 4);
  const plannedPhraseMs = Math.max(600, phraseSteps * stepMs);

  if (!canWorldStartPhrase(orgKey, plannedPhraseMs)) return;
}

  triggerHandpanHit(audioCtx, compressorNode, {
    frequency: frequencyLead,
    velocity: velocityLead,
    stress,
    hpRatio
  });
  registerHit();

  // --- 4) фолловеры: глаз → тентакли и т.п. ---
  const ensemble = getFollowersForLeaderType(leaderType);
  if (!ensemble) return;

  const followerTypesSet = new Set(
    (ensemble.followers || []).map(t => String(t || "").toUpperCase())
  );
  const followerProb = ensemble.followerProb ?? 0.1;
  const followerVelMul = ensemble.velocityMul ?? 0.8;

  for (const c of candidates) {
    if (c === leader) continue;

    const oType = String(c.organ.type || c.organ.kind || "").toUpperCase();
    if (!followerTypesSet.has(oType)) continue;

    if (Math.random() > followerProb) continue;
	
	// лимитер на орган (фолловерам особенно нужен)
if (!canOrganEmitHit(orgKey, oType, 350)) continue; // 350мс — “релакс всегда”

    const degreeIndex = pickFollowerDegreeNearLeader(degreeIndexLead, c.cfg);
    const octave = c.cfg.octave;

    const baseFrequency = getNoteFrequency(degreeIndex, octave);
    const frequency = baseFrequency * pitchFactor;

    const velocity = BASE_VELOCITY * energyBudget * c.lenFactor * followerVelMul;

    triggerHandpanHit(audioCtx, compressorNode, {
      frequency,
      velocity,
      stress,
      hpRatio
    });
    registerHit();
  }
}