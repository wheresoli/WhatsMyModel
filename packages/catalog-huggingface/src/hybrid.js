// Compose several catalog providers into one, deduping variants by id and
// tolerating per-provider failures. Earlier providers win on id collisions, so
//   hybridCatalogProvider(snapshotCatalogProvider(), huggingFaceCatalogProvider())
// serves the bundled snapshot instantly, folds in whatever live search adds, and
// still returns the snapshot if the live fetch fails (offline-resilient).
export function hybridCatalogProvider(...providers) {
  const list_ = providers.filter(Boolean);
  return {
    async list() {
      const lists = await Promise.all(
        list_.map((p) => Promise.resolve().then(() => p.list()).catch(() => []))
      );
      const byId = new Map();
      for (const l of lists) {
        for (const v of Array.isArray(l) ? l : []) {
          if (v && v.id != null && !byId.has(v.id)) byId.set(v.id, v);
        }
      }
      return [...byId.values()];
    },
  };
}
