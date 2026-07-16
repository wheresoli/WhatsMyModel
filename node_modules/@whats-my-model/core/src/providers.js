// The hardware-provider seam. classifyModel() only needs a HardwareProfile —
// { gpu, ram } in bytes — and does not care how it was obtained. Each host
// injects a provider: a plain object with an async inspect(). That indifference
// is the portability: the "backend" (accurate probing) belongs to the host, not
// to this widget.
//
// @typedef {Object} MemoryInfo
// @property {number|null} total   Bytes.
// @property {number} [used]       Bytes.
// @property {number} [free]       Bytes (GPU free) / available (RAM).
//
// @typedef {Object} HardwareProfile
// @property {(MemoryInfo & { name?: string }) | null} gpu   Binding GPU's VRAM, or null.
// @property {MemoryInfo | null} ram                         System RAM, or null.
//
// @typedef {Object} HardwareProvider
// @property {() => Promise<HardwareProfile>} inspect

const GB = 1024 * 1024 * 1024;

// A fixed profile the caller already has: manual entry, or figures a host fetched
// elsewhere. The always-available, backend-free provider.
// @param {HardwareProfile} [profile]
// @returns {HardwareProvider}
export function manualHardwareProvider(profile) {
  return { inspect: async () => profile ?? { gpu: null, ram: null } };
}

// Best-effort detection from browser APIs alone — no backend. RAM is coarse:
// navigator.deviceMemory is rounded and CLAMPED AT 8 GB, so it under-reports big
// machines. There is no web API for VRAM, so gpu is always null here — a pure
// website should fall back to manual entry for the GPU. Desktop hosts
// (Tauri/Electron) should inject an exact native probe instead of using this.
// (A future step can read a GPU name via WebGPU adapter.info and map it to VRAM
// through a static table, but a name alone can't feed classifyModel's ceiling.)
// @returns {HardwareProvider}
export function browserHardwareProvider() {
  return {
    inspect: async () => {
      const dm =
        typeof navigator !== "undefined" ? navigator.deviceMemory : undefined;
      const total = Number.isFinite(dm) ? dm * GB : null;
      return {
        gpu: null,
        ram: total ? { total, available: null, used: null } : null,
      };
    },
  };
}
