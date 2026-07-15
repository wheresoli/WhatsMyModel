import test from "node:test";
import assert from "node:assert/strict";
import { classifyModel, formatBytes, pressureTier, viabilityLabel } from "./modelViability.js";

const GB = 1024 * 1024 * 1024;
const gpu16 = { gpu: { name: "RTX 4090 Laptop", total: 16 * GB, used: 0.1 * GB, free: 15.9 * GB } };

test("formatBytes renders GB and MB sensibly", () => {
  assert.match(formatBytes(13.55 * GB), /^13\.\d GB$/); // keeps a decimal near the ceiling
  assert.equal(formatBytes(16 * GB), "16 GB"); // bare .0 dropped
  assert.equal(formatBytes(1.7 * GB), "1.7 GB");
  assert.equal(formatBytes(360 * 1024 * 1024), "360 MB");
  assert.equal(formatBytes(0), "0"); // exact zero reads "0", not "1 MB" (idle meter)
  assert.equal(formatBytes(1024), "1 MB"); // small nonzero still floors to 1 MB
  assert.equal(formatBytes(null), "—");
});

test("classifyModel: a small model fits (ok) on a 16 GB GPU", () => {
  const v = classifyModel(1.7 * GB, gpu16);
  assert.equal(v.tier, "ok");
  assert.equal(v.target, "VRAM");
});

test("classifyModel: a model near the ceiling is tight", () => {
  // 11 GB * 1.2 = 13.2 GB -> >80% of 16 but <=16 -> tight
  assert.equal(classifyModel(11 * GB, gpu16).tier, "tight");
});

test("classifyModel: a model over the ceiling is over (the freeze case)", () => {
  // Devstral 13.55 GB * 1.2 = 16.26 GB > 16 GB VRAM -> over
  assert.equal(classifyModel(13.55 * GB, gpu16).tier, "over");
  // Qwen3-Coder-30B 16.45 GB is clearly over.
  assert.equal(classifyModel(16.45 * GB, gpu16).tier, "over");
});

test("classifyModel: falls back to RAM when no GPU is present", () => {
  const ramOnly = { gpu: null, ram: { total: 32 * GB, available: 20 * GB, used: 12 * GB } };
  const v = classifyModel(13.55 * GB, ramOnly);
  assert.equal(v.target, "RAM");
  assert.equal(v.tier, "ok"); // 16.26 GB well under 32 GB
});

test("classifyModel: unknown when size or resources are missing", () => {
  assert.equal(classifyModel(null, gpu16).tier, "unknown");
  assert.equal(classifyModel(5 * GB, null).tier, "unknown");
  assert.equal(classifyModel(5 * GB, { gpu: null, ram: null }).tier, "unknown");
});

test("viabilityLabel describes tight/over with the numbers", () => {
  assert.equal(viabilityLabel(classifyModel(1.7 * GB, gpu16)), "1.7 GB");
  const over = viabilityLabel(classifyModel(13.55 * GB, gpu16));
  assert.match(over, /exceeds VRAM/);
});

test("pressureTier maps live usage to colour bands", () => {
  assert.equal(pressureTier(1 * GB, 16 * GB), "ok");
  assert.equal(pressureTier(14 * GB, 16 * GB), "tight");
  assert.equal(pressureTier(15.8 * GB, 16 * GB), "over");
  assert.equal(pressureTier(null, 16 * GB), "unknown");
});
