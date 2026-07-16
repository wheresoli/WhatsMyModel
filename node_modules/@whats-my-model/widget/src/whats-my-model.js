// <whats-my-model> — the portable widget. Pure custom element, no framework, no
// build step. All logic lives in @whats-my-model/core; this is presentation +
// the host seams (a HardwareProvider for detection, a catalog array). Hardware is
// seeded by the provider, then editable — the browser can't read VRAM, so the
// user can always correct it.
import {
    recommend,
    formatBytes,
    viabilityLabel,
    viabilityColor,
    browserHardwareProvider,
    seedCatalogProvider,
    SEED_CATALOG,
} from "@whats-my-model/core";

const GB = 1024 * 1024 * 1024;
const TASKS = ["code", "chat", "reasoning"];
const PREFS = ["fastest", "balanced", "highest-quality"];
// Doubling series, capped at 10M — Llama 4 Scout's window, the largest any
// released model declares. When a catalog entry declares its own contextLength
// (e.g. SEED_CATALOG), scoreVariant() caps the target there, so a tier above that
// model's max is inert for it. When it doesn't (e.g. the HF snapshot), the raw
// target sizes the KV cache, so the high tiers grow the estimate and only fit on
// multi-node / supercomputer-scale memory.
const CONTEXTS = [[4096, "4K"], [8192, "8K"], [16384, "16K"], [32768, "32K"], [65536, "64K"], [131072, "128K"], [262144, "256K"], [524288, "512K"], [1048576, "1M"], [2097152, "2M"], [10485760, "10M"]];
const CACHES = [["fp16", "fp16"], ["q8_0", "q8"], ["q4_0", "q4"]];
const CACHE_TYPES = new Set(CACHES.map(([v]) => v));
const DEFAULT_CACHE = "fp16";

