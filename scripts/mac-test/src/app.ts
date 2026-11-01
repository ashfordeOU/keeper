// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Drives the real Keeper app with Playwright's Electron support, always with
// a throwaway home folder and data folder (sandbox-paths.cjs points every
// Electron path there before Keeper's own code runs). A launch is refused,
// and Keeper closed again, if any path still points at the owner's home.
// In a dry run a stand-in answers from fixtures, so the flow can be proven
// without a Mac.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface WinInfo { id: number; title: string; url: string; bounds: { x: number; y: number; width: number; height: number }; visible: boolean; onTop: boolean; type?: string }

export interface KeeperApp {
  readonly fake: boolean;
  /** window.keeper.<path>(...args) in the main window */
  call<T = unknown>(api: string, ...args: unknown[]): Promise<T>;
  /** the same from the Island window */
  islandCall<T = unknown>(api: string, ...args: unknown[]): Promise<T>;
  /** a function run in Electron's main process: ({ app, BrowserWindow, screen, ... }, arg); the label names its stand-in answer in a dry run */
  main<T = unknown>(label: string, fn: (electron: any, arg: any) => T | Promise<T>, arg?: unknown): Promise<T>;
  /** a function run in the main window's page (the label names its stand-in answer in a dry run) */
  page<T = unknown>(label: string, fn: (arg: any) => T | Promise<T>, arg?: unknown): Promise<T>;
  windows(): Promise<WinInfo[]>;
  /** a PNG of a window whose URL or title matches */
  capture(match: string, file: string): Promise<boolean>;
  /** a PNG of the main window */
  screenshot(file: string): Promise<boolean>;
  /** clicks a selector in the main window (best effort) */
  click(selector: string): Promise<boolean>;
  pid(): Promise<number | undefined>;
  /** as a crash would */
  kill(): Promise<void>;
  close(): Promise<void>;
  readonly startupMs: number;
}

export interface LaunchOpts {
  root: string;
  home: string;
  userData: string;
  sandboxPaths: string;
  logDir: string;
  env: Record<string, string>;
  /** the launch number, for log names */
  n: number;
  extraArgs?: string[];
}

export class SafetyError extends Error {}

const PATHS = ['home', 'appData', 'userData', 'sessionData', 'temp', 'desktop', 'documents', 'downloads', 'music', 'pictures', 'videos', 'logs', 'crashDumps'];

export function electronEnv(o: Pick<LaunchOpts, 'home' | 'userData' | 'sandboxPaths' | 'env'>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') base[k] = v;
  return {
    ...base,
    ...o.env,
    HOME: o.home,
    KEEPER_MACTEST_HOME: o.home,
    KEEPER_MACTEST_USERDATA: o.userData,
    // --import (not --require, which this Electron ignores in NODE_OPTIONS); a file URL needs no quoting
    NODE_OPTIONS: `--import ${pathToFileURL(o.sandboxPaths).href}`,
    KEEPER_SKIP_TOUR: '1',
    XDG_CONFIG_HOME: path.join(o.home, '.config'),
    XDG_DATA_HOME: path.join(o.home, '.local/share'),
    XDG_CACHE_HOME: path.join(o.home, '.cache'),
  };
}

/** Every Electron path must be inside the throwaway home. */
export function checkPaths(paths: Record<string, string>, home: string): string[] {
  const bad: string[] = [];
  const h = home.replace(/\/+$/, '');
  for (const [k, v] of Object.entries(paths)) {
    if (k === 'temp' || k === 'exe' || k === 'appPath') continue;
    if (typeof v !== 'string' || !(v === h || v.startsWith(h + '/'))) bad.push(`${k} = ${v}`);
  }
  return bad;
}

