// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings on disk, and API keys encrypted with the operating system's keychain.

import { app, safeStorage } from 'electron';
import { promises as fsp, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEVELOPER_ID } from './build-flags';
import { overallState, readSealed, type KeychainStatus, type SecretState } from '../core/keychain';
import { defaultFolders } from '../core/platform';
import { defaultRules } from '../core/rules';
import { keepChoices, presetPatch } from '../core/features';
import { defaultSettings, mergeSettings, type AllSettings } from '../core/settings';

declare const __KEEPER_OFFICIAL__: boolean | undefined;
const OFFICIAL = typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__;

const file = () => path.join(app.getPath('userData'), 'settings.json');
const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json');

let current: AllSettings | null = null;
/** A part of the suite (`--keeper-role=island|widgets|mail`), not the app. */
const IN_PART = process.argv.some((a) => a.startsWith('--keeper-role=') && a !== '--keeper-role=app');
const listeners = new Set<(s: AllSettings, prev: AllSettings) => void>();

export function settings(): AllSettings {
  if (current) return current;
  const base = defaultSettings(defaultFolders().map((f) => f.path), defaultRules(os.homedir()));
  let raw: Record<string, unknown> | null = null;
  try {
    raw = JSON.parse(readFileSync(file(), 'utf8'));
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') {
    // A new install: the defaults (and the first-run setup) apply; nothing to keep.
    // Test runs of a development build can ask for the defaults from before 1.0 instead
    // (KEEPER_DEFAULTS=before-1.0), for end-to-end checks written against them.
    current = { ...base, featuresPinned: true };
    if (!OFFICIAL && process.env.KEEPER_DEFAULTS === 'before-1.0') current = { ...current, ...keepChoices(current) };
    // Recommended without knowing the computer yet (setup refines it), written through the
    // older settings some parts live in (the AI's own switch, the Island's coding assistants).
    else current = { ...current, ...presetPatch(current, 'recommended') };
    return current;
  }
  current = mergeSettings(base, raw);
  if (raw.featuresPinned !== true) {
    // Someone upgrading: write down what is on and off for them now, before any newer
    // default can change it, and do not show them the first-run setup again.
    current = { ...current, ...keepChoices(current), featuresPinned: true, setupDone: raw.setupDone === false ? false : true };
    // Only the app writes settings.json; a part of the suite (docs/SUITE.md) adopts the app's settings once connected.
    if (!IN_PART) void persist();
  }
  return current;
}

/**
 * In a part of the suite (the Island, widgets: electron/suite/part.ts) the app
 * owns settings.json: changes are sent to it, and its answer is adopted here.
 */
let remoteWriter: ((patch: Partial<AllSettings>) => Promise<AllSettings>) | null = null;
export function setSettingsWriter(fn: (patch: Partial<AllSettings>) => Promise<AllSettings>) {
  remoteWriter = fn;
}

/** Settings as the app has them now (a part hears of every change). */
export function adoptSettings(next: AllSettings) {
  const prev = settings();
  current = next;
  for (const l of listeners) {
    try {
      l(next, prev);
    } catch (e) {
      console.error('settings listener failed', e);
    }
  }
}

export async function updateSettings(patch: Partial<AllSettings>): Promise<AllSettings> {
  if (remoteWriter) {
    const next = await remoteWriter(patch);
    adoptSettings(next);
    return next;
  }
  const prev = settings();
  const next: AllSettings = mergeSettings(prev, { ...prev, ...patch, island: { ...prev.island, ...(patch.island ?? {}) }, ai: { ...prev.ai, ...(patch.ai ?? {}) }, platform: { ...prev.platform, ...(patch.platform ?? {}) } });
  current = next;
  // One part failing to react must not stop the others (or the windows hearing about the change).
  for (const l of listeners) {
    try {
      l(next, prev);
    } catch (e) {
      console.error('settings listener failed', e);
    }
  }
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

export function secureAvailable(): boolean {
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
  noteRead(name, clean ? 'ok' : 'missing');
  return true;
}

// What the last reads found per secret: a saved one the keychain would not
// open is "locked", never "missing" (see core/keychain.ts).
const lastRead = new Map<string, SecretState>();
const keychainListeners = new Set<(s: KeychainStatus) => void>();
let lastState: KeychainStatus['state'] = 'ok';

export function keychainStatus(): KeychainStatus {
  const bad = [...lastRead.values()].filter((s) => s === 'locked' || s === 'unavailable').length;
  return { state: overallState([...lastRead.values()]), platform: process.platform, unreadable: bad || undefined, updateAsks: process.platform === 'darwin' && !DEVELOPER_ID };
}

export function onKeychain(fn: (s: KeychainStatus) => void): () => void {
  keychainListeners.add(fn);
  return () => keychainListeners.delete(fn);
}

function noteRead(name: string, state: SecretState) {
  if (state === 'missing') lastRead.delete(name);
  else lastRead.set(name, state);
  announceKeychain();
}

/** What the last reads of the secrets under a prefix found, except "ok" (for another Keeper process). */
export function secretStates(prefix: string): Record<string, SecretState> {
  return Object.fromEntries([...lastRead].filter(([n, s]) => n.startsWith(prefix) && s !== 'ok'));
}

/**
 * What another Keeper process found reading its own secrets (Mail and calendars in a
 * process of its own reads `pim.*`): kept with this process's own reads, so the
 * keychain banner covers them too. Replaces everything earlier under that prefix.
 */
export function adoptSecretStates(prefix: string, states: Record<string, SecretState>) {
  for (const n of [...lastRead.keys()]) if (n.startsWith(prefix)) lastRead.delete(n);
  for (const [n, st] of Object.entries(states ?? {})) if (n.startsWith(prefix) && (st === 'locked' || st === 'unavailable')) lastRead.set(n, st);
  announceKeychain();
}

function announceKeychain() {
  const now = keychainStatus();
  if (now.state === lastState) return;
  lastState = now.state;
  for (const l of keychainListeners) {
    try { l(now); } catch { /* one listener failing must not stop the rest */ }
  }
}

/** A saved secret and whether it could be read: 'locked' means it is there but the keychain said no. */
export async function readSecretState(name: string): Promise<{ state: SecretState; value?: string }> {
  const stored = (await readSecrets())[name];
  const r = readSealed(stored, secureAvailable(), (b) => safeStorage.decryptString(b), process.platform);
  noteRead(name, r.state);
  return r;
}

export async function getSecret(name: string): Promise<string | undefined> {
  return (await readSecretState(name)).value;
}

/** Whether a saved secret exists but cannot be read now (the keychain refused). */
export async function secretLocked(name: string): Promise<boolean> {
  const s = (await readSecretState(name)).state;
  return s === 'locked' || s === 'unavailable';
}

/** Reads every saved secret again: after Try again (macOS asks again when it can), or at start. */
export async function retryKeychain(): Promise<KeychainStatus> {
  const all = await readSecrets();
  for (const name of Object.keys(all)) await readSecretState(name);
  for (const name of [...lastRead.keys()]) if (!(name in all)) noteRead(name, 'missing');
  return keychainStatus();
}

export async function hasSecret(name: string): Promise<boolean> {
  return !!(await readSecrets())[name];
}
