// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Live readings in the menu bar / tray: which metrics, how they look, the
// text beside each icon and the small pictures drawn for them (a sparkline,
// a number, or both). Pure: pictures are RGBA bytes the main process turns
// into tray images. macOS shows text next to a template picture; Windows and
// Linux show only pictures, so the number is drawn into the picture there.

export type TrayMetric = 'cpu' | 'mem' | 'net' | 'disk' | 'gpu' | 'power' | 'temp' | 'battery';
export const TRAY_METRICS: { id: TrayMetric; label: string; short: string }[] = [
  { id: 'cpu', label: 'Processor', short: 'CPU' },
  { id: 'mem', label: 'Memory', short: 'MEM' },
  { id: 'net', label: 'Network', short: 'NET' },
  { id: 'disk', label: 'Disk activity', short: 'DSK' },
  { id: 'gpu', label: 'Graphics', short: 'GPU' },
  { id: 'temp', label: 'Temperature', short: 'TMP' },
  { id: 'power', label: 'Power draw', short: 'PWR' },
  { id: 'battery', label: 'Battery', short: 'BAT' },
];

export interface MonitorSurfaces {
  /** live readings in the menu bar / tray */
  tray: boolean;
  /** heavy-use and heat alerts in the Island */
  island: boolean;
  /** the tool launcher's global shortcut */
  launcher: boolean;
}

export interface TrayReadingsSettings {
  metrics: TrayMetric[];
  /** one item per metric, or all in one */
  layout: 'separate' | 'combined';
  style: 'text' | 'graph' | 'both';
  /** seconds between readings while they are shown */
  intervalSec: 1 | 2 | 3 | 5 | 10;
  /** red under strain */
  strainColor: boolean;
  netUnit: 'bytes' | 'bits';
  memShows: 'used' | 'free';
  tempUnit: 'c' | 'f';
}

export interface OutputPolicy {
  /** next to the originals (Keeper's long-standing way), a new dated folder, or one chosen folder */
  mode: 'beside' | 'dated' | 'folder';
  /** the chosen folder ('folder'), or where dated folders go (default: Downloads/Keeper) */
  folder: string;
}

export interface MonitorSettings {
  surfaces: MonitorSurfaces;
  tray: TrayReadingsSettings;
  /** days of hourly and daily history */
  retentionDays: 30 | 90 | 180 | 365;
  launcherShortcut: string;
  /** tools from the launcher open in their own small window (or in the main window) */
  toolWindows: boolean;
  output: OutputPolicy;
  /** apps never named in alerts */
  quietApps: string[];
  /** folders whose processes AI agents may never stop */
  protectedFolders: string[];
}

export function defaultMonitorSettings(): MonitorSettings {
  return {
    surfaces: { tray: false, island: true, launcher: true },
    tray: { metrics: ['cpu', 'mem', 'net'], layout: 'combined', style: 'both', intervalSec: 2, strainColor: true, netUnit: 'bytes', memShows: 'used', tempUnit: 'c' },
    retentionDays: 365,
    launcherShortcut: 'CommandOrControl+Alt+Space',
    toolWindows: true,
    output: { mode: 'beside', folder: '' },
    quietApps: [],
    protectedFolders: [],
  };
}

