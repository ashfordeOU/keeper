// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Anonymous usage stats: the one pure function that builds what is sent, the
// schema it must match (shared with the server in server/telemetry), and the
// rules that switch it off. Nothing here reads the computer; the main process
// (electron/services/usage-stats.ts) gathers the inputs and passes them in.
//
// What is sent is listed field by field in docs/PRIVACY-USAGE-STATS.md. A
// field that is not in USAGE_SCHEMA can never be sent: buildPayload only
// writes schema fields, validatePayload rejects anything else, and the tests
// in test/telemetry.test.ts fail if a path, e-mail, address or host name could
// slip into a value.

/** Where the stats go. A test or an unofficial build may point elsewhere with KEEPER_TELEMETRY_URL. */
export const TELEMETRY_ENDPOINT = 'https://telemetry.ashforde.org/v1/ping';
export const TELEMETRY_HOST = 'telemetry.ashforde.org';
export const PAYLOAD_VERSION = 1;
/** Days of unsent stats kept while offline; older ones are dropped. */
export const MAX_QUEUE_DAYS = 7;
/** Largest request the server accepts (a full week of pings is about 10 KB). */
export const MAX_BODY_BYTES = 32 * 1024;

// ---------------------------------------------------------------- the schema

export const INSTALL_SOURCES = ['brew', 'winget', 'scoop', 'choco', 'flatpak', 'snap', 'aur', 'apt-repo', 'dnf-repo', 'direct'] as const;
export const OS_FAMILIES = ['macos', 'windows', 'linux', 'other'] as const;
export const ARCHES = ['x64', 'arm64', 'ia32', 'arm', 'other'] as const;
export const CPU_VENDORS = ['apple', 'intel', 'amd', 'qualcomm', 'other'] as const;
export const GPU_VENDORS = ['apple', 'nvidia', 'amd', 'intel', 'qualcomm', 'other', 'unknown'] as const;
export const FORM_FACTORS = ['laptop', 'desktop', 'tablet', 'unknown'] as const;
export const RAM_BUCKETS = [4, 8, 16, 32, 64] as const;
export const COUNT_BUCKETS = ['1-4', '5-19', '20-99', '100+'] as const;
export const MEMORY_BUCKETS = ['<250MB', '250-500MB', '500MB-1GB', '1GB+'] as const;
export const CPU_BUCKETS = ['<1%', '1-5%', '5-20%', '20%+'] as const;
export const STARTUP_BUCKETS = ['<2s', '2-5s', '5-10s', '10s+', 'unknown'] as const;

export interface UsagePayload {
  /** payload format */
  v: 1;
  /** random install ID (UUID v4), made on this computer, resettable */
  id: string;
  /** the day these stats describe (UTC, YYYY-MM-DD) */
  day: string;
  build: {
    version: string;
    channel: 'stable' | 'prerelease';
    /** built and signed by Ashforde's release workflow */
    official: boolean;
    /** how Keeper was installed (package manager or a download) */
    via: (typeof INSTALL_SOURCES)[number];
  };
  system: {
    os: (typeof OS_FAMILIES)[number];
    /** major (and minor) version only, e.g. "14.5", "11", "6.8" */
    osVersion: string;
    arch: (typeof ARCHES)[number];
    cpuVendor: (typeof CPU_VENDORS)[number];
    /** processor family, e.g. "Apple M3", "Intel Core i7 12th gen", "AMD Ryzen 7" */
    cpu: string;
    cores: number;
    ramGB: (typeof RAM_BUCKETS)[number];
    gpu: (typeof GPU_VENDORS)[number];
    form: (typeof FORM_FACTORS)[number];
    displays: number;
    notch: boolean;
    /** from the system's language setting, e.g. "en" */
    lang: string;
    /** from the system's region setting (not from the network), e.g. "EE"; "ZZ" when unknown */
    region: string;
  };
  usage: {
    /** Keeper was opened on this day */
    active: boolean;
    /** days Keeper was opened in the last 7 */
    days7: number;
    /** feature IDs that are switched on */
    features: string[];
    /** page name → how often it was opened, as a range */
    pages: Record<string, (typeof COUNT_BUCKETS)[number]>;
    /** number of AI services connected (no names, no keys) */
    aiProviders: number;
    /** number of paired devices */
    devices: number;
  };
  health: {
    crashes: number;
    restarts: number;
    /** Keeper's own memory, average, as a range */
    memory: (typeof MEMORY_BUCKETS)[number];
    /** Keeper's own processor use, average, as a range */
    cpu: (typeof CPU_BUCKETS)[number];
    startup: (typeof STARTUP_BUCKETS)[number];
  };
}

