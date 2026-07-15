import test from "node:test";
import assert from "node:assert/strict";
import { recommend, scoreVariant } from "./recommend.js";
import { SEED_CATALOG } from "./catalog-v1.js";

const GB = 1024 * 1024 * 1024;
const gpu16 = { gpu: { name: "RTX 4090 Laptop", total: 16 * GB }, ram: { total: 32 * GB } };
const gpu8 = { gpu: { name: "RTX 4060", total: 8 * GB }, ram: { total: 16 * GB } };

test("recommend: on 16 GB every recommended variant actually fits", () => {
  const { families } = recommend({ resources: gpu16, workload: { task: "code" } });
  assert.ok(families.length > 0);
  for (const f of families) {
    assert.ok(["ok", "tight"].includes(f.recommended.viability.tier), `${f.family} recommended must fit`);
  }
});

test("recommend: the 32B models are flagged won't-fit on 16 GB (the freeze guard)", () => {
  const { wontFit } = recommend({ resources: gpu16, workload: { task: "code" } });
  const ids = wontFit.map((v) => v.id);
  assert.ok(ids.includes("qwen25-coder-32b-q4km"), "32B Q4_K_M overflows 16 GB");
  // wontFit is smallest-first: the cheapest upgrade target comes first.
  for (let i = 1; i < wontFit.length; i++) {
    assert.ok(wontFit[i].sizeBytes >= wontFit[i - 1].sizeBytes);
  }
});

test("recommend: a smaller GPU fits fewer models", () => {
  const big = recommend({ resources: gpu16 }).families.flatMap((f) => [f.recommended, ...f.alternatives]);
  const small = recommend({ resources: gpu8 }).families.flatMap((f) => [f.recommended, ...f.alternatives]);
  assert.ok(small.length < big.length, "8 GB fits strictly fewer variants than 16 GB");
});

test("recommend: task preference favors matching-task families to the top", () => {
  const { families } = recommend({ resources: gpu16, workload: { task: "code" } });
  // A code family should outrank a chat family, all else close.
  const codeIdx = families.findIndex((f) => f.recommended.task === "code");
  const chatIdx = families.findIndex((f) => f.recommended.task === "chat");
  assert.ok(codeIdx !== -1 && (chatIdx === -1 || codeIdx < chatIdx));
});

test("scoreVariant: preference shifts the quality/speed tilt", () => {
  const big = SEED_CATALOG.find((v) => v.id === "qwen25-coder-14b-q4km");
  const small = SEED_CATALOG.find((v) => v.id === "qwen25-coder-7b-q4km");
  const q = (v, pref) => scoreVariant(v, gpu16, { task: "code", preference: pref });
  // highest-quality should rank the 14B above the 7B; fastest should flip it.
  assert.ok(q(big, "highest-quality").total > q(small, "highest-quality").total);
  assert.ok(q(small, "fastest").total > q(big, "fastest").total);
});

test("recommend: no resources -> nothing recommended, everything is unknown (not over)", () => {
  const { families, wontFit } = recommend({ resources: null, workload: { task: "code" } });
  assert.equal(families.length, 0);
  assert.equal(wontFit.length, 0); // unknown != over; we don't claim it won't fit
});

test("recommend: within a family, balanced picks a mid quant; prefs push to the ends", () => {
  const mk = (quant, gb) => ({ id: "x-" + quant, family: "Fam", name: "Fam", task: "code", params: 7, quant, sizeBytes: gb * GB });
  const catalog = [mk("Q2_K", 2.8), mk("Q4_K_M", 4.7), mk("Q6_K", 6.3), mk("Q8_0", 8.1)];
  const res = { gpu: { total: 16 * GB } };
  const pick = (preference) =>
    recommend({ resources: res, workload: { task: "code", preference }, catalog }).families[0].recommended.quant;
  assert.ok(["Q4_K_M", "Q6_K"].includes(pick("balanced")), "balanced avoids the Q2_K / Q8_0 extremes");
  assert.equal(pick("highest-quality"), "Q8_0");
  assert.equal(pick("fastest"), "Q2_K");
});

test("recommend: raising target context shrinks what fits (KV cache grows)", () => {
  const res = { gpu: { total: 16 * GB } };
  const count = (ctx) => {
    const r = recommend({ resources: res, workload: { task: "code", targetContext: ctx } });
    return r.families.reduce((n, f) => n + 1 + f.alternatives.length, 0);
  };
  assert.ok(count(131072) < count(4096), "128K context fits fewer variants than 4K");
});
