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
    const stress = Math.max(0, Math.min(1, params.stress ?? 0));
    const hpRatio = Math.max(0, Math.min(1, params.hpRatio ?? 1));

    if (!Number.isFinite(frequency) || frequency <= 0) return;
    if (!Number.isFinite(velocity) || velocity <= 0) return;

    const now = audioCtx.currentTime;

    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const osc3 = audioCtx.createOscillator();

    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    const shaper = audioCtx.createWaveShaper();

    osc1.type = "sine";
    osc2.type = "sine";
    osc3.type = "sine";

    // Базовая частота + лёгкая расстройка
    osc1.frequency.setValueAtTime(frequency, now);
    osc2.frequency.setValueAtTime(
        frequency * 2 * (1 + (Math.random() - 0.5) * 0.003),
        now
    );
    osc3.frequency.setValueAtTime(
        frequency * 3 * (1 + (Math.random() - 0.5) * 0.006),
        now
    );

    // Envelope
    const attack = 0.035 + Math.random() * 0.005; // мягкий Sanctuary-стиль
    const baseDecay = 2.0 + Math.random() * 0.8; // 2.5–3.5 sec
    const decay = baseDecay * (0.6 + 0.4 * hpRatio); // HP ↓ → decay короче

    const maxGain = Math.max(0.0001, Math.min(1, velocity));

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(maxGain, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    // Фильтр
    filter.type = "lowpass";
    const baseFreq = 700 + Math.random() * 1000; // 700–2400
    const darkenFactor = 1 - 0.3 * stress;
    filter.frequency.value = 1100 + Math.random() * 500; // Sanctuary range
    filter.Q.value = 0.2 + Math.random() * 0.15; // 0.2–0.6

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