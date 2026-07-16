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

// A multimodal projector — loads alongside the weights, not a variant of its own.
export function isMmproj(path) {
    const file = String(path).split(/[\\/]/).pop() || "";
    return /(?:^|[-_.])(?:mm-?proj|projector)/i.test(file);
}

// The "of N" shard count declared in a shard filename (null if not sharded).
function shardTotal(path) {
    const m = String(path).match(SHARD_RE);
    return m ? parseInt(m[2], 10) : null;
}

// The "M" index of an "M-of-N" shard filename (null if not sharded).
function shardIndex(path) {
    const m = String(path).match(SHARD_RE);
    return m ? parseInt(m[1], 10) : null;
}

// A shard set loads only if it's complete and self-consistent: every file declares
// the same total N, and indices 1..N are each present exactly once. Guards against
// a partial set, duplicate indices, and a mix of differently-sharded sets that
// share a base name (e.g. an old -of-00002 plus a newer -of-00003).
function isCompleteShardSet(shards) {
    const total = shardTotal(shards[0] && shards[0].path);
    if (!total) return false;
    // Reject extra/missing entries up front so duplicates can't slip through.
    if (shards.length !== total) return false;
    const seen = new Set();
    for (const f of shards) {
        if (shardTotal(f.path) !== total) return false;
        const idx = shardIndex(f.path);
        if (!(idx > 0) || idx > total) return false;
        if (seen.has(idx)) return false;
        seen.add(idx);
    }
    return true;
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
// pick, and they'd crowd the card). `contextLength` (the repo's max context, from
// HF's parsed GGUF metadata) is a model-architecture property shared by every
// quant, so it's stamped on all variants when known — letting the fit engine cap
// the requested context at the model's real max instead of over-sizing the KV.
export function buildVariants(repoId, files, contextLength) {
    const family = cleanFamily(repoId);
    const params = parseParams(repoId);
    const task = inferTask(repoId);
    const ctxLen = Number(contextLength);
    const ctxField = Number.isFinite(ctxLen) && ctxLen > 0 ? { contextLength: ctxLen } : {};
    const list = (Array.isArray(files) ? files : []).filter((f) => f && /\.gguf$/i.test(f.path || ""));

    // A multimodal projector (mmproj) loads alongside the weights — a sidecar, not a
    // variant. Take the largest as the projector footprint; its presence means the
    // repo is vision-capable.
    const projectorBytes = list.filter((f) => isMmproj(f.path)).reduce((mx, f) => Math.max(mx, fileSize(f)), 0);
    const modalities = projectorBytes > 0 ? ["text", "image"] : ["text"];

    const groups = new Map();
    for (const f of list) {
        if (isMmproj(f.path)) continue;
        const key = shardBase(f.path);
        if (!groups.has(key)) groups.set(key, { singles: [], shards: [] });
        (isShard(f.path) ? groups.get(key).shards : groups.get(key).singles).push(f);
    }

    const variants = [];
    for (const [key, g] of groups) {
        const quant = parseQuant(key);
        if (!quant || FULL_PRECISION.test(quant)) continue;
        let sizeBytes;
        if (g.singles.length) {
            sizeBytes = Math.max(...g.singles.map(fileSize));
        } else {
            // Sharded only: the whole set must be present and consistent or it won't load.
            if (!isCompleteShardSet(g.shards)) continue;
            sizeBytes = g.shards.reduce((s, f) => s + fileSize(f), 0);
        }
        if (!sizeBytes) continue;
        variants.push({
            id: `hf:${repoId}:${quant}`,
            family,
            name: family,
            task,
            ...(params != null ? { params } : {}),
            quant,
            ...ctxField,
            sizeBytes,
            ...(projectorBytes > 0 ? { sidecarBytes: projectorBytes } : {}),
            modalities,
            source: { provider: "huggingface", repo: repoId, path: key },
        });
    }
    return variants;
}

const HF_BASE = "https://huggingface.co";

/** URL of the variant's repository page on Hugging Face, or null for other providers. */
export function modelPageUrl(variant, base = HF_BASE) {
    const { source } = variant || {};
    if (!source || source.provider !== "huggingface" || !source.repo) return null;
    const encRepo = String(source.repo).split("/").map(encodeURIComponent).join("/");
    return `${base}/${encRepo}`;
}

/** Direct download URL for the variant's GGUF file on Hugging Face, or null for other providers. */
export function modelFileUrl(variant, base = HF_BASE) {
    const { source } = variant || {};
    if (!source || source.provider !== "huggingface" || !source.repo || !source.path) return null;
    const encRepo = String(source.repo).split("/").map(encodeURIComponent).join("/");
    const encPath = String(source.path).split("/").map(encodeURIComponent).join("/");
    return `${base}/${encRepo}/resolve/main/${encPath}`;
}
