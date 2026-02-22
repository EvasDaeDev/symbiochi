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

export const MAX_HITS_PER_SEC = 1.9;
export const MASTER_GAIN = 0.25;
export const COMPRESSOR_THRESHOLD = -24;
export const BASE_VELOCITY = 0.65;
export const STRESS_MULTIPLIER = 0.1;
export const UPDATE_INTERVAL_MS = 100; // мс между "решениями" по ударам
const GLOBAL_ACTIVITY_GAIN = 3.5;
// === внутреннее состояние системы ===

let audioCtx = null;
let masterGainNode = null;
let compressorNode = null;

let isEnabled = true;
let lastDecisionTimeMs = 0;

const organismHitTimestamps = new Map(); // per-organism hit limiter
let organismFilterFn = null;
let resumeHandlerInstalled = false;

// === утилиты ===

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function randChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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


 // === Мелодический движок ===

 // Паттерны в терминах ступеней пентатоники D minor:
 // 0=D, 1=F, 2=G, 3=A, 4=C
 const MELODIC_PATTERNS = [
   [0, 2, 3, 0], // D G A D
   [0, 1, 2, 0], // D F G D
   [0, 2, 4, 2], // D G C G
   [0, 3, 2, 0], // D A G D
 ];

 let currentPattern = null;
 let patternStep = 0;
 let lastPatternChangeMs = performance.now();

 // как часто меняем общий мотив (в миллисекундах)
 const PATTERN_CHANGE_MIN_MS = 4000;
 const PATTERN_CHANGE_MAX_MS = 10000;

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
   const followChance = 0.1;
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
       candidates.push({ d, w: 1 }); // дальние — редко, но возможны
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


// === Оркестровка: кто кому подпевает ===

const ENSEMBLE_FOLLOWERS = {
  EYES: {
    followers: ["TENTACLE", "WORM"],
    followerProb: 0.9,   // шанс, что каждый подходящий орган подпоёт
    velocityMul: 0.9     // фолловеры чуть тише
  },
  CORE: {
    followers: ["TAIL", "TENTACLE", "ANTENNA"],
    followerProb: 0.9,
    velocityMul: 0.9
  },

  
  // можно добавить ещё связок по вкусу
};

function getFollowersForLeaderType(type) {
  const key = String(type || "").toUpperCase();
  return ENSEMBLE_FOLLOWERS[key] || null;
}

// Маппинг типов органов → музыкальные параметры
export const ORGAN_AUDIO_CONFIG = {
  CORE:     { degrees: [0],    octave:  0, baseRate: 0.080, stressBias: 1.0 },
  EYES:     { degrees: [3, 4], octave:  0, baseRate: 0.032, stressBias: 1.0 },
  ANTENNA:  { degrees: [2, 3], octave:  0, baseRate: 0.038, stressBias: 1.0 },
  TAIL:     { degrees: [1, 2], octave:  0, baseRate: 0.055, stressBias: 1.0 },
  LIMB:     { degrees: [0, 2],    octave:  0, baseRate: 0.055, stressBias: 1.0 },
  TENTACLE: { degrees: [1, 3, 1, 2], octave:  -1, baseRate: 0.055, stressBias: 1.0 },
  WORM:     { degrees: [1, 3, 4],    octave:  0, baseRate: 0.055, stressBias: 1.0 },
  SHELL:    { degrees: [0],    octave: -1, baseRate: 0.064, stressBias: 1.0 },
  SPIKE:    { degrees: [2, 3, 4], octave:  0, baseRate: 0.025, stressBias: 1.0 },

  // поздние органы:
  TEETH:    { degrees: [3, 4], octave:  0, baseRate: 0.038, stressBias: 1.2 },
  CLAW:     { degrees: [2],    octave:  0, baseRate: 0.050, stressBias: 1.3 },
  FIN:      { degrees: [1, 2], octave:  0, baseRate: 0.045, stressBias: 1.0 },
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
  if (!audioCtx || !compressorNode || !masterGainNode) return;
  if (!isEnabled) return;
  if (document.hidden) return;

  if (audioCtx.state === "suspended") return;

  const nowMs = performance.now();
  if (nowMs - lastDecisionTimeMs < UPDATE_INTERVAL_MS) {
    return;
  }
  lastDecisionTimeMs = nowMs;

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
  // const energyBudget = 1 / Math.sqrt(globalVoices + 1);
  // ВРЕМЕННО: без глобального уменьшения громкости
  const energyBudget = 1;

  for (const org of activeOrganisms) {
    maybeEmitHitForOrganism(org, totalActiveOrgans, energyBudget);
  }

  cleanupHitTracker(activeOrganisms);
}

// === генерация ударов по формулам ===

function maybeEmitHitForOrganism(organism, totalActiveOrgans, energyBudget) {
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

  const densityFactor = Math.min(1, 1 / Math.sqrt(totalActiveOrgans * 0.6));
  const stressFactor = 0.6 + 0.7 * stress * (cfg.stressBias ?? 1);
  const hpActivityFactor = 0.4 + 0.6 * hpRatio;

  let P = cfg.baseRate * lenFactor * densityFactor * stressFactor * hpActivityFactor * GLOBAL_ACTIVITY_GAIN;
P = Math.min(0.35, P); // safety cap оставляем, чтобы не совсем залить всё звуком

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

  triggerHandpanHit(audioCtx, compressorNode, {
    frequency: frequencyLead,
    velocity: velocityLead,
    stress,
    hpRatio
  });

  // --- 4) фолловеры: глаз → тентакли и т.п. ---
  const ensemble = getFollowersForLeaderType(leaderType);
  if (!ensemble) return;

  const followerTypesSet = new Set(
    (ensemble.followers || []).map(t => String(t || "").toUpperCase())
  );
  const followerProb = ensemble.followerProb ?? 0.6;
  const followerVelMul = ensemble.velocityMul ?? 0.8;

  for (const c of candidates) {
    if (c === leader) continue;

    const oType = String(c.organ.type || c.organ.kind || "").toUpperCase();
    if (!followerTypesSet.has(oType)) continue;

    if (Math.random() > followerProb) continue;

    const degreeIndex = pickDegreeForOrgan(c.cfg);
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
  }
}