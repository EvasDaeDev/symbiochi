import { mulberry32, hash32, clamp01 } from "../util.js";
import { base64UrlEncode, base64UrlDecode, deflateBytes, inflateBytes } from "../util.js";
import { makeSmallConnectedBody, growBodyConnected, addModule, growPlannedModules, findFaceAnchor } from "../creature.js";

const GEN_VERSION = 1;
const PREFIX = "SYMBIOCHI1:";
const PREFIX_NOCOMP = "SYMBIOCHI1NOCOMP:";

function cleanModuleSpec(spec){
  if (!spec || typeof spec.type !== "string") return null;
  const len = Math.max(1, Math.floor(spec.len || spec.length || 1));
  return { type: spec.type, len };
}

export function extractGenome(stateOrOrg){
  if (!stateOrOrg) return null;
  const modules = Array.isArray(stateOrOrg.modules)
    ? stateOrOrg.modules.map((m) => cleanModuleSpec({ type: m.type, len: m.cells?.length || 1 })).filter(Boolean)
    : [];
  return {
    v: GEN_VERSION,
    seed: (stateOrOrg.seed ?? 0) | 0,
    plan: stateOrOrg.plan ? JSON.parse(JSON.stringify(stateOrOrg.plan)) : null,
    palette: stateOrOrg.palette ? JSON.parse(JSON.stringify(stateOrOrg.palette)) : null,
    modules
  };
}

export async function encodeGenome(genome){
  if (!genome || typeof genome !== "object") throw new Error("bad genome");
  const json = JSON.stringify(genome);
  const bytes = new TextEncoder().encode(json);
  const deflated = await deflateBytes(bytes);
  const payload = base64UrlEncode(deflated.bytes);
  return (deflated.compressed ? PREFIX : PREFIX_NOCOMP) + payload;
}

export async function decodeGenome(str){
  if (typeof str !== "string") throw new Error("bad string");
  const trimmed = str.trim();
  const isDeflated = trimmed.startsWith(PREFIX);
  const isRaw = trimmed.startsWith(PREFIX_NOCOMP);
  if (!isDeflated && !isRaw) throw new Error("bad prefix");
  const payload = trimmed.slice(isDeflated ? PREFIX.length : PREFIX_NOCOMP.length);
  if (!payload) throw new Error("empty payload");
  let bytes = base64UrlDecode(payload);
  if (isDeflated) bytes = await inflateBytes(bytes);
  const json = new TextDecoder().decode(bytes);
  const genome = JSON.parse(json);
  if (!genome || typeof genome !== "object") throw new Error("bad genome");
  if ((genome.v | 0) !== GEN_VERSION) throw new Error("bad version");
  if (!Number.isFinite(genome.seed)) throw new Error("bad seed");
  if (!Array.isArray(genome.modules)) genome.modules = [];
  genome.modules = genome.modules.map(cleanModuleSpec).filter(Boolean);
  if (genome.plan && typeof genome.plan !== "object") genome.plan = null;
  if (genome.palette && typeof genome.palette !== "object") genome.palette = null;
  return genome;
}

function mixNumber(a, b, rng){
  const t = rng();
  return a * (1 - t) + b * t;
}

function mixPlan(planA, planB, seed){
  const rng = mulberry32(seed);
  const out = {};
  const keys = new Set([
    ...Object.keys(planA || {}),
    ...Object.keys(planB || {})
  ]);
  for (const key of keys){
    const va = planA ? planA[key] : undefined;
    const vb = planB ? planB[key] : undefined;
    if (Array.isArray(va) || Array.isArray(vb)){
      const arrA = Array.isArray(va) ? va : vb;
      const arrB = Array.isArray(vb) ? vb : va;
      out[key] = rng() < 0.5 ? arrA : arrB;
    } else if (typeof va === "number" || typeof vb === "number"){
      const na = Number.isFinite(va) ? va : (Number.isFinite(vb) ? vb : 0);
      const nb = Number.isFinite(vb) ? vb : (Number.isFinite(va) ? va : 0);
      out[key] = mixNumber(na, nb, rng);
    } else if (typeof va === "string" || typeof vb === "string"){
      out[key] = rng() < 0.5 ? va : vb;
    } else if (typeof va === "boolean" || typeof vb === "boolean"){
      out[key] = rng() < 0.5 ? va : vb;
    } else {
      out[key] = rng() < 0.5 ? va : vb;
    }
  }
  if (out.symmetry != null) out.symmetry = clamp01(out.symmetry);
  if (out.wiggle != null) out.wiggle = clamp01(out.wiggle);
  return out;
}

