// Wrap any catalog provider with a TTL cache. In the browser the default store is
// IndexedDB, so repeat loads — and page reloads — are instant instead of re-hitting
// the network. Where IndexedDB is unavailable (Node, or if you pass `store: null`)
// it degrades to a straight pass-through. Inject `store`/`now` for tests.
const DAY_MS = 24 * 60 * 60 * 1000;

export function cachedCatalogProvider(inner, opts = {}) {
  const { key = "wmm:catalog", ttlMs = DAY_MS, now = () => Date.now() } = opts;
  const store = opts.store !== undefined ? opts.store : defaultStore();
  return {
    async list() {
      if (store) {
        try {
          const hit = await store.get(key);
          if (hit && Array.isArray(hit.data) && now() - hit.at < ttlMs) return hit.data;
        } catch {
          /* cache read failed — fall through to the live provider */
        }
      }
      const data = await inner.list();
      if (store) {
        try {
          await store.set(key, { at: now(), data });
        } catch {
          /* cache write failure must never break the result */
        }
      }
      return data;
    },
  };
}

function defaultStore() {
  if (typeof indexedDB === "undefined") return null; // Node / no IDB -> pass-through
  return indexedDbStore("whats-my-model", "catalog");
}

// Minimal promise-wrapped IndexedDB key/value store.
export function indexedDbStore(dbName, storeName) {
  const open = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(storeName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const run = async (mode, fn) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const req = fn(db.transaction(storeName, mode).objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    get: (k) => run("readonly", (s) => s.get(k)),
    set: (k, v) => run("readwrite", (s) => s.put(v, k)),
  };
}
