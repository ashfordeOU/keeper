// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// macOS: the on-device Apple Intelligence model, Live Text recognition and
// Spotlight, all through keeper-helper. When the helper is missing (a build
// without it, or an older Mac) every caller falls back quietly.

import { app } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { spotlightItem, pathFromResultId, type PlatformFacts } from '../../../core/platform-integrations';
import type { FileEntry } from '../../../core/types';
import { HelperClient } from './helper-client';
import { toHit } from './brain-adapter';

export interface HelloInfo {
  version: string;
  macos: number;
  arm: boolean;
  appleModel: NonNullable<PlatformFacts['appleModel']>;
  ocr: boolean;
  spotlight: boolean;
}

export function helperPath(): string | undefined {
  const candidates = app.isPackaged
    ? [path.join(path.dirname(process.execPath), 'keeper-helper')]
    : [
      path.join(app.getAppPath(), 'native/macos/KeeperHelper/.build/apple/Products/Release/keeper-helper'),
      path.join(app.getAppPath(), 'native/macos/KeeperHelper/.build/release/keeper-helper'),
    ];
  return candidates.find((p) => existsSync(p));
}

let client: HelperClient | null = null;
let hello: Promise<HelloInfo | null> | null = null;

function helper(): HelperClient | null {
  if (process.platform !== 'darwin') return null;
  if (client) return client;
  const p = helperPath();
  if (!p) return null;
  client = new HelperClient(p);
  return client;
}

/** Any helper method (the Island's Calendar and Reminders use this); rejects without a helper. */
export function macHelperCall<T = unknown>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
  const h = helper();
  if (!h) return Promise.reject(new Error('The macOS helper is not available'));
  return h.call<T>(method, params, { timeoutMs });
}

/** A helper method that streams lines (Stage's key and click events) until the signal stops it. */
export function macHelperStream(method: string, params: unknown, onDelta: (text: string) => void, signal: AbortSignal): Promise<unknown> {
  const h = helper();
  if (!h) return Promise.reject(new Error('The macOS helper is not available'));
  return h.call(method, params, { onDelta, signal });
}

/** What the helper says about this Mac; null without a helper. Asked once. */
export function macHello(): Promise<HelloInfo | null> {
  hello ??= (async () => {
    const h = helper();
    if (!h) return null;
    try {
      return await h.call<HelloInfo>('hello', undefined, { timeoutMs: 8000 });
    } catch {
      h.disable();
      return null;
    }
  })();
  return hello;
}

/** Re-asks about the model (it may have finished downloading). */
export function refreshMacHello() {
  hello = null;
  return macHello();
}

// ---------------------------------------------------------------- text recognition

/** Live Text on the file; undefined when it is not available, so the built-in reader runs instead. */
export async function macOcr(file: string, languages: string[] = []): Promise<string | undefined> {
  const info = await macHello();
  if (!info?.ocr) return undefined;
  try {
    const r = await helper()!.call<{ text: string }>('ocr', { path: file, languages: appleLanguages(languages) }, { timeoutMs: 60_000 });
    return r.text;
  } catch {
    return undefined;
  }
}

/** Keeper keeps reader language codes like "eng"; Vision wants "en-US". Unknown ones mean "detect it". */
function appleLanguages(codes: string[]): string[] {
  const map: Record<string, string> = {
    eng: 'en-US', fra: 'fr-FR', deu: 'de-DE', spa: 'es-ES', ita: 'it-IT', por: 'pt-BR', chi_sim: 'zh-Hans', chi_tra: 'zh-Hant',
    jpn: 'ja-JP', kor: 'ko-KR', rus: 'ru-RU', ukr: 'uk-UA', ara: 'ar-SA', tha: 'th-TH', vie: 'vi-VT', nld: 'nl-NL', pol: 'pl-PL',
    tur: 'tr-TR', ces: 'cs-CZ', swe: 'sv-SE', dan: 'da-DK', nor: 'no-NO', fin: 'fi-FI', ind: 'id-ID', msa: 'ms-MY', ron: 'ro-RO',
  };
  const out = codes.map((c) => map[c]).filter((c): c is string => !!c);
  return out.length === codes.length ? out : [];
}

