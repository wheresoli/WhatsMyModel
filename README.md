# What's My Model?

A portable engine and Web Component that answers "which local (GGUF) model actually fits my machine?"

The core is **pure JavaScript with no DOM, framework, or backend dependency**: given a hardware profile (`{ gpu, ram }` in bytes) and a model's file size, it classifies fit (`ok` / `tight` / `over`). Hardware detection is *not* baked in — each host injects it through a `HardwareProvider`. A browser best-effort provider ships in-package (no backend); desktop hosts supply an exact native probe. That injection seam is what lets the widget drop into any tool without carrying its own server.

Live: https://wheresoli.github.io/WhatsMyModel/

## Packages
https://www.npmjs.com/org/whats-my-model
- [`@whats-my-model/core`](packages/core) — pure fit engine (`classifyModel`, context/KV-cache-aware `estimateFit`), GGUF discovery, ranking (`recommend`), and the hardware/catalog provider contracts. Zero dependencies.
- [`@whats-my-model/widget`](packages/widget) — the `<whats-my-model>` Web Component (vanilla, no build). Task / preference / context / KV-cache controls, editable hardware, a `wmm-select` event.
- [`@whats-my-model/catalog-huggingface`](packages/catalog-huggingface) — backend-free Hugging Face catalog: live search, a bundled snapshot, a hybrid (snapshot ∪ live), and an IndexedDB cache.
- [`@whats-my-model/react`](packages/react) — a thin React wrapper for the Web Component.

## Quick start

Drop the widget into any page buildlessly via an import map — see [`apps/demo`](apps/demo). Or wire it in code:

```js
import "@whats-my-model/widget";
import {
  huggingFaceCatalogProvider,
  hybridCatalogProvider,
  cachedCatalogProvider,
} from "@whats-my-model/catalog-huggingface";
// The bundled snapshot ships behind a subpath so live-only consumers don't load it.
import { snapshotCatalogProvider } from "@whats-my-model/catalog-huggingface/snapshot";

const el = document.querySelector("whats-my-model");
el.configure({
  // Hosts inject hardware — browsers can't read VRAM. Web: browserHardwareProvider
  // (coarse) or manual entry; desktop (Tauri/Electron): an exact native probe.
  hardwareProvider: { inspect: async () => ({ gpu: { total: 16 * 2 ** 30 }, ram: { total: 32 * 2 ** 30 } }) },
  // Bundled snapshot for instant/offline, folded with a cached live search.
  catalogProvider: hybridCatalogProvider(
    snapshotCatalogProvider(),
    cachedCatalogProvider(huggingFaceCatalogProvider({ task: "code" })),
  ),
  workload: { task: "code", preference: "balanced", targetContext: 32768, cacheType: "q4_0" },
});
el.addEventListener("wmm-select", (e) => console.log(e.detail.variant));
```

React hosts: `import { WhatsMyModel } from "@whats-my-model/react"` — see [`examples/react`](examples/react).

Dev: `python scripts/serve.py` serves the demos (no-store, so ES-module edits are picked up); `node scripts/build-catalog.mjs` regenerates the snapshot; `node --test packages/*/src/*.test.js` runs the suite.

## Staying current

Two independent mechanisms keep the catalog relevant, so it never rots:

1. **Runtime (live site / any host).** The hybrid provider folds a live Hugging Face
   search into the bundled snapshot on every load — the site is current even between
   refreshes, and unknown models resolve on drill-in.
2. **Scheduled refresh (GitHub Action, weekly).** [`.github/workflows/data-refresh.yml`](.github/workflows/data-refresh.yml)
   runs `scripts/build-catalog.mjs` every Monday (and on demand) and commits the
   rebuilt snapshot to `main` **only when the model data actually changed**. GitHub
   Pages redeploys automatically after each refresh.

`build-catalog.mjs` is curated, not a raw popularity dump — HF's download ranking is
full of no-name "…-Claude-Opus-Reasoning-Distilled / …-Uncensored" reposts. So it:

- pulls across **workload + family** queries (coder, instruct, reasoning, gemma, phi,
  mistral, llama, deepseek), restricted to **trusted publishers** (model authors +
  canonical quantizers: bartowski, unsloth, lmstudio-community, …);
- collapses each model to **one publisher** and a **representative quant ladder**
  (Q2_K…Q8_0 + IQ4_XS), keeping the snapshot to ~50 distinct, current families;
- **self-guards**: an empty fetch fails loudly and a big shrink is refused — a bad or
  rate-limited run keeps the last-good snapshot instead of shipping a gutted one.

The one hand-maintained knob is the trusted-publisher list at the top of the script.
The refresh does **not** auto-publish to npm — that stays a deliberate release (**Cut
release**), so npm consumers get catalog updates on the next version you cut.

## Status

v0.1 — the fit engine, extracted from Concurro so it lives here and is shared back (Concurro consumes it via a local `file:` dependency). Hugging Face catalog, the Web Component wrapper, and native probe adapters come next.
