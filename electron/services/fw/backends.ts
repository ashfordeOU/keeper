// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Putting the rules into the operating system, and hearing what it blocked.
// Every change that needs the administrator goes through the system's own
// prompt (UAC, pkexec, the macOS password dialog), once per change. Keeper
// never installs anything that would let other programs act as administrator
// without asking (e.g. a writable script run by a privileged task).

import { app } from 'electron';
import { spawn, execFile } from 'node:child_process';
import { existsSync, promises as fsp, watch, createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capabilities, nftTable, opensnitchRule, parseFirewallLog, pfRules, windowsDefaultBlockScript, windowsRuleScript, WINDOWS_AUDIT_ON, WINDOWS_UNINSTALL, type BlockedAttempt, type Capabilities } from '../../../core/fw/enforce';
import type { RuleGroup } from '../../../core/fw/rules';
import { run } from '../../../core/platform';

export interface Backend {
  name: string;
  caps(): Capabilities;
  /** puts the rules in place; `resolved` maps host rules to their current addresses (Windows) */
  apply(groups: RuleGroup[], opts: { defaultBlock: boolean; resolved: Map<string, string[]> }): Promise<{ ok: boolean; message: string }>;
  remove(): Promise<{ ok: boolean; message: string }>;
  /** blocked attempts as the system reports them; returns a stop function */
  watchBlocked(cb: (a: BlockedAttempt) => void): () => void;
}

const dir = () => path.join(app.getPath('userData'), 'firewall');

// ---------------------------------------------------------------- Windows

function elevatedPowerShell(script: string, timeout = 120_000): Promise<{ ok: boolean; message: string }> {
  // The script goes to a file only this user can read; PowerShell is started elevated (one UAC prompt) to run it.
  return (async () => {
    await fsp.mkdir(dir(), { recursive: true });
    const file = path.join(dir(), `apply-${Date.now()}.ps1`);
    const done = `${file}.done`;
    await fsp.writeFile(file, `$ErrorActionPreference = 'Stop'\ntry {\n${script}\n'ok' | Out-File -Encoding ascii '${done.replace(/['‘’‚‛]/g, '$&$&')}'\n} catch { $_.Exception.Message | Out-File -Encoding utf8 '${done.replace(/['‘’‚‛]/g, '$&$&')}' }\n`, { mode: 0o600 });
    const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const launcher = `Start-Process -FilePath '${ps.replace(/['‘’‚‛]/g, '$&$&')}' -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${file.replace(/['‘’‚‛]/g, '$&$&')}')`;
    const r = await run(ps, ['-NoProfile', '-NonInteractive', '-Command', launcher], timeout);
    const out = await fsp.readFile(done, 'utf8').catch(() => '');
    await fsp.rm(file, { force: true });
    await fsp.rm(done, { force: true });
    if (!r.ok && !out) return { ok: false, message: 'The administrator prompt was cancelled' };
    return out.trim() === 'ok' ? { ok: true, message: 'Rules are in Windows Firewall' } : { ok: false, message: out.trim() || 'Windows Firewall refused the change' };
  })();
}