/** What one request carries: today's ping, plus any days that could not be sent (at most a week). */
export interface PingBody {
  pings: UsagePayload[];
}

type FieldRule =
  | { t: 'const'; value: number }
  | { t: 'uuid' }
  | { t: 'day' }
  | { t: 'enum'; values: readonly (string | number)[] }
  | { t: 'bool' }
  | { t: 'int'; min: number; max: number }
  | { t: 'str'; re: RegExp }
  | { t: 'ids'; re: RegExp; max: number }
  | { t: 'buckets'; key: RegExp; values: readonly string[]; max: number };

export interface FieldSpec {
  rule: FieldRule;
  /** plain words for the "what's sent" viewer and the privacy page */
  about: string;
  example: unknown;
}

const ID_RE = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
const PAGE_RE = /^[a-z][a-zA-Z0-9-]{0,31}$/;
const CPU_RE = /^[A-Za-z0-9 ]{1,40}$/;

/** Every field that may be sent, by its dotted path. Nothing else ever is. */
export const USAGE_SCHEMA: Record<string, FieldSpec> = {
  v: { rule: { t: 'const', value: 1 }, about: 'Format of this report', example: 1 },
  id: { rule: { t: 'uuid' }, about: 'A random install ID made on this computer. Not based on your hardware, name or account. You can reset it.', example: '3f6c1a9e-7b2d-4c1e-9a8f-2d4b6e8c0a17' },
  day: { rule: { t: 'day' }, about: 'The day these numbers are for', example: '2026-10-31' },
  'build.version': { rule: { t: 'str', re: /^\d{1,3}\.\d{1,3}\.\d{1,4}(-[0-9A-Za-z.]{1,20})?$/ }, about: 'Keeper’s version', example: '0.1.0' },
  'build.channel': { rule: { t: 'enum', values: ['stable', 'prerelease'] }, about: 'Stable release or test release', example: 'stable' },
  'build.official': { rule: { t: 'bool' }, about: 'Built by Ashforde (true) or built by someone else from the source (false)', example: true },
  'build.via': { rule: { t: 'enum', values: INSTALL_SOURCES }, about: 'How Keeper was installed', example: 'direct' },
  'system.os': { rule: { t: 'enum', values: OS_FAMILIES }, about: 'Operating system', example: 'macos' },
  'system.osVersion': { rule: { t: 'str', re: /^\d{1,3}(\.\d{1,3})?$/ }, about: 'Its main version number', example: '15.1' },
  'system.arch': { rule: { t: 'enum', values: ARCHES }, about: 'Processor type', example: 'arm64' },
  'system.cpuVendor': { rule: { t: 'enum', values: CPU_VENDORS }, about: 'Who made the processor', example: 'apple' },
  'system.cpu': { rule: { t: 'str', re: CPU_RE }, about: 'Processor family, not the exact model', example: 'Apple M3' },
  'system.cores': { rule: { t: 'int', min: 1, max: 128 }, about: 'Number of processor cores', example: 8 },
  'system.ramGB': { rule: { t: 'enum', values: RAM_BUCKETS }, about: 'Memory, rounded to 4, 8, 16, 32 or 64+ GB', example: 16 },
  'system.gpu': { rule: { t: 'enum', values: GPU_VENDORS }, about: 'Who made the graphics chip', example: 'apple' },
  'system.form': { rule: { t: 'enum', values: FORM_FACTORS }, about: 'Laptop or desktop (from whether there is a battery)', example: 'laptop' },
  'system.displays': { rule: { t: 'int', min: 0, max: 8 }, about: 'Number of screens', example: 1 },
  'system.notch': { rule: { t: 'bool' }, about: 'The screen has a camera notch', example: true },
  'system.lang': { rule: { t: 'str', re: /^[a-z]{2,3}$/ }, about: 'System language', example: 'en' },
  'system.region': { rule: { t: 'str', re: /^[A-Z]{2}$/ }, about: 'Region from your system settings (not from your internet address)', example: 'EE' },
  'usage.active': { rule: { t: 'bool' }, about: 'Keeper was opened that day', example: true },
  'usage.days7': { rule: { t: 'int', min: 0, max: 7 }, about: 'Days Keeper was opened in the last week', example: 5 },
  'usage.features': { rule: { t: 'ids', re: ID_RE, max: 150 }, about: 'Which features are switched on (their IDs from Settings → Features)', example: ['library', 'island', 'clipboard'] },
  'usage.pages': { rule: { t: 'buckets', key: PAGE_RE, values: COUNT_BUCKETS, max: 100 }, about: 'Which pages were opened, with a rough count (1-4, 5-19, 20-99, 100+)', example: { home: '5-19', search: '1-4' } },
  'usage.aiProviders': { rule: { t: 'int', min: 0, max: 20 }, about: 'How many AI services are connected (a number only)', example: 1 },
  'usage.devices': { rule: { t: 'int', min: 0, max: 50 }, about: 'How many devices are paired (a number only)', example: 0 },
  'health.crashes': { rule: { t: 'int', min: 0, max: 99 }, about: 'Times Keeper or one of its windows crashed (no details)', example: 0 },
  'health.restarts': { rule: { t: 'int', min: 0, max: 99 }, about: 'Times one of Keeper’s background services had to restart', example: 0 },
  'health.memory': { rule: { t: 'enum', values: MEMORY_BUCKETS }, about: 'Keeper’s own memory use, as a range', example: '250-500MB' },
  'health.cpu': { rule: { t: 'enum', values: CPU_BUCKETS }, about: 'Keeper’s own processor use, as a range', example: '<1%' },
  'health.startup': { rule: { t: 'enum', values: STARTUP_BUCKETS }, about: 'How long Keeper took to open, as a range', example: '<2s' },
};

