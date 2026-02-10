// js/organs/index.js
// Central registry for organ configuration.
// Goal: keep all per-organ behavior + animation parameters inside organ modules,
// and let the rest of the codebase query this registry.

import { ANTENNA } from "./antenna.js";
import { BODY, CORE } from "./body.js";
import { CLAW } from "./claw.js";
import { EYE } from "./eye.js";
import { FIN } from "./fin.js";
import { LIMB } from "./limb.js";
import { MOUTH } from "./mouth.js";
import { SHELL } from "./shell.js";
import { SPIKE } from "./spike.js";
import { TAIL } from "./tail.js";
import { TEETH } from "./teeth.js";
import { TENTACLE } from "./tentacle.js";
import { WORM } from "./worm.js";

export const ORGAN_DEFS = {
  // "body" and "core" are also "parts" used by UI/log/render.
  body: BODY,
  core: CORE,

  // main organs
  antenna: ANTENNA,
  tentacle: TENTACLE,
  tail: TAIL,
  worm: WORM,
  limb: LIMB,
  spike: SPIKE,
  shell: SHELL,
  eye: EYE,

  // late mutations
  teeth: TEETH,
  claw: CLAW,
  mouth: MOUTH,
  fin: FIN,
};

// Spawnable organ types (do not include body/core).
export const ORGAN_TYPES = [
  "antenna",
  "tentacle",
  "tail",
  "worm",
  "limb",
  "spike",
  "shell",
  "eye",
  "teeth",
  "claw",
  "mouth",
  "fin",
];

export function getOrganDef(type){
  if (!type) return null;
  return ORGAN_DEFS[type] || null;
}

export function organLabel(type){
  const def = getOrganDef(type);
  return def?.label || type || "Орган";
}
