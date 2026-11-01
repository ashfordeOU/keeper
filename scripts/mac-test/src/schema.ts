// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The shape of results.json, the file the Mac test run sends back. The JSON
// Schema below is written into the bundle next to it (results.schema.json),
// and validateResults() checks a run's results against the same rules, with
// no extra libraries, so a broken file is caught before it is packed.

export const SCHEMA_VERSION = 1;

export type Status = 'pass' | 'fail' | 'skip';
/** auto: no one needs to do anything; guided: the owner does or answers something; setup and cleanup: the run's own steps */
export type CheckKind = 'auto' | 'guided' | 'setup' | 'cleanup';

export interface CheckResult {
  /** stable id, "<area>.<name>" */
  id: string;
  area: string;
  title: string;
  kind: CheckKind;
  status: Status;
  /** one line: what was seen */
  details: string;
  /** why it failed (the error text), when it failed */
  error?: string;
  /** what the owner typed at a guided step (y/n/skip and their note) */
  answer?: string;
  note?: string;
  startedAt: string;
  durationMs: number;
  /** files in the bundle that belong to this check (screenshots, raw outputs) */
  artifacts: string[];
  /** small machine-readable facts (numbers, parsed values) */
  data?: unknown;
}

export interface ChangeRecord {
  id: string;
  /** what was changed on the Mac, in plain words */
  what: string;
  /** how it is put back */
  restore: string;
  admin: boolean;
  /** set at cleanup */
  restored: boolean;
  verified: boolean;
  detail?: string;
}

export interface SystemInfo {
  macos?: string;
  build?: string;
  darwin?: string;
  model?: string;
  chip?: string;
  arch?: string;
  ramGB?: number;
  cores?: number;
  displays?: { name: string; resolution?: string; builtIn: boolean; main: boolean; notch?: boolean }[];
  notch?: boolean;
  battery?: { present: boolean; percent?: number; charging?: boolean; source?: string; cycles?: number };
  node?: string;
  xcode?: string;
  swift?: string;
  terminal?: string;
}

export interface Results {
  schemaVersion: number;
  tool: { name: string; version: string };
  run: {
    id: string;
    startedAt: string;
    finishedAt?: string;
    durationSec?: number;
    mode: 'full' | 'quick';
    areas: string[];
    dryRun: boolean;
    interrupted: boolean;
    guided: boolean;
    record: boolean;
    args: string[];
  };
  keeper: { version?: string; commit?: string; dirty?: boolean };
  system: SystemInfo;
  checks: CheckResult[];
  changes: ChangeRecord[];
  cleanup: { ok: boolean; items: { what: string; ok: boolean; detail?: string }[] };
  summary: { total: number; pass: number; fail: number; skip: number };
}