/** Lenient: anything odd falls back to the default for that field. */
export function normalizeMonitorSettings(raw: unknown): MonitorSettings {
  const d = defaultMonitorSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<MonitorSettings>;
  const s = r.surfaces && typeof r.surfaces === 'object' ? r.surfaces : ({} as Partial<MonitorSurfaces>);
  const t = r.tray && typeof r.tray === 'object' ? r.tray : ({} as Partial<TrayReadingsSettings>);
  const ids = new Set(TRAY_METRICS.map((m) => m.id));
  const metrics = Array.isArray(t.metrics) ? [...new Set(t.metrics.filter((m): m is TrayMetric => ids.has(m as TrayMetric)))] : d.tray.metrics;
  const o = r.output && typeof r.output === 'object' ? r.output : ({} as Partial<OutputPolicy>);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length < 500).slice(0, 200) : []);
  return {
    surfaces: { tray: typeof s.tray === 'boolean' ? s.tray : d.surfaces.tray, island: typeof s.island === 'boolean' ? s.island : d.surfaces.island, launcher: typeof s.launcher === 'boolean' ? s.launcher : d.surfaces.launcher },
    tray: {
      metrics: metrics.length ? metrics.slice(0, 8) : d.tray.metrics,
      layout: t.layout === 'separate' ? 'separate' : 'combined',
      style: t.style === 'text' || t.style === 'graph' ? t.style : 'both',
      intervalSec: ([1, 2, 3, 5, 10] as const).includes(t.intervalSec as 2) ? (t.intervalSec as TrayReadingsSettings['intervalSec']) : d.tray.intervalSec,
      strainColor: t.strainColor !== false,
      netUnit: t.netUnit === 'bits' ? 'bits' : 'bytes',
      memShows: t.memShows === 'free' ? 'free' : 'used',
      tempUnit: t.tempUnit === 'f' ? 'f' : 'c',
    },
    retentionDays: ([30, 90, 180, 365] as const).includes(r.retentionDays as 30) ? (r.retentionDays as MonitorSettings['retentionDays']) : d.retentionDays,
    launcherShortcut: typeof r.launcherShortcut === 'string' ? r.launcherShortcut.slice(0, 60) : d.launcherShortcut,
    toolWindows: r.toolWindows !== false,
    output: { mode: o.mode === 'dated' || o.mode === 'folder' ? o.mode : 'beside', folder: typeof o.folder === 'string' ? o.folder : '' },
    quietApps: strs(r.quietApps),
    protectedFolders: strs(r.protectedFolders),
  };
}

// ---------------------------------------------------------------- live readings

export interface LiveReading {
  t: number;
  /** % of all cores */
  cpu: number;
  perCore?: number[];
  memUsed: number;
  memTotal: number;
  /** bytes per second */
  netIn?: number;
  netOut?: number;
  diskR?: number;
  diskW?: number;
  gpu?: number;
  /** watts */
  power?: number;
  /** °C, hottest sensor */
  temp?: number;
  battery?: number;
  charging?: boolean;
}

