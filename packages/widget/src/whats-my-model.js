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
  SEED_CATALOG,
} from "@whats-my-model/core";

const GB = 1024 * 1024 * 1024;
const TASKS = ["code", "chat", "reasoning"];
const PREFS = ["fastest", "balanced", "highest-quality"];
const TIER_LABEL = { ok: "Fits", tight: "Tight", over: "Won't fit", unknown: "?" };

const round1 = (n) => Math.round(n * 10) / 10;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STYLE = `
:host {
  --wmm-bg: #ffffff; --wmm-fg: #1a1a1a; --wmm-muted: #6b7280;
  --wmm-border: #e5e7eb; --wmm-accent: #2563eb; --wmm-radius: 12px;
  --wmm-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  /* consumed by core's viabilityColor(); override to reskin */
  --status-complete: #16a34a; --status-loading: #d97706; --status-failed: #dc2626; --node-neutral: #9ca3af;
  display: block; font-family: var(--wmm-font); color: var(--wmm-fg);
  background: var(--wmm-bg); border: 1px solid var(--wmm-border);
  border-radius: var(--wmm-radius); padding: 16px; max-width: 560px; box-sizing: border-box;
}
@media (prefers-color-scheme: dark) {
  :host {
    --wmm-bg: #0f1115; --wmm-fg: #e6e8eb; --wmm-muted: #99a2ad;
    --wmm-border: #272c34; --wmm-accent: #60a5fa;
    --status-complete: #22c55e; --status-loading: #f59e0b; --status-failed: #ef4444; --node-neutral: #6b7280;
  }
}
* { box-sizing: border-box; }
.controls { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: flex-end; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--wmm-muted); }
.field input, .field select {
  font-family: inherit; font-size: 13px; text-transform: none; letter-spacing: normal;
  color: var(--wmm-fg); background: var(--wmm-bg); border: 1px solid var(--wmm-border);
  border-radius: 7px; padding: 6px 8px;
}
.field input { width: 92px; }
.hint { font-size: 12px; color: var(--wmm-muted); margin: 10px 0 4px; }
.results { margin-top: 8px; }
.card { border: 1px solid var(--wmm-border); border-radius: 9px; padding: 10px 12px; margin-top: 8px; }
.card h4 { margin: 0 0 4px; font-size: 14px; }
.row { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 13px; border-radius: 6px; }
.row.click { cursor: pointer; }
.row.click:hover { color: var(--wmm-accent); }
.row .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quant, .size { color: var(--wmm-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.badge { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; color: #fff; white-space: nowrap; }
.reason { font-size: 12px; color: var(--wmm-muted); margin-top: 2px; }
.alts { margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--wmm-border); }
.alts .row { color: var(--wmm-muted); }
.wontfit { margin-top: 12px; }
.wontfit summary { cursor: pointer; font-size: 12px; color: var(--wmm-muted); }
.empty { color: var(--wmm-muted); font-size: 13px; padding: 10px 0; }
`;

export class WhatsMyModel extends HTMLElement {
  static get observedAttributes() {
    return ["task", "preference"];
  }

  #hardwareProvider = browserHardwareProvider();
  #catalog = SEED_CATALOG;
  #workload = { task: "chat", preference: "balanced" };
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
    if (this.#els) {
      this.#syncControls();
      this.#recompute();
    }
  }

  connectedCallback() {
    const t = this.getAttribute("task");
    const p = this.getAttribute("preference");
    if (t) this.#workload.task = t;
    if (p) this.#workload.preference = p;
    this.#build();
    this.#detect();
  }

  // Host seam: swap hardware detection, the catalog, or the workload.
  configure({ hardwareProvider, catalog, workload } = {}) {
    if (hardwareProvider) this.#hardwareProvider = hardwareProvider;
    if (catalog) this.#catalog = catalog;
    if (workload) this.#workload = { ...this.#workload, ...workload };
    if (this.#els) {
      this.#syncControls();
      this.#detect();
    }
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
        <label class="field">Task
          <select id="task">${TASKS.map((t) => `<option value="${t}">${t}</option>`).join("")}</select>
        </label>
        <label class="field">Preference
          <select id="pref">${PREFS.map((p) => `<option value="${p}">${p}</option>`).join("")}</select>
        </label>
        <label class="field">GPU VRAM (GB)
          <input id="vram" type="number" min="0" step="0.5" placeholder="e.g. 16" />
        </label>
        <label class="field">System RAM (GB)
          <input id="ram" type="number" min="0" step="1" placeholder="e.g. 32" />
        </label>
      </div>
      <div class="hint">Browser detection is approximate and can't read VRAM — enter your GPU's VRAM for an accurate result.</div>
      <div class="results" part="results"></div>
    `;
    const $ = (id) => this.shadowRoot.getElementById(id);
    this.#els = { task: $("task"), pref: $("pref"), vram: $("vram"), ram: $("ram"), results: this.shadowRoot.querySelector(".results") };

    this.#els.task.addEventListener("change", (e) => {
      this.#workload.task = e.target.value;
      this.#recompute();
    });
    this.#els.pref.addEventListener("change", (e) => {
      this.#workload.preference = e.target.value;
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
    this.#els.results.addEventListener("click", (e) => activate(e.target));
    this.#els.results.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate(e.target);
      }
    });

    this.#syncControls();
  }

  #syncControls() {
    if (!this.#els) return;
    this.#els.task.value = this.#workload.task;
    this.#els.pref.value = this.#workload.preference;
    this.#els.vram.value = this.#vramGB ?? "";
    this.#els.ram.value = this.#ramGB ?? "";
  }

  #row(v, clickable) {
    return `<div class="row${clickable ? " click" : ""}"${clickable ? ` data-variant-id="${esc(v.id)}" role="button" tabindex="0"` : ""}>
      <span class="grow">${esc(v.name)}</span>
      <span class="quant">${esc(v.quant)}</span>
      <span class="size">${formatBytes(v.sizeBytes)}</span>
      <span class="badge" style="background:${viabilityColor(v.viability.tier)}">${TIER_LABEL[v.viability.tier] || "?"}</span>
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

    const cards = families
      .map((f) => {
        const rec = f.recommended;
        const tightNote = rec.viability.tier === "tight" ? " — fits, but little headroom" : "";
        return `<div class="card" part="result-card">
          <h4>${esc(f.family)}</h4>
          ${this.#row(rec, true)}
          <div class="reason">Recommended for ${esc(this.#workload.preference)} · ${esc(viabilityLabel(rec.viability))}${tightNote}</div>
          ${f.alternatives.length ? `<div class="alts">${f.alternatives.map((v) => this.#row(v, true)).join("")}</div>` : ""}
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