/** Groups of fields, in the order the viewer and the docs show them. */
export const SCHEMA_GROUPS = ['build', 'system', 'usage', 'health'] as const;

/** Never sent, for the viewer and the docs. */
export const NEVER_SENT = [
  'File names, paths or file contents',
  'What you search for',
  'What you ask an AI',
  'Account names, e-mail addresses, user names or the computer’s name',
  'Your internet address or where it places you',
  'Serial numbers, hardware IDs or network card (MAC) addresses',
  'Wi-Fi names',
  'Which apps you have',
];

// ---------------------------------------------------------------- validation

export interface Validation {
  ok: boolean;
  errors: string[];
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function checkField(path: string, rule: FieldRule, v: unknown, errors: string[]) {
  const bad = (why: string) => errors.push(`${path}: ${why}`);
  switch (rule.t) {
    case 'const': if (v !== rule.value) bad('wrong value'); return;
    case 'uuid': if (typeof v !== 'string' || !UUID_V4.test(v)) bad('not a v4 UUID'); return;
    case 'day': if (typeof v !== 'string' || !DAY_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) bad('not a day'); return;
    case 'enum': if (!rule.values.includes(v as string)) bad('not one of the allowed values'); return;
    case 'bool': if (typeof v !== 'boolean') bad('not true/false'); return;
    case 'int': if (typeof v !== 'number' || !Number.isInteger(v) || v < rule.min || v > rule.max) bad(`not a whole number from ${rule.min} to ${rule.max}`); return;
    case 'str': if (typeof v !== 'string' || !rule.re.test(v)) bad('not allowed text'); return;
    case 'ids':
      if (!Array.isArray(v) || v.length > rule.max) return bad('not a list');
      if (v.some((x) => typeof x !== 'string' || !rule.re.test(x))) bad('a list entry is not an ID');
      if (new Set(v).size !== v.length) bad('repeated entries');
      return;
    case 'buckets': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return bad('not a map');
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length > rule.max) bad('too many entries');
      for (const [k, x] of entries) if (!rule.key.test(k) || !rule.values.includes(x as string)) { bad(`entry "${k.slice(0, 40)}" not allowed`); break; }
      return;
    }
  }
}

