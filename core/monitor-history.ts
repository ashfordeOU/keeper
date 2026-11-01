// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Long-term system history: one-minute readings rolled up into 5-minute,
// hourly and daily points, kept for up to a year in a small binary file
// (about 1 MB for a full year). Per-app use is kept hourly. Pure: the main
// process feeds it one reading a minute and saves what `encode` returns.

export const METRICS = ['cpu', 'cpuMax', 'mem', 'memMax', 'netIn', 'netOut', 'diskR', 'diskW', 'gpu', 'power', 'temp', 'battery'] as const;
export type Metric = (typeof METRICS)[number];

/** One point of history. Missing readings are NaN (no GPU, no battery…). */
export type Point = { t: number; n: number } & Record<Metric, number>;

/** One reading a minute, as the sampler sees it. */
export interface MinuteReading {
  t: number;
  /** % of all cores */
  cpu: number;
  /** fraction of memory used, 0–100 */
  mem: number;
  /** bytes per second averaged over the minute */
  netIn?: number;
  netOut?: number;
  diskR?: number;
  diskW?: number;
  /** % busy */
  gpu?: number;
  /** watts drawn (battery discharge or package power) */
  power?: number;
  /** hottest sensor, °C */
  temp?: number;
  battery?: number;
  /** busiest apps this minute */
  apps?: { name: string; cpu: number; memory: number }[];
}

export type TierId = '1m' | '5m' | '1h' | '1d';
export interface Tier { id: TierId; step: number; keep: number }

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const TIERS: Tier[] = [
  { id: '1m', step: MIN, keep: 2 * DAY },
  { id: '5m', step: 5 * MIN, keep: 14 * DAY },
  { id: '1h', step: HOUR, keep: 366 * DAY },
  { id: '1d', step: DAY, keep: 366 * DAY },
];

export type Retention = 30 | 90 | 180 | 365;
export const RETENTIONS: Retention[] = [30, 90, 180, 365];

export interface AppHour {
  /** start of the hour */
  t: number;
  /** average % of one core over the minutes it was seen, peak memory, minutes seen */
  apps: { name: string; cpu: number; mem: number; min: number }[];
}

export interface HistoryStore {
  tiers: Record<TierId, Point[]>;
  apps: AppHour[];
}

export function emptyStore(): HistoryStore {
  return { tiers: { '1m': [], '5m': [], '1h': [], '1d': [] }, apps: [] };
}

const MAX_FIELDS: ReadonlySet<Metric> = new Set<Metric>(['cpuMax', 'memMax']);

function fromReading(r: MinuteReading): Point {
  const v = (x: number | undefined) => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);
  return {
    t: Math.floor(r.t / MIN) * MIN, n: 1,
    cpu: v(r.cpu), cpuMax: v(r.cpu), mem: v(r.mem), memMax: v(r.mem),
    netIn: v(r.netIn), netOut: v(r.netOut), diskR: v(r.diskR), diskW: v(r.diskW),
    gpu: v(r.gpu), power: v(r.power), temp: v(r.temp), battery: v(r.battery),
  };
}

/** Folds `p` into `into` (weighted averages; peaks for the *Max fields; NaN means "not measured"). */
export function mergePoint(into: Point, p: Point): Point {
  const out = { ...into } as Point;
  for (const m of METRICS) {
    const a = into[m];
    const b = p[m];
    if (Number.isNaN(b)) continue;
    if (Number.isNaN(a)) out[m] = b;
    else if (MAX_FIELDS.has(m)) out[m] = Math.max(a, b);
    else out[m] = (a * into.n + b * p.n) / (into.n + p.n);
  }
  out.n = into.n + p.n;
  return out;
}

function addTo(list: Point[], p: Point, step: number) {
  const start = Math.floor(p.t / step) * step;
  const last = list[list.length - 1];
  if (last && last.t === start) list[list.length - 1] = mergePoint(last, { ...p, t: start });
  else if (!last || last.t < start) list.push({ ...p, t: start });
  else {
    // A reading from the past (clock moved back): merge into its bucket if there is one.
    const i = list.findIndex((x) => x.t === start);
    if (i >= 0) list[i] = mergePoint(list[i], { ...p, t: start });
  }
}

/** Adds one minute's reading to every tier and to the per-app hours, then drops what is too old. */
export function addMinute(store: HistoryStore, r: MinuteReading, retentionDays: Retention = 365): HistoryStore {
  const p = fromReading(r);
  const last = store.tiers['1m'][store.tiers['1m'].length - 1];
  // The same minute twice (a restart): replace rather than double-count.
  if (last && last.t === p.t) return store;
  for (const tier of TIERS) addTo(store.tiers[tier.id], p, tier.step);
  if (r.apps?.length) addApps(store, p.t, r.apps);
  prune(store, r.t, retentionDays);
  return store;
}

