// A small, curated seed catalog of popular text/code GGUF variants so the widget
// is useful with zero network. Sizes are APPROXIMATE (typical published GGUF
// sizes for the quant) and params are in billions — this is a starting set, to
// be superseded by a generated Hugging Face snapshot (catalog-v2) later.
//
// Variant shape: one runnable quant of one model.
//   { id, family, name, task, params, quant, contextLength, sizeBytes }
//   task: "code" | "chat" | "reasoning"

const GB = 1024 * 1024 * 1024;

export const SEED_CATALOG = [
  { id: "qwen25-coder-7b-q4km", family: "Qwen2.5-Coder", name: "Qwen2.5-Coder-7B-Instruct", task: "code", params: 7, quant: "Q4_K_M", contextLength: 32768, sizeBytes: 4.7 * GB },
  { id: "qwen25-coder-7b-q8", family: "Qwen2.5-Coder", name: "Qwen2.5-Coder-7B-Instruct", task: "code", params: 7, quant: "Q8_0", contextLength: 32768, sizeBytes: 8.1 * GB },
  { id: "qwen25-coder-14b-q4km", family: "Qwen2.5-Coder", name: "Qwen2.5-Coder-14B-Instruct", task: "code", params: 14, quant: "Q4_K_M", contextLength: 32768, sizeBytes: 9.0 * GB },
  { id: "qwen25-coder-32b-q4km", family: "Qwen2.5-Coder", name: "Qwen2.5-Coder-32B-Instruct", task: "code", params: 32, quant: "Q4_K_M", contextLength: 32768, sizeBytes: 19.9 * GB },
  { id: "qwen25-coder-32b-q3km", family: "Qwen2.5-Coder", name: "Qwen2.5-Coder-32B-Instruct", task: "code", params: 32, quant: "Q3_K_M", contextLength: 32768, sizeBytes: 15.9 * GB },

  { id: "llama31-8b-q4km", family: "Llama-3.1", name: "Llama-3.1-8B-Instruct", task: "chat", params: 8, quant: "Q4_K_M", contextLength: 131072, sizeBytes: 4.9 * GB },
  { id: "llama31-8b-q8", family: "Llama-3.1", name: "Llama-3.1-8B-Instruct", task: "chat", params: 8, quant: "Q8_0", contextLength: 131072, sizeBytes: 8.5 * GB },
  { id: "llama32-3b-q4km", family: "Llama-3.2", name: "Llama-3.2-3B-Instruct", task: "chat", params: 3, quant: "Q4_K_M", contextLength: 131072, sizeBytes: 2.0 * GB },

  { id: "mistral-7b-v03-q4km", family: "Mistral", name: "Mistral-7B-Instruct-v0.3", task: "chat", params: 7, quant: "Q4_K_M", contextLength: 32768, sizeBytes: 4.4 * GB },
  { id: "gemma2-9b-q4km", family: "Gemma-2", name: "Gemma-2-9B-it", task: "chat", params: 9, quant: "Q4_K_M", contextLength: 8192, sizeBytes: 5.8 * GB },
  { id: "phi35-mini-q4km", family: "Phi-3.5", name: "Phi-3.5-mini-instruct", task: "chat", params: 3.8, quant: "Q4_K_M", contextLength: 131072, sizeBytes: 2.4 * GB },

  { id: "deepseek-coder-v2-lite-q4km", family: "DeepSeek-Coder-V2", name: "DeepSeek-Coder-V2-Lite-Instruct", task: "code", params: 16, quant: "Q4_K_M", contextLength: 131072, sizeBytes: 10.4 * GB },
  { id: "deepseek-r1-qwen-7b-q4km", family: "DeepSeek-R1-Distill", name: "DeepSeek-R1-Distill-Qwen-7B", task: "reasoning", params: 7, quant: "Q4_K_M", contextLength: 131072, sizeBytes: 4.7 * GB },
  { id: "deepseek-r1-qwen-14b-q4km", family: "DeepSeek-R1-Distill", name: "DeepSeek-R1-Distill-Qwen-14B", task: "reasoning", params: 14, quant: "Q4_K_M", contextLength: 131072, sizeBytes: 9.0 * GB },
];
