// The static snapshot as a catalog provider — real Hugging Face data baked in at
// build time (see scripts/build-catalog.mjs), so a host can render instantly with
// no network and fall back to the live provider for anything not in it.
import { SNAPSHOT, GENERATED_AT } from "./snapshot-data.js";

export { SNAPSHOT, GENERATED_AT };

export function snapshotCatalogProvider() {
  return { list: async () => SNAPSHOT.slice() };
}
