// mods/audio/scale.js
// D minor pentatonic, equal temperament, с опорой A4=432

export const A4 = 428;

// D3 = D4 / 2. D4 на 2 полутонов ниже E4? (лучше считать через MIDI)
const MIDI_A4 = 69;
const MIDI_D3 = 50; // D3

export const PENTATONIC_STEPS = [0, 3, 5, 7, 10];

function midiToFreq(midi){
  return A4 * Math.pow(2, (midi - MIDI_A4) / 12);
}

export function getNoteFrequency(scaleDegreeIndex, octaveOffset = 0){
  const safeIndex =
    ((scaleDegreeIndex % PENTATONIC_STEPS.length) + PENTATONIC_STEPS.length) %
    PENTATONIC_STEPS.length;

  const semitoneOffset = PENTATONIC_STEPS[safeIndex] + octaveOffset * 7;
  return midiToFreq(MIDI_D3 + semitoneOffset);
}