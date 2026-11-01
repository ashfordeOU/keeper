// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The usage-stats payload as this Mac would report it (form factor, GPU,
// notch), shown and checked, never sent: Keeper is pointed at a stand-in
// server on this computer for the whole run. And performance: start-up time,
// idle processor use and memory of all of Keeper's processes together.

import { fail, pass, skip, verdict, type Ctx } from '../context';
import { sleep } from '../sys';

export async function runUsage(ctx: Ctx, stub: { url: string; hits: () => number }) {
  await ctx.rec.check('usage.payload', 'Usage stats payload on this Mac (shown, never sent)', 'auto', async (h) => {
    const app = await ctx.app();
    const st = await app.call<any>('usageStats.status');
    const ping = st?.next?.pings?.[st.next.pings.length - 1] ?? st?.next;
    h.artifact(ctx.saveData('usage-status.json', { endpoint: st?.endpoint, on: st?.on, offReason: st?.offReason, next: st?.next }));
    if (!String(st?.endpoint ?? '').startsWith(stub.url) && !app.fake) return fail(`Keeper's endpoint is ${st?.endpoint}, not the local stand-in: the run's safety setting did not take`);
    const sysp = ping?.system ?? {};
    const want = { form: ctx.facts.battery ? 'laptop' : 'desktop', notch: ctx.facts.notch };
    const ok = !!ping && sysp.os === 'macos' && sysp.notch === want.notch && (!sysp.form || sysp.form === want.form);
    return verdict(ok || app.fake, `os ${sysp.os} ${sysp.osVersion}, ${sysp.cpu}, ${sysp.ramGB} GB, GPU ${sysp.gpu}, form ${sysp.form} (expected ${want.form}), notch ${sysp.notch} (expected ${want.notch}), ${sysp.displays} display(s)`, { system: sysp, expected: want });
  });
  await ctx.rec.check('usage.never-sent', 'Nothing left this Mac (only the local stand-in could have been reached)', 'auto', async () => {
    return pass(`The local stand-in received ${stub.hits()} report(s); Keeper's endpoint was the stand-in for the whole run`);
  });
}

interface ProcRow { pid: number; ppid: number; rssKB: number; cpuSec: number; comm: string }

/** `ps -A -o pid=,ppid=,rss=,time=,comm=` → rows (time as [[dd-]hh:]mm:ss.cc). */
export function parsePs(text: string): ProcRow[] {
  const out: ProcRow[] = [];
  for (const l of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.-]+)\s+(.*)$/.exec(l);
    if (!m) continue;
    out.push({ pid: +m[1], ppid: +m[2], rssKB: +m[3], cpuSec: cpuTime(m[4]), comm: m[5].trim() });
  }
  return out;
}

export function cpuTime(t: string): number {
  let days = 0;
  let rest = t;
  if (t.includes('-')) { const [d, r] = t.split('-'); days = Number(d); rest = r; }
  const parts = rest.split(':').map(Number);
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return days * 86400 + s;
}

/** A process and everything under it. */
export function treeOf(rows: ProcRow[], root: number): ProcRow[] {
  const kids = new Map<number, ProcRow[]>();
  for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid)!.push(r); }
  const out: ProcRow[] = [];
  const walk = (p: number) => { const self = rows.find((r) => r.pid === p); if (self) out.push(self); for (const c of kids.get(p) ?? []) if (c.pid !== p) walk(c.pid); };
  walk(root);
  return out;
}

export async function runPerf(ctx: Ctx) {
  const BUDGET = { cpuPct: 0.6, rssMB: 520 };
  await ctx.rec.check('perf.startup', 'Start-up: from launch to the window being ready', 'auto', async () => {
    const app = await ctx.app();
    return pass(`${(app.startupMs / 1000).toFixed(1)} s (first start with an empty home; includes Playwright's launch)`, { ms: app.startupMs });
  });

  await ctx.rec.check('perf.idle', 'Idle: processor and memory of all Keeper processes', 'auto', async (h) => {
    const app = await ctx.app();
    const pid = await app.pid();
    if (!pid) return skip('No Keeper process id');
    const settle = ctx.dry ? 0 : ctx.args.quick ? 30 : 120;
    const measure = ctx.dry ? 0 : ctx.args.quick ? 20 : 60;
    ctx.say(`  Letting Keeper settle for ${settle} s, then measuring ${measure} s of doing nothing. Please don't use the computer for ${Math.round((settle + measure) / 60 * 10) / 10} min.`);
    await app.call('sysmon.watch', false).catch(() => undefined);
    await sleep(settle * 1000);
    const a = await ctx.sys.run('/bin/ps', ['-A', '-o', 'pid=,ppid=,rss=,time=,comm=']);
    const t0 = Date.now();
    await sleep(measure * 1000);
    const b = await ctx.sys.run('/bin/ps', ['-A', '-o', 'pid=,ppid=,rss=,time=,comm=']);
    const secs = Math.max(1, (Date.now() - t0) / 1000);
    const ta = treeOf(parsePs(a.stdout), pid);
    const tb = treeOf(parsePs(b.stdout), pid);
    const cpu = tb.reduce((s, r) => s + r.cpuSec, 0) - ta.filter((r) => tb.some((x) => x.pid === r.pid)).reduce((s, r) => s + r.cpuSec, 0);
    const cpuPct = (cpu / secs) * 100;
    const rssMB = tb.reduce((s, r) => s + r.rssKB, 0) / 1024;
    const per = tb.map((r) => ({ comm: r.comm.split('/').pop(), rssMB: Math.round(r.rssKB / 102.4) / 10 }));
    h.artifact(ctx.saveData('perf-idle.json', { settle, measure, cpuPct, rssMB, processes: per, budget: BUDGET }));
    if (!tb.length) return fail('Could not find Keeper\'s processes with ps');
    const note = 'RSS counts shared memory once per process, so it reads higher than the Linux budget\'s PSS';
    return verdict(cpuPct <= BUDGET.cpuPct, `${cpuPct.toFixed(2)} % of one core (budget ${BUDGET.cpuPct} %), ${Math.round(rssMB)} MB resident in ${tb.length} processes (Linux budget ${BUDGET.rssMB} MB PSS; ${note})`, { cpuPct, rssMB, processes: tb.length });
  });
}
