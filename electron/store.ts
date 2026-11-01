// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings on disk, and API keys encrypted with the operating system's keychain.

import { app, safeStorage } from 'electron';
import { promises as fsp, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultFolders } from '../core/platform';
import { defaultRules } from '../core/rules';
import { defaultSettings, mergeSettings, type AllSettings } from '../core/settings';

const file = () => path.join(app.getPath('userData'), 'settings.json');
const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json');

let current: AllSettings | null = null;
const listeners = new Set<(s: AllSettings, prev: AllSettings) => void>();

export function settings(): AllSettings {
  if (current) return current;
  const base = defaultSettings(defaultFolders().map((f) => f.path), defaultRules(os.homedir()));
  try {
    current = mergeSettings(base, JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    current = base;
  }
  return current;
}

export async function updateSettings(patch: Partial<AllSettings>): Promise<AllSettings> {
  const prev = settings();
  const next: AllSettings = mergeSettings(prev, { ...prev, ...patch, island: { ...prev.island, ...(patch.island ?? {}) }, ai: { ...prev.ai, ...(patch.ai ?? {}) }, platform: { ...prev.platform, ...(patch.platform ?? {}) } });
  current = next;
  for (const l of listeners) l(next, prev);
  await persist();
  return current;
}

// Writes go one after another, each through its own temporary file, so two
// changes made at the same moment can never trip over each other.
let writing: Promise<void> = Promise.resolve();
let seq = 0;
function persist(): Promise<void> {
  writing = writing.then(async () => {
    const tmp = `${file()}.${process.pid}.${++seq}.tmp`;
    await fsp.mkdir(path.dirname(file()), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(current, null, 2));
    await fsp.rename(tmp, file());
  }).catch(() => undefined);
  return writing;
}

export function onSettings(fn: (s: AllSettings, prev: AllSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------- secrets

function secureAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // On Linux without a keyring Electron falls back to a fixed key; that is not real protection.
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false;
  return true;
}

async function readSecrets(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fsp.readFile(secretsFile(), 'utf8'));
  } catch {
    return {};
  }
}

export async function setSecret(name: string, value: string): Promise<boolean> {
  const all = await readSecrets();
  const clean = value.trim();
  if (!clean) delete all[name];
  else if (secureAvailable()) all[name] = 'enc:' + safeStorage.encryptString(clean).toString('base64');
  else return false;
  await fsp.mkdir(path.dirname(secretsFile()), { recursive: true });
  await fsp.writeFile(secretsFile(), JSON.stringify(all), { mode: 0o600 });
  return true;
}

export async function getSecret(name: string): Promise<string | undefined> {
  const v = (await readSecrets())[name];
  if (!v?.startsWith('enc:') || !secureAvailable()) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
  } catch {
    return undefined;
  }
}

export async function hasSecret(name: string): Promise<boolean> {
  return !!(await readSecrets())[name];
}