/** Checks a payload strictly against USAGE_SCHEMA: every field present and valid, nothing else. */
export function validatePayload(x: unknown): Validation {
  const errors: string[] = [];
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, errors: ['not an object'] };
  const obj = x as Record<string, unknown>;
  const groups = new Set<string>(SCHEMA_GROUPS);
  // No unknown fields, at either level.
  for (const k of Object.keys(obj)) {
    if (groups.has(k)) {
      const g = obj[k];
      if (!g || typeof g !== 'object' || Array.isArray(g)) { errors.push(`${k}: not an object`); continue; }
      for (const kk of Object.keys(g)) if (!USAGE_SCHEMA[`${k}.${kk}`]) errors.push(`${k}.${kk}: unknown field`);
    } else if (!USAGE_SCHEMA[k]) errors.push(`${k}: unknown field`);
  }
  for (const [path, spec] of Object.entries(USAGE_SCHEMA)) {
    const [a, b] = path.split('.');
    const v = b === undefined ? obj[a] : (obj[a] as Record<string, unknown> | undefined)?.[b];
    if (v === undefined) { errors.push(`${path}: missing`); continue; }
    checkField(path, spec.rule, v, errors);
  }
  return { ok: errors.length === 0, errors };
}

/** Checks a whole request body: 1 to 7 valid pings from one install, each for a different day. */
export function validateBody(x: unknown): Validation & { pings: UsagePayload[] } {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, errors: ['not an object'], pings: [] };
  const keys = Object.keys(x);
  if (keys.length !== 1 || keys[0] !== 'pings') return { ok: false, errors: ['only "pings" is allowed'], pings: [] };
  const pings = (x as { pings: unknown }).pings;
  if (!Array.isArray(pings) || pings.length < 1 || pings.length > MAX_QUEUE_DAYS) return { ok: false, errors: [`pings: 1 to ${MAX_QUEUE_DAYS} entries`], pings: [] };
  const errors: string[] = [];
  pings.forEach((p, i) => { for (const e of validatePayload(p).errors) errors.push(`pings[${i}].${e}`); });
  if (!errors.length) {
    const ids = new Set(pings.map((p: UsagePayload) => p.id));
    if (ids.size !== 1) errors.push('pings: more than one install ID');
    if (new Set(pings.map((p: UsagePayload) => p.day)).size !== pings.length) errors.push('pings: the same day twice');
  }
  return { ok: errors.length === 0, errors, pings: errors.length ? [] : (pings as UsagePayload[]) };
}

// ---------------------------------------------------------------- coarsening (pure)

