// mods/labels.js
import { PARTS } from "./parts.js";

export function organLabel(type){
  return PARTS[type]?.label || type || "Орган";
}
