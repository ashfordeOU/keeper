// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// `keeper usage [--json] [--refresh]`: what is left of each tracked AI
// account's limits, from the running app (or, when it is closed, the last
// numbers it saved, marked as such).

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { connectToApp } from '../core/brain/client';
import { keeperDataDir } from '../core/brain/paths';
import type { Account, AccountState } from '../core/usage-tracker/model';
import { countdown, providerInfo } from '../core/usage-tracker/model';

type Out = (data: unknown, human: () => void) => void;

async function saved(): Promise<{ text: string; data: unknown } | null> {
  try {
    const s = JSON.parse(await fsp.readFile(path.join(keeperDataDir(), 'usage-tracker.json'), 'utf8')) as { accounts: Account[]; states: Record<string, AccountState> };
    const now = Date.now();
    const lines: string[] = ['(Keeper is not running: these are the last numbers it saved.)'];
    for (const a of s.accounts) {
      const st = s.states[a.id];
      lines.push(`${a.name} (${providerInfo(a.provider).label}${st ? `, ${st.accuracy}, read ${countdown(now - st.at)} ago` : ''})`);
      for (const l of st?.limits ?? []) lines.push(`  ${l.label}: ${l.usedPercent !== undefined ? `${Math.round(100 - l.usedPercent)}% left` : l.used !== undefined ? `${Math.round(l.used * 100) / 100}${l.unit ? ` ${l.unit}` : ''}` : ''}${l.resetsAt && l.resetsAt > now ? `, resets in ${countdown(l.resetsAt - now)}` : ''}`);
    }
    return { text: lines.join('\n'), data: { stale: true, accounts: s.accounts.map((a) => ({ id: a.id, name: a.name, service: a.provider, state: s.states[a.id] })) } };
  } catch {
    return null;
  }
}

export async function cmdUsage(flags: Record<string, string | boolean>, out: Out) {
  const app = await connectToApp();
  let r: { text?: string; data?: unknown; off?: boolean } | null = null;
  if (app) {
    try {
      r = (await app.call('keeper/usage', { refresh: !!flags.refresh })) as typeof r;
    } finally {
      app.close();
    }
  } else r = await saved();
  if (!r) throw new Error('Keeper is not running and has no saved AI usage yet. Open Keeper → Usage to add an account.');
  out(r.off ? { off: true } : r.data, () => console.log(r!.text ?? ''));
}