/** JSON Schema (draft 2020-12) for results.json. */
export const RESULTS_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/ashfordeOU/keeper/scripts/mac-test/results.schema.json',
  title: 'Keeper Mac test results',
  type: 'object',
  required: ['schemaVersion', 'tool', 'run', 'keeper', 'system', 'checks', 'changes', 'cleanup', 'summary'],
  properties: {
    schemaVersion: { const: SCHEMA_VERSION },
    tool: { type: 'object', required: ['name', 'version'], properties: { name: { type: 'string' }, version: { type: 'string' } } },
    run: {
      type: 'object',
      required: ['id', 'startedAt', 'mode', 'areas', 'dryRun', 'interrupted', 'guided', 'record', 'args'],
      properties: {
        id: { type: 'string' }, startedAt: { type: 'string', format: 'date-time' }, finishedAt: { type: 'string', format: 'date-time' },
        durationSec: { type: 'number', minimum: 0 }, mode: { enum: ['full', 'quick'] }, areas: { type: 'array', items: { type: 'string' } },
        dryRun: { type: 'boolean' }, interrupted: { type: 'boolean' }, guided: { type: 'boolean' }, record: { type: 'boolean' },
        args: { type: 'array', items: { type: 'string' } },
      },
    },
    keeper: { type: 'object' },
    system: { type: 'object' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'area', 'title', 'kind', 'status', 'details', 'startedAt', 'durationMs', 'artifacts'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9-]+\\.[A-Za-z0-9_.-]+$' },
          area: { type: 'string' }, title: { type: 'string' },
          kind: { enum: ['auto', 'guided', 'setup', 'cleanup'] },
          status: { enum: ['pass', 'fail', 'skip'] },
          details: { type: 'string' }, error: { type: 'string' }, answer: { type: 'string' }, note: { type: 'string' },
          startedAt: { type: 'string', format: 'date-time' }, durationMs: { type: 'number', minimum: 0 },
          artifacts: { type: 'array', items: { type: 'string' } },
          data: {},
        },
      },
    },
    changes: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'what', 'restore', 'admin', 'restored', 'verified'],
        properties: { id: { type: 'string' }, what: { type: 'string' }, restore: { type: 'string' }, admin: { type: 'boolean' }, restored: { type: 'boolean' }, verified: { type: 'boolean' }, detail: { type: 'string' } },
      },
    },
    cleanup: { type: 'object', required: ['ok', 'items'], properties: { ok: { type: 'boolean' }, items: { type: 'array' } } },
    summary: {
      type: 'object', required: ['total', 'pass', 'fail', 'skip'],
      properties: { total: { type: 'integer', minimum: 0 }, pass: { type: 'integer', minimum: 0 }, fail: { type: 'integer', minimum: 0 }, skip: { type: 'integer', minimum: 0 } },
    },
  },
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isDate = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** Problems with a results object; an empty list means it is valid. */
export function validateResults(r: unknown): string[] {
  const errs: string[] = [];
  if (!isObj(r)) return ['results is not an object'];
  if (r.schemaVersion !== SCHEMA_VERSION) errs.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  for (const k of RESULTS_SCHEMA.required) if (!(k in r)) errs.push(`missing ${k}`);
  const run = r.run;
  if (!isObj(run)) errs.push('run is not an object');
  else {
    if (typeof run.id !== 'string' || !run.id) errs.push('run.id missing');
    if (!isDate(run.startedAt)) errs.push('run.startedAt is not a date');
    if (run.finishedAt !== undefined && !isDate(run.finishedAt)) errs.push('run.finishedAt is not a date');
    if (run.mode !== 'full' && run.mode !== 'quick') errs.push('run.mode must be full or quick');
    if (!Array.isArray(run.areas)) errs.push('run.areas is not a list');
    for (const b of ['dryRun', 'interrupted', 'guided', 'record'] as const) if (typeof run[b] !== 'boolean') errs.push(`run.${b} is not true/false`);
  }
  const checks = r.checks;
  const ids = new Set<string>();
  const counts = { pass: 0, fail: 0, skip: 0 };
  if (!Array.isArray(checks)) errs.push('checks is not a list');
  else {
    checks.forEach((c, i) => {
      const at = `checks[${i}]`;
      if (!isObj(c)) { errs.push(`${at} is not an object`); return; }
      if (typeof c.id !== 'string' || !/^[a-z0-9-]+\.[A-Za-z0-9_.-]+$/.test(c.id)) errs.push(`${at}.id "${String(c.id)}" is not "<area>.<name>"`);
      else if (ids.has(c.id)) errs.push(`${at}.id "${c.id}" is used twice`);
      else ids.add(c.id);
      if (typeof c.id === 'string' && typeof c.area === 'string' && !c.id.startsWith(c.area + '.')) errs.push(`${at}.id does not start with its area`);
      if (typeof c.title !== 'string' || !c.title) errs.push(`${at}.title missing`);
      if (!['auto', 'guided', 'setup', 'cleanup'].includes(String(c.kind))) errs.push(`${at}.kind is not valid`);
      if (c.status === 'pass' || c.status === 'fail' || c.status === 'skip') counts[c.status]++;
      else errs.push(`${at}.status must be pass, fail or skip`);
      if (typeof c.details !== 'string') errs.push(`${at}.details is not text`);
      if (!isDate(c.startedAt)) errs.push(`${at}.startedAt is not a date`);
      if (typeof c.durationMs !== 'number' || c.durationMs < 0) errs.push(`${at}.durationMs is not a positive number`);
      if (!Array.isArray(c.artifacts) || c.artifacts.some((a) => typeof a !== 'string' || a.startsWith('/') || a.includes('..'))) errs.push(`${at}.artifacts must be paths inside the bundle`);
    });
  }
  if (!Array.isArray(r.changes)) errs.push('changes is not a list');
  else r.changes.forEach((c, i) => {
    if (!isObj(c) || typeof c.what !== 'string' || typeof c.restore !== 'string' || typeof c.restored !== 'boolean' || typeof c.verified !== 'boolean' || typeof c.admin !== 'boolean') errs.push(`changes[${i}] is incomplete`);
  });
  if (!isObj(r.cleanup) || typeof r.cleanup.ok !== 'boolean' || !Array.isArray(r.cleanup.items)) errs.push('cleanup is incomplete');
  const s = r.summary;
  if (!isObj(s)) errs.push('summary is not an object');
  else if (Array.isArray(checks)) {
    if (s.total !== checks.length) errs.push(`summary.total ${String(s.total)} is not ${checks.length}`);
    for (const k of ['pass', 'fail', 'skip'] as const) if (s[k] !== counts[k]) errs.push(`summary.${k} ${String(s[k])} is not ${counts[k]}`);
  }
  return errs;
}

export function summarize(checks: CheckResult[]): Results['summary'] {
  const out = { total: checks.length, pass: 0, fail: 0, skip: 0 };
  for (const c of checks) out[c.status]++;
  return out;
}
