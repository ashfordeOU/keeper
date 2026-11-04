// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's actions (core/automation.ts) for the `keeper do` command, through
// the same local socket as the rest of the command (keeper-methods.ts), and
// the PowerShell commands on Windows. Every action ends as a keeper:// link
// that main.ts opens, so each channel does exactly the same thing.

import { app } from 'electron';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ACTIONS, actionLink, powershellModule } from '../../core/automation';
import { registerKeeperMethod } from './keeper-methods';

export function registerAutomation(d: { openLink: (url: string) => void }) {
  registerKeeperMethod('keeper/actions', () => ACTIONS.map((a) => ({ id: a.id, title: a.title, what: a.what, group: a.group, args: a.args })));
  registerKeeperMethod('keeper/do', (p) => {
    const args = (p.args && typeof p.args === 'object' ? p.args : {}) as Record<string, string>;
    const r = actionLink(String(p.action ?? ''), args);
    if (!r.ok) throw new Error(r.message);
    d.openLink(r.link);
    return { ok: true, action: String(p.action), link: r.link };
  });
}

/** Where Windows PowerShell 5 and PowerShell 7 look for this person's modules. */
export function powershellModuleDirs(home = os.homedir()): string[] {
  const docs = process.platform === 'win32' ? app.getPath('documents') : path.join(home, 'Documents');
  return [path.join(docs, 'WindowsPowerShell', 'Modules', 'Keeper'), path.join(docs, 'PowerShell', 'Modules', 'Keeper')];
}

/** Writes Keeper.psm1 for this person only (no administrator rights). */
export async function installPowershellModule(): Promise<{ ok: boolean; message: string }> {
  try {
    const text = powershellModule(app.getVersion());
    for (const dir of powershellModuleDirs()) {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'Keeper.psm1'), text, 'utf8');
    }
    return { ok: true, message: 'Added. In PowerShell, type Import-Module Keeper, then Get-Command -Module Keeper.' };
  } catch (e) {
    return { ok: false, message: `Could not add them: ${e instanceof Error ? e.message : String(e)}` };
  }
}
