import test from "node:test";
import assert from "node:assert/strict";
import { kvCacheBytes, estimateFit, DEFAULT_CONTEXT } from "./memory.js";

const GB = 1024 * 1024 * 1024;

test("kvCacheBytes scales linearly with context", () => {
  const at4k = kvCacheBytes({ params: 7, contextLength: 4096 });
  const at8k = kvCacheBytes({ params: 7, contextLength: 8192 });
  assert.equal(at8k, at4k * 2);
});

test("kvCacheBytes: ~0.5 GB for a 7B (GQA-8/128) at 4K, fp16", () => {
  // 2 * 32 layers * 8 kvHeads * 128 headDim * 2 bytes * 4096 ctx
  assert.equal(kvCacheBytes({ params: 7, contextLength: 4096 }), 536870912);
});

test("kvCacheBytes is 0 when params/arch unknown", () => {
  assert.equal(kvCacheBytes({ contextLength: 4096 }), 0);
});

test("estimateFit: a 7B Q4_K_M fits at 32K but not at 128K on 16 GB VRAM", () => {
  const res = { gpu: { total: 16 * GB } };
  const model = { sizeBytes: 4.7 * GB, params: 7 };
  assert.equal(estimateFit({ ...model, contextLength: 32768 }, res).tier, "ok");
  assert.equal(estimateFit({ ...model, contextLength: 131072 }, res).tier, "over");
});

test("estimateFit: KV cache is the dominant term at long context", () => {
  const res = { gpu: { total: 24 * GB } };
  const fit = estimateFit({ sizeBytes: 4.7 * GB, params: 7, contextLength: 131072 }, res);
  assert.ok(fit.breakdown.kv > fit.breakdown.weights, "KV should exceed weights at 128K");
});

test("estimateFit: unknown when size or resources are missing", () => {
  assert.equal(estimateFit({ sizeBytes: 0, params: 7 }, { gpu: { total: 16 * GB } }).tier, "unknown");
  assert.equal(estimateFit({ sizeBytes: 4 * GB, params: 7 }, null).tier, "unknown");
  assert.equal(estimateFit({ sizeBytes: 4 * GB, params: 7 }, { gpu: null, ram: null }).tier, "unknown");
});

test("estimateFit: defaults context and reports it", () => {
  const fit = estimateFit({ sizeBytes: 2 * GB, params: 3 }, { gpu: { total: 16 * GB } });
  assert.equal(fit.contextLength, DEFAULT_CONTEXT);
  assert.equal(fit.tier, "ok");
});

test("estimateFit: a multimodal projector sidecar adds to the footprint", () => {
  const res = { gpu: { total: 12 * GB } };
  const base = { sizeBytes: 6.5 * GB, params: 7, contextLength: 4096 };
  assert.equal(estimateFit(base, res).tier, "ok"); // ~7.8 GB < 9.6
  const withProj = estimateFit({ ...base, sidecarBytes: 3 * GB }, res);
  assert.equal(withProj.tier, "tight"); // ~10.8 GB in (9.6, 12]
  assert.equal(withProj.breakdown.sidecar, 3 * GB);
});
