// Arena simulation: orbital physics + contact damage + honor.

import { cellPx } from './arena_render.js';

// Все основные параметры боя вынесены сюда.
// Единицы мира: клетки. Время: секунды. Скорости: клетки/сек.
export const ARENA_DEFAULTS = {
  // Гравитация солнца: тянет на орбиту вокруг центра.
  sunG: 3600,
  // Сила активного сближения с противником (режим атаки / перехват орбиты).
  bodyG: 1160,
  // Базовое сопротивление космоса. Меньше = дольше сохраняется инерция.
  spaceDrag: 0.16,
  // Торможение в плотном контакте / клинче.
  contactDrag: 0.22,
  shapeDrag: 0.20,
  sideSlipDrag: 0.34,
  clinchTurnAssist: 2.8,
  frontBiasTurn: 1.9,
  contactStick: 0.26,
  contactBodySquash: 0.22,
  contactDentDepth: 1.65,
  contactSurfaceSlide: 9.5,

  // Базовая длительность удержания в контакте.
  grappleBase: 0.28,
  // Доп. удержание, если в контакте есть щупальца.
  tentacleHoldBoost: 0.22,
  // Доп. торможение в контакте при щупальцах.
  tentacleDragBoost: 0.18,

  // Базовый урон от контакта по блокам.
  kDamage: 3.18,
  // Опорная скорость столкновения для пересчёта бонуса к урону.
  v0: 22,
  // Верхний предел бонуса от скорости удара.
  speedCap: 13.0,
  // Множитель урона шипов.
  spikeDamageMult: 2.25,
  // Снижение входящего урона панцирем.
  shellDamageReduction: 2.7,

  // Касательный импульс хвоста при удачном контакте.
  tailImpulse: 58,

  // Упругость отскока по нормали. Ниже = менее резиново.
  restitution: 0.7,
  // Плавное биомеханическое блуждание траектории, чтобы движения не были слишком линейными.
  wanderForce: 8,
  wanderFreqMin: 0.16,
  wanderFreqMax: 0.34,
  wanderSideAmp: 48,
  wanderForwardAmp: 0,
  wanderOrbitAmp: 0.05,
  wanderRetargetMin: 1.2,
  wanderRetargetMax: 2.8,
  wanderDriftResponse: 1.6,
  // Разведение тел после контакта, чтобы не слипались.
  separation: 9.2,
  // Касательный разлёт после удара. Даёт эффект «бейблейда».
  tangentBounce: 5.4,
  // Базовый множитель вращения от столкновения.
  collisionSpinBoost: 66.6,
  // Доп. раскрутка именно от касательного проскальзывания.
  collisionTangentialSpinBoost: 66.2,
  // Затухание вращения тела.
  angularDamping: 0.6,
  // Раскрутка при длительном скольжении по противнику в плотном контакте.
  contactSlideSpinBoost: 53.85,
  // Насколько сильно касательное скольжение в контакте влияет на поворот.
  contactSlideTangentialFactor: 55.32,

  // Насколько сильно система удерживает красивую орбиту вокруг солнца.
  orbitAssist: 0.04,
  // Насколько далеко вперёд предсказывается цель при перехвате.
  interceptLookAhead: 12.42,
  // Боковое смещение точки перехвата.
  interceptSideOffset: 14,
  // Насколько масса цели увеличивает боковой вынос точки перехвата.
  interceptSideMassFactor: 0.30,


  // Порог паники: доля оставшихся блоков от стартовой массы.
  panicHealthRatio: 0.15,
  // Паника не включается в первые секунды боя.
  panicMinTime: 4.0,
  // Длительность состояния бегства.
  panicDuration: 1.0,
  // Стартовый импульс бегства в долях от базовой орбитальной скорости.
  panicStartBoost: 1.25,
  // Дополнительное ускорение бегства, пока активна паника.
  panicAccel: 780,
  // Доля бокового увода при бегстве, чтобы не лететь строго назад.
  panicSideMix: 0.22,
  // Насколько масса ослабляет бегство. Больше = тяжёлые хуже убегают.
  panicMassPenalty: 0.24,
  // Ослабление orbit assist в панике, чтобы сорваться с орбиты.
  panicOrbitAssistMul: 0.35,
  // Ослабление активной атаки у бегущего.
  panicBodyGMul: 0.18,

  // Финальная фаза: оба маленькие и давно не было контакта.
  desperationEnabled: true,
  // Порог малой массы как доля стартовой массы.
  desperationHealthRatio: 0.25,
  // Альтернативный абсолютный порог блоков для финальной фазы.
  desperationBlockThreshold: 156,
  // Через сколько секунд без контакта включать форсированное добивание.
  desperationNoContactTime: 1.25,
  // Длительность окна форсированного добивания.
  desperationDuration: 1.25,
  // Во сколько раз ослаблять orbit assist в финальной фазе.
  desperationOrbitAssistMul: 0.18,
  // Во сколько раз усиливать активное сближение.
  desperationBodyGMul: 1.95,
  // Во сколько раз уменьшать боковой вынос точки перехвата.
  desperationSideOffsetMul: 0.30,
  // Во сколько раз ослаблять касательный разлёт после столкновения.
  desperationTangentBounceMul: 0.55,
  // Насколько сдвигать радиусы орбит бойцов навстречу контакту.
  desperationRadiusBias: 0.19,
  // В финальной фазе паника отключается.
  desperationDisablePanic: true,

  // Минимум блоков для выживания на арене.
  minBlocksKO: 20,
  // Награда чести за победу.
  honorWin: 100,
  // Доп. честь за нанесённый урон.
  honorDamage: 0.06,
  // Длительность боя в секундах. По таймеру победа считается по боевой эффективности.
  matchDuration: 240,
  // Обратный отсчёт перед стартом боя. Пока он идёт, тела не двигаются.
  preStartCountdown: 3,
  // Подсветка последних секунд таймера боя.
  finalCountdownWarn: 20,
  // Радиус зоны солнца для бонуса «царь горы».
  kingOfHillRadius: 24,
  // Сколько хонора давать за секунду нахождения в зоне солнца.
  honorKingPerSec: 1.0,

  // Если очки почти равны, считаем их равными и идём к следующему критерию.
  timeoutEpsilon: 0.0005,
  // Минимальный размер оторванного куска, который ещё сохраняется как часть тела.
  pruneDetachedMinBlocks: 58,
  // То же самое как доля от текущей массы. Защищает крупные органы от удаления целиком.
  pruneDetachedMinRatio: 0.12,

  // Визуальный мусор от ударов: частицы отдельных блоков и оторванные куски.
  debrisMinLife: 5.0,
  debrisMaxLife: 7.0,
  chunkMinLife: 5.0,
  chunkMaxLife: 8.0,
  chunkLargeLifeBonus: 2.0,
  fadeTailSec: 1.0,
  contactFlashSec: 0.5,

  // Камера-зума на удар: дополнительный зум поверх базового x1.0.
  cameraHitZoomAdd: 0.2,
  cameraHitZoomMax: 2.5,
  cameraHitZoomInSec: 0.1,
  cameraHitZoomOutSec: 0.5,
  cameraHitFocusInSec: 0.2,
  cameraHitFocusOutSec: 0.5,

  bloodMinLife: 0.35,
  bloodMaxLife: 0.9,
  bloodFadeTailSec: 0.45,
  bloodBurstPerCell: 2.35,
  bloodBurstMax: 48,
  bloodSpeedMin: 10.0,
  bloodSpeedMax: 34.0,
  bloodTangential: 9.0,
  enableContactFlash: false,
};


function randRange(a, b){ return a + Math.random() * (b - a); }

const FLEX_TYPES = new Set(['tentacle','tail','antenna','worm','fin','limb','claw']);
const FLEX_PROFILE = {
  tentacle: {
    bendVel: 0.22,
    lagVel: 0.18,
    turnBend: 4.8,

    maxBend: 18.0,   // было 10
    maxLag: 9.0,     // было 5.2

    response: 0.09,  // медленнее → больше инерции
    bendPow: 1.35,
    lagPow: 1.75
  },

  tail: {
    bendVel: 0.14,
    lagVel: 0.16,
    turnBend: 3.2,

    maxBend: 10.0,   // было 6
    maxLag: 6.0,     // было 3.4

    response: 0.10,
    bendPow: 1.25,
    lagPow: 1.7
  },

  antenna: {
    bendVel: 0.28,
    lagVel: 0.12,
    turnBend: 5.2,

    maxBend: 22.0,   // было 12
    maxLag: 4.5,     // было 2.8

    response: 0.07,
    bendPow: 1.45,
    lagPow: 1.6
  },

  worm: {
    bendVel: 0.20,
    lagVel: 0.20,
    turnBend: 3.8,

    maxBend: 14.0,   // было 8.4
    maxLag: 8.0,     // было 4.6

    response: 0.12,
    bendPow: 1.28,
    lagPow: 1.8
  },

  fin: {
    bendVel: 0.12,
    lagVel: 0.10,
    turnBend: 2.4,

    maxBend: 7.0,
    maxLag: 3.4,

    response: 0.11,
    bendPow: 1.12,
    lagPow: 1.4
  },

  limb: {
    bendVel: 0.07,
    lagVel: 0.05,
    turnBend: 1.5,

    maxBend: 3.2,
    maxLag: 2.0,

    response: 0.10,
    bendPow: 1.05,
    lagPow: 1.25
  },

  claw: {
    bendVel: 0.06,
    lagVel: 0.04,
    turnBend: 1.2,

    maxBend: 2.4,
    maxLag: 1.6,

    response: 0.09,
    bendPow: 1.0,
    lagPow: 1.2
  }

};
const FLEX_LIFE = {
  tentacle: { idleAmp: 0.475, idleFreq: 0.075, idleAmp2: 0.175, idleFreq2: 0.15, stiffness: 22, damping: 0.84, recoilDecay: 0.86 },
  tail:     { idleAmp: 0.125, idleFreq: 0.05,  idleAmp2: 0.05,  idleFreq2: 0.08, stiffness: 18, damping: 0.88, recoilDecay: 0.88 },
  antenna:  { idleAmp: 0.35,  idleFreq: 0.15,  idleAmp2: 0.15,  idleFreq2: 0.28, stiffness: 26, damping: 0.80, recoilDecay: 0.84 },
  worm:     { idleAmp: 0.325, idleFreq: 0.065, idleAmp2: 0.125, idleFreq2: 0.13, stiffness: 20, damping: 0.85, recoilDecay: 0.87 },
  fin:      { idleAmp: 0.11,  idleFreq: 0.065, idleAmp2: 0.035, idleFreq2: 0.115, stiffness: 16, damping: 0.89, recoilDecay: 0.90 },
  limb:     { idleAmp: 0.03,  idleFreq: 0.055, idleAmp2: 0.0,   idleFreq2: 0.08, stiffness: 14, damping: 0.91, recoilDecay: 0.92 },
  claw:     { idleAmp: 0.025, idleFreq: 0.065, idleAmp2: 0.0,   idleFreq2: 0.08, stiffness: 13, damping: 0.92, recoilDecay: 0.92 },
};
function flexProfile(type){

  const t = String(type || '').toLowerCase();
  return FLEX_PROFILE[t] || null;
}
function flexLife(type){
  const t = String(type || '').toLowerCase();
  return FLEX_LIFE[t] || FLEX_LIFE.tentacle;
}

function ensureCameraState(arena){
  const c = arena.camera || (arena.camera = {});
  if(!Number.isFinite(c.currentExtra)) c.currentExtra = 0;
  if(!Number.isFinite(c.targetExtra)) c.targetExtra = 0;
  if(!Number.isFinite(c.focusWorldX)) c.focusWorldX = arena.worldW * 0.5;
  if(!Number.isFinite(c.focusWorldY)) c.focusWorldY = arena.worldH * 0.5;
  if(!Number.isFinite(c.targetWorldX)) c.targetWorldX = arena.worldW * 0.5;
  if(!Number.isFinite(c.targetWorldY)) c.targetWorldY = arena.worldH * 0.5;
  return c;
}

