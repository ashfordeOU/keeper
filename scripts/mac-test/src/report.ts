// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// report.md: the readable side of results.json. A summary, the Mac it ran
// on, a table per area (pass, fail or skip for every check), the failures in
// full, and what was changed on the Mac and whether it was put back.

import type { CheckResult, Results } from './schema';

const ICON = { pass: 'PASS', fail: 'FAIL', skip: 'skip' } as const;

/** Markdown table cell: one line, pipes escaped. */
export function cell(s: string | undefined, max = 160): string {
  const one = String(s ?? '').replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

function fmtDuration(sec: number | undefined): string {
  if (sec === undefined) return 'unknown';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m} min ${s} s` : `${s} s`;
}

export function renderReport(r: Results, areaTitles: Record<string, string> = {}): string {
  const out: string[] = [];
  const s = r.summary;
  out.push(`# Keeper on macOS: test report`);
  out.push('');
  out.push(`Run \`${r.run.id}\`, ${r.run.mode === 'quick' ? 'quick' : 'full'} run${r.run.dryRun ? ' (**dry run with stand-in macOS output, not a real Mac**)' : ''}${r.run.interrupted ? ' (**stopped early: partial results**)' : ''}.`);
  out.push(`Started ${r.run.startedAt}, took ${fmtDuration(r.run.durationSec)}. Areas: ${r.run.areas.join(', ') || 'none'}.`);
  out.push('');
  out.push(`**${s.pass} passed, ${s.fail} failed, ${s.skip} skipped** (${s.total} checks).`);
  out.push('');

  const sy = r.system;
  out.push('## The Mac');
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  const row = (k: string, v: unknown) => { if (v !== undefined && v !== '') out.push(`| ${k} | ${cell(String(v))} |`); };
  row('macOS', [sy.macos, sy.build ? `(${sy.build})` : ''].filter(Boolean).join(' '));
  row('Model', sy.model);
  row('Chip', [sy.chip, sy.arch].filter(Boolean).join(', '));
  row('Memory', sy.ramGB !== undefined ? `${sy.ramGB} GB` : undefined);
  row('Notch', sy.notch === undefined ? undefined : sy.notch ? 'yes' : 'no');
  for (const d of sy.displays ?? []) row(d.builtIn ? 'Built-in display' : 'Display', `${d.name}${d.resolution ? `, ${d.resolution}` : ''}${d.main ? ', main' : ''}`);
  if (sy.battery) row('Battery', sy.battery.present ? `${sy.battery.percent ?? '?'} %, ${sy.battery.charging ? 'charging' : sy.battery.source ?? ''}${sy.battery.cycles !== undefined ? `, ${sy.battery.cycles} cycles` : ''}` : 'none');
  row('Node', sy.node);
  row('Xcode tools', sy.xcode);
  row('Swift', sy.swift);
  row('Terminal', sy.terminal);
  row('Keeper', [r.keeper.version, r.keeper.commit ? `@ ${r.keeper.commit}${r.keeper.dirty ? ' (local changes)' : ''}` : ''].filter(Boolean).join(' '));
  out.push('');

  const areas: string[] = [];
  for (const c of r.checks) if (!areas.includes(c.area)) areas.push(c.area);
  out.push('## Results by area');
  out.push('');
  out.push('| Area | Pass | Fail | Skip |');
  out.push('|---|---:|---:|---:|');
  for (const a of areas) {
    const cs = r.checks.filter((c) => c.area === a);
    out.push(`| ${cell(areaTitles[a] ?? a)} | ${cs.filter((c) => c.status === 'pass').length} | ${cs.filter((c) => c.status === 'fail').length} | ${cs.filter((c) => c.status === 'skip').length} |`);
  }
  out.push('');

  for (const a of areas) {
    out.push(`### ${areaTitles[a] ?? a}`);
    out.push('');
    out.push('| Result | Check | How | Details |');
    out.push('|---|---|---|---|');
    for (const c of r.checks.filter((x) => x.area === a)) {
      const how = c.kind === 'guided' ? `guided${c.answer ? ` (${cell(c.answer, 20)})` : ''}` : c.kind;
      const det = [c.details, c.note ? `Owner's note: ${c.note}` : ''].filter(Boolean).join(' — ');
      out.push(`| ${ICON[c.status]} | ${cell(c.title, 90)} \`${c.id}\` | ${how} | ${cell(det)} |`);
    }
    out.push('');
  }

  const failed = r.checks.filter((c) => c.status === 'fail');
  out.push('## Failures in full');
  out.push('');
  if (!failed.length) out.push('None.');
  for (const c of failed) out.push(...failureBlock(c));
  out.push('');

  out.push('## What was changed on the Mac, and put back');
  out.push('');
  if (!r.changes.length) out.push('Nothing was changed.');
  else {
    out.push('| Change | Restored by | Admin | Restored | Checked |');
    out.push('|---|---|---|---|---|');
    for (const c of r.changes) out.push(`| ${cell(c.what)} | ${cell(c.restore)} | ${c.admin ? 'yes' : 'no'} | ${c.restored ? 'yes' : '**no**'} | ${c.verified ? 'yes' : '**no**'}${c.detail ? ` (${cell(c.detail, 80)})` : ''} |`);
  }
  out.push('');
  out.push(`Cleanup: ${r.cleanup.ok ? 'everything checked out' : '**something was not put back; see below**'}.`);
  out.push('');
  for (const i of r.cleanup.items) out.push(`- ${i.ok ? 'ok' : '**NOT OK**'}: ${cell(i.what, 200)}${i.detail ? ` (${cell(i.detail, 200)})` : ''}`);
  out.push('');
  return out.join('\n');
}

function failureBlock(c: CheckResult): string[] {
  const lines = [`### ${c.title} (\`${c.id}\`)`, '', c.details];
  if (c.error) lines.push('', '```', c.error.slice(0, 4000), '```');
  if (c.note) lines.push('', `Owner's note: ${c.note}`);
  if (c.artifacts.length) lines.push('', `Files: ${c.artifacts.map((a) => `\`${a}\``).join(', ')}`);
  lines.push('');
  return lines;
}
