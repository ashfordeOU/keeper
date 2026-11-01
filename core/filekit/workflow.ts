// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Workflows: tools joined so the results of one step are the files of the
// next (merge → page numbers → watermark → compress). Saved by name, run on
// files or folders, by hand, when files arrive in a watched folder, or on a
// schedule.

import type { ConvertOp } from '../convert-types';

export interface WorkflowStep { id: string; op: ConvertOp; /** a label the person gave this step */ note?: string }

export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  /** folder whose new files run through the workflow */
  watch?: string;
  /** "daily 08:30", "hourly", "weekly mon 09:00"; runs on `input` */
  schedule?: string;
  /** files or folders a scheduled run takes */
  input?: string[];
  /** where results go; next to the inputs when empty */
  outDir?: string;
  /** file names a folder run picks up, e.g. "*.pdf" */
  pattern?: string;
  created: number;
  lastRun?: { at: number; ok: boolean; outputs: number; message?: string };
}

/** Tools that take every file at once and return one (or a few) results. */
export const COMBINING = new Set(['pdf.merge', 'video.merge', 'image.toPdf', 'image.scan', 'file.zip', 'pdf.alternate', 'pdf.bates', 'pdf.compare', 'file.join']);

/** Problems that would stop a workflow, in plain words; empty when it can run. */
export function checkWorkflow(w: Pick<Workflow, 'name' | 'steps'>): string[] {
  const out: string[] = [];
  if (!w.name.trim()) out.push('Give the workflow a name');
  if (!w.steps.length) out.push('Add at least one step');
  w.steps.forEach((s, i) => {
    if (!s.op?.tool) out.push(`Step ${i + 1} has no tool`);
    if (s.op?.tool === 'file.checksum' && i < w.steps.length - 1) out.push(`Step ${i + 1} (checksum) makes no files, so it must be the last step`);
  });
  return out;
}

/** "daily 08:30" / "weekdays 18:00" / "weekly mon 09:00" / "hourly" / "every 15m" -> the next time after `from`. */
export function nextRun(schedule: string, from: Date): Date | undefined {
  const s = schedule.trim().toLowerCase();
  const every = s.match(/^every\s+(\d+)\s*(m|min|minutes?|h|hours?)$/);
  if (every) {
    const ms = Number(every[1]) * (every[2].startsWith('h') ? 3_600_000 : 60_000);
    if (ms < 60_000) return undefined;
    return new Date(Math.floor(from.getTime() / ms) * ms + ms);
  }
  if (s === 'hourly') { const d = new Date(from); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; }
  const m = s.match(/^(daily|weekdays|weekly\s+(mon|tue|wed|thu|fri|sat|sun))\s+(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const d = new Date(from);
  d.setHours(Number(m[3]), Number(m[4]), 0, 0);
  for (let i = 0; i < 8; i++) {
    const ok = d > from && (m[1] === 'daily' || (m[1] === 'weekdays' && d.getDay() >= 1 && d.getDay() <= 5) || (m[2] && d.getDay() === days.indexOf(m[2])));
    if (ok) return d;
    d.setDate(d.getDate() + 1);
  }
  return undefined;
}

/** Glob-like match for folder runs: "*.pdf", "invoice*.pdf", "*.{jpg,png}". */
export function matches(name: string, pattern?: string): boolean {
  if (!pattern?.trim()) return true;
  return pattern.split(/[,;]\s*(?![^{]*\})/).some((p) => {
    const re = p.trim().replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\{([^}]+)\}/g, (_, alts: string) => `(${alts.split(',').join('|')})`).replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${re}$`, 'i').test(name);
  });
}

export const EXAMPLE_WORKFLOWS: Omit<Workflow, 'id' | 'created'>[] = [
  {
    name: 'Merge, number, watermark, compress',
    steps: [
      { id: 's1', op: { tool: 'pdf.merge' } },
      { id: 's2', op: { tool: 'pdf.number', position: 'bottom-center', start: 1 } },
      { id: 's3', op: { tool: 'pdf.watermark', text: 'CONFIDENTIAL', opacity: 0.15 } },
      { id: 's4', op: { tool: 'pdf.compress', quality: 60, maxSide: 1600 } },
    ],
  },
  {
    name: 'Scans to searchable PDF',
    steps: [
      { id: 's1', op: { tool: 'image.scan', mode: 'gray', pageSize: 'a4' } },
      { id: 's2', op: { tool: 'pdf.searchable' } },
    ],
  },
  {
    name: 'Clean before sharing',
    steps: [
      { id: 's1', op: { tool: 'pdf.sanitize', args: { scripts: true, attachments: true, metadata: true, links: true } } as never },
      { id: 's2', op: { tool: 'pdf.compress', quality: 70, maxSide: 2000 } },
    ],
  },
];
