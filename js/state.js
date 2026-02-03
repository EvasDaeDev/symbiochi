import { clamp } from "./util.js";
import { applyMutation } from "./state_mutation.js";

/* =========================
   CARROTS
========================= */
function processCarrotsTick(state){
  if (!Array.isArray(state.carrots)) return 0;

  let eaten = 0;
  const now = state.lastMutationAt;

  state.carrots = state.carrots.filter(c=>{
    if (c.until && c.until < now){
      eaten++;
      state.food = clamp((state.food||0) + 12, 0, 140);
      return false;
    }
    return true;
  });

  return eaten;
}

/* =========================
   SIMULATION
========================= */
export function simulate(state, deltaSec){
  const intervalSec = Math.max(60, Math.floor(Number(state.evoIntervalMin || 12) * 60));
  const upTo = state.lastSeen + deltaSec;

  let mutations = 0;
  let budMutations = 0;
  let eaten = 0;
  let skipped = 0;

  const dueSteps = Math.floor((upTo - state.lastMutationAt) / intervalSec);

  const MAX_OFFLINE_STEPS = 5000;
  const stepsToApply = Math.min(dueSteps, MAX_OFFLINE_STEPS);

  for (let i=0; i<stepsToApply; i++){
    state.lastMutationAt += intervalSec;
    eaten += processCarrotsTick(state);
    applyMutation(state, state.lastMutationAt);
    mutations++;
  }

  if (dueSteps > stepsToApply){
    skipped = dueSteps - stepsToApply;
    state.lastMutationAt += skipped * intervalSec;
  }

  /* ===== buds ===== */
  if (Array.isArray(state.buds)){
    for (const bud of state.buds){
      const budUpTo = (bud.lastSeen || state.lastSeen) + deltaSec;
      const budDue = Math.floor((budUpTo - (bud.lastMutationAt || state.lastMutationAt)) / intervalSec);
      const budApply = Math.min(Math.max(0, budDue), MAX_OFFLINE_STEPS);

      for (let k=0; k<budApply; k++){
        bud.lastMutationAt = (bud.lastMutationAt || state.lastMutationAt) + intervalSec;
        applyMutation(bud, bud.lastMutationAt);
        budMutations++;
      }

      if (budDue > budApply){
        bud.lastMutationAt = (bud.lastMutationAt || state.lastMutationAt) + (budDue - budApply) * intervalSec;
      }

      bud.lastSeen = budUpTo;
    }
  }

  state.lastSeen = upTo;

  return { deltaSec, mutations, budMutations, eaten, skipped, dueSteps };
}