/** A random UUID v4 from 16 random bytes (crypto.getRandomValues or randomBytes). */
export function uuidFromBytes(b: Uint8Array): string {
  if (b.length < 16) throw new Error('need 16 random bytes');
  const x = Array.from(b.slice(0, 16));
  x[6] = (x[6] & 0x0f) | 0x40;
  x[8] = (x[8] & 0x3f) | 0x80;
  const h = x.map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const isInstallId = (s: unknown): s is string => typeof s === 'string' && UUID_V4.test(s);

/**
 * Apple's model identifiers for portables since the "MacN,M" scheme began.
 * Only a fallback: the battery itself (pmset, ioreg) decides first, because
 * these names no longer say "MacBook".
 */
export const MAC_LAPTOP_MODELS = new Set([
  'Mac14,2', 'Mac14,5', 'Mac14,6', 'Mac14,7', 'Mac14,9', 'Mac14,10', 'Mac14,15', // M2 MacBook Air and Pro
  'Mac15,3', 'Mac15,6', 'Mac15,7', 'Mac15,8', 'Mac15,9', 'Mac15,10', 'Mac15,11', 'Mac15,12', 'Mac15,13', // M3
  'Mac16,1', 'Mac16,5', 'Mac16,6', 'Mac16,7', 'Mac16,8', 'Mac16,12', 'Mac16,13', // M4
]);
/** Desktops with the same scheme (iMac, Mac mini, Mac Studio, Mac Pro), so they are not "unknown". */
export const MAC_DESKTOP_MODELS = new Set([
  'Mac13,1', 'Mac13,2', 'Mac14,3', 'Mac14,8', 'Mac14,12', 'Mac14,13', 'Mac14,14', 'Mac15,4', 'Mac15,5', 'Mac15,14', 'Mac16,2', 'Mac16,3', 'Mac16,9', 'Mac16,10', 'Mac16,11',
]);

/**
 * Does this Mac have a battery (a laptop)? From `pmset -g batt` (an
 * "InternalBattery" line), then `ioreg -rn AppleSmartBattery`, then the model
 * identifier (older "MacBook…" names and the table above). Null when nothing
 * tells.
 */
export function macHasBattery(i: { pmset?: string; ioreg?: string; model?: string }): boolean | null {
  if (i.pmset && /InternalBattery/i.test(i.pmset)) return true;
  if (i.ioreg && /"BatteryInstalled"\s*=\s*Yes/i.test(i.ioreg)) return true;
  const model = (i.model ?? '').trim();
  if (/MacBook/i.test(model) || MAC_LAPTOP_MODELS.has(model)) return true;
  // pmset answered and listed no battery: a desktop.
  if (i.pmset && /Now drawing from/i.test(i.pmset)) return false;
  if (MAC_DESKTOP_MODELS.has(model) || /^(iMac|Macmini|MacPro)\d/.test(model)) return false;
  return null;
}

export function osFamily(platform: string): UsagePayload['system']['os'] {
  return platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : 'other';
}

/** "14.5.0" → "14.5"; Windows "10.0.22631" → "11"; Linux kernel "6.8.0-45-generic" → "6.8". */
export function coarseOsVersion(platform: string, release: string): string {
  const m = String(release).match(/^(\d{1,3})(?:\.(\d{1,3}))?(?:\.(\d{1,6}))?/);
  if (!m) return '0';
  if (platform === 'win32') {
    const build = Number(m[3] ?? 0);
    if (m[1] === '10') return build >= 22000 ? '11' : '10';
    return m[1];
  }
  return m[2] !== undefined ? `${Number(m[1])}.${Number(m[2])}` : String(Number(m[1]));
}

export function archOf(arch: string): UsagePayload['system']['arch'] {
  return (ARCHES as readonly string[]).includes(arch) && arch !== 'other' ? (arch as UsagePayload['system']['arch']) : 'other';
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** The processor's family, never its exact model or anything else in the name. */
export function coarseCpu(model: string, platform: string, arch: string): { vendor: UsagePayload['system']['cpuVendor']; family: string } {
  const s = String(model ?? '').replace(/\((TM|R)\)/gi, ' ').replace(/\s+/g, ' ').trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/\bApple (M\d{1,2})\b/i))) return { vendor: 'apple', family: `Apple ${m[1].toUpperCase()}` };
  if (/\bApple\b/i.test(s) || (platform === 'darwin' && arch === 'arm64')) return { vendor: 'apple', family: 'Apple silicon' };
  if (/intel|genuineintel/i.test(s)) {
    if ((m = s.match(/Core Ultra (\d)/i))) return { vendor: 'intel', family: `Intel Core Ultra ${m[1]}` };
    if ((m = s.match(/\bi([3579])-(\d{4,5})/i))) {
      const digits = m[2];
      const gen = digits.length === 5 ? Number(digits.slice(0, 2)) : Number(digits[0]);
      return { vendor: 'intel', family: `Intel Core i${m[1]} ${ordinal(gen)} gen` };
    }
    if ((m = s.match(/\bCore i([3579])\b/i))) return { vendor: 'intel', family: `Intel Core i${m[1]}` };
    if (/xeon/i.test(s)) return { vendor: 'intel', family: 'Intel Xeon' };
    if (/celeron/i.test(s)) return { vendor: 'intel', family: 'Intel Celeron' };
    if (/pentium/i.test(s)) return { vendor: 'intel', family: 'Intel Pentium' };
    if (/atom/i.test(s)) return { vendor: 'intel', family: 'Intel Atom' };
    if (/core/i.test(s)) return { vendor: 'intel', family: 'Intel Core' };
    return { vendor: 'intel', family: 'Intel' };
  }
  if (/\bAMD\b|authenticamd/i.test(s)) {
    if ((m = s.match(/Ryzen (Threadripper)/i))) return { vendor: 'amd', family: 'AMD Ryzen Threadripper' };
    if ((m = s.match(/Ryzen (?:AI )?(\d)\b/i))) return { vendor: 'amd', family: `AMD Ryzen ${m[1]}` };
    if (/ryzen/i.test(s)) return { vendor: 'amd', family: 'AMD Ryzen' };
    if (/epyc/i.test(s)) return { vendor: 'amd', family: 'AMD EPYC' };
    if (/athlon/i.test(s)) return { vendor: 'amd', family: 'AMD Athlon' };
    return { vendor: 'amd', family: 'AMD' };
  }
  if (/snapdragon|qualcomm/i.test(s)) return { vendor: 'qualcomm', family: 'Qualcomm Snapdragon' };
  if (arch === 'arm64' || arch === 'arm') return { vendor: 'other', family: 'ARM' };
  return { vendor: 'other', family: 'Other' };
}

