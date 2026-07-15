# What's My Model?

A portable engine and Web Component that answers "which local (GGUF) model actually fits my machine?"

The core is **pure JavaScript with no DOM, framework, or backend dependency**: given a hardware profile (`{ gpu, ram }` in bytes) and a model's file size, it classifies fit (`ok` / `tight` / `over`). Hardware detection is *not* baked in — each host injects it through a `HardwareProvider`. A browser best-effort provider ships in-package (no backend); desktop hosts supply an exact native probe. That injection seam is what lets the widget drop into any tool without carrying its own server.

## Packages

- [`@whats-my-model/core`](packages/core) — the fit engine, GGUF discovery helpers, and the hardware-provider contract.

## Status

v0.1 — the fit engine, extracted from Concurro so it lives here and is shared back (Concurro consumes it via a local `file:` dependency). Hugging Face catalog, the Web Component wrapper, and native probe adapters come next.
