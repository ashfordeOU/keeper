// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The audit log: every remote session, transfer, command, terminal, help
// session and power action on this device, in and out, kept locally and
// exportable. Pure: storage is the caller's.

export type AuditKind = 'screen' | 'help' | 'transfer' | 'command' | 'terminal' | 'power' | 'print' | 'forward' | 'unattended' | 'permission' | 'location';

export interface AuditEntry {
  id: string;
  at: number;
  kind: AuditKind;
  /** in: another device did it here; out: this device did it there */
  direction: 'in' | 'out';
  /** paired device id, 'help:<name>' or 'phone:<id>' */
  device?: string;
  deviceName: string;
  title: string;
  detail?: string;
  ok: boolean;
  /** for sessions: when it ended */
  until?: number;
}

export const AUDIT_MAX = 5000;

let counter = 0;
export function auditId(now = Date.now()): string {
  return `${now.toString(36)}-${(counter++ % 1679616).toString(36).padStart(4, '0')}`;
}

/** Newest first, capped. */
export function addEntry(list: AuditEntry[], e: Omit<AuditEntry, 'id'> & { id?: string }, max = AUDIT_MAX): AuditEntry[] {
  const entry: AuditEntry = { ...e, id: e.id ?? auditId(e.at), title: e.title.slice(0, 300), detail: e.detail?.slice(0, 2000) };
  return [entry, ...list].slice(0, max);
}

export interface AuditFilter {
  device?: string;
  kind?: AuditKind;
  q?: string;
  since?: number;
}

export function filterAudit(list: AuditEntry[], f: AuditFilter = {}): AuditEntry[] {
  const q = f.q?.trim().toLowerCase();
  return list.filter((e) => (!f.device || e.device === f.device) && (!f.kind || e.kind === f.kind) && (!f.since || e.at >= f.since) && (!q || `${e.deviceName} ${e.title} ${e.detail ?? ''} ${e.kind}`.toLowerCase().includes(q)));
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  // Cells starting with = + - @ would be formulas in a spreadsheet: quote them as text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function auditCsv(list: AuditEntry[]): string {
  const rows = [['time', 'kind', 'direction', 'device', 'title', 'detail', 'ok', 'ended'].join(',')];
  for (const e of list) rows.push([new Date(e.at).toISOString(), e.kind, e.direction, e.deviceName, e.title, e.detail ?? '', e.ok ? 'yes' : 'no', e.until ? new Date(e.until).toISOString() : ''].map(csvCell).join(','));
  return rows.join('\n') + '\n';
}

export function auditJson(list: AuditEntry[]): string {
  return JSON.stringify({ keeper: 'audit', version: 1, exported: new Date().toISOString(), entries: list }, null, 2);
}
