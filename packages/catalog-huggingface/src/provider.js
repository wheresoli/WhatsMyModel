// A catalog provider backed by Hugging Face's public HTTP API. Backend-free and
// dependency-free: raw fetch from the browser (the API is CORS-open for public
// GETs) or Node. Returns the same variant shape the fit engine consumes, so it
// drops in wherever the seed catalog does.
import { buildVariants } from "./parse.js";

const HF_BASE = "https://huggingface.co";
// Nudge the search toward the workload when no explicit query is given.
const TASK_SEARCH = { code: "coder", reasoning: "reasoning", chat: "instruct" };

export function huggingFaceCatalogProvider(opts = {}) {
  const {
    query,
    task,
    limit = 8,
    base = HF_BASE,
    fetchImpl = typeof fetch !== "undefined" ? fetch : null,
  } = opts;
  if (!fetchImpl) throw new Error("no fetch available — pass opts.fetchImpl");

  return {
    async list() {
      const search = query || (task && TASK_SEARCH[task]) || "";
      const url = new URL(base + "/api/models");
      url.searchParams.set("filter", "gguf");
      url.searchParams.set("pipeline_tag", "text-generation");
      url.searchParams.set("sort", "downloads");
      url.searchParams.set("direction", "-1");
      url.searchParams.set("limit", String(limit));
      if (search) url.searchParams.set("search", search);

      const res = await fetchImpl(url.toString());
      if (!res.ok) throw new Error(`Hugging Face model list failed (${res.status})`);
      const repos = await res.json();

      // Fetch each repo's tree in parallel; a repo that fails or has no GGUFs
      // just contributes nothing rather than failing the whole list.
      const perRepo = await Promise.all(
        (Array.isArray(repos) ? repos : []).slice(0, limit).map(async (repo) => {
          const id = repo && (repo.id || repo.modelId);
          if (!id) return [];
          try {
            const t = await fetchImpl(`${base}/api/models/${id}/tree/main?recursive=true`);
            if (!t.ok) return [];
            const files = await t.json();
            return buildVariants(id, files);
          } catch {
            return [];
          }
        })
      );
      return perRepo.flat();
    },
  };
}
