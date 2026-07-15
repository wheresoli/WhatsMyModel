// Turn a hardware profile + a workload + a catalog into ranked family cards.
// Pure: no DOM, no network. Hard-gates on fit first (a model that won't fit is
// never "recommended"), then scores survivors on explainable components so the
// ranking never becomes an opaque pile of constants.
import { classifyModel } from "./modelViability.js";
import { SEED_CATALOG } from "./catalog-v1.js";

const TIER_SCORE = { ok: 1, tight: 0.65, over: 0, unknown: 0.3 };

// Log-normalize params against a ~32B ceiling so 7B→32B is a smooth quality
// proxy, not a linear one (diminishing returns).
function qualityScore(params) {
  return Math.min(1, Math.log2((Number(params) || 1) + 1) / Math.log2(33));
}

// Score one variant against the host + workload. Returns the variant plus its
// viability classification and per-component scores (for explainability).
export function scoreVariant(variant, resources, workload = {}) {
  const viability = classifyModel(variant.sizeBytes, resources);
  const fit = TIER_SCORE[viability.tier] ?? 0;
  const quality = qualityScore(variant.params);
  const taskMatch = !workload.task || workload.task === variant.task ? 1 : 0.4;
  // The quality<->speed tradeoff IS the preference axis, so it isn't double-counted
  // against a standalone quality term: "fastest" rewards smaller models, "highest-
  // quality" rewards bigger, "balanced" leans quality only mildly.
  let pref;
  if (workload.preference === "fastest") pref = 1 - quality;
  else if (workload.preference === "highest-quality") pref = quality;
  else pref = 0.5 + (quality - 0.5) * 0.5;
  const total = 0.45 * fit + 0.2 * taskMatch + 0.35 * pref;
  return { ...variant, viability, scores: { fit, quality, taskMatch, pref }, total };
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
