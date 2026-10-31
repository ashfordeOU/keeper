// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper inside the operating system: what each platform offers, and the pure
// pieces (escaping, message shapes, line protocol) the integrations are built
// from. Nothing here touches the system; electron/services/platform does.

import type { BrainHit } from './brain-contract';
import { APP_NAME, BRAND, COMPANY } from './brand';

export type IntegrationId =
  | 'apple-intelligence' | 'mac-ocr' | 'spotlight' | 'shortcuts' | 'mac-services'
  | 'win-ocr' | 'win-agents' | 'win-ai' | 'explorer-menu' | 'jump-list'
  | 'gnome-search' | 'krunner' | 'desktop-actions'
  | 'mcp' | 'ask-shortcut' | 'url-actions';

export interface Integration {
  id: IntegrationId;
  label: string;
  description: string;
  /** what makes this possible on this computer, or why it is not */
  available: boolean;
  /** when it can be switched on and off */
  toggle: boolean;
  enabled: boolean;
  /** extra state: "On this Mac's model", "Needs macOS 26", … */
  detail?: string;
  /** steps for things Keeper cannot do on its own */
  steps?: string[];
  /** one-off actions, e.g. "register" or "copy" */
  actions?: { id: string; label: string }[];
}

export interface PlatformSettings {
  /** Spotlight finds files in Keeper's brain (macOS) */
  spotlight: boolean;
  /** GNOME's Activities search shows Keeper results */
  gnomeSearch: boolean;
  /** KDE's KRunner shows Keeper results */
  krunner: boolean;
  /** "Search with Keeper" in File Explorer's folder menu */
  explorerMenu: boolean;
  /** use the system's own text recognition when it has one */
  nativeOcr: boolean;
  /** global shortcut that opens Quick Search ready to ask a question */
  askShortcut: string;
}

export const DEFAULT_PLATFORM: PlatformSettings = {
  spotlight: false,
  gnomeSearch: false,
  krunner: false,
  explorerMenu: false,
  nativeOcr: true,
  askShortcut: 'CommandOrControl+Shift+K',
};

// ---------------------------------------------------------------- facts → list

/** What was found on this computer; gathered by the service, judged here. */
export interface PlatformFacts {
  platform: string;
  /** macOS major version, e.g. 26 */
  macVersion?: number;
  arm?: boolean;
  /** keeper-helper is shipped and runs */
  helper?: boolean;
  /** answer from the helper about the on-device model */
  appleModel?: 'available' | 'deviceNotEligible' | 'appleIntelligenceNotEnabled' | 'modelNotReady' | 'unsupported';
  /** Windows build number, e.g. 26100 */
  winBuild?: number;
  /** the Windows on-device agent registry command */
  odr?: boolean;
  /** Windows.Media.Ocr answered with at least one language */
  winOcr?: boolean;
  /** app is running with package identity (MSIX) */
  winPackaged?: boolean;
  /** XDG_CURRENT_DESKTOP, lower-cased */
  desktop?: string;
  /** a D-Bus session bus is reachable */
  sessionBus?: boolean;
  mcpCommand?: string;
}

const APPLE_MODEL_TEXT: Record<NonNullable<PlatformFacts['appleModel']>, string> = {
  available: 'Ready, running on this Mac',
  deviceNotEligible: 'This Mac cannot run Apple Intelligence (it needs Apple silicon)',
  appleIntelligenceNotEnabled: 'Turn on Apple Intelligence in System Settings first',
  modelNotReady: 'The model is still downloading; try again later',
  unsupported: 'Needs macOS 26 or later',
};

