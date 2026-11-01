// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Privacy & Security over IPC, and the browser extension's reports through
// Keeper's local socket (keeper/security.siteReport, used by `keeper browser-host`).

import { ipcMain } from 'electron';
import type { ScanKind, SiteReport } from '../../core/security/types';
import * as sec from '../services/security';
import { registerKeeperMethod } from '../services/brain';
import { onFeature } from '../services/features';
import { registerSecurityGuide } from '../services/security/guide-bridge';

type Deps = Parameters<typeof sec.startSecurity>[0];

export function registerSecurityIpc(deps: Deps) {
  const h = (name: string, fn: (...a: never[]) => unknown) => ipcMain.handle(`security.${name}`, (_e, ...a) => fn(...(a as never[])));
  h('overview', (refresh?: boolean) => sec.overview(refresh));
  h('permissions', () => sec.permissions());
  h('revoke', (g: Parameters<typeof sec.revoke>[0]) => sec.revoke(g));
  h('browsers', () => sec.browsers());
  h('connections', () => sec.connections());
  h('installBrowserHost', () => sec.installBrowserHost());
  h('persistence', () => sec.persistence());
  h('scan', (kind: ScanKind, paths?: string[]) => sec.scan(kind, paths));
  h('stopScan', (id: string) => sec.stopScan(id));
  h('scans', () => sec.scans());
  h('quarantine', () => sec.quarantine());
  h('quarantineFile', (p: string) => sec.quarantineFile(p));
  h('restore', (id: string, to?: string) => sec.restore(id, to));
  h('deleteQuarantined', (id: string) => sec.deleteQuarantined(id));
  h('events', (limit?: number) => sec.events(limit));
  h('settings', () => sec.settings());
  h('setSettings', (p: Parameters<typeof sec.setSettings>[0]) => sec.setSettings(p));
  h('ignore', (id: string, ignored: boolean) => sec.ignore(id, ignored));
  h('fix', (id: string) => sec.fix(id));
  h('installClamav', () => sec.installClamav());
  h('updateSignatures', () => sec.updateSignatures());
  h('checkPassword', (pw: string) => sec.checkPassword(String(pw ?? '')));
  h('exportReport', () => sec.exportReport());

  // Findings also appear in Keeper's To do list, with guided fixes.
  registerSecurityGuide();

  registerKeeperMethod('keeper/security.siteReport', (p) => {
    sec.siteReport(p as unknown as SiteReport);
    return { ok: true };
  });

  // On with the feature; off stops every watcher and scan.
  let started = false;
  onFeature('security', (on) => {
    if (on && !started) {
      started = true;
      void sec.startSecurity(deps);
    } else if (!on && started) {
      started = false;
      sec.stopSecurity();
    }
  }, { now: true });
}

export function stopSecurityIpc() {
  sec.stopSecurity();
}