function queueCameraHit(arena, hitPoint, strength = 1){
  const c = ensureCameraState(arena);
  const add = Math.max(0, arena?.params?.cameraHitZoomAdd || 0.2) * Math.max(0.25, strength);
  const maxExtra = Math.max(0, (arena?.params?.cameraHitZoomMax || 1.5) - 1);
  c.targetExtra = clamp(c.targetExtra + add, 0, maxExtra);
  if(Number.isFinite(hitPoint?.x) && Number.isFinite(hitPoint?.y)) {
    c.targetWorldX = hitPoint.x;
    c.targetWorldY = hitPoint.y;
  }
}

function stepArenaCamera(arena, dt){
  const c = ensureCameraState(arena);
  const inSec = Math.max(0.001, arena?.params?.cameraHitZoomInSec || 0.1);
  const outSec = Math.max(0.001, arena?.params?.cameraHitZoomOutSec || 0.5);
  const focusInSec = Math.max(0.001, arena?.params?.cameraHitFocusInSec || inSec);
  const focusOutSec = Math.max(0.001, arena?.params?.cameraHitFocusOutSec || outSec);
  const maxExtra = Math.max(0, (arena?.params?.cameraHitZoomMax || 1.5) - 1);
  const decay = maxExtra * (dt / outSec);
  c.targetExtra = Math.max(0, c.targetExtra - decay);
  const zoomT = c.targetExtra;
  const zoomRate = zoomT > c.currentExtra ? (dt / inSec) : (dt / outSec);
  c.currentExtra += (zoomT - c.currentExtra) * clamp(zoomRate, 0, 1);

  const restX = arena.worldW * 0.5;
  const restY = arena.worldH * 0.5;
  const focusWeight = maxExtra > 1e-6 ? clamp(c.currentExtra / maxExtra, 0, 1) : 0;
  const desiredX = restX * (1 - focusWeight) + c.targetWorldX * focusWeight;
  const desiredY = restY * (1 - focusWeight) + c.targetWorldY * focusWeight;
  const focusRate = focusWeight > 0.02 ? (dt / focusInSec) : (dt / focusOutSec);
  c.focusWorldX += (desiredX - c.focusWorldX) * clamp(focusRate, 0, 1);
  c.focusWorldY += (desiredY - c.focusWorldY) * clamp(focusRate, 0, 1);
}

function fighterModuleMap(f){
  if(!f) return new Map();
  if(!(f._moduleMetaMap instanceof Map)) f._moduleMetaMap = buildModuleMetaMap(f);
  return f._moduleMetaMap;
}

function ensureFlexState(fighter, meta){
  const c = fighter?.combat || (fighter.combat = {});
  if(!(c.flexPose instanceof Map)) c.flexPose = new Map();
  const key = String(meta?.type || 'body') + '|' + (meta?.mi ?? -1);
  let s = c.flexPose.get(key);
  if(!s){
    s = {
      bend: 0,
      lag: 0,
      bendVel: 0,
      lagVel: 0,
      phase: Math.random() * Math.PI * 2,
      phase2: Math.random() * Math.PI * 2,
      recoil: 0,
    };
    c.flexPose.set(key, s);
  }
  if(!Number.isFinite(s.bend)) s.bend = 0;
  if(!Number.isFinite(s.lag)) s.lag = 0;
  if(!Number.isFinite(s.bendVel)) s.bendVel = 0;
  if(!Number.isFinite(s.lagVel)) s.lagVel = 0;
  if(!Number.isFinite(s.phase)) s.phase = Math.random() * Math.PI * 2;
  if(!Number.isFinite(s.phase2)) s.phase2 = Math.random() * Math.PI * 2;
  if(!Number.isFinite(s.recoil)) s.recoil = 0;
  return s;
}

function updateFighterFlexPose(fighter, dt){
  const map = fighterModuleMap(fighter);
  if(!map.size) return;
  const angle = Number.isFinite(fighter?.transform?.angle) ? fighter.transform.angle : 0;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const vx = Number.isFinite(fighter?.transform?.vel?.x) ? fighter.transform.vel.x : 0;
  const vy = Number.isFinite(fighter?.transform?.vel?.y) ? fighter.transform.vel.y : 0;
  const localVx =  vx * ca + vy * sa;
  const localVy = -vx * sa + vy * ca;
  const angV = Number.isFinite(fighter?.transform?.angularVel) ? fighter.transform.angularVel : 0;
  const touched = new Set();
  for(const meta of map.values()) {
    const profile = flexProfile(meta?.type);
    if(!profile) continue;
    const st = ensureFlexState(fighter, meta);
    const life = flexLife(meta?.type);

    const tx = Number.isFinite(meta?.tx) ? meta.tx : 1;
    const ty = Number.isFinite(meta?.ty) ? meta.ty : 0;
    const px = -ty, py = tx;
    const along = localVx * tx + localVy * ty;
    const side = localVx * px + localVy * py;
    const baseLen = Math.max(1, Number.isFinite(meta?.baseLen) ? meta.baseLen : Math.max(1, (meta?.len || 1) - 1));
    const maxLag = clamp(baseLen * (profile.lagFrac ?? 0.10), 1.2, 24);
    const maxBend = clamp(baseLen * (profile.bendFrac ?? 0.18), 2.0, 40);

    const targetLag = clamp(
      -along * profile.lagVel - Math.abs(angV) * maxLag * 0.22,
      -maxLag,
      maxLag
    );
    const targetBendBase = clamp(
      -side * profile.bendVel - angV * profile.turnBend,
      -maxBend,
      maxBend
    );

    st.phase += dt * life.idleFreq;
    st.phase2 += dt * life.idleFreq2;
    const idle = Math.sin(st.phase) * life.idleAmp + Math.sin(st.phase2) * life.idleAmp2;
    const targetBend = clamp(targetBendBase + idle + (st.recoil || 0), -maxBend, maxBend);

    const step = dt * 60;
    st.bendVel += (targetBend - st.bend) * life.stiffness * dt;
    st.lagVel += (targetLag - st.lag) * (life.stiffness * 0.82) * dt;
    st.bendVel *= Math.pow(life.damping, step);
    st.lagVel *= Math.pow(life.damping, step);
    st.bend += st.bendVel * dt * 60;
    st.lag += st.lagVel * dt * 60;
    st.bend = clamp(st.bend, -maxBend, maxBend);
    st.lag = clamp(st.lag, -maxLag, maxLag);
    st.recoil *= Math.pow(life.recoilDecay, step);
    touched.add(String(meta?.type || 'body') + '|' + (meta?.mi ?? -1));
  }
  const poses = fighter?.combat?.flexPose;
  if(poses instanceof Map){
    for(const [k, st] of poses.entries()) {
      if(touched.has(k)) continue;
      st.lag *= Math.exp(-4 * dt);
      st.bend *= Math.exp(-4 * dt);
      st.lagVel *= Math.exp(-7 * dt);
      st.bendVel *= Math.exp(-7 * dt);
      st.recoil *= Math.exp(-5 * dt);
    }
  }
}

function posedLocalPoint(fighter, cell, meta){
  if(!meta) return { x: cell.x, y: cell.y };
  const profile = flexProfile(meta?.type);
  if(!profile) return { x: cell.x, y: cell.y };
  const st = ensureFlexState(fighter, meta);

  const tx = Number.isFinite(meta?.tx) ? meta.tx : 1;
  const ty = Number.isFinite(meta?.ty) ? meta.ty : 0;
  const ax = Number.isFinite(meta?.ax) ? meta.ax : cell.x;
  const ay = Number.isFinite(meta?.ay) ? meta.ay : cell.y;
  const baseLen = Math.max(1, Number.isFinite(meta?.baseLen) ? meta.baseLen : Math.max(1, (meta?.len || 1) - 1));

  const along0 = Number.isFinite(meta?.along0) ? meta.along0 : ((cell.x - ax) * tx + (cell.y - ay) * ty);
  const side0 = Number.isFinite(meta?.side0) ? meta.side0 : ((cell.x - ax) * (-ty) + (cell.y - ay) * tx);
  const u = clamp(along0 / baseLen, 0, 1);

  function axisAt(t){
    const tt = clamp(t, 0, 1);
    const s = tt * baseLen;
    const tt2 = tt * tt;
    const tt3 = tt2 * tt;
    const bendShape = 0.08 * tt + 0.22 * tt2 + 0.70 * tt3;
    const belly = 4 * tt * (1 - tt);
    const lagShape = 0.04 * tt + 0.16 * tt2 + 0.80 * tt3;
    const offN = st.bend * bendShape + st.bend * 0.12 * belly;
    const offT = st.lag * lagShape;
    return {
      x: ax + tx * s + (-ty) * offN + tx * offT,
      y: ay + ty * s + tx * offN + ty * offT,
    };
  }

  const p0 = axisAt(u);
  const eps = Math.max(0.02, 1 / Math.max(8, baseLen));
  const pA = axisAt(clamp(u - eps, 0, 1));
  const pB = axisAt(clamp(u + eps, 0, 1));
  let tanX = pB.x - pA.x;
  let tanY = pB.y - pA.y;
  const tanL = Math.hypot(tanX, tanY) || 1;
  tanX /= tanL;
  tanY /= tanL;
  const norX = -tanY;
  const norY = tanX;

  return {
    x: p0.x + norX * side0,
    y: p0.y + norY * side0,
  };
}

function worldPointHybrid(fighter, cell, meta){
  const angle = Number.isFinite(fighter?.transform?.angle) ? fighter.transform.angle : 0;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const cx = fighter.geom.center.x;
  const cy = fighter.geom.center.y;
  const lp = posedLocalPoint(fighter, cell, meta);
  const lx = lp.x - cx;
  const ly = lp.y - cy;
  const rx = lx * ca - ly * sa;
  const ry = lx * sa + ly * ca;
  return { x: fighter.transform.pos.x + cx + rx, y: fighter.transform.pos.y + cy + ry };
}

function ensureArenaVfx(arena){
  if(!arena.vfx) arena.vfx = { debris: [], chunks: [], blood: [] };
  if(!Array.isArray(arena.vfx.debris)) arena.vfx.debris = [];
  if(!Array.isArray(arena.vfx.chunks)) arena.vfx.chunks = [];
  if(!Array.isArray(arena.vfx.blood)) arena.vfx.blood = [];
  return arena.vfx;
}

function ensureContactFlashMap(fighter){
  const c = fighter?.combat || (fighter.combat = {});
  if(!(c.flashCells instanceof Map)) c.flashCells = new Map();
  return c.flashCells;
}

