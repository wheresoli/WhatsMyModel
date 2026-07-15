// Pure filename/repo heuristics for turning a Hugging Face repo's GGUF file tree
// into catalog variants. The GGUF spec says its naming is human-oriented and not
// perfectly machine-parseable, so these are best-effort — but they only feed
// display + a quality proxy, never a hard claim. No network here (testable).

const SHARD_RE = /-(\d{4,5})-of-(\d{4,5})(\.gguf)$/i;
const QUANT_TOKEN = /((?:iq|q)\d[a-z0-9_]*|fp16|bf16|f16|f32)/i;

// Quant label (e.g. "Q4_K_M") from a filename, or null. Strips the shard suffix
// and extension, then takes the trailing quant token (falls back to any token).
export function parseQuant(pathOrName) {
  const file = String(pathOrName).split(/[\\/]/).pop() || "";
  const base = file.replace(/\.gguf$/i, "").replace(/-\d{4,5}-of-\d{4,5}$/i, "");
  const trailing = base.match(new RegExp(`(?:^|[-_.])${QUANT_TOKEN.source}$`, "i"));
  if (trailing) return trailing[1].toUpperCase();
  const any = base.match(new RegExp(`(?:^|[-_.])${QUANT_TOKEN.source}(?=[-_.])`, "i"));
  return any ? any[1].toUpperCase() : null;
}

export function isShard(path) {
  return SHARD_RE.test(String(path));
}

// Group key for a file: its path with the shard suffix removed, so every shard of
// one model — and its single-file sibling, if the repo ships both — collapse to one.
export function shardBase(path) {
  return String(path).replace(SHARD_RE, "$3");
}

// Parameter count in billions from a name ("...-7B-..." -> 7), or null. The
// negative lookahead avoids matching "4bit".
export function parseParams(str) {
  const m = String(str).match(/(\d+(?:\.\d+)?)\s*b(?![a-z])/i);
  return m ? parseFloat(m[1]) : null;
}

export function inferTask(repoId) {
  const s = String(repoId).toLowerCase();
  if (/coder|starcoder|codellama|codegemma|code-/.test(s)) return "code";
  if (/\br1\b|-r1|reason|qwq|thinking|o1-/.test(s)) return "reasoning";
  return "chat";
}

// Family/display name from a repo id: drop the owner and the -GGUF suffix.
export function cleanFamily(repoId) {
  const name = String(repoId).split("/").pop() || String(repoId);
  return name.replace(/[-_. ]?gguf$/i, "");
}

const fileSize = (f) => f.size ?? (f.lfs && f.lfs.size) ?? 0;
const FULL_PRECISION = /^(FP16|F16|BF16|F32)$/;

// Turn a repo's file tree into variants — one per quant. When a quant exists as
// both a single file and a shard set, use the single file's size (they're equal);
// otherwise sum the shard set. Full-precision dumps are dropped (rarely a local
// pick, and they'd crowd the card).
export function buildVariants(repoId, files) {
  const family = cleanFamily(repoId);
  const params = parseParams(repoId);
  const task = inferTask(repoId);

  const groups = new Map();
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || !/\.gguf$/i.test(f.path || "")) continue;
    const key = shardBase(f.path);
    if (!groups.has(key)) groups.set(key, { singles: [], shards: [] });
    (isShard(f.path) ? groups.get(key).shards : groups.get(key).singles).push(f);
  }

  const variants = [];
  for (const [key, g] of groups) {
    const quant = parseQuant(key);
    if (!quant || FULL_PRECISION.test(quant)) continue;
    const sizeBytes = g.singles.length
      ? Math.max(...g.singles.map(fileSize))
      : g.shards.reduce((s, f) => s + fileSize(f), 0);
    if (!sizeBytes) continue;
    variants.push({
      id: `hf:${repoId}:${quant}`,
      family,
      name: family,
      task,
      ...(params != null ? { params } : {}),
      quant,
      sizeBytes,
      source: { provider: "huggingface", repo: repoId, path: key },
    });
  }
  return variants;
}
