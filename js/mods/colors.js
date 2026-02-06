// mods/colors.js
// Базовые цвета частей (легко менять).

import { ANTENNA } from "../organs/antenna.js";
import { CLAW } from "../organs/claw.js";
import { EYE } from "../organs/eye.js";
import { FIN } from "../organs/fin.js";
import { LIMB } from "../organs/limb.js";
import { MOUTH } from "../organs/mouth.js";
import { SHELL } from "../organs/shell.js";
import { SPIKE } from "../organs/spike.js";
import { TAIL } from "../organs/tail.js";
import { TEETH } from "../organs/teeth.js";
import { TENTACLE } from "../organs/tentacle.js";
import { WORM } from "../organs/worm.js";

export const ORGAN_COLORS = {
  antenna:  ANTENNA.initialColor,
  tentacle: TENTACLE.initialColor,
  tail:     TAIL.initialColor,
  worm:     WORM.initialColor,
  limb:     LIMB.initialColor,
  spike:    SPIKE.initialColor,
  shell:    SHELL.initialColor,
  eye:      EYE.initialColor,
  teeth:    TEETH.initialColor,
  claw:     CLAW.initialColor,
  mouth:    MOUTH.initialColor,
  fin:      FIN.initialColor
};
