// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The system monitor on a real Mac: Keeper's own readings (top, ioreg, pmset,
// energy), process details (codesign, lsof), App Nap read only; plus the raw
// command output saved beside them, so the parsers can be checked against
// this Mac's exact text later.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fail, pass, skip, verdict, type Ctx } from '../context';

export async function runMonitor(ctx: Ctx) {
  const { rec, sys } = ctx;

  await rec.check('monitor.raw', 'Raw output of top, ioreg, pmset and friends on this Mac (for the parsers)', 'auto', async (h) => {
    const cmds: [string, string, string[]][] = [
      ['top-power.txt', '/usr/bin/top', ['-l', '2', '-s', '1', '-n', '15', '-o', 'power', '-stats', 'pid,command,cpu,mem,power,threads,state']],
      ['ioreg-battery.txt', '/usr/sbin/ioreg', ['-rn', 'AppleSmartBattery']],
      ['ioreg-gpu.txt', '/usr/sbin/ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']],
      ['pmset-assertions.txt', '/usr/bin/pmset', ['-g', 'assertions']],
      ['pmset-therm.txt', '/usr/bin/pmset', ['-g', 'therm']],
      ['pmset-ps.txt', '/usr/bin/pmset', ['-g', 'ps']],
      ['vm_stat.txt', '/usr/bin/vm_stat', []],
      ['sysctl-vm-swap.txt', '/usr/sbin/sysctl', ['vm.swapusage', 'vm.loadavg', 'kern.boottime']],
      ['netstat-ib.txt', '/usr/sbin/netstat', ['-ib']],
      ['ps-E-own.txt', '/bin/sh', ['-c', `ps -E -o pid=,comm= -p ${process.pid} | head -c 2000`]],
      ['nettop-once.txt', '/usr/bin/nettop', ['-P', '-L', '1', '-J', 'bytes_in,bytes_out', '-x']],
    ];
    const failed: string[] = [];
    for (const [file, cmd, args] of cmds) {
      const r = await sys.run(cmd, args, { timeoutMs: 20_000 });
      h.artifact(ctx.saveData(`monitor/${file}`, r.stdout || r.stderr));
      if (!r.ok) failed.push(`${path.basename(cmd)} (${r.code})`);
    }
    return pass(`${cmds.length - failed.length} of ${cmds.length} commands answered${failed.length ? `; not: ${failed.join(', ')}` : ''}`, { failed });
  });

  await rec.check('monitor.live', 'Keeper\'s live readings (processor, memory, power)', 'auto', async (h) => {
    const app = await ctx.app();
    await app.call('sysmon.watch', true).catch(() => undefined);
    await new Promise((r) => setTimeout(r, ctx.dry ? 10 : 3000));
    const live = await app.call<any>('sysmon.live');
    h.artifact(ctx.saveData('monitor-live.json', live));
    const keys = Object.keys(live ?? {});
    return verdict(keys.length > 0, `Fields: ${keys.slice(0, 20).join(', ')}`, { keys });
  });

  await rec.check('monitor.energy', 'Energy use per app (top power, App Nap state read only)', 'auto', async (h) => {
    const app = await ctx.app();
    const e = await app.call<any>('sysmon.energy');
    h.artifact(ctx.saveData('monitor-energy.json', e));
    const rows = Array.isArray(e) ? e : e?.apps ?? e?.rows ?? [];
    const withNap = rows.filter((r: any) => 'appNap' in r || 'napAllowed' in r || 'nap' in r).length;
    return verdict(rows.length > 0, `${rows.length} apps with an energy reading; ${withNap} with an App Nap state${e?.note ? `; note: ${e.note}` : ''}`, { rows: rows.length, withNap });
  });

  await rec.check('monitor.sensors', 'Sensors: GPU and battery power from ioreg, thermals', 'auto', async (h) => {
    const app = await ctx.app();
    const s = await app.call<any>('sysmon.sensors');
    const t = await app.call<any>('monitor.thermals').catch((e: Error) => ({ error: e.message }));
    h.artifact(ctx.saveData('monitor-sensors.json', { sensors: s, thermals: t }));
    return verdict(!!s, `sensors: ${JSON.stringify(s).slice(0, 180)}`);
  });

  await rec.check('monitor.process', 'Process details: signature (codesign) and listeners/folders (lsof)', 'auto', async (h) => {
    const app = await ctx.app();
    const pid = await app.pid();
    if (!pid) return skip('No Keeper process id');
    const x = await app.call<any>('sysmon.procExtras', pid, { signature: true });
    h.artifact(ctx.saveData('monitor-procextras.json', x));
    let electronApp = '';
    try { electronApp = path.resolve(path.dirname(createRequire(path.join(ctx.paths.root, 'package.json'))('electron') as string), '../..'); } catch { /* dry run */ }
    const cs = await sys.run('/usr/bin/codesign', ['-dv', '--verbose=4', electronApp || '/System/Applications/Calculator.app'], { timeoutMs: 20_000 });
    const lsof = await sys.run('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'], { timeoutMs: 20_000 });
    const cwd = await sys.run('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeoutMs: 20_000 });
    h.artifact(ctx.saveData('monitor/codesign-electron.txt', cs.stderr || cs.stdout));
    h.artifact(ctx.saveData('monitor/lsof-listen.txt', lsof.stdout || lsof.stderr));
    h.artifact(ctx.saveData('monitor/lsof-cwd.txt', cwd.stdout || cwd.stderr));
    if (!x || x.error) return fail(`procExtras failed: ${x?.error ?? 'no answer'}`);
    return pass(`signature: ${JSON.stringify(x.signature ?? x.sign ?? null).slice(0, 120)}; listeners: ${JSON.stringify(x.listeners ?? x.ports ?? null).slice(0, 80)}; folder: ${x.cwd ? 'yes' : 'no'}`);
  });

  await rec.check('monitor.menubar', 'Menu-bar readings (what the menu-bar item would show)', 'auto', async (h) => {
    const app = await ctx.app();
    const p = await app.call<any>('sysmon.trayPreview').catch((e: Error) => ({ error: e.message }));
    const s = await app.call<any>('sysmon.trayState').catch((e: Error) => ({ error: e.message }));
    h.artifact(ctx.saveData('monitor-tray.json', { preview: p, state: s }));
    return verdict(!p?.error, `preview: ${JSON.stringify(p).slice(0, 160)}`);
  });

  await rec.check('monitor.appnap-readonly', 'App Nap settings, read only', 'auto', async (h) => {
    const g = await sys.run('/usr/bin/defaults', ['read', '-g', 'NSAppSleepDisabled']);
    h.artifact(ctx.saveData('monitor/appnap-global.txt', `${g.code} ${g.stdout}${g.stderr}`));
    return pass(g.ok ? `NSAppSleepDisabled (global) = ${g.stdout.trim()}` : 'No global App Nap override (the default)');
  });
}
