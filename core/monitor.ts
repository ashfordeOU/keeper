// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// System health history: a 24-hour ring of one-minute samples, "what used the
// most today", and alert rules for apps that misbehave.

export interface HealthSample {
  t: number;
  cpu: number;
  memUsed: number;
  memTotal: number;
  battery?: number;
  charging?: boolean;
  /** the busiest processes at that moment */
  top: { name: string; cpu: number; memory: number }[];
}

export interface AlertRule {
  id: string;
  enabled: boolean;
  kind: 'cpu' | 'memory';
  /** cpu: percent of one core; memory: bytes */
  threshold: number;
  /** how long it must stay above the threshold */
  minutes: number;
}

export interface ProcessAlert {
  rule: string;
  name: string;
  value: number;
  since: number;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function defaultAlertRules(): AlertRule[] {
  return [
    { id: 'cpu-hog', enabled: true, kind: 'cpu', threshold: 90, minutes: 5 },
    { id: 'memory-hog', enabled: false, kind: 'memory', threshold: 4 * 1024 ** 3, minutes: 5 },
  ];
}

/** Adds a sample and drops anything older than a day. */
export function pushSample(history: HealthSample[], s: HealthSample, keepMs = DAY_MS): HealthSample[] {
  const out = [...history, s];
  const cutoff = s.t - keepMs;
  let i = 0;
  while (i < out.length && out[i].t < cutoff) i++;
  return i ? out.slice(i) : out;
}

/**
 * Which apps did the most work over the history: average CPU while seen in the
 * top list, and the share of all sampled CPU. Battery drain is estimated from
 * the CPU share during samples taken on battery.
 */
export function topConsumers(history: HealthSample[], since = 0): { name: string; avgCpu: number; share: number; batteryShare: number; peakMemory: number; minutes: number }[] {
  const m = new Map<string, { cpu: number; n: number; mem: number; batt: number }>();
  let total = 0;
  let totalBatt = 0;
  for (const s of history) {
    if (s.t < since) continue;
    const onBattery = s.charging === false;
    for (const p of s.top) {
      const key = p.name.replace(/\s+Helper.*$/i, '').replace(/\.exe$/i, '');
      const e = m.get(key) ?? { cpu: 0, n: 0, mem: 0, batt: 0 };
      e.cpu += p.cpu;
      e.n++;
      e.mem = Math.max(e.mem, p.memory);
      if (onBattery) {
        e.batt += p.cpu;
        totalBatt += p.cpu;
      }
      total += p.cpu;
      m.set(key, e);
    }
  }
  return [...m]
    .map(([name, e]) => ({ name, avgCpu: e.cpu / e.n, share: total ? e.cpu / total : 0, batteryShare: totalBatt ? e.batt / totalBatt : 0, peakMemory: e.mem, minutes: e.n }))
    .sort((a, b) => b.share - a.share);
}

/**
 * Apps that have stayed above a rule's threshold for the rule's whole window,
 * looking only at the most recent samples.
 */
export function evaluateAlerts(history: HealthSample[], rules: AlertRule[], now = Date.now()): ProcessAlert[] {
  const out: ProcessAlert[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    const window = history.filter((s) => s.t >= now - r.minutes * 60_000 - 30_000);
    // Need samples covering most of the window.
    if (window.length < Math.max(2, Math.floor(r.minutes * 0.8))) continue;
    const names = new Set(window[window.length - 1].top.map((p) => p.name));
    for (const name of names) {
      const values = window.map((s) => s.top.find((p) => p.name === name)).map((p) => (p ? (r.kind === 'cpu' ? p.cpu : p.memory) : 0));
      if (values.every((v) => v >= r.threshold)) out.push({ rule: r.id, name, value: values[values.length - 1], since: window[0].t });
    }
  }
  return out;
}

/** Evenly spaced points for a chart: one bucket per `step` ms, averaging samples inside. */
export function bucketize(history: HealthSample[], pick: (s: HealthSample) => number | undefined, from: number, to: number, buckets: number): (number | null)[] {
  const step = (to - from) / buckets;
  const sums = new Array<number>(buckets).fill(0);
  const counts = new Array<number>(buckets).fill(0);
  for (const s of history) {
    if (s.t < from || s.t >= to) continue;
    const v = pick(s);
    if (v === undefined || !Number.isFinite(v)) continue;
    const i = Math.min(buckets - 1, Math.floor((s.t - from) / step));
    sums[i] += v;
    counts[i]++;
  }
  return sums.map((v, i) => (counts[i] ? v / counts[i] : null));
}

/** Children of a process, deepest first, from a ps-style (pid, ppid) list. */
export function processTree(root: number, pairs: { pid: number; ppid: number }[]): number[] {
  const kids = new Map<number, number[]>();
  for (const p of pairs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid]);
  const out: number[] = [];
  const visit = (pid: number, depth: number) => {
    if (depth > 50) return;
    for (const c of kids.get(pid) ?? []) visit(c, depth + 1);
    out.push(pid);
  };
  visit(root, 0);
  return out;
}

export interface SpeedResult {
  t: number;
  downMbps: number;
  upMbps: number;
  pingMs: number;
}

/** Megabits per second from bytes and milliseconds. */
export function mbps(bytes: number, ms: number): number {
  return ms > 0 ? Math.round(((bytes * 8) / (ms / 1000) / 1e6) * 10) / 10 : 0;
}
