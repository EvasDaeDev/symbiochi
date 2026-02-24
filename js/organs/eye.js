export const EYE = {
  label: "Глаза",
  wind: false,
  growthDir: 8,
  shapeOptions: ["sphere"],
  shapeWeights: [1.0],
  smallBodyThreshold: 50,
  largeRadiusChance: 0.5,
  spawnWeight: 0.1,
  growthChance: 0.5,
  width: 2,
  anim: {
    growthSec: 0.7,
    blinkPauseSec: [10, 17],
    blinkDurSec: 0.3
  },
  initialColor: "#f472b6"
};

export function getEyeShapeDefault(){
  // У тебя сейчас только sphere — и это идеально под твою цель
  return (EYE.shapeOptions && EYE.shapeOptions[0]) ? EYE.shapeOptions[0] : "sphere";
}

export function computeEyeRadiusCells(org, bodyBlocks){
  // правила “когда глаза разрешены” и “насколько большие”
  // (оставляю твою текущую логику, но теперь она живёт в eye.js)
  const raw = Number.isFinite(org?.face?.eyeRadius)
    ? org.face.eyeRadius
    : Math.max(0, (org?.face?.eyeSize ?? 1) - 1);

  const wanted = Math.max(0, Math.min(2, raw)); // clamp 0..2

  // запрет на слишком маленьких
  if (bodyBlocks < 16) return 0;

  return wanted;
}

export function normalizeFaceEye(org, bodyBlocks){
  if (!org.face) org.face = {};
  // shape всегда sphere (берём дефолт из EYE)
  org.face.eyeShape = getEyeShapeDefault();

  // radius приводим к валидному
  const r = computeEyeRadiusCells(org, bodyBlocks);
  org.face.eyeRadius = r;

  // поддержка legacy-поля eyeSize: пусть будет согласовано
  if (!Number.isFinite(org.face.eyeSize)){
    org.face.eyeSize = r + 1;
  }
}
