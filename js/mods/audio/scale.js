// mods/audio/scale.js
// D minor pentatonic scale (fixed, без сидов и сдвигов)

export const ROOT_NOTE_D3 = 146.83; // D3
export const PENTATONIC_STEPS = [0, 3, 5, 7, 10]; // 0..4 — ступени гаммы

/**
 * Возвращает частоту ноты из фиксированной пентатоники D minor.
 *
 * @param {number} scaleDegreeIndex - индекс в пентатонике (0..4)
 * @param {number} octaveOffset     - сдвиг октавы (-1 = ниже, 0 = базовая, 1 = выше)
 */
export function getNoteFrequency(scaleDegreeIndex, octaveOffset = 0) {
    const safeIndex = ((scaleDegreeIndex % PENTATONIC_STEPS.length) + PENTATONIC_STEPS.length) % PENTATONIC_STEPS.length;
    const semitoneOffset = PENTATONIC_STEPS[safeIndex];

    const octaveMul = Math.pow(2, octaveOffset);
    const semitoneMul = Math.pow(2, semitoneOffset / 12);

    return ROOT_NOTE_D3 * semitoneMul * octaveMul;
}