import test from "node:test";
import assert from "node:assert/strict";
import { snapshotCatalogProvider, SNAPSHOT, GENERATED_AT } from "./snapshot.js";

test("snapshot is a non-empty, well-formed variant list", () => {
  assert.ok(Array.isArray(SNAPSHOT) && SNAPSHOT.length > 0, "snapshot has entries");
  assert.equal(typeof GENERATED_AT, "string");
  for (const v of SNAPSHOT) {
    assert.equal(typeof v.id, "string");
    assert.equal(typeof v.family, "string");
    assert.equal(typeof v.quant, "string");
    assert.ok(v.sizeBytes > 0, `${v.id} has a positive size`);
    assert.ok(Array.isArray(v.modalities), `${v.id} has modalities`);
  }
});

test("snapshotCatalogProvider lists the snapshot", async () => {
  const list = await snapshotCatalogProvider().list();
  assert.equal(list.length, SNAPSHOT.length);
});

test("each list() is a deep copy — mutating a result can't corrupt the snapshot", async () => {
  const p = snapshotCatalogProvider();
  const a = await p.list();
  a[0].sizeBytes = -1;
  a[0].modalities.push("mutated");
  const b = await p.list();
  assert.notEqual(b[0].sizeBytes, -1, "sizeBytes not leaked");
  assert.equal(b[0].modalities.includes("mutated"), false, "nested array not leaked");
  assert.ok(SNAPSHOT[0].sizeBytes > 0, "module-level SNAPSHOT intact");
});
