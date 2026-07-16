// Compose several catalog providers into one, deduping variants by id and
// tolerating per-provider failures. Earlier providers win on id collisions, so
//   hybridCatalogProvider(snapshotCatalogProvider(), huggingFaceCatalogProvider())
// serves the bundled snapshot instantly, folds in whatever live search adds, and
// still returns the snapshot if the live fetch fails (offline-resilient).
const DEFAULT_TIMEOUT_MS = 15000;

// Race a provider's list() against a timer that yields []. A hung/slow provider
// then contributes nothing after the deadline instead of stalling list() forever
// (failures are already swallowed; this bounds the pending case too).
function withTimeout(promise, ms) {
  let timer;
  const capped = new Promise((resolve) => {
    timer = setTimeout(() => resolve([]), ms);
  });
  return Promise.race([promise, capped]).finally(() => clearTimeout(timer));
}

export function hybridCatalogProvider(...providers) {
  const activeProviders = providers.filter(Boolean);
  return {
    async list() {
      const lists = await Promise.all(
        activeProviders.map((p) =>
          withTimeout(Promise.resolve().then(() => p.list()), DEFAULT_TIMEOUT_MS).catch(() => [])
        )
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