export function listIntegrations(f: PlatformFacts, s: PlatformSettings): Integration[] {
  const out: Integration[] = [];
  const mac = f.platform === 'darwin';
  const win = f.platform === 'win32';
  const linux = f.platform === 'linux';
  const desk = f.desktop ?? '';

  out.push({
    id: 'mcp', label: 'Any AI app (MCP)', toggle: false, enabled: true, available: true,
    description: 'AI apps and editors that speak the Model Context Protocol can search and read your Keeper library, with the same safety rules as Keeper itself.',
    detail: f.mcpCommand ? `Command: ${f.mcpCommand}` : undefined,
    actions: [{ id: 'copy-mcp', label: 'Copy setup' }],
  });
  out.push({
    id: 'ask-shortcut', label: 'Ask Keeper from anywhere', toggle: false, enabled: !!s.askShortcut, available: true,
    description: 'A keyboard shortcut that opens Quick Search ready for a question about your files.',
    detail: s.askShortcut ? `Shortcut: ${s.askShortcut.replace('CommandOrControl', mac ? '⌘' : 'Ctrl')}` : 'No shortcut set',
  });
  out.push({
    id: 'url-actions', label: 'Links and scripts', toggle: false, enabled: true, available: true,
    description: 'keeper://search, keeper://ask, keeper://open and keeper://reveal links, and the keeper command, so automation tools, launchers and scripts can use Keeper.',
    actions: [{ id: 'copy-links', label: 'Copy examples' }],
  });

  if (mac) {
    const modelOk = f.appleModel === 'available';
    out.push({
      id: 'apple-intelligence', label: 'Apple Intelligence', toggle: false, enabled: modelOk, available: !!f.helper && modelOk,
      description: 'Use the on-device model that comes with macOS as Keeper’s AI. Nothing leaves your Mac and no key is needed.',
      detail: !f.helper ? 'Keeper’s macOS helper is missing from this copy' : APPLE_MODEL_TEXT[f.appleModel ?? 'unsupported'],
    });
    out.push({
      id: 'mac-ocr', label: 'Live Text recognition', toggle: true, enabled: s.nativeOcr && !!f.helper, available: !!f.helper,
      description: 'Read text in images and scans with macOS’s own text recognition: faster and more accurate than the built-in reader, and it works with more languages.',
    });
    out.push({
      id: 'spotlight', label: 'Spotlight', toggle: true, enabled: s.spotlight && !!f.helper, available: !!f.helper,
      description: 'Spotlight and Siri Suggestions also find files by what Keeper knows about them: text read from images, where they came from, tags.',
    });
    out.push({
      id: 'shortcuts', label: 'Shortcuts and Siri', toggle: false, enabled: true, available: true,
      description: 'Build a shortcut that opens a keeper:// link or runs the keeper command, then ask Siri to run it by name.',
      steps: SHORTCUT_STEPS,
      actions: [{ id: 'open-shortcuts', label: 'Open Shortcuts' }],
    });
    out.push({
      id: 'mac-services', label: 'Services menu', toggle: false, enabled: false, available: true,
      description: 'Search selected text in Keeper from any app’s Services menu, with a Quick Action you make once in Shortcuts.',
      steps: SERVICES_STEPS,
      actions: [{ id: 'open-shortcuts', label: 'Open Shortcuts' }],
    });
  }

  if (win) {
    const build = f.winBuild ?? 0;
    out.push({
      id: 'win-ocr', label: 'Windows text recognition', toggle: true, enabled: s.nativeOcr && !!f.winOcr, available: !!f.winOcr,
      description: 'Read text in images and scans with the recognition built into Windows.',
      detail: f.winOcr ? undefined : 'No recognition languages are installed (Settings → Time & language → Language)',
    });
    out.push({
      id: 'win-agents', label: 'Windows AI agents', toggle: false, enabled: false, available: !!f.odr,
      description: 'Let Copilot and other agents on Windows use Keeper through the on-device agent registry.',
      detail: f.odr ? 'The registry is available on this PC' : build >= 26100 ? 'The agent registry is not switched on for this PC yet' : 'Needs a newer Windows 11',
      actions: f.odr ? [{ id: 'register-odr', label: 'Register Keeper' }] : undefined,
      steps: f.odr ? undefined : WINDOWS_AGENT_STEPS,
    });
    out.push({
      id: 'win-ai', label: 'On-device Windows AI model', toggle: false, enabled: false, available: false,
      description: 'Windows’ own small language model on Copilot+ PCs.',
      detail: f.winPackaged ? 'Not supported by this version of Keeper yet' : 'Windows only offers it to apps installed as a Store package; use the MCP setup or a local model instead',
    });
    out.push({
      id: 'explorer-menu', label: 'File Explorer menu', toggle: true, enabled: s.explorerMenu, available: true,
      description: 'Right-click a folder (or the empty space inside one) and choose “Search with Keeper”.',
    });
    out.push({
      id: 'jump-list', label: 'Taskbar menu', toggle: false, enabled: true, available: true,
      description: 'Right-click Keeper on the taskbar for Search, Ask and Copy Text from Screen.',
    });
  }

  if (linux) {
    const gnome = desk.includes('gnome') || desk.includes('unity') || desk.includes('ubuntu');
    const kde = desk.includes('kde') || desk.includes('plasma');
    out.push({
      id: 'gnome-search', label: 'GNOME search', toggle: true, enabled: s.gnomeSearch && !!f.sessionBus, available: !!f.sessionBus,
      description: 'Type in the Activities overview and Keeper’s results appear next to the system’s own.',
      detail: !f.sessionBus ? 'No desktop session bus found' : gnome ? undefined : 'You are not on GNOME right now; it will work when you are',
    });
    out.push({
      id: 'krunner', label: 'KDE KRunner', toggle: true, enabled: s.krunner && !!f.sessionBus, available: !!f.sessionBus,
      description: 'Keeper’s results appear in KRunner and the Plasma launcher search.',
      detail: !f.sessionBus ? 'No desktop session bus found' : kde ? undefined : 'You are not on KDE Plasma right now; it will work when you are',
    });
    out.push({
      id: 'desktop-actions', label: 'Launcher actions', toggle: false, enabled: true, available: true,
      description: 'Right-click Keeper in your dock or app menu for Search, Ask and Copy Text from Screen.',
    });
  }
  return out;
}

