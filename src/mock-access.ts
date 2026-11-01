// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote access for the browser demo: a help code, an audit log with a few
// days of history, a saved command's output, unattended access ready to turn
// on. Nothing leaves the page and no prompt opens by itself.

import type { AccessApi, AuditEntry, HelpStatusView } from '../core/api-access';
import type { DeviceMeta } from '../core/link/fleet';

const MIN = 60_000;

export function mockAccess(emit: (channel: string, ...args: unknown[]) => void): { access: AccessApi } {
  const now = Date.now();
  let help: HelpStatusView = { guests: [] };
  const audit: AuditEntry[] = [
    { id: 'a1', at: now - 6 * MIN, kind: 'transfer', direction: 'out', device: 'p4t9wz6ek2rsm8va', deviceName: 'Home server', title: 'Sent Holiday 2026.mov', detail: '2.4 GB · direct', ok: true },
    { id: 'a2', at: now - 25 * MIN, kind: 'command', direction: 'out', device: 'p4t9wz6ek2rsm8va', deviceName: 'Home server', title: 'Ran a command on Home server (exit 0)', detail: 'df -h /srv', ok: true },
    { id: 'a3', at: now - 50 * MIN, kind: 'help', direction: 'in', device: 'help:x', deviceName: 'Sam', title: 'Sam helped you', detail: 'Stopped sharing', ok: true, until: now - 38 * MIN },
    { id: 'a4', at: now - 3 * 3600_000, kind: 'terminal', direction: 'out', device: 'p4t9wz6ek2rsm8va', deviceName: 'Home server', title: 'Opened a terminal on Home server', ok: true },
    { id: 'a5', at: now - 26 * 3600_000, kind: 'screen', direction: 'out', device: 'kq3m8hx2abcdtw7n', deviceName: 'Studio iMac', title: 'You controlled Studio iMac for 12 min', ok: true },
    { id: 'a6', at: now - 30 * 3600_000, kind: 'command', direction: 'in', device: 'g7cn3ve8yu5qhd2b', deviceName: 'Work laptop', title: 'Work laptop asked to run a command; you said no', detail: 'rm -rf ~/Downloads/old', ok: false },
  ];
  const no = async () => {
    throw new Error('Not available in the demo');
  };
  const access: AccessApi = {
    helpStart: async () => {
      help = { ...help, offer: { code: '482915307', password: 'K7PM4X', expires: Date.now() + 10 * MIN, link: 'keeper://help?code=482915307', reach: ['lan', 'relay'], webUrl: 'http://192.168.1.14:47821/c/#help' } };
      emit('access-help');
      return help.offer!;
    },
    helpStop: async () => {
      help = { guests: [] };
      emit('access-help');
    },
    helpStatus: async () => help,
    helpJoin: no,
    setMeta: async (_d, m) => ({ tags: [], commands: [], ...m }) as DeviceMeta,
    audit: async (f = {}) => audit.filter((e) => (!f.device || e.device === f.device) && (!f.q || e.title.toLowerCase().includes(f.q.toLowerCase()))),
    exportAudit: async () => null,
    exec: async (_d, command) => ({ code: 0, stdout: command.startsWith('df') ? 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/md0        7.3T  4.1T  3.2T  57% /srv' : 'done', stderr: '', ms: 140 }),
    power: async () => undefined,
    info: async () => ({ name: 'Home server', os: 'Linux', release: '6.8.0', arch: 'x64', cpus: 8, cpuModel: 'Intel Core i5-12400', memTotal: 32 * 1024 ** 3, memFree: 19 * 1024 ** 3, uptime: 19 * 86400, load: [0.21, 0.3, 0.28], disks: [{ mount: '/', total: 500 * 1024 ** 3, free: 310 * 1024 ** 3 }, { mount: '/srv', total: 8 * 1024 ** 4, free: 3.2 * 1024 ** 4 }], user: 'demo', keeper: '0.1.0', at: Date.now() }),
    print: async () => undefined,
    termOpen: no,
    termWrite: async () => undefined,
    termResize: async () => undefined,
    termClose: async () => undefined,
    pendingCommands: async () => [],
    answerCommand: async () => undefined,
    unattended: async () => ({ platform: 'darwin', supported: true, installed: false, can: { ok: true }, limits: ['Files, terminals and commands work after a restart, before anyone logs in.', 'Showing the login window needs the Keeper helper running as root and Screen Recording allowed; macOS may still block typing there.'] }),
    setUnattended: no,
    directStats: async () => ({ attempts: 3, ok: 2, failed: 1, lastError: '', openSockets: 1 }),
  };
  return { access };
}
