// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's crash reports: off, with one report waiting to show the viewer.

import type { CrashReportsApi, CrashReportsStatus } from '../core/api-crash';
import { makeReport } from '../core/crash-report';

export function mockCrashReports(): { crashReports: CrashReportsApi } {
  let on = false;
  const r = makeReport({ version: '1.0.0', prerelease: false, platform: 'darwin', osRelease: '15.1.0', arch: 'arm64', process: 'window', kind: 'window-error', name: 'TypeError', stack: 'TypeError: x\n    at render (index-4f2a.js:12:3)\n    at commit (react.js:44:9)' });
  const status = async (): Promise<CrashReportsStatus> => ({ on, locked: false, next: on ? { v: 1, reports: [r] } : null, waiting: on ? 1 : 0, host: 'telemetry.ashforde.org' });
  return { crashReports: { status, setOn: async (v) => { on = v; return status(); }, clear: status, sendNow: status } };
}