export const SHORTCUT_STEPS = [
  'Open the Shortcuts app and make a new shortcut.',
  'Add “Ask for Input” (Text) and then “URL” with keeper://ask?q= followed by the Provided Input variable.',
  'Add “Open URLs”. Name the shortcut, for example “Ask Keeper”.',
  'Say “Hey Siri, Ask Keeper”, or run it from the menu bar or Spotlight.',
  'To list matching files without opening Keeper, use “Run Shell Script” with: keeper search "$1" (the keeper command must be installed).',
];

export const SERVICES_STEPS = [
  'In Shortcuts, make a new shortcut and open its details (the ⓘ button).',
  'Turn on “Use as Quick Action” and “Services Menu”; set it to receive Text.',
  'Add “URL” with keeper://search?q= followed by the Shortcut Input variable, then “Open URLs”.',
  'Name it “Search in Keeper”. Select text anywhere, then choose the app menu → Services → Search in Keeper.',
];

export const WINDOWS_AGENT_STEPS = [
  'Agents on Windows that support MCP (Model Context Protocol) servers can use Keeper today.',
  'Add a server that runs: keeper mcp',
  'When the on-device agent registry is available on your PC, Keeper can register itself here with one click.',
];

// ---------------------------------------------------------------- URL actions

export type UrlAction =
  | { action: 'search'; q: string }
  | { action: 'ask'; q: string }
  | { action: 'open'; path: string }
  | { action: 'reveal'; path: string }
  | { action: 'other'; name: string };

