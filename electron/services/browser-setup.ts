// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Setting up Keeper's browser extension, as far as browsers allow: Keeper
// registers itself with every browser it finds (no button needed), opens the
// store page or the browser's extensions page, and shows the folder to pick.
// Adding the extension itself stays the person's click: browsers allow
// nothing else outside company policies, which Keeper does not use.

import { clipboard, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectBrowsers, hostLocationFor, openInBrowser, setupDef, storeListing, type DetectedBrowser, type SetupBrowserId } from '../../core/browser-setup';
import type { AddExtensionResult, BrowserSetupStatus } from '../../core/api-settingsplus';
import type { BrowserSession } from '../../core/browser-tabs';
import { browserHostRegistered, installBrowserHost } from './security';
import { prepareExtensionCopies } from './browser-extension-copy';

const home = () => os.homedir();

function detect(sessions: Pick<BrowserSession, 'browser'>[]): DetectedBrowser[] {
  return detectBrowsers({
    platform: process.platform, home: home(), env: process.env, exists: existsSync, sessions,
    linked: (id) => { const loc = hostLocationFor(process.platform, home(), id); return !!loc && browserHostRegistered(loc); },
  });
}

let lastLink = 0;
let linking: Promise<{ installed: string[]; extensionFolder: string }> | null = null;

/**
 * Registers Keeper with every supported browser found (and refreshes the
 * extension copy). The first run after start always checks, so a moved or
 * updated Keeper re-points the registrations; after that it runs when a
 * browser is found that is not registered, at most once a minute unless forced.
 * Files that are already right are not written again.
 */
export async function autoLink(sessions: Pick<BrowserSession, 'browser'>[] = [], force = false): Promise<{ installed: string[]; extensionFolder: string } | null> {
  const found = detect(sessions).filter((b) => b.supported);
  const first = !lastLink;
  if (!force && (!found.length || (!first && (found.every((b) => b.linked) || Date.now() - lastLink < 60_000)))) return null;
  lastLink = Date.now();
  const also = found.map((b) => setupDef(b.id)?.host).filter((h): h is string => !!h);
  linking ??= installBrowserHost(also, force).finally(() => { linking = null; });
  return linking;
}

export async function setupStatus(sessions: Pick<BrowserSession, 'browser'>[]): Promise<BrowserSetupStatus> {
  await autoLink(sessions).catch(() => undefined);
  return { browsers: detect(sessions), connected: sessions.length > 0 };
}

function runOpen(c: { file: string; args: string[]; verbatim?: boolean; detached?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (c.detached) {
        const child = spawn(c.file, c.args, { detached: true, stdio: 'ignore' });
        child.once('error', () => resolve(false));
        child.once('spawn', () => { child.unref(); resolve(true); });
        return;
      }
      execFile(c.file, c.args, { timeout: 15_000, windowsVerbatimArguments: !!c.verbatim, windowsHide: true }, (err) => resolve(!err));
    } catch {
      resolve(false);
    }
  });
}

async function openIn(id: SetupBrowserId, url: string): Promise<boolean> {
  for (const c of openInBrowser(process.platform, id, url)) if (await runOpen(c)) return true;
  return false;
}

/** Shows the extension's folder (Chromium) or its manifest.json (Firefox) and copies the path. */
export async function revealExtension(id: SetupBrowserId): Promise<{ ok: boolean; folder: string }> {
  const def = setupDef(id);
  const copies = await prepareExtensionCopies();
  const folder = def?.engine === 'firefox' ? path.join(copies.firefox, 'manifest.json') : copies.chromium;
  if (!existsSync(folder)) return { ok: false, folder };
  // Selecting the folder in its parent shows it ready to drag or pick; the path goes to the clipboard to paste.
  shell.showItemInFolder(folder);
  clipboard.writeText(folder);
  return { ok: true, folder };
}

export async function addExtension(id: SetupBrowserId): Promise<AddExtensionResult> {
  const def = setupDef(id);
  if (!def || def.engine === 'webkit') return { ok: false, mode: 'unsupported', opened: false, message: 'Safari support is coming.' };
  // Make sure this browser is registered before the extension first looks for Keeper.
  const registered = detect([]).find((b) => b.id === id)?.linked;
  await autoLink([], !registered).catch(() => undefined);
  const store = storeListing(id);
  if (store) {
    const opened = (await openIn(id, store)) || (await shell.openExternal(store).then(() => true, () => false));
    return { ok: opened, mode: 'store', opened, page: store };
  }
  const opened = await openIn(id, def.page);
  // The page address goes on the clipboard only if the browser did not open it; otherwise the folder's path is there to paste.
  const r = await revealExtension(id);
  if (!opened && !r.ok) clipboard.writeText(def.page);
  return { ok: r.ok, mode: 'unpacked', opened, page: def.page, folder: r.folder };
}
