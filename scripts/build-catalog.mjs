// Generate the static catalog snapshot from Hugging Face so the widget has real,
// current data with no live fetch (live fetch stays the hybrid fallback). This is
// the script the weekly GitHub Action runs (see .github/workflows/data-refresh.yml)
// and the same one a human runs:  node scripts/build-catalog.mjs
//
// Freshness WITHOUT junk. HF's download ranking is polluted by no-name reposts
// ("Qwen3.5-…-Claude-4.6-Opus-Reasoning-Distilled", "…-Uncensored" etc.), so a raw
// popularity query thrashes the catalog week to week. Two curation layers fix that
// (the analogue of TokenTicker's curated-list + validation approach):
//   1. TRUSTED publishers only — canonical GGUF orgs re-quantize every notable
//      model within days, so tracking them stays current while excluding the memes.
//   2. Guardrails — never overwrite good data with an empty or gutted fetch.
import { writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Import the provider directly (not the package index) — the index re-exports the
// snapshot module, which would be a bootstrap cycle.
import { huggingFaceCatalogProvider } from "../packages/catalog-huggingface/src/provider.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "packages", "catalog-huggingface", "src", "snapshot-data.js");
const PREV = await import("../packages/catalog-huggingface/src/snapshot-data.js")
  .then(({ SNAPSHOT }) =>
    Array.isArray(SNAPSHOT) &&
    SNAPSHOT.every(
      (v) =>
        v &&
        typeof v.id === "string" &&
        typeof v.family === "string" &&
        typeof v.quant === "string" &&
        v.sizeBytes > 0 &&
        Array.isArray(v.modalities) &&
        typeof v.source?.repo === "string"
    )
      ? SNAPSHOT
      : []
  )
  .catch((error) => {
    console.warn(`Previous snapshot unavailable; starting empty: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  });

// ── Curation knobs — the only hand-maintained part ──────────────────────────

// Canonical GGUF publishers: model authors + the well-known quantizers. Discovery
// is restricted to these. Add a publisher here if a genuinely canonical source is
// missing; that's the one knob to turn as the ecosystem shifts.
const AUTHORS = ["qwen", "google", "meta-llama", "mistralai", "microsoft", "liquidai", "nousresearch"];
const QUANTIZERS = ["bartowski", "unsloth", "lmstudio-community", "ggml-org", "hugging-quants"];
const TRUSTED = new Set([...AUTHORS, ...QUANTIZERS, "maziyarpanahi"]);

// Priority for the size cap: official authors first, then top quantizers, then the
// rest of the trusted set. Keeps the catalog anchored on first-party + best sources.
const tierOf = (owner) => {
  const o = owner.toLowerCase();
  return AUTHORS.includes(o) ? 0 : QUANTIZERS.includes(o) ? 1 : 2;
};

// Even from a trusted publisher, skip clearly non-general variants (uncensored /
// roleplay finetunes). NOT "distill" — that would wrongly drop legit
// DeepSeek-R1-Distill-* models; the trusted filter already removes the meme distills.
const JUNK = /abliterated|uncensored|heretic|horror|nsfw|roleplay|dolphin|venice|erotic/i;

// Queries spread across BOTH the workload axis (what the widget filters on) and the
// family axis, so evergreen families that don't crack the coder/instruct top-N
// (gemma, phi, mistral) are still covered. Self-updating: new versions surface here
// automatically — no repo ids to maintain.
const QUERIES = [
  { query: "coder", limit: 30 },
  { query: "instruct", limit: 30 },
  { query: "reasoning", limit: 20 },
  { query: "gemma", limit: 12 },
  { query: "phi", limit: 12 },
  { query: "mistral", limit: 12 },
  { query: "llama", limit: 15 },
  { query: "deepseek", limit: 10 },
];

// Keep a representative quant ladder per repo rather than every quant — spans
// tight-fit (Q2_K/IQ) → balanced (Q4_K_M) → quality (Q6_K/Q8_0), dropping redundant
// duplicates (Q4_0_4_4, Q3_K_XL, IQ1…). This keeps every FAMILY under the size cap;
// the live hybrid provider still serves the full ladder when a user drills in.
const QUANT_RANK = [
  "Q4_K_M", "Q4_K_S", "Q5_K_M", "Q6_K", "Q8_0", "Q3_K_M", "IQ4_XS", "Q2_K",
];
const MAX_QUANTS_PER_REPO = 8;
const quantRank = (q) => {
  const i = QUANT_RANK.indexOf(String(q).toUpperCase());
  return i < 0 ? QUANT_RANK.length : i;
};

const MAX_FAMILIES = 50; // distinct models to bake — keeps the snapshot lean while
// covering the current landscape; the live hybrid provider serves the long tail.
const MIN_KEEP = 0.75; // refuse a refresh below 75% of the current catalog — a
// partial/rate-limited fetch is kept-last-good, not shipped as a gutted catalog.

// ────────────────────────────────────────────────────────────────────────────

const ownerOf = (v) => String(v.source?.repo || "").split("/")[0];
const keep = (v) => TRUSTED.has(ownerOf(v).toLowerCase()) && !JUNK.test(v.source?.repo || "");

// Fetch every query; collect trusted variants deduped by id, remembering each repo's
// tier and first-seen (download-rank) order for the cap.
const byId = new Map();
const repoTier = new Map();
const repoOrder = [];
let failures = 0;
for (const q of QUERIES) {
  try {
    const variants = await huggingFaceCatalogProvider(q).list();
    for (const v of variants) {
      if (!keep(v) || byId.has(v.id)) continue;
      byId.set(v.id, v);
      const repo = v.source.repo;
      if (!repoTier.has(repo)) {
        repoTier.set(repo, tierOf(ownerOf(v)));
        repoOrder.push(repo);
      }
    }
  } catch (e) {
    failures++;
    console.warn(`query ${JSON.stringify(q.query)} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Admit whole repos in (tier, download-rank) order until the variant cap, so each
// model keeps its full quant ladder (the recommender ranks across quants) rather
// than being split mid-repo. Skip — don't stop — on an overflowing repo so smaller
// later repos can still use the remaining budget.
const variantsByRepo = new Map();
for (const v of byId.values()) {
  if (!variantsByRepo.has(v.source.repo)) variantsByRepo.set(v.source.repo, []);
  variantsByRepo.get(v.source.repo).push(v);
}
// Trim each repo to its representative quant ladder.
for (const [repo, vs] of variantsByRepo) {
  vs.sort((a, b) => quantRank(a.quant) - quantRank(b.quant));
  variantsByRepo.set(repo, vs.slice(0, MAX_QUANTS_PER_REPO));
}
const pos = new Map(repoOrder.map((r, i) => [r, i]));
const ranked = [...repoOrder].sort((a, b) => repoTier.get(a) - repoTier.get(b) || pos.get(a) - pos.get(b));

// One publisher per model: the same model re-quantized by several trusted orgs
// (Qwen + bartowski + lmstudio-community all ship Qwen2.5-Coder-7B) is redundant.
// Collapse each distinct family to its highest-priority repo (ranked is tier→rank
// ordered) so the budget buys DISTINCT models, then cap the family count.
const normFamily = (f) =>
  String(f)
    .replace(/^[a-z0-9]+_/i, "") // drop a "publisher_" re-upload prefix (microsoft_Phi-4… → Phi-4…)
    .replace(/[-_.]((?:iq|q)\d[a-z0-9_]*|fp16|bf16|f16|f32)$/i, "") // drop a quant token baked into the repo name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const chosen = [];
const seenFamily = new Set();
for (const repo of ranked) {
  const fam = normFamily(variantsByRepo.get(repo)[0].family);
  if (seenFamily.has(fam)) continue;
  seenFamily.add(fam);
  chosen.push(repo);
  if (chosen.length >= MAX_FAMILIES) break;
}

const snapshot = chosen
  .flatMap((repo) => variantsByRepo.get(repo))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// ── Guardrails: never clobber a good snapshot with a bad fetch ──────────────
const prevCount = Array.isArray(PREV) ? PREV.length : 0;

// Total failure (offline / rate-limited / API shape changed) — fail loudly (red run).
if (snapshot.length === 0) {
  console.error(
    `No trusted variants fetched (${failures}/${QUERIES.length} queries failed) — ` +
      "refusing to overwrite the snapshot. Keeping last-good."
  );
  process.exit(1);
}
// Partial fetch — big shrink vs the current catalog. Skip the write and stay green
// (no diff → no commit → last-good preserved); the next run retries.
if (prevCount > 0 && snapshot.length < prevCount * MIN_KEEP) {
  const floor = Math.ceil(prevCount * MIN_KEEP);
  const msg =
    `Refusing refresh: ${snapshot.length} variants < ${floor} ` +
    `(${Math.round(MIN_KEEP * 100)}% of the current ${prevCount}); ${failures} queries failed. ` +
    "Likely a partial fetch — keeping last-good, no commit.";
  console.warn(msg);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "> " + msg + "\n");
  process.exit(0);
}

const banner =
  "// GENERATED by scripts/build-catalog.mjs — do not edit by hand.\n" +
  "// Source: Hugging Face public API (trusted publishers only). Re-run to refresh.\n";
writeFileSync(
  OUT,
  banner +
    `export const GENERATED_AT = ${JSON.stringify(new Date().toISOString())};\n` +
    `export const SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};\n`
);

// ── Run report (console + GitHub step summary) ──────────────────────────────
const reposNow = new Set(snapshot.map((v) => v.source.repo));
const reposPrev = new Set((PREV || []).map((v) => v.source?.repo).filter(Boolean));
const addedRepos = [...reposNow].filter((r) => !reposPrev.has(r)).sort();
const removedRepos = [...reposPrev].filter((r) => !reposNow.has(r)).sort();

const report = [
  `# Catalog refresh`,
  `${snapshot.length} variants across ${reposNow.size} repos ` +
    `(was ${prevCount} variants / ${reposPrev.size} repos)· ${failures}/${QUERIES.length} queries failed`,
  addedRepos.length ? `\n**Added families (${addedRepos.length})**\n- ${addedRepos.join("\n- ")}` : "",
  removedRepos.length ? `\n**Dropped families (${removedRepos.length})**\n- ${removedRepos.join("\n- ")}` : "",
]
  .filter(Boolean)
  .join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
