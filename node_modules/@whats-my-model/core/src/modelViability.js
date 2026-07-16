// Will a local model fit this machine? Pure helpers shared by the model picker,
// the node chip, and the tests. A model that overflows VRAM doesn't just run
// slowly — with Concurro's default "offload every layer" it can saturate the GPU
// and freeze the display, so the editor flags it BEFORE you load it.

// Heuristic memory need = weights x this. The extra covers the KV cache, compute
// buffers, and headroom the OS/display compositor needs on the same GPU. It's a
// deliberately conservative single knob, not an exact model (KV scales with
// context, not file size) — after a freeze, erring toward caution is the point.
export const MEM_OVERHEAD = 1.2;
// Above this fraction of the ceiling we call it "tight" (fits, but little room to
// spare — risky for larger contexts or a busy desktop).
export const TIGHT_FRACTION = 0.8;

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

export function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  // Exact zero is a real reading ("nothing loaded / free"), not a small nonzero
  // value: return "0" rather than letting the min-one MB rounding below (which
  // deliberately floors small nonzero sizes to "1 MB") report an idle meter as
  // using/leaving 1 MB.
  if (bytes <= 0) return "0";
  if (bytes >= GB) {
    // Keep one decimal for GB — near a VRAM ceiling, 13.5 vs 14 is meaningful —
    // but drop a bare ".0" so 16 GB reads "16 GB", not "16.0 GB".
    const gb = (bytes / GB).toFixed(1);
    return `${gb.endsWith(".0") ? gb.slice(0, -2) : gb} GB`;
  }
  return `${Math.max(1, Math.round(bytes / MB))} MB`;
}

// Classify a model against the host. `resources` is the /local-runtime/resources
// shape ({ gpu, ram } with byte figures). The binding resource is VRAM when a GPU
// is present (Concurro offloads all layers to it by default), else system RAM.
// Returns { tier: "ok"|"tight"|"over"|"unknown", sizeBytes, need, ceiling, target }.
export function classifyModel(sizeBytes, resources) {
  const size = Number(sizeBytes);
  if (!size || size <= 0) return { tier: "unknown", sizeBytes: null };
  const gpu = resources?.gpu;
  const usingGpu = Boolean(gpu && gpu.total);
  const ceiling = usingGpu ? gpu.total : resources?.ram?.total;
  const target = usingGpu ? "VRAM" : "RAM";
  if (!ceiling) return { tier: "unknown", sizeBytes: size, target };
  const need = size * MEM_OVERHEAD;
  let tier;
  if (need > ceiling) tier = "over";
  else if (need > ceiling * TIGHT_FRACTION) tier = "tight";
  else tier = "ok";
  return { tier, sizeBytes: size, need, ceiling, target };
}

// A one-line human summary for a chip/tooltip. Empty when we can't judge.
export function viabilityLabel(v) {
  if (!v || v.tier === "unknown") return v?.sizeBytes ? formatBytes(v.sizeBytes) : "";
  const size = formatBytes(v.sizeBytes);
  if (v.tier === "ok") return size;
  const need = formatBytes(v.need);
  const ceil = formatBytes(v.ceiling);
  const verb = v.tier === "over" ? "exceeds" : "tight for";
  return `${size} · ${verb} ${v.target} (~${need} / ${ceil})`;
}

// Tier -> skin palette CSS variable, reusing the status colours so it tracks the
// active skin: green (complete), amber (loading), red (failed).
const TIER_VAR = {
  ok: "var(--status-complete)",
  tight: "var(--status-loading)",
  over: "var(--status-failed)",
};

export function viabilityColor(tier) {
  return TIER_VAR[tier] || "var(--node-neutral)";
}

// Usage pressure (used/total) -> the same tier vocabulary, for meter-bar colour.
export function pressureTier(used, total) {
  if (!total || used == null) return "unknown";
  const frac = used / total;
  if (frac >= 0.95) return "over";
  if (frac >= TIGHT_FRACTION) return "tight";
  return "ok";
}
