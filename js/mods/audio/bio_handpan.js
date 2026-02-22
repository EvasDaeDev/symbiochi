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

export const MAX_HITS_PER_SEC = 1.6;
export const MASTER_GAIN = 0.15;
export const COMPRESSOR_THRESHOLD = -24;
export const BASE_VELOCITY = 0.55;
export const STRESS_MULTIPLIER = 1.0;
export const UPDATE_INTERVAL_MS = 250; // мс между "решениями" по ударам

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

// Маппинг типов органов → музыкальные параметры
export const ORGAN_AUDIO_CONFIG = {
  CORE:     { degrees: [0],    octave: -1, baseRate: 0.060, stressBias: 1.0 },
  EYES:     { degrees: [3, 4], octave:  0, baseRate: 0.032, stressBias: 1.0 },
  ANTENNA:  { degrees: [2, 3], octave:  0, baseRate: 0.038, stressBias: 1.0 },
  TAIL:     { degrees: [1, 2], octave:  0, baseRate: 0.055, stressBias: 1.0 },
  LIMB:     { degrees: [0, 2],    octave:  0, baseRate: 0.055, stressBias: 1.0 },
  TENTACLE: { degrees: [2, 3], octave:  -1, baseRate: 0.095, stressBias: 1.0 },
  WORM:     { degrees: [1, 3, 4],    octave:  0, baseRate: 0.095, stressBias: 1.0 },
  SHELL:    { degrees: [0],    octave:  0, baseRate: 0.024, stressBias: 1.0 },
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
      audioCtx.resume();
    }
    events.forEach((ev) => window.removeEventListener(ev, resume, true));
  };

  events.forEach((ev) => window.addEventListener(ev, resume, true));
}

function handleVisibilityChange() {
  if (!audioCtx || !masterGainNode) return;

  const now = audioCtx.currentTime;
  masterGainNode.gain.cancelScheduledValues(now);
  masterGainNode.gain.setValueAtTime(masterGainNode.gain.value, now);

  const target = (!isEnabled || document.hidden) ? 0 : MASTER_GAIN;
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
  masterGainNode.gain.value = document.hidden ? 0 : MASTER_GAIN;

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
 * Получить текущий AudioContext (если нужно шарить ещё с чем‑то).
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

  // Альтернативные поля, если когда‑то появятся
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

  // Если вдруг где‑то появятся явные organs/parts — используем их
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
  const energyBudget = 1 / Math.sqrt(globalVoices + 1);

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

    const densityFactor = 1 / Math.sqrt(totalActiveOrgans);
    const stressFactor = 0.6 + 0.7 * stress * (cfg.stressBias ?? 1);
    const hpActivityFactor = 0.4 + 0.6 * hpRatio;

    let P = cfg.baseRate * lenFactor * densityFactor * stressFactor * hpActivityFactor;
    P = Math.min(0.35, P); // safety cap

    if (Math.random() < P) {
      if (!canOrganismEmitHit(orgKey)) {
        break;
      }

      const degreeIndex = randChoice(cfg.degrees);
      const octave = cfg.octave;

      const frequency = getNoteFrequency(degreeIndex, octave);

      const organVelocityFactor = lenFactor;
      const velocity = BASE_VELOCITY * energyBudget * organVelocityFactor;

      triggerHandpanHit(audioCtx, compressorNode, {
        frequency,
        velocity,
        stress,
        hpRatio
      });

      // максимум один удар на организм за тик
      break;
    }
  }
}

