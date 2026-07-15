// Context-aware footprint estimation. classifyModel() uses a flat weights×1.2
// overhead — fine as a quick guard, but the KV cache grows linearly with context
// and dominates at long context (a 7B that fits at 32K can blow past VRAM at
// 128K). estimateFit models weights + KV + compute + margin so the recommender
// can say "32K fits, 128K doesn't". Pure, no DOM/network.
import { TIGHT_FRACTION } from "./modelViability.js";

export const DEFAULT_CONTEXT = 4096;

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

// Rough dense-transformer arch from parameter count (billions), assuming modern
// GQA (8 KV heads, 128 head dim — the common Llama-3/Qwen-2.5 shape). Only used
// when explicit arch is absent; deliberately approximate. Non-GQA / MoE models
// will differ, so callers with real GGUF metadata should pass `arch`.
function approxArch(paramsB) {
  const p = Number(paramsB);
  if (!p || p <= 0) return null;
  const nLayers = p <= 2 ? 24 : p <= 4 ? 28 : p <= 9 ? 32 : p <= 16 ? 40 : p <= 35 ? 60 : p <= 50 ? 64 : 80;
  return { nLayers, nKvHeads: 8, headDim: 128 };
}

// KV cache bytes = 2 (K+V) × layers × kvHeads × headDim × bytesPerElem × context ×
// sequences. Returns 0 when params/arch are unknown (caller then relies on the
// weights + buffers terms only).
export function kvCacheBytes({ params, contextLength = DEFAULT_CONTEXT, sequences = 1, cacheBits = 16, arch } = {}) {
  const a = arch || approxArch(params);
  if (!a) return 0;
  const bytesPerElem = cacheBits / 8;
  return 2 * a.nLayers * a.nKvHeads * a.headDim * bytesPerElem * contextLength * Math.max(1, sequences);
}

// Estimate whether `model` fits `resources`, accounting for context. `model`:
//   { sizeBytes, params?, contextLength?, sequences?, cacheBits?, arch? }
// where contextLength is the TARGET context to size the KV cache for (resolve it
// against the model's max before calling). Returns the same shape as
// classifyModel (tier/sizeBytes/need/ceiling/target) plus a `breakdown`.
export function estimateFit(model, resources) {
  const sizeBytes = Number(model?.sizeBytes);
  if (!sizeBytes || sizeBytes <= 0) return { tier: "unknown", sizeBytes: null };
  const gpu = resources?.gpu;
  const usingGpu = Boolean(gpu && gpu.total);
  const ceiling = usingGpu ? gpu.total : resources?.ram?.total;
  const target = usingGpu ? "VRAM" : "RAM";
  if (!ceiling) return { tier: "unknown", sizeBytes, target };

  const contextLength = model.contextLength ?? DEFAULT_CONTEXT;
  const kv = kvCacheBytes({
    params: model.params,
    contextLength,
    sequences: model.sequences,
    cacheBits: model.cacheBits,
    arch: model.arch,
  });
  // Activation/compute buffers scale loosely with model size; bounded.
  const compute = Math.min(GB, Math.max(128 * MB, sizeBytes * 0.05));
  // Headroom for the OS/display compositor sharing the device.
  const margin = 512 * MB;
  const need = sizeBytes + kv + compute + margin;

  let tier;
  if (need > ceiling) tier = "over";
  else if (need > ceiling * TIGHT_FRACTION) tier = "tight";
  else tier = "ok";
  return {
    tier,
    sizeBytes,
    need,
    ceiling,
    target,
    contextLength,
    breakdown: { weights: sizeBytes, kv, compute, margin },
  };
}