export async function launchKeeper(o: LaunchOpts): Promise<KeeperApp> {
  const req = createRequire(path.join(o.root, 'package.json'));
  let pw: any;
  try { pw = req('playwright-core'); } catch { pw = req('playwright'); }
  const electronPath = req('electron') as string;
  const env = electronEnv(o);
  const t0 = Date.now();
  const args = [o.root, `--user-data-dir=${o.userData}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...(o.extraArgs ?? [])];
  const app = await pw._electron.launch({ executablePath: electronPath, args, env, timeout: 90_000 });
  const log = fs.createWriteStream(path.join(o.logDir, `keeper-main-${o.n}.log`), { flags: 'a' });
  try {
    app.process().stdout?.on('data', (d: Buffer) => log.write(d));
    app.process().stderr?.on('data', (d: Buffer) => log.write(d));
  } catch { /* no streams */ }
  // Safety first: if any path is the owner's own, stop right here.
  const paths = await app.evaluate(({ app: a }: any, names: string[]) => {
    const out: Record<string, string> = {};
    for (const n of names) { try { out[n] = a.getPath(n); } catch { /* not on this system */ } }
    out.processHome = process.env.HOME ?? '';
    return out;
  }, PATHS);
  fs.writeFileSync(path.join(o.logDir, `keeper-paths-${o.n}.json`), JSON.stringify(paths, null, 2));
  const bad = checkPaths(paths, o.home);
  if (bad.length) {
    try { await app.evaluate(({ app: a }: any) => a.exit(0)); } catch { /* closing */ }
    try { app.process().kill('SIGKILL'); } catch { /* gone */ }
    throw new SafetyError(`Keeper would have used the owner's own folders (${bad.join('; ')}). The run stopped Keeper before going on.`);
  }

  const findMain = () => app.windows().find((w: any) => { const u = w.url(); return u && !u.startsWith('data:') && !u.startsWith('devtools:') && (!u.includes('view=') || u.includes('view=app')); });
  const findIsland = () => app.windows().find((w: any) => w.url().includes('view=island'));
  let main: any;
  for (let i = 0; i < 120 && !main; i++) {
    main = findMain();
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  if (!main) throw new Error('Keeper did not open its window in 60 seconds');
  await main.waitForSelector('.sidebar', { timeout: 90_000 });
  const startupMs = Date.now() - t0;
  await main.click('.tour button:has-text("Skip tour")', { timeout: 2000 }).catch(() => undefined);
  main.on('pageerror', (e: Error) => log.write(`[pageerror] ${e.message}\n`));
  main.on('console', (m: any) => { if (m.type() === 'error') log.write(`[console.error] ${m.text()}\n`); });

  const callIn = async (page: any, api: string, args: unknown[]) => page.evaluate(([p, a]: [string[], unknown[]]) => {
    let o: any = (window as any).keeper;
    for (const k of p.slice(0, -1)) o = o?.[k];
    const f = o?.[p[p.length - 1]];
    if (typeof f !== 'function') throw new Error(`window.keeper.${p.join('.')} is not a function`);
    return f(...a);
  }, [api.split('.'), args]);

  const k: KeeperApp = {
    fake: false,
    startupMs,
    call: (api, ...a) => callIn(findMain() ?? main, api, a),
    islandCall: async (api, ...a) => {
      const isl = findIsland();
      if (!isl) throw new Error('No Island window');
      return callIn(isl, api, a);
    },
    main: (_label, fn, arg) => app.evaluate(fn, arg),
    page: (_label, fn, arg) => (findMain() ?? main).evaluate(fn, arg),
    windows: () => app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows().filter((w: any) => !w.isDestroyed()).map((w: any) => ({
      id: w.id, title: w.getTitle(), url: w.webContents.getURL(), bounds: w.getBounds(), visible: w.isVisible(), onTop: w.isAlwaysOnTop(),
    }))),
    capture: async (match, file) => {
      const b64 = await app.evaluate(async ({ BrowserWindow }: any, m: string) => {
        const w = BrowserWindow.getAllWindows().find((x: any) => !x.isDestroyed() && (x.webContents.getURL().includes(m) || x.getTitle() === m));
        if (!w) return null;
        const img = await w.webContents.capturePage();
        return img.isEmpty() ? null : img.toPNG().toString('base64');
      }, match).catch(() => null);
      if (!b64) return false;
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      return true;
    },
    screenshot: async (file) => { try { await (findMain() ?? main).screenshot({ path: file }); return true; } catch { return false; } },
    click: async (sel) => { try { await (findMain() ?? main).click(sel, { timeout: 4000 }); return true; } catch { return false; } },
    pid: () => app.evaluate(() => process.pid).catch(() => undefined),
    kill: async () => {
      const pid = await app.evaluate(() => process.pid).catch(() => undefined);
      try { if (pid) process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
      try { app.process().kill('SIGKILL'); } catch { /* gone */ }
      await new Promise((r) => setTimeout(r, 800));
      log.end();
    },
    close: async () => {
      try {
        // the dev copy of Electron registered itself for keeper:// links at start; take that back
        await app.evaluate(({ app: a }: any) => { try { a.removeAsDefaultProtocolClient('keeper'); } catch { /* fine */ } });
      } catch { /* closed already */ }
      await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
      try { app.process().kill('SIGKILL'); } catch { /* gone */ }
      log.end();
    },
  };
  return k;
}

// ---------------------------------------------------------------- the dry-run stand-in

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export function fakeKeeper(fixtures: Record<string, unknown>): KeeperApp {
  const calls = new Map<string, number>();
  const answer = (api: string, args: unknown[]) => {
    const n = calls.get(api) ?? 0;
    calls.set(api, n + 1);
    if (!(api in fixtures)) return {};
    const v = fixtures[api] as any;
    if (v && typeof v === 'object' && '$error' in v) throw new Error(String(v.$error));
    if (v && typeof v === 'object' && Array.isArray(v.$seq)) return v.$seq[Math.min(n, v.$seq.length - 1)];
    if (v && typeof v === 'object' && v.$byArg && typeof args[0] === 'string') return v.$byArg[args[0]] ?? v.$byArg['*'] ?? {};
    return structuredClone(v);
  };
  return {
    fake: true,
    startupMs: 4321,
    call: async (api, ...a) => answer(api, a) as any,
    islandCall: async (api, ...a) => answer(api, a) as any,
    main: async (label) => answer(`main:${label}`, []) as any,
    page: async (label) => answer(`page:${label}`, []) as any,
    windows: async () => (fixtures['windows'] as WinInfo[]) ?? [],
    capture: async (_m, file) => { fs.writeFileSync(file, PNG_1PX); return true; },
    screenshot: async (file) => { fs.writeFileSync(file, PNG_1PX); return true; },
    click: async () => true,
    pid: async () => 4242,
    kill: async () => undefined,
    close: async () => undefined,
  };
}

export const ONE_PIXEL_PNG = PNG_1PX;
