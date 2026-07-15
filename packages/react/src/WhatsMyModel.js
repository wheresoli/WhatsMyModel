import { createElement, useRef, useEffect } from "react";
import "@whats-my-model/widget"; // registers the <whats-my-model> custom element
import { splitProps } from "./props.js";

// <WhatsMyModel task="code" preference="balanced" targetContext={32768}
//   hardwareProvider={hp} catalogProvider={cp} onSelect={(variant) => ...} />
// A static `catalog` array works too (in place of catalogProvider).
//
// Note: memoize the provider/workload/catalog props (useMemo) — a new object
// identity each render re-runs configure() (and thus hardware detection / catalog load).
export function WhatsMyModel(props) {
  const ref = useRef(null);
  const { attrs, config, onSelect, rest } = splitProps(props);

  useEffect(() => {
    if (ref.current && Object.keys(config).length) ref.current.configure(config);
  }, [config.hardwareProvider, config.catalog, config.catalogProvider, config.workload]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !onSelect) return undefined;
    const handler = (e) => onSelect(e.detail.variant, e);
    el.addEventListener("wmm-select", handler);
    return () => el.removeEventListener("wmm-select", handler);
  }, [onSelect]);

  return createElement("whats-my-model", { ref, ...attrs, ...rest });
}
