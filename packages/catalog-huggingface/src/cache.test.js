import test from "node:test";
import assert from "node:assert/strict";
import { cachedCatalogProvider } from "./cache.js";

const fakeStore = () => {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v) };
};

test("cache: first call misses (hits inner), second call is served from cache", async () => {
  let calls = 0;
  const inner = { list: async () => (calls++, [{ id: "x" }]) };
  const p = cachedCatalogProvider(inner, { store: fakeStore(), ttlMs: 100, now: () => 1000 });
  assert.deepEqual((await p.list()).map((v) => v.id), ["x"]);
  await p.list();
  assert.equal(calls, 1);
});

test("cache: callers cannot mutate nested cached data", async () => {
  const inner = { list: async () => [{ id: "x", modalities: ["text"], source: { provider: "huggingface" } }] };
  const p = cachedCatalogProvider(inner, { store: fakeStore() });
  const first = await p.list();
  first[0].modalities.push("image");
  first[0].source.provider = "changed";

  assert.deepEqual(await p.list(), [{ id: "x", modalities: ["text"], source: { provider: "huggingface" } }]);
});

test("cache: refetches after the TTL expires", async () => {
  let calls = 0;
  const inner = { list: async () => (calls++, [{ id: "x" }]) };
  let t = 0;
  const p = cachedCatalogProvider(inner, { store: fakeStore(), ttlMs: 100, now: () => t });
  await p.list(); // t=0, miss
  t = 50;
  await p.list(); // hit
  assert.equal(calls, 1);
  t = 200;
  await p.list(); // expired -> refetch
  assert.equal(calls, 2);
});

test("cache: no store -> pass-through, never throws", async () => {
  let calls = 0;
  const inner = { list: async () => (calls++, [{ id: "x" }]) };
  const p = cachedCatalogProvider(inner, { store: null });
  await p.list();
  await p.list();
  assert.equal(calls, 2);
});

test("cache: default store (opts.store omitted) is pass-through in Node", async () => {
  let calls = 0;
  const inner = { list: async () => (calls++, [{ id: "x" }]) };
  const p = cachedCatalogProvider(inner); // defaultStore() is null where IndexedDB is unavailable
  assert.deepEqual((await p.list()).map((v) => v.id), ["x"]);
  await p.list();
  assert.equal(calls, 2);
});

test("cache: serves stale data when the live refetch fails", async () => {
  let calls = 0;
  const inner = {
    list: async () => {
      calls++;
      if (calls > 1) throw new Error("offline");
      return [{ id: "x" }];
    },
  };
  let t = 0;
  const p = cachedCatalogProvider(inner, { store: fakeStore(), ttlMs: 100, now: () => t });
  await p.list(); // t=0 -> populate
  t = 500; // past TTL
  const out = await p.list(); // expired -> live throws -> fall back to stale
  assert.deepEqual(out.map((v) => v.id), ["x"]);
  assert.equal(calls, 2);
});
