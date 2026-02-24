// mods/audio/bio_handpan.js
// Tap-to-play handpan audio for Symbiochi.
// AUTO/ambient playback is intentionally removed.

import { getNoteFrequency } from "./scale.js";
import { triggerHandpanHit } from "./handpan_voice.js";

// === Tuning ===
export const MASTER_GAIN = 0.08;
export const COMPRESSOR_THRESHOLD = -24;
export const BASE_VELOCITY = 0.65;

// Per-tap anti-spam (same module)
const TAP_COOLDOWN_MS = 300;

// Repeat behavior (as requested)
const REPEAT_MIN_MS = 1000;
const REPEAT_MAX_MS = 2000;
const REPEAT_GAIN_2 = 0.45;
const REPEAT_GAIN_3 = 0.22;
const REPEAT_3_PROB = 0.35; // 2 hits чаще, 3 — реже

// === Audio nodes/state ===
let audioCtx = null;
let masterGainNode = null;
let compressorNode = null;
let isEnabled = true;
let organismFilterFn = null;
let resumeHandlerInstalled = false;

// Tap-to-play anti-spam: cooldown per specific module object
const tapHitTimestamps = new WeakMap();

export function debugPlayTestHit() {
  if (!audioCtx) initBioHandpan();
  if (!audioCtx || !compressorNode) return;

  const frequency = getNoteFrequency(0, 0);
  triggerHandpanHit(audioCtx, compressorNode, {
    frequency,
    velocity: 0.5,
    stress: 0,
    hpRatio: 1,
  });
}

// === Organ → musical parameters ===
export const ORGAN_AUDIO_CONFIG = {
  CORE:     { degrees: [4],          octave:  1 },
  BODY:     { degrees: [0, 1],       octave: -1 },
  EYE:      { degrees: [3, 4],       octave: -1 },
  ANTENNA:  { degrees: [2, 3],       octave:  1 },
  TAIL:     { degrees: [1, 2],       octave:  0 },
  LIMB:     { degrees: [0, 2],       octave:  1 },
  TENTACLE: { degrees: [1, 3, 1, 2], octave:  0 },
  WORM:     { degrees: [1, 3, 4],    octave:  0 },
  SHELL:    { degrees: [0],          octave: -1 },
  SPIKE:    { degrees: [2, 3, 4],    octave:  1 },

  // late organs:
  TEETH:    { degrees: [3, 4],       octave:  1 },
  CLAW:     { degrees: [2],          octave:  0 },
  FIN:      { degrees: [1, 2],       octave: -1 },
  MOUTH:    { degrees: [0, 2],       octave:  0 },
};

function getOrganAudioConfig(organ) {
  if (!organ) return null;
  const rawType = organ.type || organ.kind || organ.id || "";
  const type = String(rawType).toUpperCase();
  return ORGAN_AUDIO_CONFIG[type] || null;
}

// === Helpers ===
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Size→pitch mapping (kept from prior design)
const SIZE_PITCH_MIN_BLOCKS = 280;
const SIZE_PITCH_MAX_BLOCKS = 5000;
const SIZE_PITCH_FREQ_SMALL = 146.83;
const SIZE_PITCH_FREQ_BIG = 65.41;
const SIZE_PITCH_MIN_FACTOR = SIZE_PITCH_FREQ_BIG / SIZE_PITCH_FREQ_SMALL;

function getBodyCellsCount(org) {
  const cells = org?.body?.cells;
  return Array.isArray(cells) ? cells.length : 0;
}

function getOrganismPitchFactor(org) {
  const cells = getBodyCellsCount(org);

  if (cells <= SIZE_PITCH_MIN_BLOCKS) return 1.0;
  if (cells >= SIZE_PITCH_MAX_BLOCKS) return SIZE_PITCH_MIN_FACTOR;

  const t = (cells - SIZE_PITCH_MIN_BLOCKS) /
            (SIZE_PITCH_MAX_BLOCKS - SIZE_PITCH_MIN_BLOCKS);

  return 1.0 + (SIZE_PITCH_MIN_FACTOR - 1.0) * t;
}

function setupResumeOnUserGesture() {
  if (!audioCtx || resumeHandlerInstalled) return;
  resumeHandlerInstalled = true;

  const events = ["pointerdown", "keydown", "touchstart"];

  const resume = () => {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
  };

  events.forEach((ev) => window.addEventListener(ev, resume, true));
}

