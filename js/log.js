import { MAX_LOG, nowSec } from "./util.js";

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

  const orgTag =
    (meta && Number.isFinite(meta.org)) ? meta.org :
    (state && Number.isFinite(state.__orgTag)) ? state.__orgTag :
    -1;

  const entry = { t: nowSec(), kind, msg };

  if (meta || Number.isFinite(orgTag)){
    entry.meta = Object.assign({}, meta || {});
    if (!Number.isFinite(entry.meta.org)) entry.meta.org = orgTag;
  }

  root.log.push(entry);

  if (root.log.length > MAX_LOG){
    root.log.splice(0, root.log.length - MAX_LOG);
  }
}
