// The static snapshot as a catalog provider — real Hugging Face data baked in at
// build time (see scripts/build-catalog.mjs), so a host can render instantly with
// no network and fall back to the live provider for anything not in it.
import { SNAPSHOT, GENERATED_AT } from "./snapshot-data.js";

export { SNAPSHOT, GENERATED_AT };

export function snapshotCatalogProvider() {
  // Deep-clone per call so a caller mutating a variant can't corrupt the module-level
  // SNAPSHOT. Qualify globalThis.structuredClone (a bare `structuredClone` can throw
  // ReferenceError where it's only present as a global property); JSON is the fallback.
  return {
    list: async () =>
      typeof globalThis.structuredClone === "function"
        ? globalThis.structuredClone(SNAPSHOT)
        : JSON.parse(JSON.stringify(SNAPSHOT)),
  };
}