/** keeper://search?q=… | keeper://ask?q=… | keeper://open?path=… | keeper://reveal?path=… */
export function parseKeeperUrl(url: string): UrlAction | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'keeper:') return null;
  const name = (u.hostname || u.pathname.replace(/^\/+/, '')).toLowerCase();
  const q = u.searchParams.get('q') ?? u.searchParams.get('text') ?? '';
  const p = u.searchParams.get('path') ?? '';
  if (name === 'search') return { action: 'search', q: q.slice(0, 500) };
  if (name === 'ask') return { action: 'ask', q: q.slice(0, 2000) };
  if ((name === 'open' || name === 'reveal') && p) {
    // Only absolute local paths: no URLs, no relative tricks.
    if (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p) || /\0/.test(p)) return null;
    return { action: name, path: p };
  }
  return { action: 'other', name };
}

// ---------------------------------------------------------------- Windows

/** A PowerShell single-quoted string: only ' needs doubling, nothing inside is expanded. */
export function psQuote(s: string): string {
  return `'${String(s).replace(/\0/g, '').replace(/['‘’‚‛]/g, "''")}'`;
}

/**
 * Windows.Media.Ocr from PowerShell (works without packaging on Windows 10+).
 * The file path goes in as a single-quoted literal, so names with $, `, ; or
 * quotes cannot run anything. Prints one JSON line: {text, lang} or {error}.
 */
export function windowsOcrScript(file: string, lang?: string): string {
  return [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation`1" })[0]',
    'function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }',
    '[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null',
    'try {',
    `  $path = ${psQuote(file)}`,
    lang
      ? `  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new(${psQuote(lang)})); if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }`
      : '  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
    '  if (-not $engine) { @{ error = "no-language" } | ConvertTo-Json -Compress; exit 0 }',
    '  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])',
    '  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])',
    '  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])',
    '  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])',
    '  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])',
    '  $lines = @($result.Lines | ForEach-Object { $_.Text })',
    '  @{ text = ($lines -join "`n"); lang = $engine.RecognizerLanguage.LanguageTag } | ConvertTo-Json -Compress',
    '} catch { @{ error = $_.Exception.Message } | ConvertTo-Json -Compress }',
  ].join('\n');
}

/** Lists the OCR languages Windows has installed; prints a JSON array. */
export const WINDOWS_OCR_LANGS_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null',
  'try { ConvertTo-Json -Compress @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }) } catch { "[]" }',
].join('\n');

/** PowerShell's -EncodedCommand takes UTF-16LE base64, which keeps the script out of quoting rules entirely. */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * Registry entries (per user, no admin) for "Search with Keeper" on folders
 * and folder backgrounds. Returned as reg.exe argument lists, so nothing is
 * parsed by a shell.
 */
export function explorerMenuReg(exe: string, add: boolean): string[][] {
  const keys = ['HKCU\\Software\\Classes\\Directory\\shell\\KeeperSearch', 'HKCU\\Software\\Classes\\Directory\\Background\\shell\\KeeperSearch'];
  if (!add) return keys.map((k) => ['delete', k, '/f']);
  const out: string[][] = [];
  keys.forEach((k, i) => {
    // %1 is the folder clicked; %V the folder whose background was clicked.
    const arg = i === 0 ? '%1' : '%V';
    out.push(['add', k, '/ve', '/d', `Search with ${APP_NAME}`, '/f']);
    out.push(['add', k, '/v', 'Icon', '/d', `"${exe}",0`, '/f']);
    out.push(['add', `${k}\\command`, '/ve', '/d', `"${exe}" "--keeper-search-in=${arg}"`, '/f']);
  });
  return out;
}

/** The folder passed by the Explorer menu, from the command line. */
export function searchInFromArgv(argv: string[]): string | undefined {
  const a = argv.find((x) => x.startsWith('--keeper-search-in='));
  if (!a) return undefined;
  const p = a.slice('--keeper-search-in='.length).replace(/^"|"$/g, '');
  return p && !p.includes('\0') ? p : undefined;
}