export function ramBucket(bytes: number): UsagePayload['system']['ramGB'] {
  const gb = bytes / 1024 ** 3;
  // Reported memory is a little under the installed amount (the system keeps some).
  if (gb < 6) return 4;
  if (gb < 12) return 8;
  if (gb < 24) return 16;
  if (gb < 48) return 32;
  return 64;
}

/** PCI vendor IDs → maker. */
export function gpuVendor(vendorIds: number[], platform: string, arch: string): UsagePayload['system']['gpu'] {
  const map: Record<number, UsagePayload['system']['gpu']> = { 0x10de: 'nvidia', 0x1002: 'amd', 0x1022: 'amd', 0x8086: 'intel', 0x106b: 'apple', 0x5143: 'qualcomm', 0x4d4f4351: 'qualcomm' };
  // A discrete card wins over the built-in one.
  const found = vendorIds.map((v) => map[v]).filter(Boolean);
  for (const pref of ['nvidia', 'amd', 'apple', 'qualcomm', 'intel'] as const) if (found.includes(pref)) return pref;
  if (platform === 'darwin' && arch === 'arm64') return 'apple';
  return vendorIds.some((v) => v > 0) ? 'other' : 'unknown';
}

/** "en-GB", "pt_BR.UTF-8", "zh-Hans-CN" → { lang: "en", region: "GB" }. */
export function localeParts(locale: string): { lang: string; region: string } {
  const parts = String(locale ?? '').split(/[.@]/)[0].split(/[-_]/);
  const lang = /^[a-zA-Z]{2,3}$/.test(parts[0] ?? '') ? parts[0].toLowerCase() : 'und';
  const region = parts.slice(1).find((p) => /^[a-zA-Z]{2}$/.test(p));
  return { lang: lang === 'und' ? 'en' : lang, region: region ? region.toUpperCase() : 'ZZ' };
}

export function countBucket(n: number): (typeof COUNT_BUCKETS)[number] | null {
  if (!(n >= 1)) return null;
  if (n < 5) return '1-4';
  if (n < 20) return '5-19';
  if (n < 100) return '20-99';
  return '100+';
}

export function memoryBucket(bytes: number): UsagePayload['health']['memory'] {
  const mb = bytes / 1048576;
  return mb < 250 ? '<250MB' : mb < 500 ? '250-500MB' : mb < 1024 ? '500MB-1GB' : '1GB+';
}

export function cpuBucket(pct: number): UsagePayload['health']['cpu'] {
  return pct < 1 ? '<1%' : pct < 5 ? '1-5%' : pct < 20 ? '5-20%' : '20%+';
}

