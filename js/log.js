import { MAX_LOG, nowSec } from "./util.js";

export function pushLog(state, msg, kind="event"){
  state.log = state.log || [];
  state.log.push({ t: nowSec(), kind, msg });
  if (state.log.length > MAX_LOG) {
    state.log.splice(0, state.log.length - MAX_LOG);
  }
}