function markFlashCell(arena, fighter, x, y, weight = 1){
  if(!fighter || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const ttl = Math.max(0.08, Number.isFinite(arena?.params?.contactFlashSec) ? arena.params.contactFlashSec : 0.5);
  const flashes = ensureContactFlashMap(fighter);
  const key = (x|0) + ',' + (y|0);
  flashes.set(key, Math.max(flashes.get(key) || 0, ttl * Math.max(0.2, Math.min(1, weight))));
}

function markContactFlash(arena, fighter, pairs, side){
  if(arena?.params?.enableContactFlash === false) return;
  if(!fighter || !Array.isArray(pairs) || !pairs.length) return;
  for(const p of pairs){
    const src = side === 'A' ? p.ca : p.cb;
    if(!src) continue;
    const x = src.x | 0;
    const y = src.y | 0;
    markFlashCell(arena, fighter, x, y, 1);
    markFlashCell(arena, fighter, x + 1, y, 0.42);
    markFlashCell(arena, fighter, x - 1, y, 0.42);
    markFlashCell(arena, fighter, x, y + 1, 0.42);
    markFlashCell(arena, fighter, x, y - 1, 0.42);
  }
}

export function resetArenaVfx(arena){
  const vfx = ensureArenaVfx(arena);
  vfx.debris.length = 0;
  vfx.chunks.length = 0;
  vfx.blood.length = 0;
  for(const f of (arena?.fighters || [])){
    if(f?.combat?.flashCells instanceof Map) f.combat.flashCells.clear();
  }
}

export function stepArenaVfx(arena, dt){
  stepArenaCamera(arena, dt);
  const vfx = ensureArenaVfx(arena);
  const fadeTail = Math.max(0.25, arena?.params?.fadeTailSec || 1.0);
  const bloodFadeTail = Math.max(0.15, Number.isFinite(arena?.params?.bloodFadeTailSec) ? arena.params.bloodFadeTailSec : 0.45);
  const dragDebris = Math.exp(-1.25 * dt);
  const dragChunk = Math.exp(-0.72 * dt);
  const dragBlood = Math.exp(-2.15 * dt);
  for(const f of (arena?.fighters || [])){
    const flashes = f?.combat?.flashCells;
    if(!(flashes instanceof Map) || !flashes.size) continue;
    for(const [k, left] of flashes.entries()){
      const next = left - dt;
      if(next <= 0) flashes.delete(k);
      else flashes.set(k, next);
    }
  }

  for(const arrName of ['debris','chunks']){
    const arr = vfx[arrName];
    for(let i = arr.length - 1; i >= 0; i--){
      const o = arr[i];
      o.age = (o.age || 0) + dt;
      if(o.age >= o.life){ arr.splice(i, 1); continue; }
      const drag = arrName === 'debris' ? dragDebris : Math.exp(-((Number.isFinite(o.dragK) ? o.dragK : 0.72)) * dt);
      o.vx *= drag;
      o.vy *= drag;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if(Number.isFinite(o.spin)) o.angle = (o.angle || 0) + o.spin * dt;
      const fadeStart = Math.max(0, o.life - fadeTail);
      o.alpha = o.age <= fadeStart ? 1 : clamp(1 - (o.age - fadeStart) / Math.max(0.001, fadeTail), 0, 1);
    }
  }

  const blood = vfx.blood;
  for(let i = blood.length - 1; i >= 0; i--){
    const o = blood[i];
    o.age = (o.age || 0) + dt;
    if(o.age >= o.life){ blood.splice(i, 1); continue; }
    o.vx *= dragBlood;
    o.vy *= dragBlood;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    if(Number.isFinite(o.spin)) o.angle = (o.angle || 0) + o.spin * dt;
    const fadeStart = Math.max(0, o.life - bloodFadeTail);
    o.alpha = o.age <= fadeStart ? 1 : clamp(1 - (o.age - fadeStart) / Math.max(0.001, bloodFadeTail), 0, 1);
  }
}


function spawnBloodBurst(arena, fighter, removedCells, baseVel, hitPoint){
  const vfx = ensureArenaVfx(arena);
  const countBase = Math.max(1, Math.floor((removedCells?.length || 0) * (Number.isFinite(arena?.params?.bloodBurstPerCell) ? arena.params.bloodBurstPerCell : 1.35)));
  const count = Math.min(Math.max(3, countBase), Math.max(3, arena?.params?.bloodBurstMax || 28));
  const hvx = Number.isFinite(baseVel?.x) ? baseVel.x : 0;
  const hvy = Number.isFinite(baseVel?.y) ? baseVel.y : 0;
  const hx = Number.isFinite(hitPoint?.x) ? hitPoint.x : (fighter?.transform?.pos?.x || 0) + (fighter?.geom?.center?.x || 0);
  const hy = Number.isFinite(hitPoint?.y) ? hitPoint.y : (fighter?.transform?.pos?.y || 0) + (fighter?.geom?.center?.y || 0);
  for(let i = 0; i < count; i++){
    const a = Math.random() * Math.PI * 2;
    const nx = Math.cos(a), ny = Math.sin(a);
    const tx = -ny, ty = nx;
    const spd = randRange(arena?.params?.bloodSpeedMin || 10, arena?.params?.bloodSpeedMax || 34);
    const tang = randRange(-(arena?.params?.bloodTangential || 9), arena?.params?.bloodTangential || 9);
    vfx.blood.push({
      x: hx + randRange(-0.18, 0.18),
      y: hy + randRange(-0.18, 0.18),
      vx: (fighter?.transform?.vel?.x || 0) * 0.22 + hvx * 0.18 + nx * spd + tx * tang,
      vy: (fighter?.transform?.vel?.y || 0) * 0.22 + hvy * 0.18 + ny * spd + ty * tang,
      angle: Math.random() * Math.PI * 2,
      spin: randRange(-12, 12),
      life: randRange(arena?.params?.bloodMinLife || 0.35, arena?.params?.bloodMaxLife || 0.9),
      age: 0,
      alpha: 1,
      size: randRange(0.28, 0.95),
      stretch: randRange(0.9, 1.8),
    });
  }
}

function spawnDebrisCells(arena, fighter, removedCells, baseVel, hitPoint){
  if(!removedCells?.length) return;
  const vfx = ensureArenaVfx(arena);
  const px = cellPx();
  const hvx = Number.isFinite(baseVel?.x) ? baseVel.x : 0;
  const hvy = Number.isFinite(baseVel?.y) ? baseVel.y : 0;
  const hx = Number.isFinite(hitPoint?.x) ? hitPoint.x : (fighter.transform.pos.x + fighter.geom.center.x);
  const hy = Number.isFinite(hitPoint?.y) ? hitPoint.y : (fighter.transform.pos.y + fighter.geom.center.y);
  for(const c of removedCells){
    const meta = fighterModuleMap(fighter).get((c.x | 0) + ',' + (c.y | 0)) || null;
    const wp = worldPointHybrid(fighter, c, meta);
    let dx = wp.x - hx;
    let dy = wp.y - hy;
    let dl = Math.hypot(dx, dy);
    if(dl < 1e-6){
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
      dl = 1;
    }
    const nx = dx / dl, ny = dy / dl;
    const tang = (Math.random() * 2 - 1) * 6;
    const tx = -ny, ty = nx;
    vfx.debris.push({
      x: wp.x, y: wp.y,
      vx: fighter.transform.vel.x * 0.45 + hvx * 0.18 + nx * randRange(6, 22) + tx * tang,
      vy: fighter.transform.vel.y * 0.45 + hvy * 0.18 + ny * randRange(6, 22) + ty * tang,
      angle: Math.random() * Math.PI * 2,
      spin: randRange(-7, 7),
      life: randRange(arena.params.debrisMinLife, arena.params.debrisMaxLife),
      age: 0, alpha: 1,
      size: px,
      cell: { ...c },
      fighterId: fighter.id,
    });
  }
}

function getChunkProfile(size){
  if(size >= 42) return { speedOut:[2.5, 8.5], tangent:[-2.0, 2.0], inherit:0.96, hitPush:0.18, spin:[-0.8, 0.8], drag:0.82, life:[4.0, 6.0], label:'heavy' };
  if(size >= 18) return { speedOut:[3.5, 11.5], tangent:[-3.0, 3.0], inherit:0.92, hitPush:0.2, spin:[-1.6, 1.6], drag:0.77, life:[3.5, 5.5], label:'medium' };
  return { speedOut:[5.0, 15.0], tangent:[-4.5, 4.5], inherit:0.88, hitPush:0.22, spin:[-2.8, 2.8], drag:0.72, life:[3.0, 5.0], label:'light' };
}

function spawnDetachedChunk(arena, fighter, detachedCells, baseVel, hitPoint){
  if(!detachedCells?.length) return;
  const vfx = ensureArenaVfx(arena);
  let sx = 0, sy = 0;
  for(const c of detachedCells){
    const meta = fighterModuleMap(fighter).get((c.x | 0) + ',' + (c.y | 0)) || null;
    const wp = worldPointHybrid(fighter, c, meta);
    sx += wp.x; sy += wp.y;
  }
  const cx = sx / detachedCells.length;
  const cy = sy / detachedCells.length;
  let dx = cx - (hitPoint?.x ?? cx);
  let dy = cy - (hitPoint?.y ?? cy);
  let dl = Math.hypot(dx, dy);
  if(dl < 1e-6){
    const a = Math.random() * Math.PI * 2;
    dx = Math.cos(a); dy = Math.sin(a); dl = 1;
  }
  const nx = dx / dl, ny = dy / dl;
  const tx = -ny, ty = nx;
  const hvx = Number.isFinite(baseVel?.x) ? baseVel.x : 0;
  const hvy = Number.isFinite(baseVel?.y) ? baseVel.y : 0;
  const worldCells = detachedCells.map(c => {
    const meta = fighterModuleMap(fighter).get((c.x | 0) + ',' + (c.y | 0)) || null;
    const wp = worldPointHybrid(fighter, c, meta);
    return { ...c, ox: wp.x - cx, oy: wp.y - cy };
  });
  const profile = getChunkProfile(detachedCells.length);
  const extraLife = detachedCells.length >= 42 ? Math.max(0, arena?.params?.chunkLargeLifeBonus || 1.0) : 0;
  const lifeMin = Math.max(arena.params.chunkMinLife, profile.life[0]) + extraLife;
  const lifeMax = Math.max(arena.params.chunkMaxLife, profile.life[1]) + extraLife;
  vfx.chunks.push({
    x: cx, y: cy,
    vx: fighter.transform.vel.x * profile.inherit + hvx * profile.hitPush + nx * randRange(profile.speedOut[0], profile.speedOut[1]) + tx * randRange(profile.tangent[0], profile.tangent[1]),
    vy: fighter.transform.vel.y * profile.inherit + hvy * profile.hitPush + ny * randRange(profile.speedOut[0], profile.speedOut[1]) + ty * randRange(profile.tangent[0], profile.tangent[1]),
    angle: 0,
    spin: randRange(profile.spin[0], profile.spin[1]),
    dragK: profile.drag,
    profile: profile.label,
    life: randRange(lifeMin, lifeMax),
    age: 0, alpha: 1,
    cells: worldCells,
    fighterId: fighter.id,
  });
  spawnDebrisCells(arena, fighter, detachedCells, baseVel, hitPoint);
}

function restoreFighterForMatch(f){
  if(!f) return;
  f.geom = normalizeFromCapsule(f.organismState || {});
  f.mass = f.geom.cells.length;
  f.alive = true;
  f.worldCells = [];
  f._moduleMetaMap = null;
  if(!f.stats) f.stats = {};
  if(!f.meta) f.meta = {};
  if(!f.transform) f.transform = { pos:{ x:0, y:0 }, vel:{ x:0, y:0 }, angle:0, angularVel:0 };
  if(!f.transform.pos) f.transform.pos = { x:0, y:0 };
  if(!f.transform.vel) f.transform.vel = { x:0, y:0 };
}



export function initMatch(arena){
  arena.mode = 'match';
  arena.resultText = '';
  arena.time.t = 0;

  const cx = arena.worldW * 0.5;
  const cy = arena.worldH * 0.5;
  arena.sun = { x: cx, y: cy };

  const A = arena.fighters[0];
  const B = arena.fighters[1];

  restoreFighterForMatch(A);
  restoreFighterForMatch(B);
  resetCombat(A);
  resetCombat(B);

  // НЕ переставляем бойцов.
  // Берём уже выставленные позиции из idle/import/spawn.
  for (const f of [A, B]) {
    if (!f?.transform) continue;
    if (!f.transform.pos) f.transform.pos = { x: cx, y: cy };
    if (!f.transform.vel) f.transform.vel = { x: 0, y: 0 };
    f.transform.vel.x = 0;
    f.transform.vel.y = 0;
    f.transform.angularVel = 0;
    f.alive = true;
  }

  arena.noContactTimer = 0;
  arena.desperationTimer = 0;
  arena.desperationActive = false;

  rebuildWorldCells(arena);
}

function seedOrbitalState(arena, fighter, orbitDir){
  const cx = arena.sun.x;
  const cy = arena.sun.y;
  const dx = fighter.transform.pos.x - cx;
  const dy = fighter.transform.pos.y - cy;
  const r = Math.max(1, Math.hypot(dx, dy));
  const tx = -dy / r;
  const ty =  dx / r;
  const v = Math.sqrt(arena.params.sunG / r) * orbitSpeedScale(fighter.mass);

  fighter.transform.vel = {
    x: tx * v * orbitDir,
    y: ty * v * orbitDir,
  };
  fighter.transform.angle = Math.atan2(fighter.transform.vel.y, fighter.transform.vel.x);
  fighter.transform.angularVel = 0;
}

function orbitSpeedScale(mass){
  const m = Math.max(12, mass);
  return clamp(1.58 - Math.log2(m) * 0.10 - Math.pow(m / 220, 0.28) * 0.18, 0.38, 1.28);
}

function resetCombat(f){
  f.alive = true;
  if(!f.stats) f.stats = {};
  if(!f.combat) f.combat = {};
  f.stats.damageDealt = 0;
  f.stats.damageTaken = 0;
  f.stats.contactFrames = 0;
  f.stats.kingHonorAcc = 0;
  f.combat.grappleTimer = 0;
  f.combat.contactDragMult = 1.0;
  f.combat.damageCarry = 0;
  f.combat.baseMass = Math.max(1, f.mass || f.geom?.cells?.length || 1);
  f.combat.panicActive = false;
  f.combat.panicTriggered = false;
  f.combat.panicTimer = 0;
  f.combat.radiusBias = 0;
  const sideId = String(f?.id || 'A').toUpperCase() === 'B' ? 1 : -1;
  f.combat.orbitDir = sideId;
  f.combat.wander = {
    phase: (sideId < 0 ? 0.35 : 3.45) + Math.random() * 0.65,
    phase2: (sideId < 0 ? 1.10 : 4.25) + Math.random() * 0.75,
    freq: randRange(ARENA_DEFAULTS.wanderFreqMin, ARENA_DEFAULTS.wanderFreqMax),
    sideSign: sideId,
    driftX: 0,
    driftY: 0,
    laneOffset: 0,
    laneTarget: randRange(0.22, 0.72) * sideId,
    orbitBias: randRange(0.01, 0.06) * sideId,
    retargetT: randRange(ARENA_DEFAULTS.wanderRetargetMin, ARENA_DEFAULTS.wanderRetargetMax),
  };
  if(f.combat.flashCells instanceof Map) f.combat.flashCells.clear();
  if(f.combat.flexPose instanceof Map) f.combat.flexPose.clear();
  f.combat.bodySquash = 0;
  f.combat.impactJitter = 0;
  f.combat.recentContactT = 0;
  f.combat.tetherStrength = 0;
  f.combat.tetherTargetId = null;
  f.combat.tetherPointX = 0;
  f.combat.tetherPointY = 0;
  f.combat.contactDent = null;
}

export function stepArena(arena, dt){
  if(arena.mode !== 'match') return;
  arena.time.t += dt;

  const A = arena.fighters[0];
  const B = arena.fighters[1];
  if(!A?.alive || !B?.alive){
    finish(arena);
    return;
  }

  updateDesperationState(arena, A, B, dt);
  updatePanicState(arena, A, B, dt);
  updatePanicState(arena, B, A, dt);
  updateWander(arena, A, dt);
  updateWander(arena, B, dt);

  applyForces(arena, A, B, dt);
  applyForces(arena, B, A, dt);

  integrate(A, dt, arena);
  integrate(B, dt, arena);
  updateFighterFlexPose(A, dt);
  updateFighterFlexPose(B, dt);

  const contact = detectContact(arena, A, B);
  if(contact.contactPairs > 0){
    arena.noContactTimer = 0;
    resolveContact(arena, A, B, contact, dt);
  }else{
    arena.noContactTimer = (arena.noContactTimer || 0) + dt;
  }

  updateKingOfHillHonor(arena, A, B, dt);

  if(arena.time.t >= arena.params.matchDuration){
    finish(arena, 'timeout');
    rebuildWorldCells(arena);
    return;
  }

  if(A.mass <= arena.params.minBlocksKO){ A.alive = false; }
  if(B.mass <= arena.params.minBlocksKO){ B.alive = false; }

  if(!A.alive || !B.alive){
    finish(arena);
  }

  rebuildWorldCells(arena);
}


function updateWander(arena, fighter, dt){
  const w = fighter?.combat?.wander;
  if(!w) return;

  const freq = Number.isFinite(w.freq) ? w.freq : randRange(arena.params.wanderFreqMin, arena.params.wanderFreqMax);
  w.phase = (Number.isFinite(w.phase) ? w.phase : 0) + dt * freq;
  w.phase2 = (Number.isFinite(w.phase2) ? w.phase2 : 0) + dt * (freq * 0.57);

  w.retargetT = (Number.isFinite(w.retargetT) ? w.retargetT : 0) - dt;
  if(w.retargetT <= 0){
    w.retargetT = randRange(arena.params.wanderRetargetMin, arena.params.wanderRetargetMax);
    if(Math.random() < 0.14) w.sideSign *= -1;
    const baseSide = Number.isFinite(fighter?.combat?.orbitDir) ? fighter.combat.orbitDir : (w.sideSign || 1);
    w.laneTarget = randRange(0.18, 1.0) * baseSide;
    w.orbitBias = clamp((Number.isFinite(w.orbitBias) ? w.orbitBias : 0) + randRange(-0.03, 0.03), -0.10, 0.10);
    w.freq = randRange(arena.params.wanderFreqMin, arena.params.wanderFreqMax);
  }

  const targetDx = Math.cos(w.phase) * 0.75 + Math.sin(w.phase2) * 0.25;
  const targetDy = Math.sin(w.phase) * 0.18 - Math.cos(w.phase2) * 0.10;
  const blend = clamp(dt * Math.max(0.1, arena.params.wanderDriftResponse || 1.6), 0, 1);

  w.driftX += (targetDx - (Number.isFinite(w.driftX) ? w.driftX : 0)) * blend;
  w.driftY += (targetDy - (Number.isFinite(w.driftY) ? w.driftY : 0)) * blend;
  w.laneOffset = (Number.isFinite(w.laneOffset) ? w.laneOffset : 0) + ((Number.isFinite(w.laneTarget) ? w.laneTarget : 0) - (Number.isFinite(w.laneOffset) ? w.laneOffset : 0)) * clamp(dt * 0.85, 0, 1);
}

function updateKingOfHillHonor(arena, A, B, dt){
  const rMax = Math.max(1, arena.params.kingOfHillRadius);
  const r2 = rMax * rMax;
  for(const f of [A, B]){
    if(!f?.alive) continue;
    const cx = f.transform.pos.x + f.geom.center.x;
    const cy = f.transform.pos.y + f.geom.center.y;
    const dx = cx - arena.sun.x;
    const dy = cy - arena.sun.y;
    if(dx * dx + dy * dy <= r2){
      f.stats.kingHonorAcc = (f.stats.kingHonorAcc || 0) + arena.params.honorKingPerSec * dt;
    }
  }
}

function applyForces(arena, self, other, dt){
  const p = self.transform.pos;
  const v = self.transform.vel;

  const toSunX = arena.sun.x - p.x;
  const toSunY = arena.sun.y - p.y;
  const r2s = toSunX * toSunX + toSunY * toSunY + 1200;
  const rs = Math.sqrt(r2s);
  const dirSx = toSunX / rs;
  const dirSy = toSunY / rs;

  const accSun = arena.params.sunG / r2s;
  v.x += dirSx * accSun * dt;
  v.y += dirSy * accSun * dt;

  applyOrbitAssist(arena, self, dt, rs);
  applyInterceptForce(arena, self, other, dt);
  applyPanicDrive(arena, self, other, dt);

  const w = self?.combat?.wander;
  if(w){
    const rr = Math.max(1e-6, Math.hypot(p.x - arena.sun.x, p.y - arena.sun.y));
    const tx = -(p.y - arena.sun.y) / rr;
    const ty =  (p.x - arena.sun.x) / rr;
    const wf = arena.params.wanderForce || 0;
    const massScale = Math.max(1, self.mass * 0.16);
    const lane = (Number.isFinite(w.laneOffset) ? w.laneOffset : 0) + (Number.isFinite(w.driftX) ? w.driftX : 0) * 0.35;
    v.x += tx * lane * wf * dt / massScale;
    v.y += ty * lane * wf * dt / massScale;
  }

  const speed = Math.hypot(v.x, v.y);
  if(speed > 1e-5){
    const facing = Number.isFinite(self.transform.angle) ? self.transform.angle : Math.atan2(v.y, v.x);
    const fx = Math.cos(facing);
    const fy = Math.sin(facing);
    const along = (v.x * fx + v.y * fy) / speed;
    const side = Math.sqrt(Math.max(0, 1 - along * along));
    const morph = self?.combat?.morph || {};
    const appendages = (morph.tentacle || 0) + (morph.tail || 0) + (morph.fin || 0) + (morph.limb || 0) + (morph.worm || 0) * 0.6;
    const shapeDrag = (arena.params.shapeDrag || 0) * (0.7 + Math.min(2.2, appendages * 0.08));
    const sideSlipDrag = (arena.params.sideSlipDrag || 0) * (0.3 + side * side * 1.25);
    const drag = Math.exp(-(arena.params.spaceDrag + shapeDrag + sideSlipDrag) * dt);
    v.x *= drag;
    v.y *= drag;
  }else{
    const spaceDrag = Math.exp(-arena.params.spaceDrag * dt);
    v.x *= spaceDrag;
    v.y *= spaceDrag;
  }
}

function applyOrbitAssist(arena, fighter, dt, r){
  const p = fighter.transform.pos;
  const v = fighter.transform.vel;
  const rx = p.x - arena.sun.x;
  const ry = p.y - arena.sun.y;
  const rr = Math.max(1, r);
  const tx = -ry / rr;
  const ty =  rx / rr;
  const radiusBias = Number.isFinite(fighter.combat?.radiusBias) ? fighter.combat.radiusBias : 0;
  const biasedR = Math.max(24, rr * (1 + radiusBias));
  const wander = fighter?.combat?.wander;
  const orbitBias = 1 + (Number.isFinite(wander?.orbitBias) ? wander.orbitBias : 0) + (arena.params.wanderOrbitAmp || 0) * (Number.isFinite(wander?.laneOffset) ? wander.laneOffset : 0) * 0.25;
  const orbitDir = Number.isFinite(fighter?.combat?.orbitDir) ? fighter.combat.orbitDir : 1;
  const desiredV = Math.sqrt(arena.params.sunG / biasedR) * orbitSpeedScale(fighter.mass) * 0.90 * Math.max(0.72, orbitBias) * orbitDir;
  const currentTan = v.x * tx + v.y * ty;
  const tanError = desiredV - currentTan;
  const maneuver = 1 / Math.sqrt(Math.max(1, fighter.mass));
  const panicMul = fighter.combat?.panicActive ? arena.params.panicOrbitAssistMul : 1.0;
  const desperationMul = arena.desperationActive ? arena.params.desperationOrbitAssistMul : 1.0;
  const assist = arena.params.orbitAssist * panicMul * desperationMul * (0.18 + 2.2 * maneuver);

  v.x += tx * tanError * assist * dt;
  v.y += ty * tanError * assist * dt;
}

function applyInterceptForce(arena, self, other, dt){
  const p = self.transform.pos;
  const v = self.transform.vel;
  const lookAhead = arena.params.interceptLookAhead;
  const predX = other.transform.pos.x + other.transform.vel.x * lookAhead;
  const predY = other.transform.pos.y + other.transform.vel.y * lookAhead;

  const orx = predX - arena.sun.x;
  const ory = predY - arena.sun.y;
  const rr = Math.max(1, Math.hypot(orx, ory));
  const tx = -ory / rr;
  const ty =  orx / rr;

  const sideBase = arena.params.interceptSideOffset;
  const desperationSideMul = arena.desperationActive ? arena.params.desperationSideOffsetMul : 1.0;
  const sideOffset = clamp((sideBase + Math.sqrt(Math.max(1, other.mass)) * arena.params.interceptSideMassFactor) * desperationSideMul, 5, 28);

  const cross = (p.x - predX) * ty - (p.y - predY) * tx;
  const sideSign = Math.sign(cross) || 1;
  const w = self?.combat?.wander;
  const nx = rr > 1e-6 ? orx / rr : 0;
  const ny = rr > 1e-6 ? ory / rr : 0;
  const laneOffset = Number.isFinite(w?.laneOffset) ? w.laneOffset : 0;
  const wanderSide = (arena.params.wanderSideAmp || 0) * (laneOffset + (Number.isFinite(w?.driftX) ? w.driftX : 0) * 0.25) * (w?.sideSign || 1);

  const targetX = predX + tx * (sideOffset * sideSign + wanderSide);
  const targetY = predY + ty * (sideOffset * sideSign + wanderSide);

  const dx = targetX - p.x;
  const dy = targetY - p.y;
  const d2 = dx * dx + dy * dy + 600;
  const d = Math.sqrt(d2);
  const dirX = dx / d;
  const dirY = dy / d;

  const engage = smoothstep(380, 58, d);
  const maneuver = 1 / Math.sqrt(Math.max(1, self.mass));
  const panicMul = self.combat?.panicActive ? arena.params.panicBodyGMul : 1.0;
  const desperationMul = arena.desperationActive ? arena.params.desperationBodyGMul : 1.0;
  const acc = arena.params.bodyG * panicMul * desperationMul * engage * (0.95 + 9.0 * maneuver) / d2;

  v.x += dirX * acc * dt;
  v.y += dirY * acc * dt;
}


function updateDesperationState(arena, A, B, dt){
  const p = arena.params;
  if(!p.desperationEnabled){
    arena.desperationActive = false;
    arena.desperationTimer = 0;
    A.combat.radiusBias = 0;
    B.combat.radiusBias = 0;
    return;
  }

  if(arena.desperationActive){
    arena.desperationTimer = Math.max(0, (arena.desperationTimer || 0) - dt);
    if(arena.desperationTimer <= 0){
      arena.desperationActive = false;
      A.combat.radiusBias = 0;
      B.combat.radiusBias = 0;
    }
  }

  const bothSmall = isDesperationCandidate(arena, A) && isDesperationCandidate(arena, B);
  if(!bothSmall) return;
  if((arena.noContactTimer || 0) < p.desperationNoContactTime) return;

  arena.desperationActive = true;
  arena.desperationTimer = p.desperationDuration;
  A.combat.radiusBias = -p.desperationRadiusBias;
  B.combat.radiusBias =  p.desperationRadiusBias;
  if(p.desperationDisablePanic){
    cancelPanic(A);
    cancelPanic(B);
  }
}

function isDesperationCandidate(arena, fighter){
  if(!fighter?.alive) return false;
  const baseMass = Math.max(1, fighter.combat?.baseMass || fighter.mass || 1);
  const hpRatio = Math.max(0, fighter.mass) / baseMass;
  return hpRatio <= arena.params.desperationHealthRatio || fighter.mass <= arena.params.desperationBlockThreshold;
}

function cancelPanic(f){
  if(!f?.combat) return;
  f.combat.panicActive = false;
  f.combat.panicTimer = 0;
}


function updatePanicState(arena, self, other, dt){
  if(!self?.alive) return;
  const c = self.combat || (self.combat = {});
  if(c.panicActive){
    c.panicTimer = Math.max(0, (c.panicTimer || 0) - dt);
    if(c.panicTimer <= 0){
      c.panicActive = false;
      c.panicTimer = 0;
    }
  }

  if(c.panicTriggered) return;
  if(arena.desperationActive && arena.params.desperationDisablePanic) return;
  if(arena.time.t < arena.params.panicMinTime) return;

  const baseMass = Math.max(1, c.baseMass || self.mass || 1);
  const hpRatio = Math.max(0, self.mass) / baseMass;
  if(hpRatio > arena.params.panicHealthRatio) return;

  triggerPanicEscape(arena, self, other);
}

function triggerPanicEscape(arena, self, other){
  const c = self.combat || (self.combat = {});
  c.panicTriggered = true;
  c.panicActive = true;
  c.panicTimer = arena.params.panicDuration;
  c.grappleTimer = 0;
  c.contactDragMult = 1.0;

  const sx = self.transform.pos.x + self.geom.center.x;
  const sy = self.transform.pos.y + self.geom.center.y;
  const ox = other.transform.pos.x + other.geom.center.x;
  const oy = other.transform.pos.y + other.geom.center.y;

  let dx = sx - ox;
  let dy = sy - oy;
  let d = Math.hypot(dx, dy);
  if(d < 1e-6){
    dx = sx - arena.sun.x;
    dy = sy - arena.sun.y;
    d = Math.max(1, Math.hypot(dx, dy));
  }
  const nx = dx / d;
  const ny = dy / d;
  const tx = -ny;
  const ty = nx;

  const rvx = self.transform.vel.x - other.transform.vel.x;
  const rvy = self.transform.vel.y - other.transform.vel.y;
  const sideSign = Math.sign(rvx * tx + rvy * ty) || 1;
  const mix = clamp(arena.params.panicSideMix, 0, 0.45);
  const ex = nx * (1 - mix) + tx * mix * sideSign;
  const ey = ny * (1 - mix) + ty * mix * sideSign;
  const el = Math.max(1e-6, Math.hypot(ex, ey));

  const baseSpeed = Math.sqrt(arena.params.sunG / Math.max(40, Math.hypot(sx - arena.sun.x, sy - arena.sun.y))) * orbitSpeedScale(self.mass);
  const massPenalty = 1 - clamp(Math.log2(Math.max(2, self.mass)) * arena.params.panicMassPenalty * 0.1, 0, 0.55);
  const boost = baseSpeed * arena.params.panicStartBoost * massPenalty;

  self.transform.vel.x += (ex / el) * boost;
  self.transform.vel.y += (ey / el) * boost;
}

function applyPanicDrive(arena, self, other, dt){
  if(!self?.combat?.panicActive) return;
  const sx = self.transform.pos.x + self.geom.center.x;
  const sy = self.transform.pos.y + self.geom.center.y;
  const ox = other.transform.pos.x + other.geom.center.x;
  const oy = other.transform.pos.y + other.geom.center.y;
  let dx = sx - ox;
  let dy = sy - oy;
  let d = Math.max(1, Math.hypot(dx, dy));
  const nx = dx / d;
  const ny = dy / d;
  const tx = -ny;
  const ty = nx;
  const mix = clamp(arena.params.panicSideMix, 0, 0.45);
  const sideSign = Math.sign(self.transform.vel.x * tx + self.transform.vel.y * ty) || 1;
  const dirX = nx * (1 - mix) + tx * mix * sideSign;
  const dirY = ny * (1 - mix) + ty * mix * sideSign;
  const dirL = Math.max(1e-6, Math.hypot(dirX, dirY));
  const panicT = clamp((self.combat.panicTimer || 0) / Math.max(0.001, arena.params.panicDuration), 0, 1);
  const massPenalty = 1 - clamp(Math.log2(Math.max(2, self.mass)) * arena.params.panicMassPenalty * 0.1, 0, 0.55);
  const accel = arena.params.panicAccel * panicT * massPenalty;
  self.transform.vel.x += (dirX / dirL) * accel * dt / Math.max(1, self.mass * 0.08);
  self.transform.vel.y += (dirY / dirL) * accel * dt / Math.max(1, self.mass * 0.08);
}

function integrate(f, dt, arena){
  const p = f.transform.pos;
  const v = f.transform.vel;

  if(f.combat.grappleTimer > 0){
    const cd = arena.params.contactDrag * (Number.isFinite(f.combat.contactDragMult) ? f.combat.contactDragMult : 1.0);
    const drag = Math.exp(-cd * dt);
    v.x *= drag;
    v.y *= drag;
    f.combat.grappleTimer = Math.max(0, f.combat.grappleTimer - dt);
    if(f.combat.grappleTimer === 0) f.combat.contactDragMult = 1.0;
  }

  p.x += v.x * dt;
  p.y += v.y * dt;

  if(f.combat){
    f.combat.recentContactT = Math.max(0, (f.combat.recentContactT || 0) - dt);
    f.combat.bodySquash = (f.combat.bodySquash || 0) * Math.exp(-5.6 * dt);
    f.combat.impactJitter = (f.combat.impactJitter || 0) * Math.exp(-8.5 * dt);
    f.combat.tetherStrength = (f.combat.tetherStrength || 0) * Math.exp(-4.2 * dt);
    if(f.combat.contactDent){
      f.combat.contactDent.strength *= Math.exp(-5.4 * dt);
      if(f.combat.contactDent.strength < 0.03) f.combat.contactDent = null;
    }
  }

  updateAngularMotion(f, arena, dt);

  p.x = clamp(p.x, 10, arena.worldW - 10);
  p.y = clamp(p.y, 10, arena.worldH - 10);
}

function updateAngularMotion(f, arena, dt){
  if(!f?.transform) return;
  const p = f.transform.pos;
  const v = f.transform.vel;
  const rx = p.x - arena.sun.x;
  const ry = p.y - arena.sun.y;
  const r = Math.max(1, Math.hypot(rx, ry));
  const tx = -ry / r;
  const ty =  rx / r;
  const vt = v.x * tx + v.y * ty;
  const inertia = Math.max(12, f.mass * Math.max(4, f.geom.radius) * 0.06);
  const speed = Math.hypot(v.x, v.y);
  const targetSpin = vt / Math.max(10, f.geom.radius * 2.25);
  f.transform.angularVel += (targetSpin - f.transform.angularVel) * clamp((12 / inertia) * dt, 0, 0.14);
  const desiredAngle = speed > 0.35 ? Math.atan2(v.y, v.x) : (Number.isFinite(f.transform.angle) ? f.transform.angle : 0);
  let da = desiredAngle - (Number.isFinite(f.transform.angle) ? f.transform.angle : 0);
  while(da > Math.PI) da -= Math.PI * 2;
  while(da < -Math.PI) da += Math.PI * 2;
  const contactTurn = (f.combat?.recentContactT || 0) > 0 ? (arena.params.clinchTurnAssist || 0) : 0;
  f.transform.angularVel += da * (arena.params.frontBiasTurn || 0.9) * dt * (1.0 + contactTurn);
  f.transform.angularVel *= Math.exp(-arena.params.angularDamping * dt);
  f.transform.angle += f.transform.angularVel * dt;
}

function bumpHit(hit, type){
  const t = String(type || '').toLowerCase();
  if(!t) return;
  if(t.includes('spike')) hit.spike++;
  else if(t.includes('shell')) hit.shell++;
  else if(t.includes('tentacle') || t.includes('tent') || t.includes('whip')) hit.tentacle++;
  else if(t.includes('tail')) hit.tail++;
}

function detectContact(arena, A, B){
  const dx0 = (A.transform.pos.x + A.geom.center.x) - (B.transform.pos.x + B.geom.center.x);
  const dy0 = (A.transform.pos.y + A.geom.center.y) - (B.transform.pos.y + B.geom.center.y);
  const d2 = dx0 * dx0 + dy0 * dy0;
  const r0 = A.geom.radius + B.geom.radius + 6;
  if(d2 > r0 * r0){
    return emptyContact();
  }

  const bucketSize = 8;
  const mapA = fighterModuleMap(A);
  const mapB = fighterModuleMap(B);
  const map = new Map();
  for(const c of B.geom.cells){
    const wp = worldPointHybrid(B, c, mapB.get((c.x | 0) + ',' + (c.y | 0)) || null);
    const bx = Math.floor(wp.x / bucketSize);
    const by = Math.floor(wp.y / bucketSize);
    const key = bx + ',' + by;
    let arr = map.get(key);
    if(!arr){ arr = []; map.set(key, arr); }
    arr.push([wp.x, wp.y, c]);
  }

  let pairs = 0;
  let nx = 0, ny = 0;
  let hitX = 0, hitY = 0;
  const outPairs = [];
  const hitA = { spike:0, shell:0, tentacle:0, tail:0 };
  const hitB = { spike:0, shell:0, tentacle:0, tail:0 };
  const touchRadius = 2.45;
  const touchRadius2 = touchRadius * touchRadius;

  for(const ca of A.geom.cells){
    const wa = worldPointHybrid(A, ca, mapA.get((ca.x | 0) + ',' + (ca.y | 0)) || null);
    const bx0 = Math.floor(wa.x / bucketSize);
    const by0 = Math.floor(wa.y / bucketSize);

    let found = null;
    for(let dxB = -1; dxB <= 1 && !found; dxB++){
      for(let dyB = -1; dyB <= 1 && !found; dyB++){
        const arr = map.get((bx0 + dxB) + ',' + (by0 + dyB));
        if(!arr) continue;
        for(const [bx, by, cb] of arr){
          const ddx = wa.x - bx;
          const ddy = wa.y - by;
          const dist2 = ddx * ddx + ddy * ddy;
          if(dist2 <= touchRadius2){
            found = { ax: wa.x, ay: wa.y, bx, by, ca, cb };
            break;
          }
        }
      }
    }

    if(found){
      pairs++;
      nx += (found.ax - found.bx);
      ny += (found.ay - found.by);
      hitX += (found.ax + found.bx) * 0.5;
      hitY += (found.ay + found.by) * 0.5;
      outPairs.push(found);
      bumpHit(hitA, found.ca?.type || found.ca?.t || found.ca?.kind);
      bumpHit(hitB, found.cb?.type || found.cb?.t || found.cb?.kind);
    }
  }

  if(pairs === 0) return emptyContact();

  const inv = 1 / Math.max(1e-6, Math.hypot(nx, ny));
  const normal = { x: nx * inv, y: ny * inv };

  const rvx = A.transform.vel.x - B.transform.vel.x;
  const rvy = A.transform.vel.y - B.transform.vel.y;
  const vIn = Math.max(0, rvx * normal.x + rvy * normal.y);

  const vAn = Math.max(0, A.transform.vel.x * normal.x + A.transform.vel.y * normal.y);
  const vBn = Math.max(0, -(B.transform.vel.x * normal.x + B.transform.vel.y * normal.y));
  const attackerSpeedA = Math.max(vAn, vIn * 0.5);
  const attackerSpeedB = Math.max(vBn, vIn * 0.5);

  const MAX_PAIRS = 64;
  let pairsLite = outPairs;
  if(outPairs.length > MAX_PAIRS){
    const step = Math.ceil(outPairs.length / MAX_PAIRS);
    pairsLite = [];
    for(let i = 0; i < outPairs.length; i += step) pairsLite.push(outPairs[i]);
  }

  return {
    contactPairs: pairs,
    pairs: pairsLite,
    hitA,
    hitB,
    normal,
    vIn,
    attackerSpeedA,
    attackerSpeedB,
    hitPoint: { x: hitX / pairs, y: hitY / pairs }
  };
}

function resolveContact(arena, A, B, contact, dt){
  A.stats.contactFrames++;
  B.stats.contactFrames++;
  markContactFlash(arena, A, contact?.pairs, 'A');
  markContactFlash(arena, B, contact?.pairs, 'B');
  queueCameraHit(arena, contact?.hitPoint, clamp(contact?.contactPairs / 8, 0.35, 1.2));

  applyContactSlideSpin(arena, A, B, contact, dt);

  const speedInA = Math.max(0, Number(contact.attackerSpeedA) || 0);
  const speedInB = Math.max(0, Number(contact.attackerSpeedB) || 0);

  const attackMultA = 1 + clamp(speedInA / arena.params.v0, 0, arena.params.speedCap);
  const attackMultB = 1 + clamp(speedInB / arena.params.v0, 0, arena.params.speedCap);

  const modA = getAttackMod(A, contact.hitA, arena) * getDefenseMod(B, contact.hitB, arena);
  const modB = getAttackMod(B, contact.hitB, arena) * getDefenseMod(A, contact.hitA, arena);

  const impactFactorA = 0.90 + 2.15 * clamp(speedInA / Math.max(1, arena.params.v0), 0, arena.params.speedCap);
  const impactFactorB = 0.90 + 2.15 * clamp(speedInB / Math.max(1, arena.params.v0), 0, arena.params.speedCap);
  const rawToB = (contact.contactPairs * arena.params.kDamage * attackMultA * modA * impactFactorA);
  const rawToA = (contact.contactPairs * arena.params.kDamage * attackMultB * modB * impactFactorB);

  B.combat.damageCarry = (B.combat.damageCarry || 0) + rawToB;
  A.combat.damageCarry = (A.combat.damageCarry || 0) + rawToA;
  const dmgToB = Math.floor(B.combat.damageCarry);
  const dmgToA = Math.floor(A.combat.damageCarry);
  if(dmgToB > 0) B.combat.damageCarry -= dmgToB;
  if(dmgToA > 0) A.combat.damageCarry -= dmgToA;

  if(dmgToB > 0) applyDamage(arena, B, dmgToB, contact, 'B');
  if(dmgToA > 0) applyDamage(arena, A, dmgToA, contact, 'A');

  A.stats.damageDealt += dmgToB;
  B.stats.damageTaken += dmgToB;
  B.stats.damageDealt += dmgToA;
  A.stats.damageTaken += dmgToA;

  const tentacleInvolved = (contact.hitA.tentacle > 0) || (contact.hitB.tentacle > 0);

  if(contact.hitA.tail > 0) applyTailKick(arena, A, B, contact);
  if(contact.hitB.tail > 0) applyTailKick(arena, B, A, contact);

  const nx = contact.normal.x;
  const ny = contact.normal.y;
  const tx = -ny;
  const ty =  nx;

  const rvx = A.transform.vel.x - B.transform.vel.x;
  const rvy = A.transform.vel.y - B.transform.vel.y;
  const vn = rvx * nx + rvy * ny;
  const vt = rvx * tx + rvy * ty;

  if(contact.contactPairs > 0){
    const t = (arena.params.contactStick || arena.params.grappleBase || 0.22) + (tentacleInvolved ? arena.params.tentacleHoldBoost : 0) + clamp(contact.contactPairs / 42, 0.04, 0.16);
    A.combat.grappleTimer = Math.max(A.combat.grappleTimer, t);
    B.combat.grappleTimer = Math.max(B.combat.grappleTimer, t);
    A.combat.recentContactT = Math.max(A.combat.recentContactT || 0, 0.46);
    B.combat.recentContactT = Math.max(B.combat.recentContactT || 0, 0.46);
    const mult = 1 + (tentacleInvolved ? arena.params.tentacleDragBoost : 0.10) + clamp(contact.contactPairs / 50, 0.03, 0.22);
    A.combat.contactDragMult = Math.max(A.combat.contactDragMult || 1.0, mult);
    B.combat.contactDragMult = Math.max(B.combat.contactDragMult || 1.0, mult);
    const tether = clamp(0.22 + contact.contactPairs * 0.01 + (tentacleInvolved ? 0.16 : 0), 0.18, 1.2);
    A.combat.tetherTargetId = B.id;
    B.combat.tetherTargetId = A.id;
    A.combat.tetherStrength = Math.max(A.combat.tetherStrength || 0, tether);
    B.combat.tetherStrength = Math.max(B.combat.tetherStrength || 0, tether);
    A.combat.tetherPointX = contact.hitPoint.x; A.combat.tetherPointY = contact.hitPoint.y;
    B.combat.tetherPointX = contact.hitPoint.x; B.combat.tetherPointY = contact.hitPoint.y;
    const dent = clamp((arena.params.contactDentDepth || 1.2) * (0.45 + contact.contactPairs / 24), 0.35, 2.3);
    A.combat.contactDent = { x: contact.hitPoint.x, y: contact.hitPoint.y, strength: Math.max(A.combat.contactDent?.strength || 0, dent) };
    B.combat.contactDent = { x: contact.hitPoint.x, y: contact.hitPoint.y, strength: Math.max(B.combat.contactDent?.strength || 0, dent) };
  }

  const invMA = 1 / Math.max(1, A.mass);
  const invMB = 1 / Math.max(1, B.mass);
  const invSum = invMA + invMB;

  if(vn < 0){
    const e = arena.params.restitution;
    const massBiasA = 1 / Math.pow(Math.max(1, A.mass), 0.42);
    const massBiasB = 1 / Math.pow(Math.max(1, B.mass), 0.42);
    const j = -(1 + e) * vn;
    const jA = j * (invMA / invSum) * (0.78 + 0.55 * massBiasA);
    const jB = j * (invMB / invSum) * (0.78 + 0.55 * massBiasB);

    A.transform.vel.x += nx * jA;
    A.transform.vel.y += ny * jA;
    B.transform.vel.x -= nx * jB;
    B.transform.vel.y -= ny * jB;

    const tangentMul = arena.desperationActive ? arena.params.desperationTangentBounceMul : 1.0;
    const tangentKick = Math.abs(vn) * arena.params.tangentBounce * tangentMul;
    const massFactorA = 1 / Math.pow(Math.max(1, A.mass), 0.52);
    const massFactorB = 1 / Math.pow(Math.max(1, B.mass), 0.52);

    A.transform.vel.x += tx * tangentKick * massFactorA;
    A.transform.vel.y += ty * tangentKick * massFactorA;
    B.transform.vel.x -= tx * tangentKick * massFactorB;
    B.transform.vel.y -= ty * tangentKick * massFactorB;

    applySolarSlip(arena, A, Math.abs(vn) * 0.04 * massFactorA);
    applySolarSlip(arena, B, Math.abs(vn) * 0.04 * massFactorB);

    const spinBoost = arena.params.collisionSpinBoost;
    const tangentialSpin = arena.params.collisionTangentialSpinBoost * Math.abs(vt);
    applyAngularImpulse(
      A,
      contact.hitPoint,
      { x: nx * jA + tx * tangentKick * massFactorA, y: ny * jA + ty * tangentKick * massFactorA },
      spinBoost + tangentialSpin
    );
    applyAngularImpulse(
      B,
      contact.hitPoint,
      { x: -nx * jB - tx * tangentKick * massFactorB, y: -ny * jB - ty * tangentKick * massFactorB },
      spinBoost + tangentialSpin
    );
  }

  const impactSquash = clamp(contact.contactPairs / 24, 0.08, arena.params.contactBodySquash || 0.18);
  A.combat.bodySquash = Math.max(A.combat.bodySquash || 0, impactSquash);
  B.combat.bodySquash = Math.max(B.combat.bodySquash || 0, impactSquash);
  A.combat.impactJitter = Math.max(A.combat.impactJitter || 0, Math.abs(vn) * 0.04 + impactSquash * 4.0);
  B.combat.impactJitter = Math.max(B.combat.impactJitter || 0, Math.abs(vn) * 0.04 + impactSquash * 4.0);

  const slide = clamp(vt * 0.06, -1.6, 1.6);
  const surfaceSlide = (arena.params.contactSurfaceSlide || 0) * dt;
  A.transform.pos.x += tx * slide * surfaceSlide * invMB;
  A.transform.pos.y += ty * slide * surfaceSlide * invMB;
  B.transform.pos.x -= tx * slide * surfaceSlide * invMA;
  B.transform.pos.y -= ty * slide * surfaceSlide * invMA;

  const push = arena.params.separation * clamp(contact.contactPairs / 26, 0.14, 0.92);
  const pA = push * (invMA / invSum);
  const pB = push * (invMB / invSum);

  A.transform.pos.x += nx * pA * dt;
  A.transform.pos.y += ny * pA * dt;
  B.transform.pos.x -= nx * pB * dt;
  B.transform.pos.y -= ny * pB * dt;
}

function getAttackMod(f, hit, arena){
  if(hit?.spike > 0) return arena.params.spikeDamageMult;
  return 1.0;
}

function getDefenseMod(target, hit, arena){
  if(hit?.shell > 0) return arena.params.shellDamageReduction;
  return 1.0;
}

function applyTailKick(arena, attacker, other, contact){
  const ox = other.transform.pos.x + other.geom.center.x;
  const oy = other.transform.pos.y + other.geom.center.y;
  const toSunX = arena.sun.x - ox;
  const toSunY = arena.sun.y - oy;
  const len = Math.max(1e-6, Math.hypot(toSunX, toSunY));
  const tx = -toSunY / len;
  const ty =  toSunX / len;

  const rvx = attacker.transform.vel.x - other.transform.vel.x;
  const rvy = attacker.transform.vel.y - other.transform.vel.y;
  const sign = Math.sign(rvx * tx + rvy * ty) || 1;

  const kick = arena.params.tailImpulse * clamp(contact.vIn / Math.max(1, arena.params.v0), 0, 1) * sign;

  other.transform.vel.x += tx * kick;
  other.transform.vel.y += ty * kick;
  attacker.transform.vel.x -= tx * kick * 0.15;
  attacker.transform.vel.y -= ty * kick * 0.15;
}

function applyAngularImpulse(target, hitPoint, impulse, boost = 1){
  if(!target?.transform || !hitPoint || !impulse) return;
  const cx = target.transform.pos.x + target.geom.center.x;
  const cy = target.transform.pos.y + target.geom.center.y;
  const rx = hitPoint.x - cx;
  const ry = hitPoint.y - cy;
  const torque = (rx * impulse.y - ry * impulse.x) * Math.max(0, boost);
  const radius = Math.max(4, target.geom.radius);
  const inertia = Math.max(14, target.mass * radius * radius * 0.055);
  target.transform.angularVel += torque / inertia;
}

function applyContactSlideSpin(arena, A, B, contact, dt){
  if(!contact?.hitPoint) return;
  const nx = contact.normal.x;
  const ny = contact.normal.y;
  const tx = -ny;
  const ty = nx;
  const rvx = A.transform.vel.x - B.transform.vel.x;
  const rvy = A.transform.vel.y - B.transform.vel.y;
  const slide = rvx * tx + rvy * ty;
  if(Math.abs(slide) < 0.01) return;

  const boost = arena.params.contactSlideSpinBoost * (0.35 + Math.min(1.6, contact.contactPairs * 0.03));
  const tangentialImpulse = {
    x: tx * slide * arena.params.contactSlideTangentialFactor * dt,
    y: ty * slide * arena.params.contactSlideTangentialFactor * dt,
  };

  applyAngularImpulse(A, contact.hitPoint, tangentialImpulse, boost);
  applyAngularImpulse(B, contact.hitPoint, { x: -tangentialImpulse.x, y: -tangentialImpulse.y }, boost);
}

function applySolarSlip(arena, target, impulse){
  if(!target?.transform || !Number.isFinite(impulse) || impulse <= 0) return;
  const p = target.transform.pos;
  const rx = p.x - arena.sun.x;
  const ry = p.y - arena.sun.y;
  const r = Math.max(1, Math.hypot(rx, ry));
  const tx = -ry / r;
  const ty =  rx / r;
  const sign = Math.sign(target.transform.vel.x * tx + target.transform.vel.y * ty) || 1;
  target.transform.vel.x += tx * impulse * sign;
  target.transform.vel.y += ty * impulse * sign;
}

function applyDamage(arena, target, dmg, contact, targetId){
  const n = Math.min(dmg, target.geom.cells.length);
  if(n <= 0) return;

  const pts = [];
  for(const p of (contact?.pairs || [])){
    if(targetId === 'A') pts.push([p.ax, p.ay]);
    else pts.push([p.bx, p.by]);
  }

  const removedCells = removeCellsNearWorldPoints(target, pts, n);
  const hitVel = {
    x: (contact?.normal?.x || 0) * Math.max(0, contact?.vIn || 0),
    y: (contact?.normal?.y || 0) * Math.max(0, contact?.vIn || 0),
  };
  spawnDebrisCells(arena, target, removedCells, hitVel, contact?.hitPoint);
  spawnBloodBurst(arena, target, removedCells, hitVel, contact?.hitPoint);

  const detachedComps = pruneDetachedIslands(target.geom, arena.params);
  for(const comp of detachedComps){
    spawnDetachedChunk(arena, target, comp, hitVel, contact?.hitPoint);
  }

  recomputeGeom(target.geom);
  target.mass = target.geom.cells.length;
}


function removeCellsNearWorldPoints(target, pts, n){
  const P = (pts && pts.length) ? pts.slice(0, 64) : null;
  const scored = [];
  for(let i = 0; i < target.geom.cells.length; i++){
    const c = target.geom.cells[i];
    const meta = fighterModuleMap(target).get((c.x | 0) + ',' + (c.y | 0)) || null;
    const wp = worldPointHybrid(target, c, meta);
    let d = 999999;
    if(P){
      for(const [px, py] of P){
        const md = Math.abs(wp.x - px) + Math.abs(wp.y - py);
        if(md < d) d = md;
        if(d <= 0.2) break;
      }
    }else{
      const dx = c.x - target.geom.center.x;
      const dy = c.y - target.geom.center.y;
      d = -Math.hypot(dx, dy);
    }
    scored.push({ i, d: d + Math.random() * 0.02 });
  }

  scored.sort((a, b) => a.d - b.d);
  const kill = new Set();
  for(let k = 0; k < n && k < scored.length; k++) kill.add(scored[k].i);
  const removed = [];
  target.geom.cells = target.geom.cells.filter((cell, idx) => {
    if(kill.has(idx)){
      removed.push({ ...cell });
      return false;
    }
    return true;
  });
  return removed;
}

function pruneDetachedIslands(geom, params = {}){
  const cells = geom.cells;
  if(cells.length <= 1) return [];

  const idxByKey = new Map();
  for(let i = 0; i < cells.length; i++) idxByKey.set(cells[i].x + ',' + cells[i].y, i);

  const seen = new Uint8Array(cells.length);
  const comps = [];

  for(let i = 0; i < cells.length; i++) {
    if(seen[i]) continue;
    const q = [i];
    seen[i] = 1;
    const comp = [];
    while(q.length){
      const j = q.pop();
      comp.push(j);
      const c = cells[j];
      const nb = [
        (c.x + 1) + ',' + c.y,
        (c.x - 1) + ',' + c.y,
        c.x + ',' + (c.y + 1),
        c.x + ',' + (c.y - 1)
      ];
      for(const k of nb){
        const ni = idxByKey.get(k);
        if(ni === undefined || seen[ni]) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    comps.push(comp);
  }

  if(comps.length <= 1) return [];
  comps.sort((a, b) => b.length - a.length);
  const keep = new Set(comps[0]);
  const removedComps = [];
  for(let i = 1; i < comps.length; i++) {
    removedComps.push(comps[i].map(idx => ({ ...cells[idx] })));
  }
  geom.cells = cells.filter((_, i) => keep.has(i));
  return removedComps;
}

function buildTimeoutScoreEntry(self, other){
  const selfStart = Math.max(1, self?.combat?.baseMass || self?.mass || 1);
  const otherStart = Math.max(1, other?.combat?.baseMass || other?.mass || 1);
  const selfMass = Math.max(0, self?.mass || 0);
  const otherMass = Math.max(0, other?.mass || 0);
  const damageEfficiency = clamp((otherStart - otherMass) / otherStart, 0, 1);
  const survivalRatio = clamp(selfMass / selfStart, 0, 1);
  const selfHonor = Math.max(0, Math.floor(self?.stats?.kingHonorAcc || 0));
  const otherHonor = Math.max(0, Math.floor(other?.stats?.kingHonorAcc || 0));
  const honorTotal = selfHonor + otherHonor;
  const sunControlShare = honorTotal > 0 ? selfHonor / honorTotal : 0.5;
  const blocksLeft = selfMass;
  return {
    id: self?.id || '?',
    name: self?.name || '—',
    damageEfficiency,
    survivalRatio,
    sunControlShare,
    blocksLeft,
    hillHonor: selfHonor,
    scoreTuple: [damageEfficiency, survivalRatio, sunControlShare, blocksLeft],
  };
}

function compareTimeoutEntries(a, b, eps = 0.0005){
  const av = a?.scoreTuple || [];
  const bv = b?.scoreTuple || [];
  for(let i = 0; i < Math.max(av.length, bv.length); i++) {
    const da = Number(av[i] || 0);
    const db = Number(bv[i] || 0);
    if(Math.abs(da - db) <= eps) continue;
    return da > db ? 1 : -1;
  }
  return 0;
}

function breakSimultaneousKOTie(A, B, scoreA, scoreB, eps = 0.0005){
  const aBlocks = Number(scoreA?.blocksLeft || A?.mass || 0);
  const bBlocks = Number(scoreB?.blocksLeft || B?.mass || 0);
  if(Math.abs(aBlocks - bBlocks) > eps) return aBlocks > bBlocks ? A : B;

  const aDamage = Number(A?.stats?.damageDealt || 0);
  const bDamage = Number(B?.stats?.damageDealt || 0);
  if(Math.abs(aDamage - bDamage) > eps) return aDamage > bDamage ? A : B;

  const aSun = Number(scoreA?.sunControlShare || 0.5);
  const bSun = Number(scoreB?.sunControlShare || 0.5);
  if(Math.abs(aSun - bSun) > eps) return aSun > bSun ? A : B;

  const aHonor = Number(scoreA?.hillHonor || A?.stats?.kingHonorAcc || 0);
  const bHonor = Number(scoreB?.hillHonor || B?.stats?.kingHonorAcc || 0);
  if(Math.abs(aHonor - bHonor) > eps) return aHonor > bHonor ? A : B;

  return A;
}

export function stepFinishedDrift(arena, dt){
  if(arena?.mode !== 'finished' || !arena?.winnerId) return;
  const winner = arena.winnerId === 'A' ? arena.fighters[0] : arena.fighters[1];
  if(!winner?.alive) return;
  const other = winner.id === 'A' ? arena.fighters[1] : arena.fighters[0];
  applyForces(arena, winner, other || winner, dt);
  integrate(winner, dt, arena);
  updateFighterFlexPose(winner, dt);
  rebuildWorldCells(arena);
}


export function stepIdlePreview(arena, dt){
  if(!arena) return;
  for(const f of (arena.fighters || [])) {
    if(!f || !f.alive || !f.transform) continue;
    if(!f.transform.vel) f.transform.vel = { x: 0, y: 0 };
    f.transform.vel.x = 0;
    f.transform.vel.y = 0;
    f.transform.angularVel = 0;
    if(!Number.isFinite(f.transform.angle)) f.transform.angle = 0;
    updateFighterFlexPose(f, dt);
  }
  rebuildWorldCells(arena);
}

function finish(arena, reason = 'ko'){
  arena.mode = 'finished';
  const A = arena.fighters[0];
  const B = arena.fighters[1];
  let winner = null;
  const scoreA = buildTimeoutScoreEntry(A, B);
  const scoreB = buildTimeoutScoreEntry(B, A);
  arena.timeoutSummary = { A: scoreA, B: scoreB, reason };

  if(reason === 'timeout'){
    const cmp = compareTimeoutEntries(scoreA, scoreB, arena.params.timeoutEpsilon || 0.0005);
    if(cmp > 0) winner = A;
    else if(cmp < 0) winner = B;
  }else{
    if(A.alive && !B.alive) winner = A;
    else if(!A.alive && B.alive) winner = B;
    else if(!A.alive && !B.alive) winner = breakSimultaneousKOTie(A, B, scoreA, scoreB, arena.params.timeoutEpsilon || 0.0005);
  }

  const hillA = Math.floor(A?.stats?.kingHonorAcc || 0);
  const hillB = Math.floor(B?.stats?.kingHonorAcc || 0);
  if(A) A.meta.honor = (A.meta.honor | 0) + hillA;
  if(B) B.meta.honor = (B.meta.honor | 0) + hillB;

  if(!winner){
    arena.resultText = reason === 'timeout' ? `Time up — draw` : 'Draw';
    arena.winnerId = null;
    return;
  }
  arena.winnerId = winner.id;

  const honorAdd = arena.params.honorWin + Math.round(winner.stats.damageDealt * arena.params.honorDamage);
  winner.meta.wins = (winner.meta.wins | 0) + 1;
  winner.meta.honor = (winner.meta.honor | 0) + honorAdd;

  const modeText = reason === 'timeout' ? 'Time up' : 'KO';
  if(reason === 'timeout' && arena.timeoutSummary){
    const ws = winner.id === 'A' ? arena.timeoutSummary.A : arena.timeoutSummary.B;
    arena.resultText = `${modeText}: ${winner.name} wins by score (dmg ${(ws.damageEfficiency*100).toFixed(1)}% | surv ${(ws.survivalRatio*100).toFixed(1)}% | sun ${(ws.sunControlShare*100).toFixed(1)}%)`;
  } else {
    const hillText = (hillA > 0 || hillB > 0) ? ` | hill ${hillA}/${hillB}` : '';
    arena.resultText = `${modeText}: ${winner.name} wins (${A.mass}:${B.mass}, +${honorAdd} honor${hillText})`;
  }
}

function buildModuleMetaMap(f){
  const map = new Map();
  const mods = Array.isArray(f?.organismState?.modules) ? f.organismState.modules : [];
  let shiftX = 0, shiftY = 0;
  const core = f?.organismState?.body?.core;
  if(Array.isArray(core) && core.length >= 2){
    shiftX = core[0] | 0;
    shiftY = core[1] | 0;
  }
  for(let mi = 0; mi < mods.length; mi++){
    const m = mods[mi] || {};
    const type = String(m?.type || m?.t || 'body').toLowerCase();
    const rawCells = Array.isArray(m?.cells) ? m.cells : (Array.isArray(m?.blocks) ? m.blocks : (Array.isArray(m?.bodyCells) ? m.bodyCells : []));
    const pts = [];
    for(const c of (Array.isArray(rawCells) ? rawCells : [])){
      let x = null, y = null;
      if(Array.isArray(c) && c.length >= 2){ x = c[0] | 0; y = c[1] | 0; }
      else if(c && Number.isFinite(c.x) && Number.isFinite(c.y)){ x = c.x | 0; y = c.y | 0; }
      else if(typeof c === 'string'){
        const mxy = /^(-?\d+)\s*,\s*(-?\d+)$/.exec(c.trim());
        if(mxy){ x = mxy[1] | 0; y = mxy[2] | 0; }
      }
      if(x === null || y === null) continue;
      pts.push({ x: (x - shiftX) | 0, y: (y - shiftY) | 0 });
    }
    const len = pts.length;
    if(!len) continue;
    const anchor = pts[0];
    const tip = pts[len - 1] || anchor;
    let tx0 = tip.x - anchor.x;
    let ty0 = tip.y - anchor.y;
    const tl = Math.hypot(tx0, ty0) || 1;
    const tx = tx0 / tl;
    const ty = ty0 / tl;
    const px = -ty;
    const py = tx;
    let minAlong = Infinity, maxAlong = -Infinity;
    const tmp = [];
    for(let i = 0; i < len; i++){
      const pt = pts[i];
      const dx = pt.x - anchor.x;
      const dy = pt.y - anchor.y;
      const along0 = dx * tx + dy * ty;
      const side0 = dx * px + dy * py;
      if(along0 < minAlong) minAlong = along0;
      if(along0 > maxAlong) maxAlong = along0;
      tmp.push({ pt, i, along0, side0 });
    }
    const baseLen = Math.max(1, maxAlong - minAlong);
    for(const it of tmp){
      const x = it.pt.x | 0;
      const y = it.pt.y | 0;
      map.set(x + ',' + y, {
        type, mi, i: it.i, len,
        ax: anchor.x, ay: anchor.y,
        tx, ty,
        along0: it.along0,
        side0: it.side0,
        baseLen,
      });
    }
  }
  return map;
}

export function rebuildWorldCells(arena){
  const px = cellPx();
  for(const f of arena.fighters){
    if(!f) continue;
    if(!f.alive){ f.worldCells = []; continue; }
    const out = [];
    const moduleMap = fighterModuleMap(f);
    const palette = {
      body: f?.organismState?.partColor?.body || f?.organismState?.palette?.body || null,
      eye: f?.organismState?.partColor?.eye || f?.organismState?.palette?.eye || null,
    };
    const flashCells = f?.combat?.flashCells instanceof Map ? f.combat.flashCells : null;
    const flashTtl = Math.max(0.08, Number.isFinite(arena?.params?.contactFlashSec) ? arena.params.contactFlashSec : 0.5);
    for(const c of f.geom.cells){
      const meta = moduleMap.get((c.x | 0) + ',' + (c.y | 0)) || null;
      const wp = worldPointHybrid(f, c, meta);
      const flashLeft = flashCells ? (flashCells.get((c.x | 0) + ',' + (c.y | 0)) || 0) : 0;
      const posed = posedLocalPoint(f, c, meta);
      out.push({
        px: wp.x * px,
        py: wp.y * px,
        type: c.type || c.t || c.kind || 'body',
        localX: c.x,
        localY: c.y,
        mi: meta?.mi ?? -1,
        segIndex: meta?.i ?? 0,
        segLen: meta?.len ?? 1,
        anchorX: meta?.ax ?? c.x,
        anchorY: meta?.ay ?? c.y,
        posedLocalX: posed.x,
        posedLocalY: posed.y,
        flash: flashLeft > 0 ? clamp(flashLeft / flashTtl, 0, 1) : 0,
        palette,
      });
    }
    f.worldCells = out;
  }
}

function worldPoint(f, c){
  const angle = Number.isFinite(f?.transform?.angle) ? f.transform.angle : 0;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const cx = f.geom.center.x;
  const cy = f.geom.center.y;
  const lx = c.x - cx;
  const ly = c.y - cy;
  const rx = lx * ca - ly * sa;
  const ry = lx * sa + ly * ca;
  return {
    x: f.transform.pos.x + cx + rx,
    y: f.transform.pos.y + cy + ry,
  };
}

export function recomputeGeom(geom){
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  let sx = 0, sy = 0;
  for(const c of geom.cells){
    if(c.x < minx) minx = c.x;
    if(c.y < miny) miny = c.y;
    if(c.x > maxx) maxx = c.x;
    if(c.y > maxy) maxy = c.y;
    sx += c.x; sy += c.y;
  }
  const n = Math.max(1, geom.cells.length);
  const cx = sx / n, cy = sy / n;
  let r = 0;
  for(const c of geom.cells){
    const dx = c.x - cx, dy = c.y - cy;
    const d = Math.hypot(dx, dy);
    if(d > r) r = d;
  }
  geom.bbox = { minx, miny, maxx, maxy };
  geom.center = { x: cx, y: cy };
  geom.radius = r;
}

export function normalizeFromCapsule(organismState){
  const cells = [];
  const pushCell = (x, y, type) => {
    if(!Number.isFinite(x) || !Number.isFinite(y)) return;
    cells.push({ x: x | 0, y: y | 0, type: type || 'body' });
  };

  const normList = (lst, type) => {
    if(!Array.isArray(lst)) return;
    for(const c of lst){
      if(!c) continue;
      if(Array.isArray(c) && c.length >= 2) pushCell(c[0], c[1], type);
      else if(typeof c === 'object' && Number.isFinite(c.x) && Number.isFinite(c.y)) pushCell(c.x, c.y, type);
      else if(typeof c === 'string'){
        const m = /^(-?\d+)\s*,\s*(-?\d+)$/.exec(c.trim());
        if(m) pushCell(m[1] | 0, m[2] | 0, type);
      }
    }
  };

  const bodyCells = organismState?.body?.cells || organismState?.body?.blocks || organismState?.body?.cellsPacked || [];
  normList(bodyCells, 'body');

  const mods = Array.isArray(organismState?.modules) ? organismState.modules : [];
  let hasShell = false, hasSpike = false, hasTentacle = false, hasTail = false;

  for(const m of mods){
    const tRaw = String(m?.type || m?.t || '').toLowerCase();
    const t = tRaw || 'organ';
    if(t === 'shell') hasShell = true;
    if(t === 'spike') hasSpike = true;
    if(t.includes('tentacle') || t === 'tentacle') hasTentacle = true;
    if(t.includes('tail') || t === 'tail') hasTail = true;

    const mCells = (Array.isArray(m?.cells) ? m.cells : (Array.isArray(m?.blocks) ? m.blocks : (Array.isArray(m?.bodyCells) ? m.bodyCells : null)));
    if(mCells) normList(mCells, t);
  }

  const byKey = new Map();
  for(const c of cells){
    const k = c.x + ',' + c.y;
    const prev = byKey.get(k);
    if(!prev) byKey.set(k, c);
    else if(prev.type === 'body' && c.type !== 'body') byKey.set(k, c);
  }
  const uniq = Array.from(byKey.values());

  let anchorX = 0, anchorY = 0;
  if(Array.isArray(organismState?.body?.core) && organismState.body.core.length >= 2){
    anchorX = organismState.body.core[0] | 0;
    anchorY = organismState.body.core[1] | 0;
  } else if(uniq.length){
    let sx = 0, sy = 0;
    for(const c of uniq){ sx += c.x; sy += c.y; }
    anchorX = Math.round(sx / uniq.length);
    anchorY = Math.round(sy / uniq.length);
  }
  for(const c of uniq){ c.x = (c.x - anchorX) | 0; c.y = (c.y - anchorY) | 0; }

  const geom = {
    cells: uniq,
    modules: mods,
    hasShell, hasSpike, hasTentacle, hasTail,
    bbox: null, center: { x: 0, y: 0 }, radius: 0
  };
  recomputeGeom(geom);
  return geom;
}

function emptyContact(){
  return {
    contactPairs: 0,
    pairs: [],
    hitA: { spike:0, shell:0, tentacle:0, tail:0 },
    hitB: { spike:0, shell:0, tentacle:0, tail:0 },
    normal: { x:0, y:0 },
    vIn: 0,
    hitPoint: null,
  };
}

function smoothstep(edge0, edge1, x){
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
