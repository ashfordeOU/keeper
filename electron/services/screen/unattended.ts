// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Installs or removes the unattended-access service (core/screen/unattended.ts
// writes the definitions) through the elevate service: one administrator
// prompt. Only offered when one of your devices already has "Control this
// computer" and "Let it in without asking" here.

import { app } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UnattendedStatus } from '../../../core/access-types';
import { run } from '../../../core/platform';
import { canEnableUnattended, definition, installSteps, LINUX_UNIT_PATH, MAC_PLIST_PATH, stagedName, uninstallSteps, unattendedLimits, WIN_SERVICE, type UnattendedPaths } from '../../../core/screen/unattended';
import { runCmds } from '../elevate';

function paths(): UnattendedPaths {
  const exe = process.execPath;
  const daemon = path.join(__dirname, 'linkd.cjs');
  const user = os.userInfo().username;
  const helper = process.platform === 'darwin' ? path.join(path.dirname(exe), '..', 'Helpers', 'keeper-helper') : undefined;
  return { exe, daemon, dataDir: app.getPath('userData'), user, home: os.homedir(), helper };
}

let cachedInstalled: boolean | null = null;

async function installed(): Promise<boolean> {
  if (process.platform === 'linux') return existsSync(LINUX_UNIT_PATH);
  if (process.platform === 'darwin') return existsSync(MAC_PLIST_PATH);
  if (process.platform === 'win32') {
    const r = await run('sc.exe', ['query', WIN_SERVICE], 5000);
    return r.ok && /STATE/.test(r.stdout);
  }
  return false;
}

export function unattendedInstalledSync(): boolean {
  if (cachedInstalled !== null) return cachedInstalled;
  cachedInstalled = process.platform === 'linux' ? existsSync(LINUX_UNIT_PATH) : process.platform === 'darwin' ? existsSync(MAC_PLIST_PATH) : false;
  return cachedInstalled;
}

export async function unattendedStatus(devices: Parameters<typeof canEnableUnattended>[0], unattended: Record<string, boolean>): Promise<UnattendedStatus> {
  const supported = ['linux', 'darwin', 'win32'].includes(process.platform);
  const inst = supported ? await installed() : false;
  cachedInstalled = inst;
  return {
    platform: process.platform,
    supported,
    installed: inst,
    can: canEnableUnattended(devices, unattended),
    limits: unattendedLimits(process.platform),
    preview: supported ? definition(process.platform, paths()) : undefined,
  };
}

/**
 * Turns the service on or off. The daemon needs this device's Link key while
 * nobody is logged in (no keychain then): it is written to a file only this
 * account can read, the same protection as when there is no keychain at all.
 */
export async function setUnattended(on: boolean, deps: { identity: () => { pub: string; priv: string } }, devices: Parameters<typeof canEnableUnattended>[0], unattended: Record<string, boolean>): Promise<void> {
  if (!['linux', 'darwin', 'win32'].includes(process.platform)) throw new Error('Unattended access is not available on this system');
  const dir = path.join(app.getPath('userData'), 'unattended');
  const keyFile = path.join(app.getPath('userData'), 'link', 'unattended-key.json');
  if (on) {
    const can = canEnableUnattended(devices, unattended);
    if (!can.ok) throw new Error(can.reason);
    await fsp.mkdir(dir, { recursive: true });
    const staged = path.join(dir, stagedName(process.platform));
    await fsp.writeFile(staged, definition(process.platform, paths()), { mode: 0o644 });
    await fsp.mkdir(path.dirname(keyFile), { recursive: true });
    await fsp.writeFile(keyFile, JSON.stringify(deps.identity()), { mode: 0o600 });
    const r = await runCmds(installSteps(process.platform, staged, paths()));
    if (!r.ok) {
      await fsp.rm(keyFile, { force: true });
      throw new Error(r.message);
    }
  } else {
    const r = await runCmds(uninstallSteps(process.platform));
    await fsp.rm(keyFile, { force: true });
    if (!r.ok) throw new Error(r.message);
  }
  cachedInstalled = on;
}
