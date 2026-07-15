// The static snapshot as a catalog provider — real Hugging Face data baked in at
// build time (see scripts/build-catalog.mjs), so a host can render instantly with
// no network and fall back to the live provider for anything not in it.
import { SNAPSHOT, GENERATED_AT } from "./snapshot-data.js";

export { SNAPSHOT, GENERATED_AT };

export function snapshotCatalogProvider() {
  // Deep-clone: .slice() would only copy the array, leaving the variant objects
  // (and their modalities/source) shared, so a caller mutating a result would
  // corrupt the module-level SNAPSHOT for every later call. The live provider
  // builds fresh objects each call; match that. The data is plain JSON.
  return { list: async () => JSON.parse(JSON.stringify(SNAPSHOT)) };
}
