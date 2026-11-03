// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Apps Quick Search can open, as each system lists them:
//   macOS    .app bundles in /Applications, ~/Applications and the system's own folders
//   Windows  Start menu shortcuts (.lnk) and Store apps
//   Linux    .desktop files (XDG data folders, Flatpak and Snap exports)
// Pure parts: reading a .desktop file and turning its Exec line into a
// program and arguments (the Desktop Entry rules), and app names from paths.

export interface LaunchApp {
  /** stable id: the path, or "store:<app id>" on Windows, or "desktop:<file name>" on Linux */
  id: string;
  name: string;
  /** the bundle, shortcut or .desktop file */
  path: string;
  /** other words it is found by (generic name, keywords) */
  keywords?: string;
  /** Linux: the program and its arguments; Windows Store apps: the app id */
  exec?: string[];
  /** Linux: its icon name or path (Icon=) */
  icon?: string;
  /** Linux: runs in a terminal */
  terminal?: boolean;
}

export interface DesktopEntry {
  name: string;
  genericName?: string;
  keywords?: string;
  exec?: string;
  icon?: string;
  terminal: boolean;
  /** NoDisplay, Hidden, not an Application, or only for other desktops */
  hidden: boolean;
}

/** Unescapes a Desktop Entry string value (\s \n \t \r \\). */
function unescapeValue(v: string): string {
  return v.replace(/\\([sntr\\;])/g, (_m, c: string) => (c === 's' ? ' ' : c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c));
}

/**
 * Reads the [Desktop Entry] group, preferring names in the person's language
 * (Name[de_DE], then Name[de], then Name).
 */
export function parseDesktopEntry(text: string, locale = 'en_US', desktop = ''): DesktopEntry | null {
  const lines = text.split(/\r?\n/);
  let inMain = false;
  const kv = new Map<string, string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) { inMain = line === '[Desktop Entry]'; continue; }
    if (!inMain) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    kv.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  if (!kv.size) return null;
  const lang = locale.split(/[.@]/)[0];
  const short = lang.split('_')[0];
  const loc = (k: string) => kv.get(`${k}[${lang}]`) ?? kv.get(`${k}[${short}]`) ?? kv.get(k);
  const name = loc('Name');
  if (!name) return null;
  const desktops = desktop.toLowerCase().split(':').filter(Boolean);
  const only = (kv.get('OnlyShowIn') ?? '').toLowerCase().split(';').filter(Boolean);
  const not = (kv.get('NotShowIn') ?? '').toLowerCase().split(';').filter(Boolean);
  const wrongDesktop = (only.length > 0 && desktops.length > 0 && !only.some((d) => desktops.includes(d))) || not.some((d) => desktops.includes(d));
  return {
    name: unescapeValue(name),
    genericName: loc('GenericName') ? unescapeValue(loc('GenericName')!) : undefined,
    keywords: loc('Keywords') ? unescapeValue(loc('Keywords')!).split(';').filter(Boolean).join(' ') : undefined,
    exec: kv.get('Exec'),
    icon: kv.get('Icon'),
    terminal: kv.get('Terminal') === 'true',
    hidden: kv.get('NoDisplay') === 'true' || kv.get('Hidden') === 'true' || (kv.get('Type') ?? 'Application') !== 'Application' || wrongDesktop,
  };
}

/**
 * The program and arguments of an Exec line: quoted arguments, escapes, and
 * the field codes (%f %U %i %c %k…) left out, as when opening an app with no
 * files. "%%" is a percent sign. Undefined when the line is malformed.
 */
export function execArgv(exec: string, o: { name?: string; icon?: string; file?: string } = {}): string[] | undefined {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let quoted = false;
  for (let i = 0; i < exec.length; i++) {
    const c = exec[i];
    if (quoted) {
      if (c === '\\' && i + 1 < exec.length && '"`$\\'.includes(exec[i + 1])) { cur += exec[++i]; continue; }
      if (c === '"') { quoted = false; continue; }
      cur += c;
      continue;
    }
    if (c === '"') { quoted = true; has = true; continue; }
    if (/\s/.test(c)) { if (has || cur) out.push(cur); cur = ''; has = false; continue; }
    cur += c;
  }
  if (quoted) return undefined;
  if (has || cur) out.push(cur);
  const args: string[] = [];
  for (const a of out) {
    if (a === '%f' || a === '%F' || a === '%u' || a === '%U') { if (o.file) args.push(o.file); continue; }
    if (a === '%i') { if (o.icon) args.push('--icon', o.icon); continue; }
    if (a === '%c') { if (o.name) args.push(o.name); continue; }
    if (/^%[dDnNvmk]$/.test(a)) continue;
    // Field codes inside an argument: drop them, keep the rest; %% is a percent sign.
    args.push(a.replace(/%%/g, '\u0000').replace(/%[a-zA-Z]/g, '').replace(/\u0000/g, '%'));
  }
  return args.length && args[0] ? args : undefined;
}

/** "Visual Studio Code.app" → "Visual Studio Code"; "Firefox.lnk" → "Firefox". */
export function appNameFromPath(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p;
  return base.replace(/\.(app|lnk|desktop)$/i, '');
}

/** Start menu shortcuts that are not apps people open (uninstallers, help files, read-me links). */
export function isNoiseShortcut(name: string): boolean {
  return /\b(uninstall|uninstaller|remove|readme|read me|release notes|license|help|documentation|manual|website|on the web)\b/i.test(name);
}

/** One entry per name: the first of each name wins (user folders are read first). */
export function dedupeApps(list: LaunchApp[]): LaunchApp[] {
  const seen = new Set<string>();
  const out: LaunchApp[] = [];
  for (const a of list) {
    const k = a.name.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
