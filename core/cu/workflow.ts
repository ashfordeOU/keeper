// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Show Keeper once, then let it repeat: a recording of what the person did in
// Keeper's browser becomes a workflow with blanks (what was typed), which can
// be replayed with new values, by an AI or on a schedule.

export interface RecordedEvent {
  kind: 'navigate' | 'click' | 'type' | 'select' | 'press' | 'download';
  url: string;
  /** the element as a person would describe it */
  role?: string;
  name?: string;
  value?: string;
  at: number;
}

export interface WorkflowStep {
  kind: RecordedEvent['kind'];
  /** for navigate: the URL, possibly with {{blanks}} */
  url?: string;
  role?: string;
  name?: string;
  /** typed or chosen value, possibly a {{blank}} */
  value?: string;
}

export interface Workflow {
  id: string;
  name: string;
  /** site it was recorded on */
  site: string;
  params: { name: string; example: string; secret?: boolean }[];
  steps: WorkflowStep[];
  created: number;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'value';

/**
 * Generalises a recording: consecutive typing into one field collapses,
 * typed values become named blanks (passwords become secret placeholders),
 * and repeated navigations to the same page are dropped.
 */
export function generalise(name: string, events: RecordedEvent[], id = `wf-${Date.now()}`): Workflow {
  const steps: WorkflowStep[] = [];
  const params: Workflow['params'] = [];
  const used = new Set<string>();
  for (const e of events) {
    const prev = steps[steps.length - 1];
    if (e.kind === 'navigate') {
      if (prev?.kind === 'navigate' && prev.url === e.url) continue;
      // A navigation straight after a click is the click's own result.
      if (prev?.kind === 'click') continue;
      steps.push({ kind: 'navigate', url: e.url });
      continue;
    }
    if (e.kind === 'type') {
      if (prev?.kind === 'type' && prev.name === e.name && prev.role === e.role) {
        // Typing in the same field again replaces what was there: one blank, not two.
        steps.pop();
        const was = /\{\{(?:secret:)?([a-z0-9_]+)\}\}/.exec(prev.value ?? '')?.[1];
        if (was) {
          used.delete(was);
          const i = params.findIndex((x) => x.name === was);
          if (i >= 0) params.splice(i, 1);
        }
      }
      const isSecret = /password|passcode|pin\b/i.test(e.name ?? '') || e.value === '‹secret›';
      let p = slug(e.name ?? 'value');
      while (used.has(p)) p += '_2';
      used.add(p);
      const old = params.findIndex((x) => x.name === p);
      if (old >= 0) params.splice(old, 1);
      params.push({ name: p, example: isSecret ? '' : e.value ?? '', secret: isSecret || undefined });
      steps.push({ kind: 'type', role: e.role, name: e.name, value: isSecret ? `{{secret:${p}}}` : `{{${p}}}` });
      continue;
    }
    steps.push({ kind: e.kind, role: e.role, name: e.name, value: e.value });
  }
  let site = '';
  try {
    site = new URL(events.find((e) => e.url)?.url ?? '').hostname;
  } catch {
    /* no URL recorded */
  }
  return { id, name, site, params, steps, created: Date.now() };
}

/** Fills the blanks for a run. Secret placeholders are left for Keeper's own filling. */
export function instantiate(w: Workflow, values: Record<string, string>): WorkflowStep[] {
  const missing = w.params.filter((p) => !p.secret && values[p.name] === undefined && p.example === '');
  if (missing.length) throw new Error(`Missing values: ${missing.map((p) => p.name).join(', ')}`);
  const fill = (s?: string) => s?.replace(/\{\{(?!secret:)([a-z0-9_]+)\}\}/g, (_m, n: string) => values[n] ?? w.params.find((p) => p.name === n)?.example ?? '');
  return w.steps.map((s) => ({ ...s, url: fill(s.url), value: fill(s.value) }));
}

/** A readable summary for the list and for an AI that should follow it. */
export function workflowText(w: Workflow): string {
  const line = (s: WorkflowStep, i: number) => `${i + 1}. ${s.kind === 'navigate' ? `go to ${s.url}` : s.kind === 'type' ? `type ${s.value} into ${s.role ?? 'field'} "${s.name ?? ''}"` : `${s.kind} ${s.role ?? ''} "${s.name ?? ''}"${s.value ? ` (${s.value})` : ''}`}`;
  return `Workflow "${w.name}" on ${w.site} — blanks: ${w.params.map((p) => p.name).join(', ') || 'none'}\n${w.steps.map(line).join('\n')}`;
}