/** A manifest for the Windows on-device agent registry describing Keeper's MCP server. */
export function odrManifest(command: string, args: string[], version: string) {
  return {
    manifest_version: '0.1',
    name: 'keeper',
    display_name: BRAND,
    version,
    description: 'Search, read and understand the files on this PC with Keeper’s on-device index.',
    author: { name: COMPANY },
    server: { type: 'binary', entry_point: command, mcp_config: { command, args } },
    tools: [
      { name: 'search_files', description: 'Find files by name, content, kind, date or source' },
      { name: 'read_file', description: 'Read the text of a file in the library' },
    ],
  };
}

// ---------------------------------------------------------------- Linux

export const GNOME_BUS_NAME = 'org.ashfordeou.Keeper.SearchProvider';
export const GNOME_OBJECT_PATH = '/org/ashfordeou/Keeper/SearchProvider';
export const KRUNNER_BUS_NAME = 'org.ashfordeou.Keeper.Runner';
export const KRUNNER_OBJECT_PATH = '/runner';

/** The .ini GNOME Shell reads to find a search provider. */
export function gnomeProviderIni(desktopId: string): string {
  return [
    '[Shell Search Provider]',
    `DesktopId=${desktopId}`,
    `BusName=${GNOME_BUS_NAME}`,
    `ObjectPath=${GNOME_OBJECT_PATH}`,
    'Version=2',
    '',
  ].join('\n');
}

/** The KRunner D-Bus plugin description (Plasma 5.24+ / 6). */
export function krunnerDesktopFile(): string {
  return [
    '[Desktop Entry]',
    `Name=${BRAND}`,
    `Comment=Find files with ${APP_NAME}`,
    'X-KDE-ServiceTypes=Plasma/Runner',
    'Type=Service',
    'Icon=keeper',
    `X-KDE-PluginInfo-Author=${COMPANY}`,
    'X-KDE-PluginInfo-Name=keeper',
    'X-KDE-PluginInfo-Version=1.0',
    'X-KDE-PluginInfo-License=AGPL-3.0-or-later',
    'X-KDE-PluginInfo-EnabledByDefault=true',
    'X-Plasma-API=DBus',
    `X-Plasma-DBusRunner-Service=${KRUNNER_BUS_NAME}`,
    `X-Plasma-DBusRunner-Path=${KRUNNER_OBJECT_PATH}`,
    '',
  ].join('\n');
}

/** A D-Bus activation file, so the desktop can start Keeper when it asks for results. */
export function dbusServiceFile(busName: string, exec: string): string {
  return ['[D-BUS Service]', `Name=${busName}`, `Exec=${desktopExec(exec)} --keeper-dbus`, ''].join('\n');
}

/** Quotes a path for Exec= lines in .desktop and .service files. */
export function desktopExec(p: string): string {
  if (/^[\w/.+-]+$/.test(p)) return p;
  return `"${p.replace(/(["`$\\])/g, '\\$1')}"`;
}

/** Result ids carry the path; GNOME hands them back when one is opened. */
export function resultId(h: Pick<BrainHit, 'path'>): string {
  return 'f:' + h.path;
}
export function pathFromResultId(id: string): string | undefined {
  return id.startsWith('f:') ? id.slice(2) : undefined;
}

export interface GnomeMeta {
  id: string;
  name: string;
  description: string;
  gicon?: string;
}

const KIND_ICON: Record<string, string> = {
  image: 'image-x-generic', video: 'video-x-generic', audio: 'audio-x-generic', document: 'x-office-document',
  archive: 'package-x-generic', installer: 'application-x-executable', app: 'application-x-executable', code: 'text-x-script', other: 'text-x-generic',
};

export function iconFor(kind: string): string {
  return KIND_ICON[kind] ?? 'text-x-generic';
}

function shortDir(p: string, home?: string): string {
  const dir = p.replace(/[\\/][^\\/]*$/, '') || '/';
  return home && (dir === home || dir.startsWith(home + '/')) ? '~' + dir.slice(home.length) : dir;
}