export function startupBucket(ms: number | undefined): UsagePayload['health']['startup'] {
  if (ms === undefined || !(ms > 0)) return 'unknown';
  return ms < 2000 ? '<2s' : ms < 5000 ? '2-5s' : ms < 10_000 ? '5-10s' : '10s+';
}

export const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

const clampInt = (n: unknown, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(n) || 0)));

// ---------------------------------------------------------------- the payload

/** Everything the main process gathers; buildPayload decides what of it becomes the report. */
export interface TelemetryInputs {
  installId: string;
  now: number;
  version: string;
  official: boolean;
  installSource: string;
  platform: string;
  osRelease: string;
  arch: string;
  cpuModel: string;
  cores: number;
  totalMemBytes: number;
  gpuVendorIds: number[];
  hasBattery: boolean | null;
  tablet?: boolean;
  displays: number;
  notch: boolean;
  locale: string;
  /** UTC days (YYYY-MM-DD) Keeper was opened */
  activeDays: string[];
  featuresOn: string[];
  /** feature IDs from the registry; anything else in featuresOn is dropped */
  knownFeatures: string[];
  pageOpens: Record<string, number>;
  aiProviders: number;
  devices: number;
  crashes: number;
  restarts: number;
  avgMemoryBytes: number;
  avgCpuPct: number;
  startupMs?: number;
}

/** The one place the report is made. Pure: same inputs, same report. */
export function buildPayload(i: TelemetryInputs): UsagePayload {
  const day = utcDay(i.now);
  const weekAgo = utcDay(i.now - 6 * 86_400_000);
  const days = new Set(i.activeDays.filter((d) => DAY_RE.test(d) && d >= weekAgo && d <= day));
  const known = new Set(i.knownFeatures);
  const pages: Record<string, (typeof COUNT_BUCKETS)[number]> = {};
  for (const [k, n] of Object.entries(i.pageOpens).sort((a, b) => b[1] - a[1]).slice(0, 100)) {
    const b = countBucket(n);
    if (b && PAGE_RE.test(k)) pages[k] = b;
  }
  const cpu = coarseCpu(i.cpuModel, i.platform, i.arch);
  const { lang, region } = localeParts(i.locale);
  const version = /^\d{1,3}\.\d{1,3}\.\d{1,4}(-[0-9A-Za-z.]{1,20})?$/.test(i.version) ? i.version : '0.0.0';
  return {
    v: 1,
    id: i.installId,
    day,
    build: {
      version,
      channel: version.includes('-') ? 'prerelease' : 'stable',
      official: !!i.official,
      via: (INSTALL_SOURCES as readonly string[]).includes(i.installSource) ? (i.installSource as UsagePayload['build']['via']) : 'direct',
    },
    system: {
      os: osFamily(i.platform),
      osVersion: coarseOsVersion(i.platform, i.osRelease),
      arch: archOf(i.arch),
      cpuVendor: cpu.vendor,
      cpu: cpu.family,
      cores: clampInt(i.cores, 1, 128),
      ramGB: ramBucket(i.totalMemBytes),
      gpu: gpuVendor(i.gpuVendorIds, i.platform, i.arch),
      form: i.tablet ? 'tablet' : i.hasBattery === null ? 'unknown' : i.hasBattery ? 'laptop' : 'desktop',
      displays: clampInt(i.displays, 0, 8),
      notch: !!i.notch,
      lang,
      region,
    },
    usage: {
      active: days.has(day),
      days7: days.size,
      features: [...new Set(i.featuresOn.filter((f) => known.has(f) && ID_RE.test(f)))].sort().slice(0, 150),
      pages,
      aiProviders: clampInt(i.aiProviders, 0, 20),
      devices: clampInt(i.devices, 0, 50),
    },
    health: {
      crashes: clampInt(i.crashes, 0, 99),
      restarts: clampInt(i.restarts, 0, 99),
      memory: memoryBucket(i.avgMemoryBytes),
      cpu: cpuBucket(i.avgCpuPct),
      startup: startupBucket(i.startupMs),
    },
  };
}

