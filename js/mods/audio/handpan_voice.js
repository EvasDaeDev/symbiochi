// mods/audio/handpan_voice.js
// Один перкуссионный голос handpan для организма.

let activeVoices = 0;
const MAX_SIMULTANEOUS_VOICES = 8;

let saturatorCurve = null;

function createSaturatorCurve() {
    // Мягкая waveshaper-сатурация.
    const n = 256;
    const curve = new Float32Array(n);
    const amount = 1.0;

    for (let i = 0; i < n; i++) {
        const x = (i * 2) / (n - 1) - 1; // -1..1
        curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
    }
    return curve;
}

function getSaturatorCurve() {
    if (!saturatorCurve) {
        saturatorCurve = createSaturatorCurve();
    }
    return saturatorCurve;
}

/**
 * Возвращает текущее количество активных голосов.
 */
export function getActiveVoicesCount() {
    return activeVoices;
}

/**
 * Запускает один удар handpan.
 *
 * @param {AudioContext} audioCtx
 * @param {AudioNode} destinationNode - обычно мастер-компрессор
 * @param {Object} params
 * @param {number} params.frequency   - частота, Гц
 * @param {number} params.velocity    - 0..1, громкость удара (с учётом energyBudget)
 * @param {number} [params.stress=0]  - 0..1, влияет на "темноту" фильтра
 * @param {number} [params.hpRatio=1] - 0..1, влияет на длину хвоста
 */
export function triggerHandpanHit(audioCtx, destinationNode, params) {
    if (!audioCtx || audioCtx.state === "closed") return;
    if (!destinationNode) return;
    if (activeVoices >= MAX_SIMULTANEOUS_VOICES) return;

    const frequency = params.frequency;
    let velocity = params.velocity;
// лёгкий компрессор чувствительности: низкие vel остаются, высокие сглаживаются
velocity = Math.pow(velocity, 0.8);

const maxGain = Math.max(0.0001, Math.min(0.7, velocity)); // кэп на 0.7
    const stress = Math.max(0, Math.min(1, params.stress ?? 0));
    const hpRatio = Math.max(0, Math.min(1, params.hpRatio ?? 1));

    if (!Number.isFinite(frequency) || frequency <= 0) return;
    if (!Number.isFinite(velocity) || velocity <= 0) return;

    const now = audioCtx.currentTime;

const osc1 = audioCtx.createOscillator();
const osc2 = audioCtx.createOscillator();
const osc3 = audioCtx.createOscillator();

const gain1 = audioCtx.createGain();
const gain2 = audioCtx.createGain();
const gain3 = audioCtx.createGain();

const gain = audioCtx.createGain();
const filter = audioCtx.createBiquadFilter();
const shaper = audioCtx.createWaveShaper();

osc1.type = "sine";
osc2.type = "sine";
osc3.type = "sine";

// Базовая частота + мягкая расстройка
osc1.frequency.setValueAtTime(frequency, now);
osc2.frequency.setValueAtTime(
  frequency * 2 * (1 + (Math.random() - 0.5) * 0.001),
  now
);
osc3.frequency.setValueAtTime(
  frequency * 3 * (1 + (Math.random() - 0.5) * 0.002),
  now
);

// Уровни: фундамент громкий, обертона мягче
gain1.gain.value = 1.0;
gain2.gain.value = 0.45; // было 1
gain3.gain.value = 0.25; // было 1

osc1.connect(gain1);
osc2.connect(gain2);
osc3.connect(gain3);

gain1.connect(gain);
gain2.connect(gain);
gain3.connect(gain);


    // Envelope
// Мягкий, но быстрый щелчок (handpan vibe)
const attack = 0.008 + Math.random() * 0.007; // 0.008–0.015

// Более стабильный и длинный хвост для релакса
const baseDecay = 1.1 + Math.random() * 2.5; // 4.5–7.0 сек
const decay = baseDecay * (0.7 + 0.3 * hpRatio); 
// HP ↓ чуть короче, но не радикально — чтобы не было "обрубков"

    

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(maxGain, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    // Фильтр
filter.type = "lowpass";

// Чем выше стресс — тем темнее звук
const darkenFactor = 1 - 0.4 * stress;     // stress 0 → 1.0, stress 1 → 0.6

// Базовый диапазон для "санктуарийного" тембру
const baseCutoff = 350 + Math.random() * 250; // 350–600 Гц

filter.frequency.setValueAtTime(baseCutoff * darkenFactor, now);

// Низкий Q, чтобы не вылезали резкие пики
filter.Q.setValueAtTime(0.15 + Math.random() * 0.25, now); // 0.15–0.4

    // Лёгкая сатурация
    shaper.curve = getSaturatorCurve();
    shaper.oversample = "4x";

    // Routing
    osc1.connect(gain);
    osc2.connect(gain);
    osc3.connect(gain);

    gain.connect(filter);
    filter.connect(shaper);
    shaper.connect(destinationNode);

    activeVoices++;

    const stopTime = now + decay + 0.05;

    osc1.start(now);
    osc2.start(now);
    osc3.start(now);

    osc1.stop(stopTime);
    osc2.stop(stopTime);
    osc3.stop(stopTime);

    const cleanupDelayMs = (decay + 0.1) * 1000;

    setTimeout(() => {
        try {
            osc1.disconnect();
            osc2.disconnect();
            osc3.disconnect();
            gain.disconnect();
            filter.disconnect();
            shaper.disconnect();
        } catch (e) {
            // узлы могли уже быть отключены — игнорируем
        }
        activeVoices = Math.max(0, activeVoices - 1);
    }, cleanupDelayMs);
}