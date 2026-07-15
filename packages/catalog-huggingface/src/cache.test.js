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