/** GetResultMetas: one entry per id we still know. */
export function gnomeMetas(ids: string[], hits: Map<string, BrainHit>, home?: string): GnomeMeta[] {
  const out: GnomeMeta[] = [];
  for (const id of ids) {
    const h = hits.get(id);
    if (!h) continue;
    const snippet = h.snippet ? ' — ' + h.snippet.replace(/\s+/g, ' ').slice(0, 80) : '';
    out.push({ id, name: h.name, description: shortDir(h.path, home) + snippet, gicon: iconFor(h.kind) });
  }
  return out;
}

/** GNOME passes the typed words as an array; Keeper reads them as one query. */
export function termsToQuery(terms: string[]): string {
  return terms.map((t) => t.trim()).filter(Boolean).join(' ').slice(0, 300);
}

/**
 * KRunner's Match returns (id, text, icon, type, relevance, properties).
 * Type 100 = exact, 70 = possible, 50 = helper; relevance 0..1.
 */
export type KrunnerMatch = [string, string, string, number, number, Record<string, unknown>];

export function krunnerMatches(hits: BrainHit[], home?: string): KrunnerMatch[] {
  return hits.slice(0, 12).map((h, i) => [
    resultId(h),
    h.name,
    iconFor(h.kind),
    h.score >= 0.85 && i === 0 ? 100 : 70,
    Math.max(0, Math.min(1, h.score)),
    { subtext: shortDir(h.path, home), urls: [`file://${encodeURI(h.path)}`] },
  ]);
}

// ---------------------------------------------------------------- helper line protocol

/**
 * keeper-helper (macOS) talks JSON, one message per line, both ways.
 *  host → helper: {id, method, params}
 *  helper → host: {id, result} | {id, error} | {id, delta} (streamed text)
 *                 | {id, tool: {call, name, arguments}}  (the model wants Keeper to run a tool;
 *                    the host answers with {id, method: 'toolResult', params: {call, result}})
 */
export interface HelperRequest {
  id: number;
  method: string;
  params?: unknown;
}

export interface HelperMessage {
  id: number;
  result?: unknown;
  error?: string;
  delta?: string;
  tool?: { call: string; name: string; arguments: unknown };
}

export function encodeLine(msg: unknown): string {
  // JSON.stringify never emits raw newlines (they are escaped), so one message is one line.
  return JSON.stringify(msg) + '\n';
}

/** Splits a byte stream into whole lines and parses each; bad lines are reported, not thrown. */
export class LineDecoder {
  private buf = '';
  constructor(private onMessage: (m: HelperMessage) => void, private onBad: (line: string) => void = () => undefined, private maxLine = 32 * 1024 * 1024) {}
  push(chunk: string | Buffer) {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      try {
        const m = JSON.parse(line) as HelperMessage;
        if (typeof m === 'object' && m && typeof m.id === 'number') this.onMessage(m);
        else this.onBad(line);
      } catch {
        this.onBad(line);
      }
    }
    if (this.buf.length > this.maxLine) {
      this.onBad(this.buf.slice(0, 200));
      this.buf = '';
    }
  }
}

// ---------------------------------------------------------------- Spotlight

export interface SpotlightItem {
  id: string;
  path: string;
  title: string;
  /** what Spotlight shows under the title and searches */
  description: string;
  keywords: string[];
  kind: string;
  mtime: number;
}

/** What Keeper tells Spotlight about a file: its name, where it came from, tags, and the start of its text. */
export function spotlightItem(h: Pick<BrainHit, 'path' | 'name' | 'kind' | 'mtime' | 'source' | 'tags' | 'snippet'>, text?: string): SpotlightItem {
  const desc = [h.source ? `From ${h.source}` : '', (text ?? h.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)].filter(Boolean).join(' · ');
  const keywords = [...new Set([...(h.tags ?? []), h.source ?? '', h.kind].map((k) => k.trim()).filter(Boolean))].slice(0, 20);
  return { id: resultId(h), path: h.path, title: h.name, description: desc, keywords, kind: h.kind, mtime: h.mtime };
}
