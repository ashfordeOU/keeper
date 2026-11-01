// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// `keeper stage …` (Stage mode) and `keeper display …` (external monitors over
// DDC/CI), both through the running Keeper app.

import { connectToApp } from '../core/brain/client';
import type { RevertResult, StageCapture, StageStatus } from '../core/stage/types';
import type { DisplayInfo } from '../core/display-control';

type Out = (data: unknown, human: () => void) => void;
const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);

async function call(method: string, params: Record<string, unknown>): Promise<unknown> {
  const app = await connectToApp();
  if (!app) throw new Error('Keeper is not running. Open the Keeper app first.');
  try {
    return await app.call(method, params);
  } finally {
    app.close();
  }
}

/** keeper stage [on|off|toggle|status|extend|presets|journal|detect|support] [--preset Recording] [--now] [--minutes 15] */
export async function cmdStage(rest: string[], flags: Record<string, string | boolean>, out: Out) {
  const cmd = rest[0] ?? 'status';
  const r = await call('keeper/stage', { cmd, preset: flags.preset ?? rest[1], now: flags.now, minutes: flags.minutes ?? flags.for });
  out(r, () => {
    if (cmd === 'presets') {
      for (const p of r as { id: string; name: string; builtIn: boolean; countdown: number; limitMin: number }[]) console.log(`  ${p.name.padEnd(16)} ${dim(p.id)}${p.builtIn ? '' : dim(' (yours)')}${p.countdown ? dim(` · ${p.countdown}s countdown`) : ''}${p.limitMin ? dim(` · ends after ${p.limitMin} min`) : ''}`);
      return;
    }
    if (cmd === 'detect') {
      const c = r as StageCapture;
      console.log(c.sources.length ? c.sources.map((s) => `  ${s.label}${dim(s.reliable ? ' (reliable)' : ' (a guess)')}`).join('\n') : 'Nothing seems to be capturing the screen.');
      console.log(dim(c.method));
      return;
    }
    if (cmd === 'journal') {
      const j = r as { entries: { seq: number; label: string; state: string; prior?: string; applied?: string }[] } | null;
      if (!j?.entries.length) return console.log('Nothing to put back.');
      for (const e of j.entries) console.log(`  ${String(e.seq).padStart(2)} ${e.label}${e.prior !== undefined ? dim(` ${e.prior} → ${e.applied}`) : ''}${e.state === 'pending' ? dim(' (pending)') : ''}`);
      return;
    }
    if (cmd === 'support') {
      for (const s of r as { label: string; support: Record<string, { how: string }> }[]) console.log(`  ${s.label.padEnd(36)} macOS ${s.support.darwin.how.padEnd(8)} Windows ${s.support.win32.how.padEnd(8)} Linux ${s.support.linux.how}`);
      return;
    }
    const s = r as StageStatus;
    if (!s.on && s.countdownEndsAt) return console.log(`${bold('Stage')} starts in a moment (${s.presetName})`);
    if (!s.on) {
      console.log(`${bold('Stage')} is off`);
      const back = (s.lastRevert ?? []) as RevertResult[];
      if (back.length && (cmd === 'off' || cmd === 'stop' || cmd === 'toggle')) for (const b of back) console.log(dim(`  ${b.label}: ${b.outcome === 'restored' ? 'put back' : b.outcome === 'left' ? 'left as you set it' : b.outcome}`));
      return;
    }
    const mins = s.since ? Math.round((Date.now() - s.since) / 60_000) : 0;
    console.log(`${bold('Stage')} is on · ${s.presetName} · ${mins} min${s.endsAt ? ` · ends in ${Math.max(0, Math.round((s.endsAt - Date.now()) / 60_000))} min` : ''}`);
    for (const a of s.applied) console.log(`  ${a.ok ? '✓' : '–'} ${a.label}${a.note ? dim(` · ${a.note}`) : ''}`);
  });
}

/** keeper display [list] | set ID brightness|contrast|volume 0-100 | inputs ID | input ID CODE | up|down brightness|volume */
export async function cmdDisplay(rest: string[], flags: Record<string, string | boolean>, out: Out) {
  const cmd = rest[0] ?? 'list';
  const p: Record<string, unknown> = { cmd };
  if (cmd === 'set') Object.assign(p, { id: rest[1], control: rest[2], value: rest[3] });
  else if (cmd === 'inputs') p.id = rest[1];
  else if (cmd === 'input') Object.assign(p, { id: rest[1], code: rest[2] });
  else if (cmd === 'up' || cmd === 'down') p.control = rest[1] ?? 'brightness';
  const r = await call('keeper/display', p);
  out(r, () => {
    if (cmd === 'list') {
      const l = r as { displays: DisplayInfo[]; note?: string };
      for (const d of l.displays) console.log(`  ${bold(d.name)} ${dim(d.id)}  brightness ${d.brightness ?? '—'} · contrast ${d.contrast ?? '—'} · volume ${d.volume ?? '—'}`);
      if (l.note) console.log(dim(l.note));
      return;
    }
    if (cmd === 'inputs') {
      const l = r as { current?: number; inputs: { code: number; label: string }[]; note?: string };
      for (const i of l.inputs) console.log(`  ${i.code === l.current ? '●' : ' '} 0x${i.code.toString(16).padStart(2, '0')}  ${i.label}`);
      if (l.note) console.log(dim(l.note));
      return;
    }
    if (cmd === 'up' || cmd === 'down') return console.log(`${rest[1] ?? 'brightness'}: ${(r as { value: number | null }).value ?? 'no display answered'}`);
    console.log('Done.');
  });
  void flags;
}