/** "1.2M", "340K", "12B": short enough for a menu bar. Bits when asked (network). */
export function shortRate(bytesPerSec: number | undefined, unit: 'bytes' | 'bits' = 'bytes'): string {
  if (bytesPerSec === undefined || !Number.isFinite(bytesPerSec)) return '–';
  let v = unit === 'bits' ? bytesPerSec * 8 : bytesPerSec;
  const k = unit === 'bits' ? 1000 : 1024;
  const units = unit === 'bits' ? ['b', 'K', 'M', 'G'] : ['B', 'K', 'M', 'G'];
  let i = 0;
  while (v >= k && i < units.length - 1) {
    v /= k;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)}${units[i]}`;
}

export type Strain = 'ok' | 'warn' | 'high';

/** How hard this metric is working right now, for the red-under-strain colour. */
export function strainOf(metric: TrayMetric, r: LiveReading): Strain {
  const memPct = r.memTotal ? (r.memUsed / r.memTotal) * 100 : 0;
  switch (metric) {
    case 'cpu': return r.cpu >= 85 ? 'high' : r.cpu >= 60 ? 'warn' : 'ok';
    case 'mem': return memPct >= 92 ? 'high' : memPct >= 80 ? 'warn' : 'ok';
    case 'gpu': return (r.gpu ?? 0) >= 90 ? 'high' : (r.gpu ?? 0) >= 70 ? 'warn' : 'ok';
    case 'temp': return (r.temp ?? 0) >= 90 ? 'high' : (r.temp ?? 0) >= 80 ? 'warn' : 'ok';
    case 'battery': return r.charging ? 'ok' : (r.battery ?? 100) <= 10 ? 'high' : (r.battery ?? 100) <= 20 ? 'warn' : 'ok';
    default: return 'ok';
  }
}

/** The number a metric shows (and the value its sparkline plots). */
export function metricValue(metric: TrayMetric, r: LiveReading, s: Pick<TrayReadingsSettings, 'memShows'> = { memShows: 'used' }): number | undefined {
  switch (metric) {
    case 'cpu': return r.cpu;
    case 'mem': return r.memTotal ? ((s.memShows === 'free' ? r.memTotal - r.memUsed : r.memUsed) / r.memTotal) * 100 : undefined;
    case 'net': return r.netIn === undefined && r.netOut === undefined ? undefined : (r.netIn ?? 0) + (r.netOut ?? 0);
    case 'disk': return r.diskR === undefined && r.diskW === undefined ? undefined : (r.diskR ?? 0) + (r.diskW ?? 0);
    case 'gpu': return r.gpu;
    case 'power': return r.power;
    case 'temp': return r.temp;
    case 'battery': return r.battery;
  }
}

/** Short text for one metric: "23%", "↓1.2M ↑40K", "54°", "12.3W". */
export function metricText(metric: TrayMetric, r: LiveReading, s: Pick<TrayReadingsSettings, 'netUnit' | 'memShows' | 'tempUnit'>): string {
  const pct = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '–' : `${Math.round(v)}%`);
  switch (metric) {
    case 'cpu': return pct(r.cpu);
    case 'mem': return pct(metricValue('mem', r, s));
    case 'net': return `↓${shortRate(r.netIn, s.netUnit)} ↑${shortRate(r.netOut, s.netUnit)}`;
    case 'disk': return `R${shortRate(r.diskR)} W${shortRate(r.diskW)}`;
    case 'gpu': return pct(r.gpu);
    case 'power': return r.power === undefined ? '–' : `${r.power.toFixed(r.power >= 10 ? 0 : 1)}W`;
    case 'temp': return r.temp === undefined ? '–' : `${Math.round(s.tempUnit === 'f' ? r.temp * 1.8 + 32 : r.temp)}°`;
    case 'battery': return r.battery === undefined ? '–' : `${Math.round(r.battery)}%`;
  }
}

/** The text beside the tray icon (macOS) or in its tooltip (elsewhere). */
export function trayTitle(metrics: TrayMetric[], r: LiveReading | undefined, s: TrayReadingsSettings, labels = false): string {
  if (!r) return '';
  return metrics.map((m) => `${labels ? TRAY_METRICS.find((x) => x.id === m)!.short + ' ' : ''}${metricText(m, r, s)}`).join('  ');
}

/** A full one-line-per-metric summary for tooltips and the menu. */
export function trayTooltip(r: LiveReading | undefined, s: TrayReadingsSettings): string {
  if (!r) return 'Reading…';
  const lines = TRAY_METRICS.filter((m) => metricValue(m.id, r, s) !== undefined).map((m) => `${m.label}: ${metricText(m.id, r, s)}`);
  return lines.join('\n');
}

/** The scale a sparkline uses: percentages are 0–100; rates scale to their own recent peak. */
export function scaleFor(metric: TrayMetric, values: number[]): number {
  if (metric === 'cpu' || metric === 'mem' || metric === 'gpu' || metric === 'battery') return 100;
  if (metric === 'temp') return 105;
  const peak = Math.max(0, ...values.filter(Number.isFinite));
  if (metric === 'power') return Math.max(10, peak * 1.15);
  return Math.max(64 * 1024, peak * 1.15);
}

// ---------------------------------------------------------------- pictures

export interface Bitmap { width: number; height: number; data: Uint8Array }
export type Rgba = [number, number, number, number];

/** 3×5 pixel glyphs: enough for numbers, units and a percent sign. */
const GLYPHS: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001001010010', '8': '111101111101111', '9': '111101111001111',
  '%': '101001010100101', '.': '000000000000010', K: '101101110101101', M: '101111111101101', G: '111100101101111',
  B: '110101110101110', W: '101101111111101', C: '111100100100111', '°': '010101010000000', '-': '000000111000000', ' ': '000000000000000',
  b: '100100110101110',
};

function blank(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function put(b: Bitmap, x: number, y: number, c: Rgba) {
  if (x < 0 || y < 0 || x >= b.width || y >= b.height) return;
  const i = (y * b.width + x) * 4;
  const a = c[3] / 255;
  const ia = b.data[i + 3] / 255;
  const oa = a + ia * (1 - a);
  if (oa <= 0) return;
  for (let k = 0; k < 3; k++) b.data[i + k] = Math.round((c[k] * a + b.data[i + k] * ia * (1 - a)) / oa);
  b.data[i + 3] = Math.round(oa * 255);
}

/** Width in pixels of `text` drawn at `scale`. */
export function textWidth(text: string, scale = 1): number {
  return text.length ? (text.length * 4 - 1) * scale : 0;
}

/** Draws text with the 3×5 font; unknown characters leave a gap. */
export function drawText(b: Bitmap, text: string, x: number, y: number, c: Rgba, scale = 1) {
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS[' '];
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
      if (g[gy * 3 + gx] !== '1') continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(b, cx + gx * scale + sx, y + gy * scale + sy, c);
    }
    cx += 4 * scale;
  }
}

/** An area sparkline, newest on the right, in a box. */
export function drawSparkline(b: Bitmap, values: (number | null | undefined)[], max: number, box: { x: number; y: number; w: number; h: number }, c: Rgba) {
  const n = box.w;
  const vals = values.slice(-n);
  const off = n - vals.length;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const hgt = Math.max(1, Math.round((Math.min(max, Math.max(0, v)) / (max || 1)) * box.h));
    const x = box.x + off + i;
    for (let k = 0; k < hgt; k++) put(b, x, box.y + box.h - 1 - k, k === hgt - 1 ? c : [c[0], c[1], c[2], Math.round(c[3] * 0.45)]);
  }
}

export interface IconSpec {
  /** pixels (the tray image is made at 2× for sharp screens) */
  width: number;
  height: number;
  values: (number | null | undefined)[];
  max: number;
  /** a number drawn in the picture (Windows and Linux, which show no text) */
  text?: string;
  color: Rgba;
  /** a faint frame around the graph */
  frame?: boolean;
  /** draw only the graph (macOS puts the text beside it) */
  graph?: boolean;
}

/** One tray picture: the text on top (when asked) and the sparkline under it. */
export function renderIcon(spec: IconSpec): Bitmap {
  const b = blank(spec.width, spec.height);
  const scale = spec.height >= 28 ? 2 : 1;
  let top = 0;
  if (spec.text) {
    const tw = textWidth(spec.text, scale);
    // Shrink the text when it does not fit.
    const s = tw > spec.width && scale > 1 ? 1 : scale;
    drawText(b, spec.text, Math.max(0, Math.floor((spec.width - textWidth(spec.text, s)) / 2)), 0, spec.color, s);
    top = 5 * s + s;
  }
  if (spec.graph !== false) {
    const box = { x: spec.frame ? 1 : 0, y: top, w: spec.width - (spec.frame ? 2 : 0), h: spec.height - top - (spec.frame ? 1 : 0) };
    if (box.h > 1) drawSparkline(b, spec.values, spec.max, box, spec.color);
    if (spec.frame) {
      const f: Rgba = [spec.color[0], spec.color[1], spec.color[2], 90];
      for (let x = 0; x < spec.width; x++) put(b, x, spec.height - 1, f);
      for (let y = top; y < spec.height; y++) {
        put(b, 0, y, f);
        put(b, spec.width - 1, y, f);
      }
    }
  }
  return b;
}

/** Colours: the menu-bar ink (black/white), with amber and red under strain. */
export function inkFor(strain: Strain, dark: boolean, colorUnderStrain: boolean): Rgba {
  if (colorUnderStrain && strain === 'high') return [235, 64, 52, 255];
  if (colorUnderStrain && strain === 'warn') return [230, 150, 20, 255];
  return dark ? [240, 240, 240, 255] : [20, 20, 20, 255];
}

/**
 * Converts RGBA bytes to what Electron's nativeImage.createFromBitmap expects:
 * BGRA with premultiplied alpha. Unpremultiplied half-transparent pixels (the
 * sparkline's frame) are invalid there and drew as stray marks in the macOS
 * menu bar.
 */
export function toBgra(b: Bitmap): Uint8Array {
  const out = new Uint8Array(b.data.length);
  for (let i = 0; i < b.data.length; i += 4) {
    const a = b.data[i + 3];
    out[i] = Math.round((b.data[i + 2] * a) / 255);
    out[i + 1] = Math.round((b.data[i + 1] * a) / 255);
    out[i + 2] = Math.round((b.data[i] * a) / 255);
    out[i + 3] = a;
  }
  return out;
}

/** A bounded ring of recent values per metric, for sparklines. */
export function pushRing<T>(ring: T[], v: T, max = 60): T[] {
  ring.push(v);
  if (ring.length > max) ring.splice(0, ring.length - max);
  return ring;
}