// Format viability as exact values: "12.5 GB / 16 GB"
const viabilityBadge = (v) => {
    if (!v || v.tier === "unknown" || !v.need || !v.ceiling) return "?";
    return `${formatBytes(v.need)} / ${formatBytes(v.ceiling)}`;
};
// Native-tooltip copy per control, surfaced via title= on hover. Static author
// strings (no quotes/angle-brackets), so inlined into the template unescaped.
const TIPS = {
    task: "What you'll use the model for. Softly nudges the ranking toward models built for that job (code, chat, reasoning).",
    pref: "Speed-vs-quality tradeoff. fastest favours smaller, quicker files; highest-quality favours larger, higher-fidelity ones; balanced leans quality and breaks ties on speed.",
    ctx: "Context window (tokens) to plan for. Longer context needs a larger KV cache and more VRAM, so a model that fits at 32K may not at 128K.",
    cache: "KV = key/value cache: the model's working memory of the tokens already in your context, held in GPU memory so it doesn't re-process them each step. It grows with context length. Storing it at lower precision (q8/q4) saves memory for a small quality cost; fp16 keeps it full-precision (lossless).",
    vram: "Your GPU's video memory, the main limit on what fits (weights + KV cache + buffers must stay under it). Browsers can't read it, so enter your own.",
    ram: "System memory. Used as the fit ceiling only when no GPU VRAM is set (CPU/RAM-only inference).",
};
// Message from an unknown throw shape (string, plain object, undefined) without
// assuming `.message` exists.
const errMessage = (e) => (e && typeof e === "object" && "message" in e ? e.message : String(e));
const parseContext = (value) => {
    const s = String(value).trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const round1 = (n) => Math.round(n * 10) / 10;
const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const HF_BASE = "https://huggingface.co";
const hfModelPageUrl = (v) => {
    const s = v?.source;
    if (!s || s.provider !== "huggingface" || !s.repo) return null;
    return `${HF_BASE}/${String(s.repo).split("/").map(encodeURIComponent).join("/")}`;
};
const hfModelFileUrl = (v) => {
    const s = v?.source;
    if (!s || s.provider !== "huggingface" || !s.repo || !s.path) return null;
    const repo = String(s.repo).split("/").map(encodeURIComponent).join("/");
    const path = String(s.path).split("/").map(encodeURIComponent).join("/");
    return `${HF_BASE}/${repo}/resolve/main/${path}`;
};

const STYLE = `
:host {
  --wmm-bg: #ffffff; --wmm-fg: #1f2937; --wmm-muted: #6b7280; --wmm-faint: #9ca3af;
  --wmm-border: #d1d5db; --wmm-accent: #1f2937; --wmm-radius: 5px;
  --wmm-font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --status-complete: #059669; --status-loading: #d97706; --status-failed: #dc2626; --node-neutral: #9ca3af;
  display: block; font-family: var(--wmm-font); color: var(--wmm-fg);
  background: var(--wmm-bg); border: 1px solid var(--wmm-border);
  border-radius: var(--wmm-radius); padding: 20px; max-width: 640px; box-sizing: border-box;
}
@media (prefers-color-scheme: dark) {
  :host {
    --wmm-bg: #1f2937; --wmm-fg: #f3f4f6; --wmm-muted: #d1d5db; --wmm-faint: #9ca3af;
    --wmm-border: #374151; --wmm-accent: #f3f4f6;
    --status-complete: #10b981; --status-loading: #f59e0b; --status-failed: #ef4444;
  }
}
* { box-sizing: border-box; }
.controls { display: flex; flex-wrap: wrap; gap: 16px 12px; align-items: flex-end; margin-bottom: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 500; color: var(--wmm-muted); }
.field[title] { cursor: help; }
.field input, .field select {
  font-family: inherit; font-size: 13px;
  color: var(--wmm-fg); background: var(--wmm-bg); border: 1px solid var(--wmm-border);
  border-radius: var(--wmm-radius); padding: 8px 10px;
}
.field input { width: 100px; }
.field select { padding: 8px 8px; }
.hint { font-size: 12px; color: var(--wmm-faint); margin: 8px 0 0; line-height: 1.4; }
.results { margin-top: 16px; }
.card { border: 1px solid var(--wmm-border); border-radius: var(--wmm-radius); padding: 12px 14px; margin-top: 12px; background: color-mix(in srgb, var(--wmm-fg) 2%, transparent); }
.card h4 { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
.row { display: flex; align-items: center; gap: 10px; padding: 8px 4px; font-size: 13px; border-radius: 3px; }
.row.click { cursor: pointer; transition: background 80ms; }
.row.click:hover { background: color-mix(in srgb, var(--wmm-accent) 6%, transparent); }
.row .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quant { color: var(--wmm-muted); font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 500; }
.size { color: var(--wmm-faint); font-size: 12px; font-variant-numeric: tabular-nums; }
.badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 3px; color: #fff; white-space: nowrap; }
.reason { font-size: 12px; color: var(--wmm-muted); margin-top: 4px; }
.alts { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--wmm-border); }
.alts .row { color: var(--wmm-muted); }
.wontfit { margin-top: 16px; }
.wontfit summary { cursor: pointer; font-size: 12px; color: var(--wmm-muted); font-weight: 500; user-select: none; }
.wontfit summary:hover { color: var(--wmm-fg); }
.empty { color: var(--wmm-muted); font-size: 13px; padding: 12px 0; }
.hf-links { display: flex; gap: 4px; align-items: center; flex-shrink: 0; }
.hf-link { color: var(--wmm-muted); text-decoration: none; font-size: 13px; line-height: 1; padding: 4px 6px; border-radius: 3px; cursor: pointer; transition: all 80ms; }
.hf-link:hover { color: var(--wmm-accent); background: color-mix(in srgb, var(--wmm-accent) 8%, transparent); }
.hf-link--interactive { cursor: pointer; }
`;

export class WhatsMyModel extends HTMLElement {
    static get observedAttributes() {
        return ["task", "preference", "target-context", "cache-type"];
    }

    #hardwareProvider = browserHardwareProvider();
    #catalog = SEED_CATALOG;
    #catalogProvider = seedCatalogProvider();
    #onDownload = null;
    #loadSeq = 0;
    #workload = { task: "chat", preference: "balanced", targetContext: 4096, cacheType: "fp16" };
    #vramGB = null;
    #ramGB = null;
    #byId = new Map();
    #els = null;

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    attributeChangedCallback(name, _old, value) {
        if (name === "task" && value) this.#workload.task = value;
        if (name === "preference" && value) this.#workload.preference = value;
        if (name === "target-context" && value) {
            const ctx = parseContext(value);
            if (ctx != null) this.#workload.targetContext = ctx;
        }
        if (name === "cache-type" && value && CACHE_TYPES.has(value)) this.#workload.cacheType = value;
        if (this.#els) {
            this.#syncControls();
            this.#recompute();
        }
    }

    connectedCallback() {
        const t = this.getAttribute("task");
        const p = this.getAttribute("preference");
        const tc = this.getAttribute("target-context");
        const ct = this.getAttribute("cache-type");
        if (t) this.#workload.task = t;
        if (p) this.#workload.preference = p;
        if (tc) {
            const ctx = parseContext(tc);
            if (ctx != null) this.#workload.targetContext = ctx;
        }
        if (ct && CACHE_TYPES.has(ct)) this.#workload.cacheType = ct;
        this.#build();
        this.#detect();
    }

    // Host seam: swap hardware detection, the catalog (an array via `catalog`, or an
    // async `catalogProvider` with list()), or the workload.
    configure({ hardwareProvider, catalog, catalogProvider, workload, onDownload } = {}) {
        let reDetect = false;
        let reLoad = false;
        if (hardwareProvider) {
            this.#hardwareProvider = hardwareProvider;
            reDetect = true;
        }
        if (workload) this.#workload = { ...this.#workload, ...workload };
        if (catalog) this.#catalog = catalog;
        if (catalogProvider) {
            this.#catalogProvider = catalogProvider;
            reLoad = true;
        }
        if (typeof onDownload === "function") {
            this.#onDownload = onDownload;
        }
        if (!this.#els) return;
        this.#syncControls();
        if (reDetect) this.#detect();
        if (reLoad) this.#loadCatalog();
        if (!reDetect && !reLoad) this.#recompute();
    }

    // Load the catalog from the async provider, guarding against overlapping loads
    // (a newer configure() wins; a slow HF fetch can't clobber it).
    async #loadCatalog() {
        const seq = ++this.#loadSeq;
        this.#els.results.innerHTML = `<div class="empty">Loading models…</div>`;
        let list;
        try {
            list = await this.#catalogProvider.list();
        } catch (e) {
            if (seq === this.#loadSeq) {
                this.#els.results.innerHTML = `<div class="empty">Couldn't load catalog: ${esc(errMessage(e))}</div>`;
            }
            return;
        }
        if (seq !== this.#loadSeq) return;
        if (Array.isArray(list) && list.length) this.#catalog = list;
        this.#recompute();
    }

    async #detect() {
        let hw = null;
        try {
            hw = await this.#hardwareProvider.inspect();
        } catch {
            hw = null;
        }
        this.#vramGB = hw?.gpu?.total ? round1(hw.gpu.total / GB) : null;
        this.#ramGB = hw?.ram?.total ? round1(hw.ram.total / GB) : null;
        this.#syncControls();
        this.#recompute();
    }

    #resources() {
        const gpu = this.#vramGB ? { total: this.#vramGB * GB } : null;
        const ram = this.#ramGB ? { total: this.#ramGB * GB } : null;
        return gpu || ram ? { gpu, ram } : null;
    }

    #recompute() {
        const resources = this.#resources();
        const result = resources
            ? recommend({ resources, workload: this.#workload, catalog: this.#catalog })
            : null;
        this.#renderResults(result);
    }

    #build() {
        this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div class="controls">
        <label class="field" title="${TIPS.task}">Task
          <select id="task">${TASKS.map((t) => `<option value="${t}">${t}</option>`).join("")}</select>
        </label>
        <label class="field" title="${TIPS.pref}">Preference
          <select id="pref">${PREFS.map((p) => `<option value="${p}">${p}</option>`).join("")}</select>
        </label>
        <label class="field" title="${TIPS.ctx}">Context
          <select id="ctx">${CONTEXTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        </label>
        <label class="field" title="${TIPS.cache}">KV cache
          <select id="cache">${CACHES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        </label>
        <label class="field" title="${TIPS.vram}">GPU VRAM (GB)
          <input id="vram" type="number" min="0" step="0.5" placeholder="e.g. 16" />
        </label>
        <label class="field" title="${TIPS.ram}">System RAM (GB)
          <input id="ram" type="number" min="0" step="1" placeholder="e.g. 32" />
        </label>
      </div>
      <div class="hint">Browser detection is approximate and can't read VRAM — enter your GPU's VRAM for an accurate result.</div>
      <div class="results" part="results"></div>
    `;
        const $ = (id) => this.shadowRoot.getElementById(id);
        this.#els = { task: $("task"), pref: $("pref"), ctx: $("ctx"), cache: $("cache"), vram: $("vram"), ram: $("ram"), results: this.shadowRoot.querySelector(".results") };

        this.#els.task.addEventListener("change", (e) => {
            this.#workload.task = e.target.value;
            this.#recompute();
        });
        this.#els.pref.addEventListener("change", (e) => {
            this.#workload.preference = e.target.value;
            this.#recompute();
        });
        this.#els.ctx.addEventListener("change", (e) => {
            this.#workload.targetContext = parseInt(e.target.value, 10);
            this.#recompute();
        });
        this.#els.cache.addEventListener("change", (e) => {
            this.#workload.cacheType = e.target.value;
            this.#recompute();
        });
        const onNum = (key) => (e) => {
            const v = parseFloat(e.target.value);
            this[key] = Number.isFinite(v) && v > 0 ? v : null;
            this.#recompute();
        };
        // private fields aren't index-assignable, so wire explicitly
        this.#els.vram.addEventListener("input", (e) => {
            const v = parseFloat(e.target.value);
            this.#vramGB = Number.isFinite(v) && v > 0 ? v : null;
            this.#recompute();
        });
        this.#els.ram.addEventListener("input", (e) => {
            const v = parseFloat(e.target.value);
            this.#ramGB = Number.isFinite(v) && v > 0 ? v : null;
            this.#recompute();
        });

        const activate = (target) => {
            const row = target.closest("[data-variant-id]");
            if (!row) return;
            const variant = this.#byId.get(row.dataset.variantId);
            if (variant) {
                this.dispatchEvent(new CustomEvent("wmm-select", { detail: { variant }, bubbles: true, composed: true }));
            }
        };
        this.#els.results.addEventListener("click", (e) => {
            const downloadLink = e.target.closest("[data-download-id]");
            if (downloadLink && this.#onDownload) {
                e.preventDefault();
                e.stopPropagation();
                const variantId = downloadLink.dataset.downloadId;
                const variant = this.#byId.get(variantId);
                if (variant) {
                    this.#onDownload({
                        variant,
                        fileUrl: hfModelFileUrl(variant),
                        repo: variant.source?.repo,
                    });
                }
                return;
            }
            if (!e.target.closest("a")) activate(e.target);
        });
        this.#els.results.addEventListener("keydown", (e) => {
            if (e.target.closest?.("a")) return;
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                activate(e.target);
            }
        });

        this.#syncControls();
    }

    #syncControls() {
        if (!this.#els) return;
        // Normalize an out-of-set cacheType (e.g. injected via configure({workload}))
        // back to the default so the <select> and #workload can't desync.
        if (!CACHE_TYPES.has(this.#workload.cacheType)) this.#workload.cacheType = DEFAULT_CACHE;
        this.#els.task.value = this.#workload.task;
        this.#els.pref.value = this.#workload.preference;
        this.#els.ctx.value = String(this.#workload.targetContext);
        this.#els.cache.value = this.#workload.cacheType;
        this.#els.vram.value = this.#vramGB ?? "";
        this.#els.ram.value = this.#ramGB ?? "";
    }

    #row(v, clickable) {
        const pageUrl = hfModelPageUrl(v);
        const fileUrl = hfModelFileUrl(v);
        const downloadHandler = this.#onDownload ? ` data-download-id=\"${esc(v.id)}\"` : "";
        const downloadAttrs = this.#onDownload
            ? ` class=\"hf-link hf-link--interactive\" title=\"Download GGUF file\" aria-label=\"Download GGUF file\"${downloadHandler}`
            : ` class=\"hf-link\" href=\"${fileUrl}\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"Download GGUF file\" aria-label=\"Download GGUF file\"`;
        const downloadTag = `<a${downloadAttrs}>⬇</a>`;
        const links = pageUrl
            ? `<span class=\"hf-links\">${fileUrl ? downloadTag : ""}<a class=\"hf-link\" href=\"${pageUrl}\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"View on Hugging Face\" aria-label=\"View on Hugging Face\">↗</a></span>`
            : "";
        return `<div class=\"row${clickable ? " click" : ""}\"${clickable ? ` data-variant-id=\"${esc(v.id)}\" role=\"button\" tabindex=\"0\"` : ""}>
      <span class=\"grow\">${esc(v.name)}</span>
      <span class=\"quant\">${esc(v.quant)}</span>
      <span class=\"size\">${formatBytes(v.sizeBytes)}</span>
      <span class=\"badge\" style=\"background:${viabilityColor(v.viability.tier)}\">${viabilityBadge(v.viability)}</span>
      ${links}
    </div>`;
    }

    #renderResults(result) {
        this.#byId = new Map();
        if (!result) {
            this.#els.results.innerHTML = `<div class="empty">Enter your GPU VRAM (or system RAM) above to see which models fit.</div>`;
            return;
        }
        const { families, wontFit } = result;
        for (const f of families) for (const v of [f.recommended, ...f.alternatives]) this.#byId.set(v.id, v);
        for (const v of wontFit) this.#byId.set(v.id, v);
        const ctxLabel = (CONTEXTS.find(([v]) => v === this.#workload.targetContext) || [0, String(this.#workload.targetContext)])[1];

        const cards = families
            .map((f) => {
                const rec = f.recommended;
                const tightNote = rec.viability.tier === "tight" ? " — fits, but little headroom" : "";
                return `<div class="card" part="result-card">
          <h4>${esc(f.family)}</h4>
          ${this.#row(rec, true)}
          <div class="reason">Recommended for ${esc(this.#workload.preference)} at ${ctxLabel} ctx · ${esc(viabilityLabel(rec.viability))}${tightNote}</div>
          ${f.alternatives.length ? `<div class="alts">${f.alternatives.slice(0, 5).map((v) => this.#row(v, true)).join("")}${f.alternatives.length > 5 ? `<div class="reason">+${f.alternatives.length - 5} more quant${f.alternatives.length - 5 > 1 ? "s" : ""}</div>` : ""}</div>` : ""}
        </div>`;
            })
            .join("");

        const won = families.length
            ? cards
            : `<div class="empty">Nothing in the catalog fits this machine — try more VRAM, or a smaller model source.</div>`;

        const wont = wontFit.length
            ? `<details class="wontfit"><summary>${wontFit.length} won't fit your ${result.resources.gpu ? "VRAM" : "RAM"}</summary>
          ${wontFit.map((v) => this.#row(v, false)).join("")}
        </details>`
            : "";

        this.#els.results.innerHTML = won + wont;
    }
}
