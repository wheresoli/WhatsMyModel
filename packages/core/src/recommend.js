// Turn a hardware profile + a workload + a catalog into ranked family cards.
// Pure: no DOM, no network. Hard-gates on fit first (a model that won't fit is
// never "recommended"), then scores survivors on explainable components so the
// ranking never becomes an opaque pile of constants.
import { estimateFit, DEFAULT_CONTEXT } from "./memory.js";
import { SEED_CATALOG } from "./catalog-v1.js";

const TIER_SCORE = { ok: 1, tight: 0.65, over: 0, unknown: 0.3 };
const GB = 1024 * 1024 * 1024;

// Parameter count -> quality proxy, log-normalized against a ~32B ceiling
// (diminishing returns). Differentiates families.
function paramQuality(params) {
  return Math.min(1, Math.log2((Number(params) || 1) + 1) / Math.log2(33));
}

// Quant label -> fidelity proxy. This is what differentiates variants *within* a
// family (same params, different quant): Q4_K_M is the usual sweet spot, Q2/IQ1
// are lossy last resorts, Q6/Q8 near-lossless. Without this, all quants of a model
// tie and the smallest (worst) one wins the sort — recommending IQ1 for a 9B.
const QUANT_QUALITY = { IQ1: 0.18, IQ2: 0.32, Q2: 0.38, IQ3: 0.48, Q3: 0.56, IQ4: 0.68, Q4: 0.76, Q5: 0.86, Q6: 0.93, Q8: 0.98, FP16: 1, F16: 1, BF16: 1, F32: 1 };
function quantQuality(quant) {
  const m = String(quant || "").toUpperCase().match(/^(IQ\d|Q\d|FP16|F16|BF16|F32)/);
  return (m && QUANT_QUALITY[m[1]]) ?? 0.6;
}

// Smaller = faster, on a log scale over ~1.5 GB (fast) to ~40 GB (slow).
function speedScore(sizeBytes) {
  const gb = (Number(sizeBytes) || 0) / GB;
  const s = 1 - (Math.log2(gb + 1) - Math.log2(1.5)) / (Math.log2(41) - Math.log2(1.5));
  return Math.max(0, Math.min(1, s));
}

// Score one variant against the host + workload. Returns the variant plus its
// viability classification and per-component scores (for explainability).
export function scoreVariant(variant, resources, workload = {}) {
  // Size the KV cache for the requested context, capped at the model's own max.
  const target = workload.targetContext || DEFAULT_CONTEXT;
  const contextLength = variant.contextLength ? Math.min(target, variant.contextLength) : target;
  const viability = estimateFit(
    { sizeBytes: variant.sizeBytes, sidecarBytes: variant.sidecarBytes, params: variant.params, contextLength, sequences: workload.concurrentSequences, cacheBits: workload.cacheBits },
    resources
  );
  const fit = TIER_SCORE[viability.tier] ?? 0;
  const taskMatch = !workload.task || workload.task === variant.task ? 1 : 0.4;
  // Likely output quality blends model size and quant fidelity.
  const capability = 0.6 * paramQuality(variant.params) + 0.4 * quantQuality(variant.quant);
  const speed = speedScore(variant.sizeBytes);
  // Preference is the ranking axis for fitting variants: pure quality, pure speed,
  // or the tradeoff — which naturally settles on a mid quant (Q4_K_M/Q5_K_M).
  let pref;
  if (workload.preference === "fastest") pref = speed;
  else if (workload.preference === "highest-quality") pref = capability;
  else pref = 0.7 * capability + 0.3 * speed; // balanced leans capability; speed breaks ties
  const total = 0.3 * fit + 0.15 * taskMatch + 0.55 * pref;
  return { ...variant, viability, scores: { fit, taskMatch, capability, speed, pref }, total };
}

// Rank the catalog for this machine. Returns:
//   { families: [{ family, recommended, alternatives, score }], wontFit, resources, workload }
// `families` is sorted best-first; each card's `recommended` is the top-scoring
// variant that actually fits, `alternatives` the rest of that family (also fitting).
// `wontFit` lists over-ceiling variants smallest-first (what you'd need more VRAM for).
export function recommend({ resources, workload = {}, catalog = SEED_CATALOG } = {}) {
  const scored = catalog.map((v) => scoreVariant(v, resources, workload));
  const fits = (v) => v.viability.tier === "ok" || v.viability.tier === "tight";

  const byFamily = new Map();
  for (const v of scored.filter(fits)) {
    if (!byFamily.has(v.family)) byFamily.set(v.family, []);
    byFamily.get(v.family).push(v);
  }

  const families = [];
  for (const [family, variants] of byFamily) {
    variants.sort((a, b) => b.total - a.total);
    families.push({
      family,
      recommended: variants[0],
      alternatives: variants.slice(1),
      score: variants[0].total,
    });
  }
  families.sort((a, b) => b.score - a.score);

  const wontFit = scored
    .filter((v) => v.viability.tier === "over")
    .sort((a, b) => a.sizeBytes - b.sizeBytes);

  return { families, wontFit, resources, workload };
}