function mixPalette(palA, palB, seed){
  const rng = mulberry32(seed);
  const out = {};
  const keys = new Set([
    ...Object.keys(palA || {}),
    ...Object.keys(palB || {})
  ]);
  for (const key of keys){
    const va = palA ? palA[key] : undefined;
    const vb = palB ? palB[key] : undefined;
    out[key] = rng() < 0.5 ? va : vb;
  }
  return out;
}

function shuffleWithSeed(arr, seed){
  const rng = mulberry32(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--){
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function mergeGenomes(genA, genB){
  const sharedSeed = hash32((genA.seed ^ genB.seed) >>> 0, 9137);
  const list = [
    ...(genA.modules || []),
    ...(genB.modules || [])
  ];
  const shuffled = shuffleWithSeed(list, sharedSeed);
  const mid = Math.floor(shuffled.length / 2);
  const mods1 = shuffled.slice(0, mid);
  const mods2 = shuffled.slice(mid);

  const out1 = {
    v: GEN_VERSION,
    seed: hash32(sharedSeed, 1) | 0,
    plan: mixPlan(genA.plan || {}, genB.plan || {}, hash32(sharedSeed, 11)),
    palette: mixPalette(genA.palette || {}, genB.palette || {}, hash32(sharedSeed, 21)),
    modules: mods1
  };
  const out2 = {
    v: GEN_VERSION,
    seed: hash32(sharedSeed, 2) | 0,
    plan: mixPlan(genA.plan || {}, genB.plan || {}, hash32(sharedSeed, 12)),
    palette: mixPalette(genA.palette || {}, genB.palette || {}, hash32(sharedSeed, 22)),
    modules: mods2
  };
  return { out1, out2, ruleInfo: { sharedSeed, mid } };
}

function resetModuleGrowth(state, targetLens){
  let hasAny = true;
  let guard = 0;
  const maxSteps = Math.max(30, targetLens.reduce((s, v) => s + v, 0) * 3);
  while (hasAny && guard < maxSteps){
    hasAny = false;
    for (let i = 0; i < state.modules.length; i++){
      const target = targetLens[i] ?? 1;
      if (state.modules[i].cells.length >= target){
        state.modules[i].growDir = null;
      } else {
        hasAny = true;
      }
    }
    if (!hasAny) break;
    guard++;
    growPlannedModules(state, mulberry32(hash32(state.seed, 700 + guard)), { maxGrows: 1 });
  }
}

export function instantiateParentFromGenome(state, genomeOut){
  if (!state || !genomeOut) return;
  const seed = genomeOut.seed | 0;
  const rng = mulberry32(hash32(seed, 321));
  const targetBody = 10 + Math.max(0, Math.min(12, (genomeOut.modules?.length || 0)));

  const body = makeSmallConnectedBody(seed, Math.max(8, targetBody));
  growBodyConnected({ body, modules: [] }, Math.max(0, targetBody - body.cells.length), rng);

  state.seed = seed;
  state.plan = genomeOut.plan ? JSON.parse(JSON.stringify(genomeOut.plan)) : state.plan;
  state.palette = genomeOut.palette ? JSON.parse(JSON.stringify(genomeOut.palette)) : state.palette;
  state.body = body;
  state.face = { anchor: findFaceAnchor(body, seed), eyeSize: 1, extraEye: false };
  state.modules = [];
  state.anim = {};
  state.cam = { ox: body.core[0], oy: body.core[1] };

  const moduleSpecs = (genomeOut.modules || []).map(cleanModuleSpec).filter(Boolean);
  const targetLens = [];
  for (const spec of moduleSpecs){
    const added = addModule(state, spec.type, rng);
    if (added){
      const idx = state.modules.length - 1;
      targetLens[idx] = spec.len;
      if (state.modules[idx]) state.modules[idx].growTo = spec.len;
    }
  }
  if (state.modules.length){
    resetModuleGrowth(state, targetLens);
  }
  state.lastMutationAt = state.lastSeen;
  state.mutationDebt = 0;
  if (state.bars){
    state.bars.food = Math.max(0.7, state.bars.food ?? 1);
    state.bars.clean = Math.max(0.7, state.bars.clean ?? 1);
    state.bars.hp = Math.max(0.7, state.bars.hp ?? 1);
    state.bars.mood = Math.max(0.7, state.bars.mood ?? 1);
  }
}
