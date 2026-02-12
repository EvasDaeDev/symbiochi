import { nowSec } from "./util.js";
import { MAX_LOG } from "./world.js";

// Separate screen/debug log (requested): keeps more lines and is rendered in a left panel.
export const MAX_DEBUG_LOG = 1000;

/**
 * pushLog(stateOrOrg, msg, kind?, meta?)
 *
 * If called with a bud organism, we route the entry into the root state's log
 * when temporary fields are present:
 *  - org.__logRoot : root state
 *  - org.__orgTag  : -1 for parent, 0.. for bud index
 *
 * meta is optional and may include:
 *  - part: string (e.g. "tail", "claw")
 *  - mi: number (module index inside org.modules)
 *  - org: number (-1 parent, 0.. bud index)
 */
export function pushLog(state, msg, kind = "event", meta = null){
  const root = (state && state.__logRoot) ? state.__logRoot : state;
  if (!root) return;

  root.log = root.log || [];

  const orgName = (state && state.name) ? state.name : "Организм";
  const prefixedMsg = (typeof msg === "string" && !msg.startsWith(`[${orgName}]`))
    ? `[${orgName}] ${msg}`
    : msg;

  const orgTag =
    (meta && Number.isFinite(meta.org)) ? meta.org :
    (state && Number.isFinite(state.__orgTag)) ? state.__orgTag :
    -1;

  const entry = { t: nowSec(), kind, msg: prefixedMsg };

  if (meta || Number.isFinite(orgTag)){
    entry.meta = Object.assign({}, meta || {});
    if (!Number.isFinite(entry.meta.org)) entry.meta.org = orgTag;
  }

  root.log.push(entry);

  if (root.log.length > MAX_LOG){
    root.log.splice(0, root.log.length - MAX_LOG);
  }

  // Mirror into an extended debug log (1000 lines) when present.
  // This log is intended for *everything happening on screen*, including reasons of failures.
  // Stored on the root state so parent + buds share one stream.
  if (!root.debugLog) root.debugLog = [];
  root.debugLog.push({ t: entry.t, kind: entry.kind, msg: entry.msg });
  if (root.debugLog.length > MAX_DEBUG_LOG){
    root.debugLog.splice(0, root.debugLog.length - MAX_DEBUG_LOG);
  }
}
