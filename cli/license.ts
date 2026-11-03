// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// `keeper license [status|verify <license>|activate <license>|deactivate] [--json]`:
// Keeper Pro's license on this computer. `verify` checks a license on its own,
// offline; the others ask the running app, which keeps the license in the keychain.
// In builds without Pro there is nothing to show, and the command says so.

import { connectToApp } from '../core/brain/client';
import { PLAN_NAME } from '../core/entitlements';
import { PRO_PUBLIC_KEYS } from '../core/pro/keys';
import { findToken, PROBLEM_TEXT, verifyLicense } from '../core/pro/license';
import { proEnabled } from '../core/pro-switch';

type Out = (data: unknown, human: () => void) => void;

declare const __KEEPER_OFFICIAL__: boolean | undefined;
const OFFICIAL = typeof __KEEPER_OFFICIAL__ === 'boolean' ? __KEEPER_OFFICIAL__ : false;

export const LICENSE_HELP = '  keeper license [status|verify <license>|activate <license>|deactivate]\n                             Keeper Pro on this computer (verify works offline)\n';

export async function cmdLicense(rest: string[], out: Out) {
  if (!proEnabled()) return out({ off: true }, () => console.log('Keeper Pro isn’t part of this version. Everything in Keeper is free.'));
  const [what = 'status', arg = ''] = rest;
  if (what === 'verify') {
    const token = findToken(arg);
    const keys = [...PRO_PUBLIC_KEYS, ...(!OFFICIAL && process.env.KEEPER_PRO_TEST_KEY ? [process.env.KEEPER_PRO_TEST_KEY] : [])];
    const c = token ? await verifyLicense(token, keys, Date.now()) : ({ ok: false, reason: 'malformed' } as const);
    if (!c.ok) process.exitCode = 1;
    return out(c, () => console.log(c.ok ? `Valid: Keeper ${PLAN_NAME[c.payload.plan]}, ${c.payload.seats} seat${c.payload.seats === 1 ? '' : 's'}, ${c.payload.exp ? `${c.state === 'grace' ? 'ended' : 'until'} ${new Date(c.payload.exp).toISOString().slice(0, 10)}` : 'never ends'}` : PROBLEM_TEXT[c.reason]));
  }
  if (!['status', 'activate', 'deactivate'].includes(what)) throw new Error('keeper license [status|verify <license>|activate <license>|deactivate]');
  const app = await connectToApp();
  if (!app) throw new Error('Open Keeper first: it keeps the license in this computer’s keychain.');
  try {
    const r = (await app.call('keeper/license', { action: what, token: findToken(arg) ?? arg })) as { text: string; data?: unknown; off?: boolean };
    out(r.off ? { off: true } : r.data, () => console.log(r.text));
  } finally {
    app.close();
  }
}
