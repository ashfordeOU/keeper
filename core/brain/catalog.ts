// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every AI service Keeper knows how to talk to, and how: which API style, where
// it lives, how the key is sent, where its list of models is, and what it can
// do. Model names change often, so none are fixed here: Keeper reads each
// service's own list. No Node modules here (the interface reads this too).

/** The wire format a service speaks. */
export type ApiStyle = 'anthropic' | 'openai' | 'openai-responses' | 'gemini' | 'ollama' | 'bedrock';

/** How the key goes with each request. */
export type AuthStyle = 'bearer' | 'x-api-key' | 'api-key' | 'goog-key' | 'none';

export interface CatalogEntry {
  id: string;
  label: string;
  style: ApiStyle;
  baseUrl: string;
  auth: AuthStyle;
  /** path (relative to baseUrl) that lists models; empty when there is none */
  modelsPath: string;
  tools: boolean;
  streaming: boolean;
  jsonMode: boolean;
  /** runs on this computer */
  local?: boolean;
  /** no key needed */
  keyless?: boolean;
  /** where people get a key or learn more */
  docs?: string;
  /** what to fill in (e.g. a resource name in the address) */
  note?: string;
  group: 'cloud' | 'distributor' | 'local' | 'gateway' | 'enterprise';
}

export const CATALOG: CatalogEntry[] = [
  // Model makers
  { id: 'anthropic', label: 'Anthropic (Claude)', style: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', auth: 'x-api-key', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, docs: 'https://console.anthropic.com', group: 'cloud' },
  { id: 'openai', label: 'OpenAI', style: 'openai', baseUrl: 'https://api.openai.com/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, docs: 'https://platform.openai.com/api-keys', group: 'cloud' },
  { id: 'openai-responses', label: 'OpenAI (Responses API)', style: 'openai-responses', baseUrl: 'https://api.openai.com/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, docs: 'https://platform.openai.com/docs/api-reference/responses', group: 'cloud' },
  { id: 'gemini', label: 'Google Gemini', style: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', auth: 'goog-key', modelsPath: '/models', tools: true, streaming: false, jsonMode: true, docs: 'https://aistudio.google.com/apikey', group: 'cloud' },
  { id: 'xai', label: 'xAI (Grok)', style: 'openai', baseUrl: 'https://api.x.ai/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, docs: 'https://console.x.ai', group: 'cloud' },
  { id: 'mistral', label: 'Mistral', style: 'openai', baseUrl: 'https://api.mistral.ai/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, docs: 'https://console.mistral.ai', group: 'cloud' },
  { id: 'deepseek', label: 'DeepSeek', style: 'openai', baseUrl: 'https://api.deepseek.com/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, docs: 'https://platform.deepseek.com', group: 'cloud' },
  { id: 'cohere', label: 'Cohere (compatible API)', style: 'openai', baseUrl: 'https://api.cohere.ai/compatibility/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, docs: 'https://dashboard.cohere.com', group: 'cloud' },
  { id: 'moonshot', label: 'Moonshot (Kimi)', style: 'openai', baseUrl: 'https://api.moonshot.ai/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, group: 'cloud' },
  { id: 'qwen', label: 'Alibaba Qwen (international)', style: 'openai', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, group: 'cloud' },
  { id: 'perplexity', label: 'Perplexity', style: 'openai', baseUrl: 'https://api.perplexity.ai', auth: 'bearer', modelsPath: '', tools: false, streaming: true, jsonMode: true, group: 'cloud' },
  // Distributors and fast hosts
  { id: 'openrouter', label: 'OpenRouter', style: 'openai', baseUrl: 'https://openrouter.ai/api/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, docs: 'https://openrouter.ai/keys', group: 'distributor' },
  { id: 'together', label: 'Together AI', style: 'openai', baseUrl: 'https://api.together.xyz/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, group: 'distributor' },
  { id: 'groq', label: 'Groq', style: 'openai', baseUrl: 'https://api.groq.com/openai/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, group: 'distributor' },
  { id: 'fireworks', label: 'Fireworks AI', style: 'openai', baseUrl: 'https://api.fireworks.ai/inference/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, group: 'distributor' },
  { id: 'cerebras', label: 'Cerebras', style: 'openai', baseUrl: 'https://api.cerebras.ai/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, group: 'distributor' },
  { id: 'huggingface', label: 'Hugging Face (router)', style: 'openai', baseUrl: 'https://router.huggingface.co/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, group: 'distributor' },
  { id: 'nvidia', label: 'NVIDIA NIM', style: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, group: 'distributor' },
  // Enterprise clouds
  { id: 'azure', label: 'Azure OpenAI', style: 'openai', baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1', auth: 'api-key', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, note: 'Replace YOUR-RESOURCE with your Azure resource name; the model is your deployment name.', group: 'enterprise' },
  { id: 'bedrock', label: 'Amazon Bedrock (API key)', style: 'bedrock', baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com', auth: 'bearer', modelsPath: '', tools: true, streaming: false, jsonMode: false, note: 'Uses a Bedrock API key and the Converse API; change us-east-1 to your region. Signing with AWS access keys (SigV4) is not built in — use a gateway for that.', group: 'enterprise' },
  { id: 'vertex', label: 'Google Vertex AI (compatible endpoint)', style: 'openai', baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1/projects/YOUR-PROJECT/locations/us-central1/endpoints/openapi', auth: 'bearer', modelsPath: '', tools: true, streaming: true, jsonMode: true, note: 'Paste a short-lived token from `gcloud auth print-access-token` as the key; replace YOUR-PROJECT and the region.', group: 'enterprise' },
  // On this computer
  { id: 'ollama', label: 'Ollama', style: 'ollama', baseUrl: 'http://127.0.0.1:11434', auth: 'none', modelsPath: '/api/tags', tools: true, streaming: true, jsonMode: true, local: true, keyless: true, group: 'local' },
  { id: 'lmstudio', label: 'LM Studio', style: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', auth: 'none', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, local: true, keyless: true, group: 'local' },
  { id: 'llamacpp', label: 'llama.cpp server', style: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', auth: 'none', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, local: true, keyless: true, group: 'local' },
  { id: 'vllm', label: 'vLLM', style: 'openai', baseUrl: 'http://127.0.0.1:8000/v1', auth: 'none', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, local: true, keyless: true, group: 'local' },
  { id: 'jan', label: 'Jan', style: 'openai', baseUrl: 'http://127.0.0.1:1337/v1', auth: 'none', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, local: true, keyless: true, group: 'local' },
  // Gateways (one key, many models; also how SigV4/service accounts are usually handled)
  { id: 'litellm', label: 'LiteLLM-style gateway', style: 'openai', baseUrl: 'http://127.0.0.1:4000/v1', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, local: true, group: 'gateway' },
  { id: 'custom-openai', label: 'Any OpenAI-compatible address', style: 'openai', baseUrl: '', auth: 'bearer', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, group: 'gateway' },
  { id: 'custom-anthropic', label: 'Any Anthropic-compatible address', style: 'anthropic', baseUrl: '', auth: 'x-api-key', modelsPath: '/models', tools: true, streaming: true, jsonMode: true, group: 'gateway' },
];

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((c) => c.id === id);
}

/** Headers that carry the key in the way the service expects. */
export function authHeaders(auth: AuthStyle, key: string | undefined): Record<string, string> {
  if (!key || auth === 'none') return {};
  if (auth === 'bearer') return { authorization: `Bearer ${key}` };
  if (auth === 'x-api-key') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  if (auth === 'api-key') return { 'api-key': key };
  return { 'x-goog-api-key': key };
}

/** The request that lists a service's models. */
export function modelListRequest(e: Pick<CatalogEntry, 'style' | 'auth' | 'modelsPath'>, baseUrl: string, key?: string): { url: string; headers: Record<string, string> } | null {
  if (!e.modelsPath || !baseUrl) return null;
  const base = baseUrl.replace(/\/+$/, '');
  return { url: base + e.modelsPath + (e.style === 'gemini' ? '?pageSize=200' : ''), headers: authHeaders(e.auth, key) };
}

/** Model ids from any of the list formats services use, sorted. */
export function parseModelList(style: ApiStyle, data: unknown): string[] {
  const d = data as Record<string, unknown> | undefined;
  let ids: string[] = [];
  if (style === 'ollama' && Array.isArray(d?.models)) ids = (d!.models as { name?: string; model?: string }[]).map((m) => m.name ?? m.model ?? '');
  else if (style === 'gemini' && Array.isArray(d?.models)) {
    ids = (d!.models as { name?: string; supportedGenerationMethods?: string[] }[])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => (m.name ?? '').replace(/^models\//, ''));
  } else if (Array.isArray(d?.data)) ids = (d!.data as { id?: string }[]).map((m) => m.id ?? '');
  else if (Array.isArray(data)) ids = (data as { id?: string }[]).map((m) => m.id ?? '');
  return [...new Set(ids.filter(Boolean))].sort();
}

/** Prices per million tokens, entered by the person; Keeper does not guess them. */
export interface Price {
  input: number;
  output: number;
}

export interface UsageRecord {
  /** connection id */
  id: string;
  /** day, YYYY-MM-DD */
  day: string;
  calls: number;
  input: number;
  output: number;
  errors: number;
}

/** Adds one call to the running totals (one row per connection per day). */
export function addUsage(rows: UsageRecord[], id: string, at: number, input: number, output: number, error = false): UsageRecord[] {
  const day = new Date(at).toISOString().slice(0, 10);
  const out = rows.slice();
  const i = out.findIndex((r) => r.id === id && r.day === day);
  const row = i >= 0 ? { ...out[i] } : { id, day, calls: 0, input: 0, output: 0, errors: 0 };
  row.calls++;
  row.input += input;
  row.output += output;
  if (error) row.errors++;
  if (i >= 0) out[i] = row;
  else out.push(row);
  // Keep a year.
  const cutoff = new Date(at - 366 * 86_400_000).toISOString().slice(0, 10);
  return out.filter((r) => r.day >= cutoff);
}

export function costOf(r: Pick<UsageRecord, 'input' | 'output'>, p: Price | undefined): number | undefined {
  if (!p) return undefined;
  return (r.input / 1e6) * p.input + (r.output / 1e6) * p.output;
}
