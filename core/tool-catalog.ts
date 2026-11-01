// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every Keeper tool the launcher can open, with words people search for, and
// the one standard place results go. The launcher (a global shortcut) finds a
// tool by typing and opens it in a small window of its own.

import { TOOL_INFO, type ConvertTool } from './convert-types';
import type { OutputPolicy } from './monitor-tray';

export type LauncherKind = 'toolbox' | 'convert' | 'page';

export interface LauncherTool {
  /** `toolbox:json`, `convert:video.compress`, `page:health` */
  id: string;
  kind: LauncherKind;
  name: string;
  desc: string;
  group: string;
  icon: string;
  /** extra search words */
  words?: string;
  /** feature that must be on */
  feature?: string;
  /** small window size */
  size?: { w: number; h: number };
}

const T = (id: string, name: string, desc: string, group: string, icon: string, words = '', feature?: string): LauncherTool => ({ id: `toolbox:${id}`, kind: 'toolbox', name, desc, group, icon, words, feature: feature ?? 'tools' });
const P = (route: string, name: string, desc: string, icon: string, words = '', feature?: string): LauncherTool => ({ id: `page:${route}`, kind: 'page', name, desc, group: 'Pages', icon, words, feature });

/** The Toolbox's tools (ids match src/screens/Tools*.tsx). */
export const TOOLBOX: LauncherTool[] = [
  T('screen', 'Copy text from screen', 'Drag over anything to copy its text or read a QR code.', 'Screen', 'screenshot', 'ocr capture qr'),
  T('colour', 'Colour picker', 'Pick any colour on screen.', 'Screen', 'drop', 'color eyedropper hex'),
  T('pixels', 'Dead-pixel test', 'Solid colours to spot stuck pixels.', 'Screen', 'grid', 'display'),
  T('clean', 'Clean the keyboard', 'Locks the keyboard while you wipe it.', 'Screen', 'lock'),
  T('link', 'Clean a link', 'Strip tracking tags from links.', 'Text', 'globe', 'url utm tracking'),
  T('redact', 'Hide personal info', 'Mask e-mails, numbers and keys.', 'Text', 'eye', 'redact privacy'),
  T('case', 'Change case', 'Title, sentence, camelCase, snake_case.', 'Text', 'text', 'upper lower'),
  T('words', 'Word counter', 'Words, characters and reading time.', 'Text', 'document', 'count characters'),
  T('unicode', 'Hidden characters', 'Find zero-width and look-alike characters.', 'Text', 'search', 'unicode inspector'),
  T('password', 'Password generator', 'Strong random passwords and phrases.', 'Text', 'lock', 'passphrase'),
  T('qr', 'QR code maker', 'Links, text, Wi-Fi and contacts as a QR code.', 'Text', 'grid'),
  T('diff', 'Compare texts', 'Which lines changed between two versions.', 'Text', 'dupes', 'diff checker'),
  T('speak', 'Read aloud', 'Hear any text in the system voices.', 'Text', 'audio', 'text to speech tts'),
  T('lorem', 'Placeholder text', 'Lorem ipsum paragraphs.', 'Text', 'document', 'lorem ipsum'),
  T('receipts', 'Receipts to spreadsheet', 'Totals from photos of receipts as CSV.', 'Text', 'assistant'),
  T('subs', 'Translate subtitles', 'Translate .srt and .vtt files.', 'Text', 'assistant', 'srt vtt'),
  T('json', 'JSON formatter', 'Pretty-print or minify JSON.', 'Developer', 'code', 'format validate'),
  T('b64', 'Base64', 'Encode and decode text.', 'Developer', 'code', 'encode decode'),
  T('hash', 'Hashes', 'SHA-1, SHA-256 and SHA-512.', 'Developer', 'code', 'sha md5 checksum'),
  T('uuid', 'UUIDs', 'Random v4 and time-ordered v7.', 'Developer', 'code', 'guid'),
  T('jwt', 'JWT decoder', 'What is inside a token.', 'Developer', 'code', 'token'),
  T('time', 'Timestamp converter', 'Unix time and ISO dates.', 'Developer', 'clock', 'epoch unix date'),
  T('regex', 'Regex tester', 'Live highlighting of matches.', 'Developer', 'search', 'regular expression'),
  T('markdown', 'Markdown preview', 'Markdown as formatted text.', 'Developer', 'code', 'md html'),
  T('csv', 'CSV to JSON', 'Spreadsheet exports as JSON.', 'Developer', 'code'),
  T('colours', 'Colour converter', 'Hex, RGB, HSL, OKLCH and contrast.', 'Developer', 'palette', 'color contrast'),
  T('bases', 'Number bases', 'Decimal, hex, binary and octal.', 'Developer', 'code', 'binary hex'),
  T('url', 'URL encode', 'Encode and decode text for links.', 'Developer', 'globe'),
  T('html', 'HTML entities', 'Escape and unescape entities.', 'Developer', 'code'),
  T('cron', 'Cron explainer', 'Cron schedules in words.', 'Developer', 'clock', 'crontab'),
  T('coords', 'Coordinates', 'Coordinate formats, distances and maps.', 'Developer', 'globe', 'gps latitude longitude'),
  T('wifi', 'Wi-Fi passwords', 'Saved Wi-Fi passwords and sharing.', 'System', 'globe', 'wireless network'),
  T('eject', 'Eject all disks', 'Eject every external drive.', 'System', 'arrowUp', 'unmount usb'),
  T('speed', 'Internet speed', 'Download, upload and latency.', 'System', 'bolt', 'speedtest bandwidth'),
  T('network', 'Network details', 'Your addresses here and on the internet.', 'System', 'globe', 'ip address'),
  T('tweaks', 'System tweaks', 'Hidden files, extensions and other switches.', 'System', 'settings', 'hidden settings'),
  T('displays', 'Display control', 'Brightness and volume of external monitors.', 'System', 'sun', 'ddc brightness', 'displayControl'),
  T('download-video', 'Download video', 'Save a video or its sound from a page.', 'Media', 'down', 'youtube mp3', 'videoDownload'),
  T('record-voice', 'Record your voice', 'Record from the microphone, then transcribe.', 'Media', 'mic', 'audio recorder'),
  T('web-pdf', 'Web page to PDF', 'Save any page as a PDF.', 'Media', 'globe', 'print'),
];

