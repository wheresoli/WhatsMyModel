import test from "node:test";
import assert from "node:assert/strict";
import { huggingFaceCatalogProvider } from "./provider.js";

// Offline fetch stub: branch on the endpoint, return fixture JSON.
function stubFetch(routes) {
  return async (url) => {
    for (const [needle, body] of routes) {
      if (url.includes(needle)) return { ok: true, status: 200, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const MODELS = [
  { id: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF", gguf: { context_length: 32768 } },
  { id: "broken/repo-GGUF" },
];
const TREE = [
  { path: "qwen2.5-coder-7b-instruct-q4_k_m.gguf", size: 4683073536 },
  { path: "qwen2.5-coder-7b-instruct-q8_0.gguf", size: 8100000000 },
  { path: "qwen2.5-coder-7b-instruct-fp16.gguf", size: 15237853184 },
];

test("provider maps HF responses into variants and applies the task search", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return stubFetch([
      ["/api/models?", MODELS],
      ["Qwen%2FQwen2.5-Coder-7B-Instruct-GGUF/tree", TREE],
      ["Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/tree", TREE],
    ])(url);
  };
  const provider = huggingFaceCatalogProvider({ task: "code", limit: 8, fetchImpl });
  const variants = await provider.list();

  assert.ok(calls[0].includes("filter=gguf"));
  assert.ok(calls[0].includes("pipeline_tag=text-generation"));
  assert.ok(calls[0].includes("search=coder")); // task -> search term
  assert.ok(calls[0].includes("expand")); // asks for GGUF metadata (context_length)
  const quants = variants.map((v) => v.quant).sort();
  assert.deepEqual(quants, ["Q4_K_M", "Q8_0"]); // fp16 dropped; broken repo contributed nothing
  assert.equal(variants[0].source.provider, "huggingface");
  for (const v of variants) assert.equal(v.contextLength, 32768); // from expanded gguf metadata
});

test("provider throws on a failed model list", async () => {
  const provider = huggingFaceCatalogProvider({
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  await assert.rejects(() => provider.list(), /Hugging Face model list failed/);
});