/** Adds a day's ping to the unsent queue: one per day (the newest wins), at most a week, oldest dropped. */
export function enqueue(queue: UsagePayload[], p: UsagePayload, now: number): UsagePayload[] {
  const oldest = utcDay(now - (MAX_QUEUE_DAYS - 1) * 86_400_000);
  const rest = queue.filter((q) => q.day !== p.day && q.day >= oldest && q.id === p.id);
  return [...rest, p].sort((a, b) => a.day.localeCompare(b.day)).slice(-MAX_QUEUE_DAYS);
}

// ---------------------------------------------------------------- switching it off

export type OffReason = 'switch' | 'env' | 'dnt' | 'policy';

export const OFF_REASON_TEXT: Record<OffReason, string> = {
  switch: 'You switched it off.',
  env: 'Switched off by KEEPER_TELEMETRY=0 on this computer.',
  dnt: 'Switched off because DO_NOT_TRACK is set on this computer.',
  policy: 'Switched off by your organisation’s policy file.',
};

const falsy = (v?: string) => v !== undefined && /^(0|false|off|no)$/i.test(v.trim());
const truthy = (v?: string) => v !== undefined && v.trim() !== '' && !falsy(v);

/** Why stats are off, or null when they may be sent. The order is the order of strength. */
export function offReason(o: { switchOn: boolean; env: Record<string, string | undefined>; policy: ManagedPolicy | null }): OffReason | null {
  if (o.policy?.usageStats === false) return 'policy';
  if (falsy(o.env.KEEPER_TELEMETRY)) return 'env';
  if (truthy(o.env.DO_NOT_TRACK)) return 'dnt';
  if (!o.switchOn) return 'switch';
  return null;
}

// ---------------------------------------------------------------- managed policy

/**
 * An administrator can switch things off for every account on a computer with
 * a small JSON file at the system-wide place below (readable by all, writable
 * only by administrators):
 *
 *   { "usageStats": false }
 */
export interface ManagedPolicy {
  usageStats?: boolean;
}

export function policyPath(platform: string, env: Record<string, string | undefined>): string {
  if (platform === 'win32') return `${(env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData').replace(/[\\/]+$/, '')}\\Keeper\\policy.json`;
  if (platform === 'darwin') return '/Library/Application Support/Keeper/policy.json';
  return '/etc/keeper/policy.json';
}

/** Reads the policy file's text; unknown keys are ignored, a broken file means "no policy". */
export function parsePolicy(text: string | null | undefined): ManagedPolicy | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (!j || typeof j !== 'object') return null;
    const out: ManagedPolicy = {};
    // "telemetry": false is accepted too, as administrators may expect that name.
    const v = j.usageStats ?? j.telemetry;
    if (typeof v === 'boolean') out.usageStats = v;
    return out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the interface's view

export interface UsageStatsStatus {
  /** sending is allowed right now */
  on: boolean;
  /** the switch in Settings (what the person chose) */
  switchOn: boolean;
  offReason: OffReason | null;
  offText?: string;
  /** set by the environment or a policy: the switch cannot change it */
  locked: boolean;
  installId: string;
  endpoint: string;
  host: string;
  /** the last report sent, exactly as sent */
  last?: { at: number; body: PingBody };
  /** what would be sent next, built now from the current numbers */
  next: PingBody | null;
  /** unsent days waiting for a connection */
  queued: number;
  /** the last attempt, in plain words */
  lastAttempt?: { at: number; result: string };
  /** Keeper's firewall has a rule that blocks this connection */
  blockedByFirewall: boolean;
  policyFile: string;
}

export interface UsageStatsApi {
  status(): Promise<UsageStatsStatus>;
  setOn(on: boolean): Promise<UsageStatsStatus>;
  resetId(): Promise<UsageStatsStatus>;
  /** block or allow this connection in Keeper's firewall */
  setBlocked(blocked: boolean): Promise<UsageStatsStatus>;
  /** a main page was opened (its name only) */
  page(name: string): Promise<void>;
}
