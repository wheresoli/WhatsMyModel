// Wrap any catalog provider with a TTL cache. In the browser the default store is
// IndexedDB, so repeat loads — and page reloads — are instant instead of re-hitting
// the network. Where IndexedDB is unavailable (Node, or if you pass `store: null`)
// it degrades to a straight pass-through. Inject `store`/`now` for tests.
const DAY_MS = 24 * 60 * 60 * 1000;
const clone = (data) => structuredClone(data);

export function cachedCatalogProvider(inner, opts = {}) {
  const { key = "wmm:catalog", ttlMs = DAY_MS, now = () => Date.now() } = opts;
  const store = opts.store !== undefined ? opts.store : defaultStore();
  return {
    async list() {
      let stale = null; // an expired-but-usable entry, kept as an offline fallback
      if (store) {
        try {
          const hit = await store.get(key);
          if (hit && Array.isArray(hit.data)) {
            if (now() - hit.at < ttlMs) return clone(hit.data); // fresh — copy so callers can't mutate the cache
            stale = hit.data;
          }
        } catch {
          /* cache read failed — fall through to the live provider */
        }
      }
      let data;
      try {
        data = await inner.list();
      } catch (e) {
        if (stale) return clone(stale); // live fetch failed but we have data — better stale than an error
        throw e;
      }
      if (store) {
        try {
          await store.set(key, { at: now(), data: clone(data) }); // store a copy so a caller mutating the result can't corrupt the cache
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
      req.onupgradeneeded = () => {
        // Idempotent: a future version bump (or a DB shared with other code) must
        // not throw ConstraintError by re-creating an existing store.
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
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