function addApps(store: HistoryStore, t: number, apps: NonNullable<MinuteReading['apps']>) {
  const hour = Math.floor(t / HOUR) * HOUR;
  let h = store.apps[store.apps.length - 1];
  if (!h || h.t !== hour) {
    if (h && h.t > hour) return;
    h = { t: hour, apps: [] };
    store.apps.push(h);
  }
  for (const a of apps) {
    const name = appKey(a.name);
    const e = h.apps.find((x) => x.name === name);
    if (e) {
      e.cpu = (e.cpu * e.min + a.cpu) / (e.min + 1);
      e.mem = Math.max(e.mem, a.memory);
      e.min++;
    } else h.apps.push({ name, cpu: a.cpu, mem: a.memory, min: 1 });
  }
  // Keep the hour small: the 12 apps that did the most work.
  h.apps.sort((a, b) => b.cpu * b.min - a.cpu * a.min);
  if (h.apps.length > 24) h.apps.length = 24;
}

/** Helpers count as their app: "Browser Helper (Renderer)" → "Browser", "code.exe" → "code". */
export function appKey(name: string): string {
  return name.replace(/\s+Helper.*$/i, '').replace(/\.exe$/i, '').trim() || name;
}

export function prune(store: HistoryStore, now: number, retentionDays: Retention = 365) {
  for (const tier of TIERS) {
    const keep = tier.step >= HOUR ? Math.min(tier.keep, retentionDays * DAY) : tier.keep;
    const cutoff = now - keep;
    const list = store.tiers[tier.id];
    let i = 0;
    while (i < list.length && list[i].t < cutoff) i++;
    if (i) store.tiers[tier.id] = list.slice(i);
  }
  const cutoff = now - retentionDays * DAY;
  let i = 0;
  while (i < store.apps.length && store.apps[i].t < cutoff) i++;
  if (i) store.apps = store.apps.slice(i);
}

/** The finest tier that still covers `from`, so a chart has detail when zoomed in and stays light when zoomed out. */
export function pickTier(store: HistoryStore, from: number, to: number, maxPoints = 600): TierId {
  for (const tier of TIERS) {
    const list = store.tiers[tier.id];
    const covers = list.length > 0 && list[0].t <= from + tier.step;
    const count = (to - from) / tier.step;
    if (covers && count <= maxPoints) return tier.id;
  }
  // Nothing reaches back that far (history is young): the finest tier with data that still fits.
  for (const tier of TIERS) if (store.tiers[tier.id].length && (to - from) / tier.step <= maxPoints) return tier.id;
  return TIERS[TIERS.length - 1].id;
}

export interface HistoryQuery {
  tier: TierId;
  step: number;
  points: Point[];
}

/** Points between `from` and `to` at the best resolution for `maxPoints`. */
export function query(store: HistoryStore, from: number, to: number, maxPoints = 600): HistoryQuery {
  const tier = pickTier(store, from, to, maxPoints);
  const step = TIERS.find((t) => t.id === tier)!.step;
  const points = store.tiers[tier].filter((p) => p.t + step > from && p.t <= to);
  return { tier, step, points };
}

/** Evenly spaced values for a chart, with nulls where nothing was recorded (sleep, Keeper closed). */
export function series(q: HistoryQuery, metric: Metric, from: number, to: number): (number | null)[] {
  const n = Math.max(1, Math.round((to - from) / q.step));
  const out: (number | null)[] = new Array(n).fill(null);
  for (const p of q.points) {
    const i = Math.floor((p.t - from) / q.step);
    if (i >= 0 && i < n && !Number.isNaN(p[metric])) out[i] = p[metric];
  }
  return out;
}

export interface Peak { metric: Metric; value: number; t: number }

/** The highest reading of each metric in the range (CPU and memory peaks use the per-minute maxima). */
export function peaks(q: HistoryQuery): Peak[] {
  const out: Peak[] = [];
  const pick: [Metric, Metric][] = [['cpu', 'cpuMax'], ['mem', 'memMax'], ['netIn', 'netIn'], ['netOut', 'netOut'], ['diskR', 'diskR'], ['diskW', 'diskW'], ['gpu', 'gpu'], ['power', 'power'], ['temp', 'temp']];
  for (const [label, field] of pick) {
    let best: Peak | undefined;
    for (const p of q.points) if (!Number.isNaN(p[field]) && (!best || p[field] > best.value)) best = { metric: label, value: p[field], t: p.t };
    if (best) out.push(best);
  }
  return out;
}

