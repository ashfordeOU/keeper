// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// AI usage for local model servers and services that keep nothing on this
// computer: Ollama and LM Studio answer on localhost (nothing leaves the
// computer); Antigravity has no local record, so it says where to look.

import { lmStudioModels, ollamaPs, USAGE_TOOLS, type UsageReport, type UsageTool, type UsageWindow } from '../../core/island-tools/usage';

async function local(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const label = (t: UsageTool) => USAGE_TOOLS.find((x) => x.id === t)?.label ?? t;
const how = (t: UsageTool) => USAGE_TOOLS.find((x) => x.id === t)?.how ?? '';

function report(tool: UsageTool, body: unknown | null, parse: (b: unknown) => UsageWindow[], source: string): UsageReport {
  if (body === null) return { tool, label: label(tool), state: 'none', windows: [], source: '', message: how(tool), updatedAt: Date.now() };
  const w = parse(body);
  return { tool, label: label(tool), state: 'ok', windows: w.length ? w : [{ label: 'Running, no model loaded' }], source, updatedAt: Date.now() };
}

/** Local model servers that answer, plus services with nothing local; only reports the person can use are returned. */
export async function localModelReports(): Promise<UsageReport[]> {
  const ollamaBase = process.env.OLLAMA_HOST ? (/^https?:/.test(process.env.OLLAMA_HOST) ? process.env.OLLAMA_HOST : `http://${process.env.OLLAMA_HOST}`) : 'http://127.0.0.1:11434';
  const [o, l] = await Promise.all([local(`${ollamaBase.replace(/\/$/, '')}/api/ps`), local('http://127.0.0.1:1234/api/v0/models')]);
  return [
    report('ollama', o, ollamaPs, 'From Ollama on this computer'),
    report('lmstudio', l, lmStudioModels, 'From LM Studio on this computer'),
    { tool: 'antigravity', label: label('antigravity'), state: 'none', windows: [], source: '', message: how('antigravity'), updatedAt: Date.now() },
  ];
}