const CONVERT_GROUP: Record<string, string> = { video: 'Video', audio: 'Audio', image: 'Images', pdf: 'PDF', doc: 'Documents', file: 'Files', convert: 'Convert' };
const CONVERT_ICON: Record<string, string> = { video: 'video', audio: 'audio', image: 'image', pdf: 'document', doc: 'document', file: 'folder', convert: 'refresh' };

/** Convert's tools, from its own table so new ones appear by themselves. */
export function convertTools(): LauncherTool[] {
  return (Object.entries(TOOL_INFO) as [ConvertTool, (typeof TOOL_INFO)[ConvertTool]][]).map(([id, t]) => ({
    id: `convert:${id}`, kind: 'convert' as const, name: `${CONVERT_GROUP[t.category] ?? 'Convert'}: ${t.label}`, desc: t.description, group: CONVERT_GROUP[t.category] ?? 'Convert',
    icon: CONVERT_ICON[t.category] ?? 'refresh', words: `${t.category} ${t.accepts.join(' ')} ${id}`, feature: 'convert', size: { w: 760, h: 640 },
  }));
}

export const PAGES: LauncherTool[] = [
  P('health', 'Health', 'Processor, memory, history and alerts.', 'bolt', 'activity monitor system', 'health'),
  P('health:processes', 'Processes', 'Every running program; quit, pause or inspect.', 'power', 'task manager kill ps top', 'processes'),
  P('health:history', 'Health history', 'Up to a year of processor, memory, network and disk use.', 'clock', 'charts graph', 'health'),
  P('health:dev', 'Dev servers and agents', 'Coding agents and dev servers by project.', 'code', 'ports localhost ai', 'health'),
  P('health:sensors', 'Graphics, fans and power', 'GPU use, temperatures, fans and power draw.', 'sun', 'gpu temperature watts', 'health'),
  P('space', 'Space Map', 'What takes up room on your disks.', 'disk', 'storage disk usage', 'space'),
  P('cleanup', 'Clean Up', 'Caches and leftovers you can remove.', 'broom', 'clean junk', 'cleanup'),
  P('duplicates', 'Duplicates', 'Copies and look-alike photos.', 'dupes', 'duplicate files', 'duplicates'),
  P('awake', 'Keep Awake', 'Stop the computer sleeping for a while.', 'coffee', 'caffeinate', 'keepAwake'),
  P('controls', 'Quick Controls', 'Wi-Fi, Bluetooth, firewall and privacy switches.', 'settings', 'toggle', 'quickControls'),
  P('startup', 'Startup items', 'What starts with your computer.', 'power', 'login items', 'startupItems'),
  P('apps', 'Uninstall apps', 'Apps you no longer use.', 'app', 'uninstall remove', 'startupItems'),
  P('tools', 'Toolbox', 'Every small tool.', 'grid', 'utilities', 'tools'),
  P('convert', 'Convert', 'Any file to another format.', 'refresh', 'converter', 'convert'),
];