function windowsBackend(): Backend {
  const logFile = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Keeper', 'firewall.log');
  return {
    name: 'Windows Firewall',
    caps: () => capabilities('win32'),
    async apply(groups, opts) {
      const scripts = ["Get-NetFirewallRule -Group 'Keeper' -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike 'Keeper essential*' } | Remove-NetFirewallRule"];
      for (const g of groups.filter((x) => x.enabled)) for (const r of g.rules) {
        const s = windowsRuleScript(r, r.host ? opts.resolved.get(r.host) ?? [] : []);
        if (s) scripts.push(s);
      }
      scripts.push(windowsDefaultBlockScript(opts.defaultBlock));
      // Blocked attempts are logged to a file this user may read, so Keeper can ask about them without running as administrator.
      scripts.push(`New-Item -ItemType Directory -Force -Path '${path.dirname(logFile).replace(/['‘’‚‛]/g, '$&$&')}' | Out-Null`);
      scripts.push(`Set-NetFirewallProfile -Profile Domain,Private,Public -LogBlocked True -LogMaxSizeKilobytes 4096 -LogFileName '${logFile.replace(/['‘’‚‛]/g, '$&$&')}'`);
      scripts.push(`icacls '${path.dirname(logFile).replace(/['‘’‚‛]/g, '$&$&')}' /grant "$env:USERNAME:(OI)(CI)R" | Out-Null`);
      scripts.push(WINDOWS_AUDIT_ON);
      return elevatedPowerShell(scripts.join('\n'));
    },
    remove: () => elevatedPowerShell(WINDOWS_UNINSTALL + "\nSet-NetFirewallProfile -Profile Domain,Private,Public -LogBlocked False"),
    watchBlocked(cb) {
      let pos = 0;
      let stopped = false;
      const read = () => {
        if (stopped || !existsSync(logFile)) return;
        const s = createReadStream(logFile, { start: pos, encoding: 'utf8' });
        let text = '';
        s.on('data', (d) => (text += d));
        s.on('end', () => { pos += Buffer.byteLength(text); for (const a of parseFirewallLog(text)) if (a.direction === 'out') cb(a); });
        s.on('error', () => undefined);
      };
      void fsp.stat(logFile).then((st) => (pos = st.size)).catch(() => undefined);
      let w: ReturnType<typeof watch> | undefined;
      try { w = watch(path.dirname(logFile), () => read()); } catch { /* folder not there yet */ }
      const t = setInterval(read, 5000);
      t.unref();
      return () => { stopped = true; w?.close(); clearInterval(t); };
    },
  };
}

// ---------------------------------------------------------------- Linux

async function pkexec(args: string[], timeout = 120_000) {
  const r = await run('pkexec', args, timeout);
  return r.ok ? { ok: true, message: '' } : { ok: false, message: /dismissed|Not authorized|126/.test(r.stderr) ? 'The administrator prompt was cancelled' : (r.stderr || 'Not allowed').split('\n')[0] };
}

function linuxBackend(): Backend {
  const opensnitch = existsSync('/etc/opensnitchd') || existsSync('/usr/bin/opensnitchd');
  return {
    name: opensnitch ? 'OpenSnitch + nftables' : 'nftables',
    caps: () => capabilities('linux', { opensnitch }),
    async apply(groups, opts) {
      await fsp.mkdir(dir(), { recursive: true });
      const nf = path.join(dir(), 'keeper.nft');
      await fsp.writeFile(nf, nftTable(groups, { defaultOutbound: opts.defaultBlock ? 'drop' : 'accept' }), { mode: 0o600 });
      // One prompt for both: a short shell script run as root, with only Keeper's own files as input.
      const steps = [`nft -f '${nf.replace(/'/g, "'\\''")}'`];
      if (opensnitch) {
        const rulesDir = path.join(dir(), 'opensnitch');
        await fsp.rm(rulesDir, { recursive: true, force: true });
        await fsp.mkdir(rulesDir, { recursive: true });
        for (const g of groups.filter((x) => x.enabled)) for (const r of g.rules) {
          const o = opensnitchRule(r);
          if (o) await fsp.writeFile(path.join(rulesDir, o.file), o.json);
        }
        steps.push(`rm -f /etc/opensnitchd/rules/keeper-*.json`, `cp '${rulesDir.replace(/'/g, "'\\''")}'/keeper-*.json /etc/opensnitchd/rules/ 2>/dev/null || true`);
      }
      const r = await pkexec(['sh', '-c', steps.join(' && ')]);
      return r.ok ? { ok: true, message: opensnitch ? 'Rules are in nftables and OpenSnitch' : 'Rules are in nftables' } : r;
    },
    remove: () => pkexec(['sh', '-c', 'nft delete table inet keeper 2>/dev/null; rm -f /etc/opensnitchd/rules/keeper-*.json; true']),
    watchBlocked(cb) {
      // Kernel log lines from "log prefix keeper-…"; readable when the user may read the journal.
      const p = spawn('journalctl', ['-k', '-f', '-n', '0', '-o', 'cat'], { stdio: ['ignore', 'pipe', 'ignore'] });
      p.on('error', () => undefined);
      let buf = '';
      p.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!/keeper-(deny|default)/.test(l)) continue;
          const f = (k: string) => l.match(new RegExp(`\\b${k}=(\\S+)`))?.[1];
          cb({ t: Date.now(), direction: f('OUT') ? 'out' : 'in', remote: f('DST') ?? '', remotePort: f('DPT') ? Number(f('DPT')) : undefined, proto: (f('PROTO') ?? '').toLowerCase() as BlockedAttempt['proto'], local: f('SRC'), localPort: f('SPT') ? Number(f('SPT')) : undefined });
        }
      });
      return () => p.kill();
    },
  };
}

