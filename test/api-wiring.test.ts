// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every method the interface's API type promises (core/api.ts KeeperApi) must be
// exposed by the preload script, and every preload call must reach a handler in
// the main process. A method that exists only in the demo mocks used to crash a
// page in the real app (Browser tabs: setup/addExtension/revealExtension).

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const root = path.resolve(__dirname, '..');

// What the preload hands the page, and the channel each method calls.
const exposed: { api?: Record<string, unknown> } = {};
const calls: { kind: 'invoke' | 'send' | 'sendSync'; ch: string }[] = [];
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_k: string, v: Record<string, unknown>) => { exposed.api = v; } },
  ipcRenderer: {
    invoke: (ch: string) => { calls.push({ kind: 'invoke', ch }); return Promise.resolve(); },
    send: (ch: string) => { calls.push({ kind: 'send', ch }); },
    sendSync: (ch: string) => { calls.push({ kind: 'sendSync', ch }); },
    on: () => undefined,
    removeListener: () => undefined,
  },
  webUtils: { getPathForFile: () => '' },
}));

/** Methods the preload answers itself, without asking the main process. */
const RENDERER_ONLY = new Set(['on', 'files.pathOf', 'preview.url', 'voice.hud.level']);

/** The API type's methods as dotted paths ("pim.accounts", "places.trash.list"). */
function typeMethods(): string[] {
  const file = path.join(root, 'core/api.ts');
  const program = ts.createProgram([file], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true, types: [] });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(file)!;
  let api: ts.Type | undefined;
  ts.forEachChild(sf, (n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === 'KeeperApi') api = checker.getTypeAtLocation(n);
  });
  expect(api, 'KeeperApi interface').toBeTruthy();
  const out: string[] = [];
  const walk = (t: ts.Type, prefix: string, depth: number) => {
    for (const p of checker.getPropertiesOfType(t)) {
      const decl = p.valueDeclaration ?? p.declarations?.[0];
      if (!decl) continue;
      const pt = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(p, decl));
      const name = prefix ? `${prefix}.${p.name}` : p.name;
      if (pt.getCallSignatures().length) out.push(name);
      else if (depth < 3 && pt.flags & ts.TypeFlags.Object) walk(pt, name, depth + 1);
    }
  };
  walk(api!, '', 0);
  return out;
}

async function preloadMethods(): Promise<Map<string, { kind: string; ch: string } | null>> {
  await import('../electron/preload');
  const out = new Map<string, { kind: string; ch: string } | null>();
  const walk = (o: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      const name = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'function') {
        if (RENDERER_ONLY.has(name)) { out.set(name, null); continue; }
        calls.length = 0;
        try { void (v as (...a: unknown[]) => unknown)(); } catch { /* local helpers may need arguments */ }
        out.set(name, calls[0] ?? null);
      } else if (v && typeof v === 'object') walk(v as Record<string, unknown>, name);
    }
  };
  walk(exposed.api!, '');
  return out;
}

/** All main-process sources, for finding where each channel is handled. */
function mainSources(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && !/preload/.test(e.name)) parts.push(fs.readFileSync(p, 'utf8'));
    }
  };
  walk(path.join(root, 'electron'));
  walk(path.join(root, 'core'));
  return parts.join('\n');
}

describe('API wiring', () => {
  it('the preload exposes every method of the API type, and every channel has a handler', async () => {
    const want = typeMethods();
    expect(want.length).toBeGreaterThan(800);
    const have = await preloadMethods();

    const missing = want.filter((m) => !have.has(m));
    expect(missing, 'in core/api*.ts but not exposed by electron/preload.ts').toEqual([]);

    const src = mainSources();
    const literal = (ch: string) => src.includes(`'${ch}'`) || src.includes(`"${ch}"`) || src.includes('`' + ch + '`');
    // Groups registered in a loop (`${group}.${name}` over an object of functions).
    const dynamic = (group: string) =>
      src.includes('`' + group + '.${') || src.includes(`('${group}', `) || src.includes(`'${group}.' +`) || src.includes(`h = (name: string, fn: (...args: never[]) => unknown) => ipcMain.handle(\`${group}.`);
    const defined = (name: string) => new RegExp(`(^|[\\s,{'"])${name}['"]?\\s*[:(]|\\b${name}\\s*=\\s*(async\\s*)?\\(|h\\('${name}'|handle\\('${name}'`, 'm').test(src);

    const unhandled: string[] = [];
    for (const [method, call] of have) {
      if (!call) {
        if (!RENDERER_ONLY.has(method)) unhandled.push(`${method} (calls nothing)`);
        continue;
      }
      if (literal(call.ch)) continue;
      const dot = call.ch.lastIndexOf('.');
      const group = call.ch.slice(0, dot), name = call.ch.slice(dot + 1);
      if (dynamic(group) && defined(name)) continue;
      unhandled.push(`${method} → ${call.ch}`);
    }
    expect(unhandled, 'preload methods with no main-process handler').toEqual([]);
  });
});
