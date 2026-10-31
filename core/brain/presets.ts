// SPDX-License-Identifier: AGPL-3.0-or-later
// Ready-made AI endpoints, shared by the app and its interface (no Node modules here).

/** Ready-made endpoints people pick from; all speak the OpenAI chat format. */
export const COMPATIBLE_PRESETS: { id: string; label: string; baseUrl: string; local?: boolean; keyless?: boolean }[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'xai', label: 'xAI', baseUrl: 'https://api.x.ai/v1' },
  { id: 'lmstudio', label: 'LM Studio (this computer)', baseUrl: 'http://127.0.0.1:1234/v1', local: true, keyless: true },
  { id: 'llamacpp', label: 'llama.cpp server (this computer)', baseUrl: 'http://127.0.0.1:8080/v1', local: true, keyless: true },
  { id: 'jan', label: 'Jan (this computer)', baseUrl: 'http://127.0.0.1:1337/v1', local: true, keyless: true },
];

/** Is this address on this computer? */
export function isLocalUrl(u: string | undefined): boolean {
  if (!u) return false;
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
  } catch {
    return false;
  }
}
