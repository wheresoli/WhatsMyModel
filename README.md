# What's My Model?

A portable engine and Web Component that answers "which local (GGUF) model actually fits my machine?"

The core is **pure JavaScript with no DOM, framework, or backend dependency**: given a hardware profile (`{ gpu, ram }` in bytes) and a model's file size, it classifies fit (`ok` / `tight` / `over`). Hardware detection is *not* baked in — each host injects it through a `HardwareProvider`. A browser best-effort provider ships in-package (no backend); desktop hosts supply an exact native probe. That injection seam is what lets the widget drop into any tool without carrying its own server.

## Packages

- [`@whats-my-model/core`](packages/core) — pure fit engine (`classifyModel`, context/KV-cache-aware `estimateFit`), GGUF discovery, ranking (`recommend`), and the hardware/catalog provider contracts. Zero dependencies.
- [`@whats-my-model/widget`](packages/widget) — the `<whats-my-model>` Web Component (vanilla, no build). Task / preference / context / KV-cache controls, editable hardware, a `wmm-select` event.
- [`@whats-my-model/catalog-huggingface`](packages/catalog-huggingface) — backend-free Hugging Face catalog: live search, a bundled snapshot, a hybrid (snapshot ∪ live), and an IndexedDB cache.
- [`@whats-my-model/react`](packages/react) — a thin React wrapper for the Web Component.

## Quick start

Drop the widget into any page buildlessly via an import map — see [`apps/demo`](apps/demo). Or wire it in code:

```js
import "@whats-my-model/widget";
import {
  snapshotCatalogProvider,
  huggingFaceCatalogProvider,
  hybridCatalogProvider,
  cachedCatalogProvider,
} from "@whats-my-model/catalog-huggingface";

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

## Status

v0.1 — the fit engine, extracted from Concurro so it lives here and is shared back (Concurro consumes it via a local `file:` dependency). Hugging Face catalog, the Web Component wrapper, and native probe adapters come next.
