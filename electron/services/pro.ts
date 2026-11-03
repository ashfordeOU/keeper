// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Pro in the app: core/pro/client.ts with the keychain, the data folder,
// the network and the browser plugged in. In builds without Pro (the default,
// core/pro-switch.ts) nothing here runs: no file, no keychain, no timer, no request.
//
// Unofficial builds (tests, people building from source) may point it elsewhere:
// KEEPER_PRO_CONFIG_URL, KEEPER_LICENSE_SERVER_URL, and KEEPER_PRO_TEST_KEY (one
// more public key to trust). Ashforde's own builds ignore all three.

import { app, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { freeThrough, proEnabled } from '../../core/pro-switch';
import { LICENSE_SERVER_URL, PRO_CONFIG_URL } from '../../core/pro/config';
import { ProClient, type ProStore } from '../../core/pro/client';
import { PRO_PUBLIC_KEYS } from '../../core/pro/keys';
import type { Plan } from '../../core/entitlements';
import { getSecret, setSecret } from '../store';

declare const __KEEPER_OFFICIAL__: boolean | undefined;
const OFFICIAL = typeof __KEEPER_OFFICIAL__ === 'boolean' ? __KEEPER_OFFICIAL__ : false;
const env = (k: string) => (!OFFICIAL ? process.env[k] : undefined) || undefined;

const file = () => path.join(app.getPath('userData'), 'pro.json');

let client: ProClient | null = null;
let notify: () => void = () => undefined;

function make(): ProClient {
  return new ProClient({
    enabled: proEnabled(),
    freeThrough: freeThrough(),
    edition: (process as { mas?: boolean }).mas ? 'mas' : 'direct',
    keys: [...PRO_PUBLIC_KEYS, ...(env('KEEPER_PRO_TEST_KEY') ? [env('KEEPER_PRO_TEST_KEY')!] : [])],
    configUrl: env('KEEPER_PRO_CONFIG_URL') ?? PRO_CONFIG_URL,
    serverUrl: env('KEEPER_LICENSE_SERVER_URL') ?? LICENSE_SERVER_URL,
    now: () => Date.now(),
    fetch: (url, init) => fetch(url, { ...init, credentials: 'omit', signal: AbortSignal.timeout(20_000) }),
    load: async () => {
      try { return JSON.parse(await fsp.readFile(file(), 'utf8')) as ProStore; } catch { return {}; }
    },
    save: async (s) => {
      await fsp.mkdir(path.dirname(file()), { recursive: true });
      await fsp.writeFile(file(), JSON.stringify(s), { mode: 0o600 });
    },
    getSecret,
    setSecret,
    openExternal: (url) => shell.openExternal(url),
    randomRef: () => randomBytes(16).toString('base64url'),
    every: (ms, fn) => {
      const t = setInterval(fn, ms);
      t.unref?.();
      return () => clearInterval(t);
    },
    changed: () => notify(),
  });
}

/** The one client (made on first use; in builds without Pro it never does anything). */
export function pro(): ProClient {
  return (client ??= make());
}

/** Starts the daily checks, only in builds with Pro switched on. */
export function startPro(onChange: () => void) {
  if (!proEnabled()) return;
  notify = onChange;
  void pro().start();
}

/** The plan, for anonymous usage stats (only asked for in builds with Pro). */
export async function currentPlan(): Promise<Plan> {
  if (!proEnabled()) return 'free';
  await pro().status();
  return pro().entitlements().plan;
}

/** keeper://license?token=… (from the e-mail or the checkout's thank-you page). False when Pro is off. */
export async function activateFromLink(url: string): Promise<{ ok: boolean; message: string } | null> {
  if (!proEnabled()) return null;
  try {
    await pro().activate(url);
    return { ok: true, message: 'Keeper Pro is on. Thank you!' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