/** Apps that did the most work between two times, from the hourly per-app record. */
export function topApps(store: HistoryStore, from: number, to: number, limit = 12): { name: string; cpuMinutes: number; avgCpu: number; peakMem: number; minutes: number }[] {
  const m = new Map<string, { cpuMin: number; min: number; mem: number }>();
  for (const h of store.apps) {
    if (h.t + HOUR <= from || h.t > to) continue;
    for (const a of h.apps) {
      const e = m.get(a.name) ?? { cpuMin: 0, min: 0, mem: 0 };
      e.cpuMin += (a.cpu / 100) * a.min;
      e.min += a.min;
      e.mem = Math.max(e.mem, a.mem);
      m.set(a.name, e);
    }
  }
  return [...m].map(([name, e]) => ({ name, cpuMinutes: Math.round(e.cpuMin * 10) / 10, avgCpu: e.min ? Math.round((e.cpuMin / e.min) * 1000) / 10 : 0, peakMem: e.mem, minutes: e.min }))
    .sort((a, b) => b.cpuMinutes - a.cpuMinutes).slice(0, limit);
}

/** A CSV of the points (one row per point), for spreadsheets. */
export function toCsv(q: HistoryQuery): string {
  const head = ['time', ...METRICS].join(',');
  const rows = q.points.map((p) => [new Date(p.t).toISOString(), ...METRICS.map((m) => (Number.isNaN(p[m]) ? '' : String(Math.round(p[m] * 100) / 100)))].join(','));
  return [head, ...rows].join('\n') + '\n';
}

// ---------------------------------------------------------------- compact file

const MAGIC = 0x4b4d4831; // "KMH1"
const REC = 4 + 2 + METRICS.length * 4;

/** Packs the numeric tiers into bytes: per point a minute stamp, a count and one float per metric. */
export function encode(store: HistoryStore): Uint8Array {
  const total = TIERS.reduce((s, t) => s + store.tiers[t.id].length, 0);
  const buf = new ArrayBuffer(4 + TIERS.length * 5 + total * REC);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint32(o, MAGIC);
  o += 4;
  TIERS.forEach((tier, ti) => {
    const list = store.tiers[tier.id];
    dv.setUint8(o, ti);
    dv.setUint32(o + 1, list.length);
    o += 5;
    for (const p of list) {
      dv.setUint32(o, Math.floor(p.t / MIN));
      dv.setUint16(o + 4, Math.min(65535, p.n));
      o += 6;
      for (const m of METRICS) {
        dv.setFloat32(o, p[m]);
        o += 4;
      }
    }
  });
  return new Uint8Array(buf);
}

/** Reads what `encode` wrote; a damaged or foreign file gives an empty store rather than an error. */
export function decode(bytes: Uint8Array): HistoryStore {
  const store = emptyStore();
  if (bytes.byteLength < 4) return store;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0) !== MAGIC) return store;
  let o = 4;
  try {
    for (let k = 0; k < TIERS.length; k++) {
      const ti = dv.getUint8(o);
      const count = dv.getUint32(o + 1);
      o += 5;
      const tier = TIERS[ti];
      if (!tier || o + count * REC > bytes.byteLength) return emptyStore();
      const list: Point[] = [];
      for (let i = 0; i < count; i++) {
        const p = { t: dv.getUint32(o) * MIN, n: dv.getUint16(o + 4) } as Point;
        o += 6;
        for (const m of METRICS) {
          p[m] = dv.getFloat32(o);
          o += 4;
        }
        list.push(p);
      }
      store.tiers[tier.id] = list;
    }
  } catch {
    return emptyStore();
  }
  return store;
}

/** Brings the one-minute readings Keeper kept before (a day of samples) into the new store. */
export function importLegacy(store: HistoryStore, samples: { t: number; cpu: number; memUsed: number; memTotal: number; battery?: number; top?: { name: string; cpu: number; memory: number }[] }[]): HistoryStore {
  if (store.tiers['1m'].length) return store;
  for (const s of [...samples].sort((a, b) => a.t - b.t)) addMinute(store, { t: s.t, cpu: s.cpu, mem: s.memTotal ? (s.memUsed / s.memTotal) * 100 : NaN, battery: s.battery, apps: s.top });
  return store;
}
