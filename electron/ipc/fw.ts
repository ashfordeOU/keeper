// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC and command-line access for Keeper's firewall.

import { ipcMain } from 'electron';
import { fwApi, initFirewall, stopFirewall } from '../services/fw';
import { health, sample } from '../services/net';
import { registerKeeperMethod } from '../services/brain';

export function registerFirewallIpc(deps: { alert: (title: string, detail: string) => void; broadcast: (ch: string, ...a: unknown[]) => void }) {
  for (const [k, fn] of Object.entries(fwApi)) ipcMain.handle(`fw.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  // The keeper command: keeper fw rules|allow|deny|alerts|log|profile|silent|status
  registerKeeperMethod('keeper/fw', async (p) => {
    const cmd = String(p.cmd ?? 'status');
    const args = (p.args as string[] | undefined) ?? [];
    const s = await fwApi.status();
    if (cmd === 'status') return { mode: s.state.mode, profile: s.state.activeProfile, enforcement: s.enforcement, dns: s.dns, pending: s.pending.length, caps: s.caps };
    if (cmd === 'rules') return s.state.groups.map((g) => ({ group: g.name, enabled: g.enabled, rules: g.rules }));
    if (cmd === 'alerts') return s.pending;
    if (cmd === 'log') return s.recent.slice(0, Number(args[0] ?? 50));
    if (cmd === 'profile') return args[0] ? (await fwApi.setProfile(args[0])).state.activeProfile : s.state.profiles;
    if (cmd === 'silent') return (await fwApi.setMode(args[0] === 'off' ? 'alert' : args[0] === 'deny' ? 'silent-deny' : 'silent-allow')).state.mode;
    if (cmd === 'allow' || cmd === 'deny') {
      // keeper fw deny <host|address> [port] [--app /path]
      const target = args[0];
      if (!target) throw new Error(`Usage: keeper fw ${cmd} <host or address> [port] [--app /path/to/app]`);
      const appI = args.indexOf('--app');
      const appPath = appI >= 0 ? args[appI + 1] : undefined;
      const port = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
      const isIp = /^[0-9a-f.:]+(\/\d+)?$/i.test(target);
      const rule = { id: `cli-${Date.now().toString(36)}`, app: appPath ? { path: appPath } : 'any' as const, direction: 'out' as const, host: isIp ? undefined : target, ip: isIp ? target : undefined, port, verdict: cmd as 'allow' | 'deny', enabled: true, created: Date.now(), note: 'Added from the command line' };
      await fwApi.saveRule('mine', rule);
      return rule;
    }
    throw new Error('Commands: status, rules, alerts, log [n], profile [id], silent [allow|deny|off], allow|deny <host|address> [port] [--app path]');
  });
  void initFirewall({
    ...deps,
    sample,
    network: async () => { const h = await health(); return { ssid: h.wifi?.ssid, gateway: h.gateway }; },
  });
}

export { stopFirewall };
