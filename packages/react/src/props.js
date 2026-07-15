// Split React props into where they belong on <whats-my-model>: scalar workload
// props become HTML attributes; provider/workload objects go through the element's
// configure() method (they can't ride on attributes); onSelect bridges the
// wmm-select event; everything else (className, style, id, …) passes through.
const ATTR = {
  task: "task",
  preference: "preference",
  targetContext: "target-context",
  cacheType: "cache-type",
};
const CONFIG_KEYS = ["hardwareProvider", "catalogProvider", "workload"];

export function splitProps(props = {}) {
  const attrs = {};
  const config = {};
  const rest = {};
  let onSelect;
  for (const [k, v] of Object.entries(props)) {
    if (k === "onSelect") onSelect = v;
    else if (k in ATTR) {
      if (v != null) attrs[ATTR[k]] = String(v);
    } else if (CONFIG_KEYS.includes(k)) {
      if (v != null) config[k] = v;
    } else {
      rest[k] = v;
    }
  }
  return { attrs, config, onSelect, rest };
}
