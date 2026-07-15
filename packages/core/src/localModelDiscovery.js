// Pure helpers for turning a scanned folder of GGUF files into local-model
// entries and merging them with the user's manually-added models. Kept free of
// Tauri/DOM so the logic stays simple to reason about and is shared by useSettings.

const GGUF_RE = /\.gguf$/i;

export function baseName(path) {
  return String(path || "").split(/[\\/]/).filter(Boolean).pop() || "";
}

// The immediate parent directory name — used to disambiguate two discovered
// files that share a stem (e.g. the same quant sitting in two model repos).
export function parentDirName(path) {
  const parts = String(path || "").split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : "";
}

// File stem without the .gguf extension — this becomes the served model name/alias.
export function modelStem(path) {
  return baseName(path).replace(GGUF_RE, "");
}

// Build local-model entries for folder-discovered GGUF files and merge them with
// the user's manually-configured models. Rules:
//   - Manual models are authoritative: a discovered file whose path a manual
//     model already points to is dropped (same file, don't list it twice).
//   - Names must stay unique because they key model selection (agent-ref
//     "local:<name>" and the llama-server alias). A discovered stem that collides
//     with an existing name is qualified by its parent folder, then numbered.
//   - Discovered entries are ephemeral (id "disc:<path>", discovered: true) and
//     are never persisted — the folder is the source of truth, so removing a file
//     drops its model on the next scan.
// Manual models are returned first (curated), discovered ones appended.
export function mergeLocalModels(discoveredPaths, manualModels) {
  const manual = Array.isArray(manualModels) ? manualModels : [];
  const manualPaths = new Set(
    manual.map((model) => (model && model.path ? String(model.path) : "")).filter(Boolean)
  );
  const usedNames = new Set(
    manual.map((model) => (model && model.name ? String(model.name) : "")).filter(Boolean)
  );
  const discovered = [];
  for (const path of Array.isArray(discoveredPaths) ? discoveredPaths : []) {
    if (!path || manualPaths.has(String(path))) continue;
    let name = modelStem(path) || baseName(path);
    if (usedNames.has(name)) {
      const parent = parentDirName(path);
      const qualified = parent ? `${parent}/${name}` : name;
      let candidate = qualified;
      let counter = 2;
      while (usedNames.has(candidate)) candidate = `${qualified} (${counter++})`;
      name = candidate;
    }
    usedNames.add(name);
    discovered.push({ id: `disc:${path}`, kind: "file", name, path, discovered: true });
  }
  return [...manual, ...discovered];
}
