// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The brain in the browser demo: real search over the demo files, and an
// assistant that answers a few questions the way the real one would.

import type { BrainApi, ConnectionsInfo } from '../core/api-brain';
import type { BrainHit, BrainStatus } from '../core/brain-contract';
import { COMPATIBLE_PRESETS } from '../core/brain/presets';
import type { TraceStep } from '../core/brain/harness';
import { search as metaSearch } from '../core/query/match';
import { parseQuery } from '../core/query/parse';
import type { FileEntry } from '../core/types';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mockBrain(files: FileEntry[], emit: (channel: string, v: unknown) => void, home: string): { brain: BrainApi } {
  let semantic: BrainStatus['semantic'] = 'ready';
  const status = (): BrainStatus => ({
    files: files.length, indexed: files.length, withText: files.filter((f) => f.text).length + 212, passages: 1840, embedded: semantic === 'ready' ? 1795 : 0,
    pending: semantic === 'ready' ? 45 : 0, semantic, semanticModel: semantic === 'off' ? undefined : 'Multilingual E5 small (8-bit)', updatedAt: Date.now() - 40_000,
  });
  const hit = (f: FileEntry, score: number, snippet?: string): BrainHit => ({ path: f.path, name: f.name, kind: f.kind, size: f.size, mtime: f.mtime, score, snippet, source: f.source?.name, tags: f.tags, why: snippet ? ['words', 'meaning'] : ['name'] });
  const search = async (q: string, limit = 20): Promise<BrainHit[]> => {
    const hits = metaSearch(files, parseQuery(q).query);
    // The demo has no text index; loosen to any word so questions still find files.
    const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const loose = hits.length ? [] : files.filter((f) => words.some((w) => `${f.name} ${f.text ?? ''}`.toLowerCase().includes(w)));
    const list = hits.length ? hits.map((h) => ({ f: h.file, s: h.snippet })) : loose.map((f) => ({ f, s: f.text?.slice(0, 160) }));
    return list.slice(0, limit).map((x, i) => hit(x.f, Math.max(0.2, 1 - i * 0.08), x.s));
  };
  const conns: ConnectionsInfo = {
    active: 'anthropic',
    connections: [
      { id: 'anthropic', kind: 'anthropic', label: 'Claude', model: 'claude-opus-5-5', hasKey: true, local: false, needsKey: true },
      { id: 'openai', kind: 'openai', label: 'OpenAI', model: 'gpt-5', baseUrl: 'https://api.openai.com/v1', hasKey: false, local: false, needsKey: true },
      { id: 'ollama', kind: 'ollama', label: 'Ollama (this computer)', model: 'llama3.2', baseUrl: 'http://127.0.0.1:11434', hasKey: true, local: true, needsKey: false },
      { id: 'apple', kind: 'platform', label: 'Apple Intelligence (on this Mac)', model: 'on-device', hasKey: true, local: true, needsKey: false },
    ],
    kinds: [
      { kind: 'anthropic', label: 'Claude (Anthropic)', available: true },
      { kind: 'openai', label: 'OpenAI', available: true },
      { kind: 'openai-compatible', label: 'Any OpenAI-compatible service', available: true },
      { kind: 'ollama', label: 'Ollama (this computer)', available: true },
      { kind: 'platform', label: 'Apple Intelligence (on this Mac)', available: true },
    ],
    presets: COMPATIBLE_PRESETS,
  };
  const apps = [
    { id: 'claude-desktop', label: 'Claude desktop app', file: `${home}/Library/Application Support/Claude/claude_desktop_config.json`, installed: true, connected: true },
    { id: 'vscode', label: 'Visual Studio Code', file: `${home}/Library/Application Support/Code/User/mcp.json`, installed: true, connected: false },
    { id: 'cursor', label: 'Cursor', file: `${home}/.cursor/mcp.json`, installed: true, connected: false },
    { id: 'windsurf', label: 'Windsurf', file: `${home}/.codeium/windsurf/mcp_config.json`, installed: false, connected: false },
    { id: 'lmstudio', label: 'LM Studio', file: `${home}/.lmstudio/mcp.json`, installed: true, connected: false },
    { id: 'zed', label: 'Zed', file: `${home}/.config/zed/settings.json`, installed: false, connected: false },
  ];
  const brain: BrainApi = {
    status: async () => status(),
    search: async (q, o) => search(q, o?.limit),
    async ask(reqId, question) {
      const steps: TraceStep[] = [];
      const step = async (s: TraceStep) => { await wait(350); steps.push(s); emit('brain-step', { reqId, step: s }); };
      const q = question.toLowerCase();
      const hits = await search(/wifi|wi-fi|password/.test(q) ? 'wifi password' : /invoice|owe|pay|due/.test(q) ? 'invoice' : /tax/.test(q) ? 'tax' : question, 8);
      await step({ tool: 'search_files', args: { query: question }, summary: `${hits.length} files for “${question}”`, ms: 42 });
      const top = hits[0];
      let answer: string;
      if (top) {
        await step({ tool: 'read_file', args: { path: top.path }, summary: `read ${top.name}`, ms: 18 });
        const short = top.path.replace(home, '~');
        answer = /wifi|wi-fi|password/.test(q)
          ? `The Wi-Fi network **Studio-5G** uses the password shown in your screenshot from 28 October [[${short}]].`
          : /invoice|owe|pay|due/.test(q)
            ? `Acme's Q3 invoice (#4471) is for **$4,200.00**, due on 15 November. It came in from Gmail two days ago [[${short}]].`
            : `The closest match is **${top.name}** [[${short}]]${hits[1] ? `, and also ${hits[1].name} [[${hits[1].path.replace(home, '~')}]]` : ''}.`;
      } else {
        answer = 'I could not find anything about that in your files. Try different words, or check that the folder is in your library.';
      }
      let out = '';
      for (const part of answer.match(/.{1,12}/gs) ?? []) { out += part; emit('brain-delta', { reqId, text: part }); await wait(30); }
      return {
        answer: out, sources: hits.slice(0, 4), trace: steps, provider: conns.connections.find((c) => c.id === conns.active)?.label ?? 'Claude', model: 'claude-opus-5-5',
        actions: top && /invoice/.test(q) ? [{ type: 'tag', path: top.path, tag: 'to-pay', reason: 'Due on 15 November' }, { type: 'move', path: top.path, to: `${home}/Documents/Invoices`, reason: 'Keep invoices together' }] : [],
        redacted: /wifi|password/.test(q) ? { password: 1 } : undefined, messages: [],
      };
    },
    cancel: async () => undefined,
    async setSemantic(on) {
      semantic = on ? 'ready' : 'off';
      emit('brain-status', status());
      return status();
    },
    removeModel: async () => { semantic = 'off'; return status(); },
    rebuild: async () => status(),
    connections: async () => conns,
    testConnection: async (id) => ({ ok: true, message: `${conns.connections.find((c) => c.id === id)?.label} answered: “ready”` }),
    apps: async () => apps,
    async setAppConnected(id, on) {
      const a = apps.find((x) => x.id === id)!;
      a.connected = on;
      return { ok: true, message: on ? `Added Keeper to ${a.label}. Restart ${a.label} to use it.` : `Removed Keeper from ${a.label}.` };
    },
    server: async () => ({
      http: false, port: 0, token: 'demo-token-not-real', socket: `${home}/Library/Application Support/Keeper/brain/keeper.sock`,
      snippets: [
        { id: 'json', label: 'Any MCP app (JSON)', text: JSON.stringify({ mcpServers: { keeper: { command: '/Applications/Keeper.app/Contents/MacOS/Keeper', args: ['/Applications/Keeper.app/Contents/Resources/app.asar/dist-cli/keeper.cjs', 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } } } }, null, 2) },
        { id: 'claude-code', label: 'Claude Code (terminal)', text: 'claude mcp add --env ELECTRON_RUN_AS_NODE=1 keeper -- /Applications/Keeper.app/Contents/MacOS/Keeper /Applications/Keeper.app/Contents/Resources/app.asar/dist-cli/keeper.cjs mcp' },
      ],
    }),
    modelSize: async () => 135_390_915,
  };
  return { brain };
}
