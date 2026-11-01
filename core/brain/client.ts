// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The `keeper` command talking to the running app over its private channel
// (a socket only this user can open, plus a token), or — when the app is
// closed — loading the saved library and brain itself, read-only.

import { existsSync, promises as fsp } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { FileIndex } from '../indexer';
import { normalizeBrainSettings } from './config';
import { E5Embedder, e5Present } from './e5';
import { LocalBrain } from './local';
import { McpServer, type JsonRpcRequest, type JsonRpcResponse } from './mcp';
import { createProvider } from './providers';
import { ENDPOINT_FILE, keeperDataDir, type BrainEndpoint } from './paths';

export interface AppConnection {
  call(method: string, params?: Record<string, unknown>, onNotify?: (method: string, params: unknown) => void): Promise<unknown>;
  /** sends a raw line and passes every reply line to `onLine` (for proxying MCP) */
  raw(onLine: (line: string) => void): (line: string) => void;
  close(): void;
}

/** Connects to the running app, or returns null when it is not running. */
export async function connectToApp(dataDir = keeperDataDir()): Promise<AppConnection | null> {
  let ep: BrainEndpoint;
  try {
    ep = JSON.parse(await fsp.readFile(path.join(dataDir, 'brain', ENDPOINT_FILE), 'utf8'));
  } catch {
    return null;
  }
  const sock = await new Promise<net.Socket | null>((resolve) => {
    const s = net.connect(ep.socket, () => resolve(s));
    s.once('error', () => resolve(null));
    s.setTimeout(3000, () => { s.destroy(); resolve(null); });
  });
  if (!sock) return null;
  sock.setTimeout(0);
  sock.setEncoding('utf8');
  let buf = '';
  const lineHandlers = new Set<(line: string) => void>();
  sock.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      for (const h of lineHandlers) h(line);
    }
  });
  const ok = await new Promise<boolean>((resolve) => {
    const h = (line: string) => { lineHandlers.delete(h); try { resolve(!!JSON.parse(line).ok); } catch { resolve(false); } };
    lineHandlers.add(h);
    // Agents Keeper started carry a hub token and their terminal's id in the environment.
    sock.write(JSON.stringify({ token: ep.token, agent: process.env.KEEPER_AGENT_TOKEN, session: process.env.KEEPER_SESSION }) + '\n');
    sock.once('close', () => resolve(false));
  });
  if (!ok) { sock.destroy(); return null; }
  let seq = 0;
  return {
    call(method, params, onNotify) {
      const id = `c${++seq}`;
      return new Promise((resolve, reject) => {
        const h = (line: string) => {
          let m: JsonRpcResponse & { method?: string; params?: unknown };
          try { m = JSON.parse(line); } catch { return; }
          if (m.method && m.id === undefined) { onNotify?.(m.method, m.params); return; }
          if (m.id !== id) return;
          lineHandlers.delete(h);
          if (m.error) reject(new Error(m.error.message));
          else resolve(m.result);
        };
        lineHandlers.add(h);
        sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    raw(onLine) {
      lineHandlers.add(onLine);
      return (line) => sock.write(line.endsWith('\n') ? line : line + '\n');
    },
    close() {
      sock.end();
    },
  };
}

/** The saved library and brain, for when the app is not running (read-only). */
export async function offlineBrain(dataDir = keeperDataDir(), opts: { semantic?: boolean; syncMs?: number } = {}): Promise<{ brain: LocalBrain; server: McpServer } | null> {
  if (!existsSync(path.join(dataDir, 'index.json'))) return null;
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(await fsp.readFile(path.join(dataDir, 'settings.json'), 'utf8'));
  } catch {
    /* defaults */
  }
  const b = normalizeBrainSettings(raw.brain as never, raw.ai as never);
  const excluded = Array.isArray(raw.excluded) ? (raw.excluded as string[]) : [];
  const folders = Array.isArray(raw.folders) ? (raw.folders as string[]) : [];
  const index = new FileIndex(path.join(dataDir, 'index.json'), folders.map((p) => ({ path: p, label: path.basename(p) })), excluded);
  if (!(await index.load())) return null;
  // Never write the app's files from here: the save directory is a scratch copy.
  const brain = new LocalBrain({
    index: () => index,
    dir: path.join(dataDir, 'brain'),
    excluded: () => excluded,
    visibility: () => b.visibility,
    redactAlways: () => b.redactAlways,
    home: os.homedir(),
    // Keys live in the system keychain through the app; offline, only keyless local AIs work.
    provider: async () => {
      const c = b.connections.find((x) => x.id === b.active);
      if (!c || !(c.kind === 'ollama' || (c.kind === 'openai-compatible' && /127\.0\.0\.1|localhost/.test(c.baseUrl ?? '')))) return null;
      return createProvider({ kind: c.kind, model: c.model, baseUrl: c.baseUrl, tools: c.tools, contextTokens: c.contextTokens });
    },
  });
  await brain.load();
  brain.markDirty = () => undefined;
  // Catch up on files changed since the app last ran (kept in memory only, and time-boxed).
  await brain.sync({ signal: AbortSignal.timeout(opts.syncMs ?? 15_000) }).catch(() => undefined);
  if ((opts.semantic ?? b.semantic) && (await e5Present(path.join(dataDir, 'models')))) {
    try {
      await brain.useEmbedder(await E5Embedder.load(path.join(dataDir, 'models'), { threads: 2 }));
      // Passages the app has not reached yet: do a few here, briefly.
      const until = Date.now() + 8000;
      while (brain.engine.pendingCount && Date.now() < until && (await brain.engine.embedSome(16, (p) => index.files.get(p)))) { /* continue */ }
    } catch {
      /* the model runtime is not available to this command: words only */
    }
  }
  const server = new McpServer({
    env: brain.harnessEnv(),
    version: 'offline',
    redact: b.mcpRedact,
    status: () => ({ ...brain.status(), note: 'Keeper is not running; this is the last saved index.' }),
    savedSearches: () => (Array.isArray(raw.savedSearches) ? (raw.savedSearches as { id: string; name: string; text: string }[]) : []),
  });
  return { brain, server };
}

export type { JsonRpcRequest };