// ---------------------------------------------------------------- the on-device model

export interface PlatformChatRequest {
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
  temperature?: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  runTool?: (name: string, args: unknown) => Promise<unknown>;
}

/** A chat provider backed by a model built into the operating system. */
export interface PlatformChatProvider {
  id: string;
  label: string;
  local: true;
  supportsTools: boolean;
  /** the on-device model has a small window; callers should keep context short */
  contextTokens: number;
  available(): Promise<{ ok: boolean; reason?: string }>;
  chat(req: PlatformChatRequest): Promise<{ text: string }>;
}

export const appleProvider: PlatformChatProvider = {
  id: 'apple',
  label: 'Apple Intelligence (on this Mac)',
  local: true,
  supportsTools: true,
  contextTokens: 4096,
  async available() {
    const info = await refreshMacHello();
    if (!info) return { ok: false, reason: 'Keeper’s macOS helper is not available' };
    return info.appleModel === 'available' ? { ok: true } : { ok: false, reason: info.appleModel };
  },
  async chat(req) {
    const h = helper();
    if (!h || (await macHello())?.appleModel !== 'available') throw new Error('Apple Intelligence is not available on this Mac');
    return h.call<{ text: string }>('chat', { system: req.system, messages: req.messages, tools: req.tools, temperature: req.temperature }, {
      signal: req.signal, onDelta: req.onDelta, onTool: req.runTool, timeoutMs: 180_000,
    });
  },
};

// ---------------------------------------------------------------- Spotlight

const syncFile = () => path.join(app.getPath('userData'), 'spotlight.json');
let syncing = false;

/**
 * Brings Spotlight up to date with the library: new and changed files are
 * (re)indexed in batches, removed ones deleted. Only Keeper's own items are
 * touched; Spotlight's usual index of the disk is left alone.
 */
export async function syncSpotlight(files: FileEntry[]): Promise<{ added: number; removed: number } | null> {
  const info = await macHello();
  if (!info?.spotlight || syncing) return null;
  syncing = true;
  try {
    let known: Record<string, number> = {};
    try {
      known = JSON.parse(await fsp.readFile(syncFile(), 'utf8'));
    } catch {
      /* first run */
    }
    const now: Record<string, number> = {};
    const changed: FileEntry[] = [];
    for (const f of files) {
      if (f.cloudOnly) continue;
      const stamp = f.mtime + (f.text?.length ?? 0) + (f.tags?.length ?? 0);
      now[f.path] = stamp;
      if (known[f.path] !== stamp) changed.push(f);
    }
    const gone = Object.keys(known).filter((p) => !(p in now));
    const h = helper()!;
    for (let i = 0; i < changed.length; i += 400) {
      const items = changed.slice(i, i + 400).map((f) => spotlightItem(toHit(f, 1), f.text));
      await h.call('spotlight.index', { items }, { timeoutMs: 120_000 });
    }
    for (let i = 0; i < gone.length; i += 1000) {
      await h.call('spotlight.remove', { ids: gone.slice(i, i + 1000).map((p) => 'f:' + p) }, { timeoutMs: 60_000 });
    }
    await fsp.writeFile(syncFile(), JSON.stringify(now));
    return { added: changed.length, removed: gone.length };
  } finally {
    syncing = false;
  }
}

export async function clearSpotlight(): Promise<void> {
  const info = await macHello();
  if (!info?.spotlight) return;
  await helper()!.call('spotlight.removeAll', undefined, { timeoutMs: 60_000 }).catch(() => undefined);
  await fsp.rm(syncFile(), { force: true });
}

/** Spotlight hands back the item's id when someone opens a Keeper result. */
export function pathFromSpotlightActivity(type: string, info: unknown): string | undefined {
  if (type !== 'com.apple.corespotlightitem') return undefined;
  const id = (info as Record<string, unknown> | undefined)?.kCSSearchableItemActivityIdentifier;
  return typeof id === 'string' ? pathFromResultId(id) : undefined;
}

export function stopHelper() {
  client?.stop();
}
