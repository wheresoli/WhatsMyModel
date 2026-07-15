# @whats-my-model/core

Pure, dependency-free JavaScript. No DOM, framework, backend, or Tauri.

## API

- **`classifyModel(sizeBytes, resources)`** — will a model of this file size fit? Returns `{ tier: "ok" | "tight" | "over" | "unknown", sizeBytes, need, ceiling, target }`. Binds against VRAM when a GPU is present (the display-freeze constraint), else system RAM.
- **`viabilityLabel` / `viabilityColor` / `pressureTier` / `formatBytes`** — presentation helpers over the classification.
- **`mergeLocalModels(discoveredPaths, manualModels)`** — turn a scanned folder of `.gguf` files into deduped, uniquely-named local-model entries (+ `baseName` / `parentDirName` / `modelStem`).
- **Hardware providers** — `browserHardwareProvider()` (best-effort, no backend, no VRAM) and `manualHardwareProvider(profile)`. Hosts with an accurate probe inject their own `{ inspect(): Promise<HardwareProfile> }`.

`resources` / `HardwareProfile` shape: `{ gpu: { total, used, free, name? } | null, ram: { total, available, used } | null }`, all in bytes.

## Test

```
npm test    # node --test, zero dependencies
```
