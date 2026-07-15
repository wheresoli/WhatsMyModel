import test from "node:test";
import assert from "node:assert/strict";
import { hybridCatalogProvider } from "./hybrid.js";

const P = (arr, opts = {}) => ({
  list: async () => {
    if (opts.throw) throw new Error("boom");
    return arr;
  },
});

test("hybrid merges providers, dedupes by id, earlier provider wins", async () => {
  const a = P([{ id: "x", src: "a" }, { id: "y" }]);
  const b = P([{ id: "x", src: "b" }, { id: "z" }]);
  const list = await hybridCatalogProvider(a, b).list();
  assert.deepEqual(list.map((v) => v.id).sort(), ["x", "y", "z"]);
  assert.equal(list.find((v) => v.id === "x").src, "a");
});

test("hybrid tolerates a failing provider (offline-resilient)", async () => {
  const list = await hybridCatalogProvider(P(null, { throw: true }), P([{ id: "x" }])).list();
  assert.deepEqual(list.map((v) => v.id), ["x"]);
});

test("hybrid ignores falsy providers", async () => {
  const list = await hybridCatalogProvider(null, P([{ id: "x" }]), undefined).list();
  assert.equal(list.length, 1);
});
