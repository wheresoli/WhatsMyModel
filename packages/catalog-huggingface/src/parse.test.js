import test from "node:test";
import assert from "node:assert/strict";
import { parseQuant, parseParams, inferTask, cleanFamily, isShard, shardBase, buildVariants } from "./parse.js";

// Real filenames sampled from Qwen/Qwen2.5-Coder-7B-Instruct-GGUF.
const FILES = [
  { path: "qwen2.5-coder-7b-instruct-fp16-00001-of-00004.gguf", size: 3951521376 },
  { path: "qwen2.5-coder-7b-instruct-fp16.gguf", size: 15237853184 },
  { path: "qwen2.5-coder-7b-instruct-q2_k.gguf", size: 3015940032 },
  { path: "qwen2.5-coder-7b-instruct-q3_k_m.gguf", size: 3808391104 },
  { path: "qwen2.5-coder-7b-instruct-q4_k_m-00001-of-00002.gguf", size: 3993201376 },
  { path: "qwen2.5-coder-7b-instruct-q4_k_m-00002-of-00002.gguf", size: 689872288 },
  { path: "qwen2.5-coder-7b-instruct-q4_k_m.gguf", size: 4683073536 },
];

test("parseQuant reads the trailing quant token", () => {
  assert.equal(parseQuant("qwen2.5-coder-7b-instruct-q4_k_m.gguf"), "Q4_K_M");
  assert.equal(parseQuant("model-q2_k.gguf"), "Q2_K");
  assert.equal(parseQuant("model-q4_k_m-00001-of-00002.gguf"), "Q4_K_M");
  assert.equal(parseQuant("model-fp16.gguf"), "FP16");
  assert.equal(parseQuant("plain.gguf"), null);
});

test("shard detection and base grouping", () => {
  assert.equal(isShard("model-q4_k_m-00001-of-00002.gguf"), true);
  assert.equal(isShard("model-q4_k_m.gguf"), false);
  assert.equal(shardBase("model-q4_k_m-00001-of-00002.gguf"), "model-q4_k_m.gguf");
});

test("parseParams pulls billions, ignoring '4bit'", () => {
  assert.equal(parseParams("Qwen2.5-Coder-7B-Instruct-GGUF"), 7);
  assert.equal(parseParams("Llama-3.2-3B"), 3);
  assert.equal(parseParams("something-4bit"), null);
  assert.equal(parseParams("no-size-here"), null);
});

test("inferTask / cleanFamily", () => {
  assert.equal(inferTask("Qwen/Qwen2.5-Coder-7B-Instruct-GGUF"), "code");
  assert.equal(inferTask("bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF"), "reasoning");
  assert.equal(inferTask("meta/Llama-3.1-8B-Instruct-GGUF"), "chat");
  assert.equal(cleanFamily("Qwen/Qwen2.5-Coder-7B-Instruct-GGUF"), "Qwen2.5-Coder-7B-Instruct");
});

test("buildVariants dedupes single-vs-sharded, drops full precision, infers meta", () => {
  const vs = buildVariants("Qwen/Qwen2.5-Coder-7B-Instruct-GGUF", FILES);
  const quants = vs.map((v) => v.quant).sort();
  assert.deepEqual(quants, ["Q2_K", "Q3_K_M", "Q4_K_M"]); // fp16 dropped
  const q4 = vs.find((v) => v.quant === "Q4_K_M");
  // single file (4.68 GB), NOT single + shard-sum (~9.4 GB)
  assert.equal(q4.sizeBytes, 4683073536);
  assert.equal(q4.params, 7);
  assert.equal(q4.task, "code");
  assert.equal(q4.family, "Qwen2.5-Coder-7B-Instruct");
  assert.deepEqual(q4.modalities, ["text"]); // no projector -> text only
  assert.equal(q4.sidecarBytes, undefined);
});

test("mmproj is a sidecar (not a variant) and marks the repo multimodal", () => {
  const files = [
    { path: "llava-v1.6-vicuna-7b-q4_k_m.gguf", size: 4100000000 },
    { path: "llava-v1.6-vicuna-7b-q8_0.gguf", size: 7200000000 },
    { path: "mmproj-model-f16.gguf", size: 624000000 },
  ];
  const vs = buildVariants("cjpais/llava-v1.6-vicuna-7b-gguf", files);
  assert.deepEqual(vs.map((v) => v.quant).sort(), ["Q4_K_M", "Q8_0"]); // mmproj excluded as a variant
  for (const v of vs) {
    assert.deepEqual(v.modalities, ["text", "image"]);
    assert.equal(v.sidecarBytes, 624000000);
  }
});

test("incomplete shard sets are skipped (won't load)", () => {
  const files = [
    { path: "big-q4_k_m-00001-of-00003.gguf", size: 1000 },
    { path: "big-q4_k_m-00002-of-00003.gguf", size: 1000 }, // 00003 missing
  ];
  assert.equal(buildVariants("owner/big-GGUF", files).length, 0);
});

test("duplicate shard indices don't satisfy the count (missing index still caught)", () => {
  const files = [
    { path: "big-q4_k_m-00001-of-00003.gguf", size: 1000 },
    { path: "big-q4_k_m-00001-of-00003.gguf", size: 1000 }, // dup of 1, 2 and 3 missing
    { path: "big-q4_k_m-00003-of-00003.gguf", size: 1000 },
  ];
  assert.equal(buildVariants("owner/big-GGUF", files).length, 0);
});

test("a mix of shard sets with different totals (same base) is rejected", () => {
  const files = [
    { path: "big-q4_k_m-00001-of-00002.gguf", size: 1000 },
    { path: "big-q4_k_m-00002-of-00002.gguf", size: 1000 }, // complete -of-00002 set...
    { path: "big-q4_k_m-00003-of-00003.gguf", size: 1000 }, // ...contaminated by a stray -of-00003
  ];
  assert.equal(buildVariants("owner/big-GGUF", files).length, 0);
});

test("a complete, consistent shard set is accepted (sizes summed)", () => {
  const files = [
    { path: "big-q4_k_m-00001-of-00002.gguf", size: 1000 },
    { path: "big-q4_k_m-00002-of-00002.gguf", size: 500 },
  ];
  const vs = buildVariants("owner/big-GGUF", files);
  assert.equal(vs.length, 1);
  assert.equal(vs[0].sizeBytes, 1500);
});

test("a full 1..N set plus a duplicate is rejected (no inflated size)", () => {
  // The whole set is present, but a duplicate would double-count in the size sum.
  const files = [
    { path: "big-q4_k_m-00001-of-00002.gguf", size: 1000 },
    { path: "big-q4_k_m-00002-of-00002.gguf", size: 1000 },
    { path: "big-q4_k_m-00002-of-00002.gguf", size: 1000 }, // duplicate of shard 2
  ];
  assert.equal(buildVariants("owner/big-GGUF", files).length, 0);
});
