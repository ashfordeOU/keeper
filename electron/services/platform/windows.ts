// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Windows: its own text recognition (Windows.Media.Ocr), "Search with Keeper"
// in File Explorer, the taskbar menu, and registering Keeper with the
// on-device agent registry so Copilot and other agents can use it.

import { app } from 'electron';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodePowerShell, explorerMenuReg, odrManifest, WINDOWS_OCR_LANGS_SCRIPT, windowsOcrScript } from '../../../core/platform-integrations';
import { run } from '../../../core/platform';

const PS = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Windows PowerShell 5.1 (not 7): it can load WinRT types directly. The script goes in encoded, never through a shell. */
function ps(script: string, timeout = 60_000) {
  return run(PS(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(script)], timeout);
}

let ocrLangs: Promise<string[]> | null = null;

/** Languages Windows can read; empty when none are installed or this is not Windows 10+. */
export function windowsOcrLanguages(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  ocrLangs ??= ps(WINDOWS_OCR_LANGS_SCRIPT, 20_000).then((r) => {
    try {
      const v = JSON.parse(r.stdout.trim() || '[]');
      return Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : [];
    } catch {
      return [];
    }
  });
  return ocrLangs;
}

/** Text from an image with Windows' own recognition; undefined means "use the built-in reader". */
export async function windowsOcr(file: string): Promise<string | undefined> {
  if (!(await windowsOcrLanguages()).length) return undefined;
  const r = await ps(windowsOcrScript(file), 60_000);
  try {
    const v = JSON.parse(r.stdout.trim().split(/\r?\n/).pop() ?? '{}') as { text?: string; error?: string };
    return v.error ? undefined : v.text ?? '';
  } catch {
    return undefined;
  }
}

/** Adds or removes "Search with Keeper" on folders in File Explorer (this user only, no admin). */
export async function setExplorerMenu(on: boolean): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  let ok = true;
  for (const args of explorerMenuReg(exe, on)) {
    const r = await run('reg', args, 10_000);
    // Deleting a key that is not there is fine.
    if (!r.ok && on) ok = false;
  }
  return ok;
}

/** Right-click on the taskbar icon: Search, Ask and Copy Text from Screen. */
export function setJumpList() {
  if (process.platform !== 'win32') return;
  const exe = process.execPath;
  try {
    app.setUserTasks([
      { program: exe, arguments: 'keeper://quick', iconPath: exe, iconIndex: 0, title: 'Search', description: 'Find a file with Keeper' },
      { program: exe, arguments: 'keeper://ask', iconPath: exe, iconIndex: 0, title: 'Ask Keeper', description: 'Ask a question about your files' },
      { program: exe, arguments: 'keeper://capture', iconPath: exe, iconIndex: 0, title: 'Copy Text from Screen', description: 'Pick an area and copy the text in it' },
    ]);
  } catch {
    /* not available (e.g. portable copies on old Windows) */
  }
}

let odrPath: Promise<string | null> | null = null;

/** The on-device agent registry command, when this Windows has it. */
export function findOdr(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  odrPath ??= run('where.exe', ['odr.exe'], 8000).then((r) => (r.ok ? r.stdout.split(/\r?\n/)[0].trim() || null : null));
  return odrPath;
}

export function windowsBuild(): number {
  if (process.platform !== 'win32') return 0;
  return Number(os.release().split('.')[2]) || 0;
}

/** Registers Keeper's MCP server with the agent registry. Returns what the registry said. */
export async function registerWithOdr(launch: { command: string; args: string[] }): Promise<{ ok: boolean; message: string }> {
  const odr = await findOdr();
  if (!odr) return { ok: false, message: 'The on-device agent registry is not available on this PC.' };
  const dir = path.join(app.getPath('userData'), 'agent-registry');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'manifest.json');
  await fsp.writeFile(file, JSON.stringify(odrManifest(launch.command, launch.args, app.getVersion()), null, 2));
  const r = await run(odr, ['mcp', 'add', file], 60_000);
  return { ok: r.ok, message: (r.stdout || r.stderr).trim().slice(0, 500) || (r.ok ? 'Registered.' : 'The registry did not accept Keeper.') };
}

/** Running as a Store (MSIX) package gives an app identity; Windows' own AI models require one. */
export function hasPackageIdentity(): boolean {
  return process.platform === 'win32' && !!(process as { windowsStore?: boolean }).windowsStore;
}