// ---------------------------------------------------------------- macOS

// pf.conf already loads anchors under com.apple/*; a sub-anchor there needs no change to system files.
const MAC_ANCHOR = 'com.apple/250.KeeperFirewall';

function osascriptAdmin(cmd: string): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const as = `do shell script ${JSON.stringify(cmd)} with administrator privileges with prompt "Keeper needs your password to update its firewall rules."`;
    execFile('/usr/bin/osascript', ['-e', as], { timeout: 120_000 }, (err, _o, e) => resolve(err ? { ok: false, message: /User canceled|-128/.test(String(e)) ? 'The administrator prompt was cancelled' : String(e).split('\n')[0] } : { ok: true, message: 'Rules are in the system packet filter' }));
  });
}

function macBackend(): Backend {
  const filterExtension = false; // set by the network filter extension when it is installed and approved (see docs/FIREWALL.md)
  return {
    name: filterExtension ? 'Keeper network filter' : 'Packet filter (pf)',
    caps: () => capabilities('darwin', { filterExtension }),
    async apply(groups) {
      await fsp.mkdir(dir(), { recursive: true });
      const f = path.join(dir(), 'keeper.pf');
      await fsp.writeFile(f, pfRules(groups), { mode: 0o600 });
      return osascriptAdmin(`/sbin/pfctl -a ${MAC_ANCHOR} -f '${f.replace(/'/g, "'\\''")}' && /sbin/pfctl -E 2>/dev/null || true`);
    },
    remove: () => osascriptAdmin(`/sbin/pfctl -a ${MAC_ANCHOR} -F all 2>/dev/null || true`),
    watchBlocked: () => () => undefined,
  };
}

// ---------------------------------------------------------------- test double

/** KEEPER_FW_FAKE=1: records what would be applied, and lets tests inject blocked attempts. */
export function fakeBackend(): Backend & { inject(a: BlockedAttempt): void; applied: string[] } {
  const listeners = new Set<(a: BlockedAttempt) => void>();
  const applied: string[] = [];
  return {
    name: 'Test',
    applied,
    caps: () => ({ ...capabilities('linux', { opensnitch: true }), notes: ['Test enforcement: nothing is changed on this computer.'] }),
    async apply(groups) {
      applied.push(nftTable(groups));
      await fsp.mkdir(dir(), { recursive: true });
      await fsp.writeFile(path.join(dir(), 'fake-applied.nft'), applied[applied.length - 1]);
      return { ok: true, message: 'Rules applied (test)' };
    },
    remove: async () => ({ ok: true, message: 'Removed (test)' }),
    watchBlocked(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    inject(a) { for (const l of listeners) l(a); },
  };
}

declare const __KEEPER_OFFICIAL__: boolean | undefined;
/** Test doubles never in an official build: an environment variable must not be able to switch the firewall off. */
export const FW_TESTABLE = !(typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__);

export function backendFor(platform = process.platform): Backend {
  if (FW_TESTABLE && process.env.KEEPER_FW_FAKE) return fakeBackend();
  if (platform === 'win32') return windowsBackend();
  if (platform === 'darwin') return macBackend();
  return linuxBackend();
}

export const homeDir = os.homedir;
