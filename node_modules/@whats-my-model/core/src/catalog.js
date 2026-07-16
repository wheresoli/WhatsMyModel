// Accessors over the seed catalog. A CatalogProvider is anything that returns a
// variant array; the widget defaults to the bundled seed, and a later HF-snapshot
// provider can drop in here without touching the recommender.
import { SEED_CATALOG } from "./catalog-v1.js";

export { SEED_CATALOG };

export function catalogByTask(task, catalog = SEED_CATALOG) {
  if (!task) return catalog.slice();
  return catalog.filter((v) => v.task === task);
}

export function catalogFamilies(catalog = SEED_CATALOG) {
  return [...new Set(catalog.map((v) => v.family))];
}

// The default, backend-free catalog provider: the bundled seed set.
export function seedCatalogProvider() {
  return { list: async () => SEED_CATALOG.slice() };
}
