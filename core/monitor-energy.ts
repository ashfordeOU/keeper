// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// macOS energy: the "power" figure `top` reports per process (the same energy
// impact Activity Monitor shows), which processes hold power assertions
// (`pmset -g assertions`), and App Nap per app (the documented
// NSAppSleepDisabled preference). Pure parsers.

export interface EnergyRow {
  pid: number;
  name: string;
  /** energy impact as `top` reports it */
  power: number;
  /** assertions it holds ("PreventUserIdleSystemSleep: Playing audio") */
  holds?: string[];
  bundleId?: string;
  /** true: App Nap allowed (the default); false: switched off for this app */
  appNap?: boolean;
}

/** `top -l 2 -stats pid,command,power`: the last sample (the first has no rates yet). */
export function parseTopPower(out: string): EnergyRow[] {
  const blocks = out.split(/\n(?=\s*PID\s+COMMAND)/);
  const last = blocks[blocks.length - 1] ?? '';
  const rows: EnergyRow[] = [];
  for (const l of last.split('\n').slice(1)) {
    const m = l.trim().match(/^(\d+)\s+(.+?)\s+([\d.]+)$/);
    if (m) rows.push({ pid: Number(m[1]), name: m[2].trim(), power: Number(m[3]) });
  }
  return rows.sort((a, b) => b.power - a.power);
}

/** `pmset -g assertions` → what each process holds, by pid. */
export function parseAssertions(out: string): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const l of out.split('\n')) {
    const x = l.match(/pid\s+(\d+)\([^)]*\):\s*\[[^\]]*\]\s*(?:[\d:]+\s+)?(\w+)\s+named:\s*"([^"]*)"/);
    if (!x) continue;
    const pid = Number(x[1]);
    m.set(pid, [...(m.get(pid) ?? []), `${x[2]}: ${x[3]}`]);
  }
  return m;
}

/** `defaults read <id> NSAppSleepDisabled`: missing or 0 → App Nap allowed. */
export function parseAppNap(out: string): boolean {
  return !/^\s*(1|true|yes)\s*$/i.test(out);
}

export function appNapCmd(bundleId: string, allowed: boolean): { file: string; args: string[] } {
  if (!/^[A-Za-z0-9][\w.-]{1,200}$/.test(bundleId)) throw new Error('Not an app identifier');
  return allowed ? { file: '/usr/bin/defaults', args: ['delete', bundleId, 'NSAppSleepDisabled'] } : { file: '/usr/bin/defaults', args: ['write', bundleId, 'NSAppSleepDisabled', '-bool', 'YES'] };
}