function handleVisibilityChange() {
  if (!audioCtx || !masterGainNode) return;

  const now = audioCtx.currentTime;
  masterGainNode.gain.cancelScheduledValues(now);
  masterGainNode.gain.setValueAtTime(masterGainNode.gain.value, now);

  const target = !isEnabled ? 0 : MASTER_GAIN;
  const fadeTime = target === 0 ? 0.15 : 0.5;
  masterGainNode.gain.linearRampToValueAtTime(target, now + fadeTime);
}

function isOrganismAudioActive(org) {
  if (!org) return false;

  if (organismFilterFn) return !!organismFilterFn(org);

  const state = String(org.state || "").toLowerCase();
  if (state === "anabiosis" || state === "dormant" || state === "sleep" || state === "sleeping") return false;
  if (state === "withering" || state === "drying" || state === "dead") return false;

  if (org.isInAnabiosis || org.anabiosis || org.isDormant) return false;
  if (org.isWithering || org.isDying || org.withering || org.drying) return false;

  return true;
}

// === Public API ===
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
  masterGainNode.gain.value = MASTER_GAIN;

  compressorNode.connect(masterGainNode);
  masterGainNode.connect(audioCtx.destination);

  document.addEventListener("visibilitychange", handleVisibilityChange);
  setupResumeOnUserGesture();

  return audioCtx;
}

export function setBioHandpanEnabled(enabled) {
  isEnabled = !!enabled;
  handleVisibilityChange();
}

export function setOrganismFilter(fn) {
  organismFilterFn = typeof fn === "function" ? fn : null;
}

export function getBioHandpanAudioContext() {
  return audioCtx;
}

/**
 * Tap-to-play: play an organ sound on click/tap.
 * @param {object} organism - organism object (parent or bud)
 * @param {object} organ - { type, length }
 * @param {object|null} key - optional anti-spam key (module object is ideal)
 */
export function playOrganTap(organism, organ, key = null) {
  if (!isEnabled) return false;
  if (!isOrganismAudioActive(organism)) return false;

  if (!audioCtx) initBioHandpan();
  if (!audioCtx || !compressorNode) return false;
  if (audioCtx.state === "suspended") {
    // will resume on gesture handler; still allow scheduling after resume
  }

  if (key && typeof key === "object") {
    const nowMs = performance.now();
    const lastMs = tapHitTimestamps.get(key) || 0;
    if (nowMs - lastMs < TAP_COOLDOWN_MS) return false;
    tapHitTimestamps.set(key, nowMs);
  }

  const cfg = getOrganAudioConfig(organ);
  if (!cfg) return false;

  const rawLength =
    typeof organ?.length === "number" ? organ.length :
    (typeof organ?.size === "number" ? organ.size : 10);

  // length affects loudness + deterministic pitch choice
  let lenFactor = rawLength / 20;
  if (!Number.isFinite(lenFactor)) lenFactor = 0.5;
  lenFactor = Math.max(0.2, Math.min(1, lenFactor));

  const pitchFactor = getOrganismPitchFactor(organism);

  // stress/hp feed timbre in handpan_voice
  const rawStress =
    typeof organism?.stress === "number" ? organism.stress :
    (typeof organism?.stressLevel === "number" ? organism.stressLevel : 0);
  const stress = clamp01(rawStress);

  const hp =
    typeof organism?.hp === "number" ? organism.hp :
    (typeof organism?.hpCurrent === "number" ? organism.hpCurrent :
      (typeof organism?.health === "number" ? organism.health : 1));

  const maxHp =
    typeof organism?.hpMax === "number" ? organism.hpMax :
    (typeof organism?.maxHp === "number" ? organism.maxHp : hp);

  const hpRatio = maxHp > 0 ? clamp01(hp / maxHp) : 1;

  // Deterministic scale degree from length (no motifs, no micro-variation)
  const degArr = Array.isArray(cfg.degrees) && cfg.degrees.length ? cfg.degrees : [0];
  const degree = degArr[Math.abs(Math.floor(rawLength)) % degArr.length] || 0;

  const baseFrequency = getNoteFrequency(degree, cfg.octave || 0);
  const frequency = baseFrequency * pitchFactor;

  const baseVelocity = BASE_VELOCITY * lenFactor;

  const repeats = (Math.random() < REPEAT_3_PROB) ? 3 : 2;
  const gains = repeats === 3 ? [1.0, REPEAT_GAIN_2, REPEAT_GAIN_3] : [1.0, REPEAT_GAIN_2];

  triggerHandpanHit(audioCtx, compressorNode, {
    frequency,
    velocity: Math.max(0.02, baseVelocity),
    stress,
    hpRatio,
  });

  return true;
}

// Back-compat no-op: auto/ambient removed by design.
export function updateBioHandpan() {
  return;
}