/** Everything the launcher can open, for the features that are on. */
export function launcherTools(on: (feature: string) => boolean = () => true): LauncherTool[] {
  return [...TOOLBOX, ...convertTools(), ...PAGES].filter((t) => !t.feature || on(t.feature));
}

/** Ranks tools for what was typed: name starts, word starts, then anywhere; recent ones first on ties. */
export function searchTools(tools: LauncherTool[], q: string, recent: string[] = []): LauncherTool[] {
  const query = q.trim().toLowerCase();
  const rank = (t: LauncherTool) => {
    const r = recent.indexOf(t.id);
    const bonus = r < 0 ? 0 : 5 - Math.min(4, r);
    if (!query) return 10 + bonus;
    const name = t.name.toLowerCase();
    const hay = `${name} ${t.desc.toLowerCase()} ${t.group.toLowerCase()} ${(t.words ?? '').toLowerCase()}`;
    const words = query.split(/\s+/);
    if (!words.every((w) => hay.includes(w))) return -1;
    let s = 0;
    if (name.startsWith(query)) s += 100;
    else if (name.split(/[\s:]+/).some((w) => w.startsWith(words[0]))) s += 60;
    else if (name.includes(query)) s += 40;
    else s += 10;
    if (t.kind === 'toolbox') s += 3;
    return s + bonus;
  };
  return tools.map((t) => ({ t, s: rank(t) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s || a.t.name.localeCompare(b.t.name)).map((x) => x.t);
}

/** Splits `convert:video.compress` into its kind and id. */
export function parseToolId(id: string): { kind: LauncherKind; ref: string } | null {
  const m = id.match(/^(toolbox|convert|page):(.+)$/);
  return m ? { kind: m[1] as LauncherKind, ref: m[2] } : null;
}

// ---------------------------------------------------------------- standard output folder

/** "2026-10-31 14.05" — sorts by date, readable, valid on every file system. */
export function datedName(now: Date, label?: string): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}.${p(now.getMinutes())}`;
  const clean = label?.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
  return clean ? `${stamp} ${clean}` : stamp;
}

/**
 * Where a tool's results go under the standard output setting. Undefined
 * means "Keeper's usual place" (a new folder next to the originals). Never an
 * existing folder's files: a dated folder is new each time, and file names
 * inside are made unique by the tools.
 */
export function standardOutputDir(policy: OutputPolicy, downloads: string, label: string | undefined, now = new Date(), join: (...p: string[]) => string = (...p) => p.join('/'), exists: (p: string) => boolean = () => false): string | undefined {
  if (policy.mode === 'beside') return undefined;
  if (policy.mode === 'folder') return policy.folder || undefined;
  const base = policy.folder || join(downloads, 'Keeper');
  let dir = join(base, datedName(now, label));
  for (let i = 2; exists(dir) && i < 1000; i++) dir = join(base, `${datedName(now, label)} ${i}`);
  return dir;
}
