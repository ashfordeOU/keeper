// SPDX-License-Identifier: AGPL-3.0-or-later
// Where each kind of rebuildable clutter lives, per operating system.
// A `*` segment matches every sub-folder (browser profiles, Firefox profiles, ...).

import path from 'node:path';
import type { Safety } from '../types';

export interface CacheTarget {
  id: string;
  name: string;
  description: string;
  icon: string;
  safety: Safety;
  /** 'cache' = contents are deleted (they rebuild); 'bin' = the system Trash / Recycle Bin */
  mode: 'cache' | 'bin';
  /** candidate folders; their contents are what gets cleaned, never the folder itself */
  roots: string[];
  /** names directly inside a root that belong to another target, or must be kept */
  exclude?: string[];
  /** keep files touched more recently than this (running apps may need them) */
  keepNewerThanMs?: number;
  /** shown when files were skipped for lack of permission */
  adminNote?: string;
  /** selected by default in Smart Scan */
  preselect: boolean;
}

export interface TargetEnv {
  platform: NodeJS.Platform;
  home: string;
  /** Windows %LOCALAPPDATA% */
  localAppData?: string;
  /** Windows %APPDATA% */
  appData?: string;
  /** the user's temp folder */
  temp?: string;
  systemRoot?: string;
  programData?: string;
  /** Linux $XDG_CACHE_HOME */
  xdgCache?: string;
}

const DAY = 86_400_000;

/** Chromium keeps one folder per profile; these are the rebuildable parts of each. */
const CHROMIUM_PROFILE_CACHES = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', path.join('Service Worker', 'CacheStorage'), path.join('Service Worker', 'ScriptCache')];
const CHROMIUM_SHARED_CACHES = ['GrShaderCache', 'ShaderCache', 'GraphiteDawnCache', 'component_crx_cache'];

function chromium(userData: string): string[] {
  return [
    ...CHROMIUM_SHARED_CACHES.map((c) => path.join(userData, c)),
    ...CHROMIUM_PROFILE_CACHES.map((c) => path.join(userData, '*', c)),
  ];
}

/** Electron apps (Slack, Discord, VS Code, Teams classic, ...) share Chromium's layout. */
function electronApp(dir: string): string[] {
  return ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', path.join('Service Worker', 'CacheStorage'), 'CachedData'].map((c) => path.join(dir, c));
}

export function cacheTargets(env: TargetEnv): CacheTarget[] {
  if (env.platform === 'win32') return windows(env);
  if (env.platform === 'darwin') return mac(env);
  return linux(env);
}

function windows(env: TargetEnv): CacheTarget[] {
  const L = env.localAppData ?? path.join(env.home, 'AppData', 'Local');
  const R = env.appData ?? path.join(env.home, 'AppData', 'Roaming');
  const W = env.systemRoot ?? 'C:\\Windows';
  const PD = env.programData ?? 'C:\\ProgramData';
  return [
    {
      id: 'temp', name: 'Temporary files', icon: 'file', safety: 'safe', mode: 'cache', preselect: true,
      description: 'Leftovers from installers and apps. Anything touched in the last day is kept.',
      roots: [env.temp ?? path.join(L, 'Temp')], keepNewerThanMs: DAY,
    },
    {
      id: 'system-temp', name: 'Windows temp', icon: 'gear', safety: 'safe', mode: 'cache', preselect: true,
      description: 'System-wide temporary files. Files Windows is still using are skipped.',
      roots: [path.join(W, 'Temp')], keepNewerThanMs: DAY, adminNote: 'Some system temp files need admin rights and were skipped',
    },
    {
      id: 'browser-cache', name: 'Browser caches', icon: 'globe', safety: 'safe', mode: 'cache', preselect: true,
      description: 'Chrome, Edge, Brave, Vivaldi, Opera and Firefox rebuild these as you browse. Logins, history and tabs stay.',
      roots: [
        ...chromium(path.join(L, 'Google', 'Chrome', 'User Data')),
        ...chromium(path.join(L, 'Google', 'Chrome Beta', 'User Data')),
        ...chromium(path.join(L, 'Microsoft', 'Edge', 'User Data')),
        ...chromium(path.join(L, 'BraveSoftware', 'Brave-Browser', 'User Data')),
        ...chromium(path.join(L, 'Vivaldi', 'User Data')),
        ...chromium(path.join(L, 'Chromium', 'User Data')),
        ...chromium(path.join(L, 'Arc', 'User Data')),
        ...['Opera Stable', 'Opera GX Stable'].flatMap((o) => [
          ...CHROMIUM_PROFILE_CACHES.map((c) => path.join(L, 'Opera Software', o, c)),
          ...CHROMIUM_PROFILE_CACHES.map((c) => path.join(R, 'Opera Software', o, c)),
        ]),
        path.join(L, 'Mozilla', 'Firefox', 'Profiles', '*', 'cache2'),
        path.join(L, 'Mozilla', 'Firefox', 'Profiles', '*', 'startupCache'),
        path.join(L, 'Microsoft', 'Windows', 'INetCache', 'IE'),
      ],
    },
    {
      id: 'app-cache', name: 'App caches', icon: 'apps', safety: 'safe', mode: 'cache', preselect: true,
      description: 'Discord, Slack, Teams, Spotify, VS Code, Zoom, Steam and Adobe rebuild these on their own.',
      roots: [
        ...electronApp(path.join(R, 'discord')),
        ...electronApp(path.join(R, 'Slack')),
        ...electronApp(path.join(R, 'Microsoft', 'Teams')),
        ...electronApp(path.join(L, 'Packages', 'MSTeams_8wekyb3d8bbwe', 'LocalCache', 'Microsoft', 'MSTeams', 'EBWebView', 'Default')),
        ...electronApp(path.join(R, 'Code')),
        ...electronApp(path.join(R, 'Cursor')),
        ...electronApp(path.join(R, 'Notion')),
        ...electronApp(path.join(R, 'Figma')),
        path.join(R, 'Code', 'CachedExtensionVSIXs'),
        path.join(L, 'Spotify', 'Data'),
        path.join(L, 'Packages', 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0', 'LocalCache', 'Spotify', 'Data'),
        path.join(R, 'Zoom', 'logs'),
        path.join(L, 'Steam', 'htmlcache'),
        path.join(R, 'Adobe', 'Common', 'Media Cache Files'),
        path.join(R, 'Adobe', 'Common', 'Media Cache'),
      ],
    },
    {
      id: 'thumbnails', name: 'Thumbnail cache', icon: 'photo', safety: 'safe', mode: 'cache', preselect: false,
      description: 'Pictures File Explorer drew for folder previews. They are redrawn when you open a folder.',
      roots: [path.join(L, 'Microsoft', 'Windows', 'Explorer')], exclude: ['ExplorerStartupLog.etl'],
    },
    {
      id: 'crash-reports', name: 'Crash dumps & error reports', icon: 'warning', safety: 'safe', mode: 'cache', preselect: true,
      description: 'Memory dumps and error reports apps left behind after a crash.',
      roots: [
        path.join(L, 'CrashDumps'),
        path.join(L, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
        path.join(L, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
        path.join(PD, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
        path.join(PD, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
        path.join(W, 'Minidump'),
      ],
    },
    {
      id: 'update-leftovers', name: 'Windows Update downloads', icon: 'history', safety: 'review', mode: 'cache', preselect: false,
      description: 'Update installers Windows has already used. Removing them needs admin rights.',
      roots: [path.join(W, 'SoftwareDistribution', 'Download'), path.join(W, 'Downloaded Program Files')],
      adminNote: 'Windows Update files need admin rights, so they were skipped',
    },
    {
      id: 'dev-cache', name: 'Developer caches', icon: 'code', safety: 'review', mode: 'cache', preselect: false,
      description: 'npm, Yarn, pnpm, pip, NuGet, Gradle, Maven, Cargo and Go caches. The next install downloads packages again.',
      roots: [
        path.join(L, 'npm-cache'), path.join(R, 'npm-cache'), path.join(L, 'Yarn', 'Cache'), path.join(L, 'pnpm', 'store'),
        path.join(L, 'pnpm-store'), path.join(L, 'pip', 'cache'), path.join(L, 'NuGet', 'v3-cache'), path.join(L, 'NuGet', 'Cache'),
        path.join(env.home, '.gradle', 'caches'), path.join(env.home, '.cargo', 'registry', 'cache'), path.join(L, 'go-build'),
        path.join(L, 'JetBrains', '*', 'caches'), path.join(L, 'Temp', 'JetBrains'),
      ],
    },
    {
      id: 'ai-cache', name: 'AI tools', icon: 'assistant', safety: 'review', mode: 'cache', preselect: false,
      description: 'Caches and downloaded models of AI apps and local model runners. Models are downloaded again when next used.',
      roots: [...electronApp(path.join(R, 'Claude')), ...electronApp(path.join(R, 'ChatGPT')), path.join(env.home, '.ollama', 'models'), path.join(env.home, '.cache', 'huggingface', 'hub'), path.join(env.home, '.cache', 'lm-studio', 'models'), path.join(env.home, '.lmstudio', 'models'), path.join(L, 'Microsoft', 'Copilot', 'EBWebView', 'Default', 'Cache')],
    },
    {
      id: 'bin', name: 'Recycle Bin', icon: 'trash', safety: 'permanent', mode: 'bin', preselect: false,
      description: 'Files you already deleted. Emptying it removes them for good.',
      roots: [],
    },
  ];
}

const MAC_BROWSER_DIRS = ['Google', 'BraveSoftware', 'Microsoft Edge', 'Arc', 'company.thebrowser.Browser', 'com.apple.Safari', 'Firefox', 'Vivaldi', 'com.operasoftware.Opera', 'com.vivaldi.Vivaldi', 'org.mozilla.firefox'];
const MAC_DEV_DIRS = ['com.openai.chat', 'com.anthropic.claudefordesktop', 'com.todesktop.230313mzl4w4u92', 'Yarn', 'pip', 'pnpm', 'Homebrew', 'CocoaPods', 'go-build', 'JetBrains', 'com.apple.dt.Xcode', 'node-gyp', 'ms-playwright'];
/** Sync state and transfers in flight, not caches: removing them makes iCloud re-download or re-sync. */
const MAC_KEEP = ['com.apple.bird', 'CloudKit', 'com.apple.cloudd', 'com.apple.nsurlsessiond', 'com.apple.akd', 'FamilyCircle', 'com.apple.iCloudHelper', 'com.apple.Music', 'com.apple.podcasts', 'com.apple.findmy.fmipcore'];

function mac(env: TargetEnv): CacheTarget[] {
  const lib = (...p: string[]) => path.join(env.home, 'Library', ...p);
  const support = (...p: string[]) => lib('Application Support', ...p);
  return [
    {
      id: 'user-cache', name: 'User caches', icon: 'layers', safety: 'safe', mode: 'cache', preselect: true,
      description: 'Apps keep these to open faster and rebuild them when needed. iCloud sync state is left alone.',
      roots: [lib('Caches')], exclude: [...MAC_BROWSER_DIRS, ...MAC_DEV_DIRS, ...MAC_KEEP],
    },
    {
      id: 'logs', name: 'Logs', icon: 'doc', safety: 'safe', mode: 'cache', preselect: true,
      description: 'Diagnostic logs apps write over time. Nothing needs them to run.',
      roots: [lib('Logs')], exclude: ['DiagnosticReports'],
    },
    {
      id: 'crash-reports', name: 'Crash reports', icon: 'warning', safety: 'safe', mode: 'cache', preselect: true,
      description: 'Reports macOS saved after apps crashed or hung.',
      roots: [lib('Logs', 'DiagnosticReports')],
    },
    {
      id: 'browser-cache', name: 'Browser caches', icon: 'globe', safety: 'safe', mode: 'cache', preselect: true,
      description: 'Chrome, Safari, Firefox, Arc, Edge, Brave and others rebuild these as you browse. Logins, history and tabs stay.',
      roots: [
        lib('Caches', 'Google', 'Chrome'), lib('Caches', 'BraveSoftware', 'Brave-Browser'), lib('Caches', 'Microsoft Edge'),
        lib('Caches', 'Arc'), lib('Caches', 'company.thebrowser.Browser'), lib('Caches', 'com.apple.Safari'), lib('Caches', 'Vivaldi'),
        lib('Caches', 'com.vivaldi.Vivaldi'), lib('Caches', 'com.operasoftware.Opera'), lib('Caches', 'Firefox', 'Profiles', '*', 'cache2'),
        lib('Caches', 'org.mozilla.firefox'),
        ...chromium(support('Google', 'Chrome')), ...chromium(support('BraveSoftware', 'Brave-Browser')), ...chromium(support('Microsoft Edge')),
        ...chromium(support('Arc', 'User Data')), ...chromium(support('Vivaldi')), ...chromium(support('Chromium')),
      ],
    },
    {
      id: 'app-cache', name: 'App caches', icon: 'apps', safety: 'safe', mode: 'cache', preselect: true,
      description: 'Slack, Discord, Teams, VS Code, Notion, Figma, Spotify and Zoom rebuild these on their own.',
      roots: [
        ...electronApp(support('Slack')), ...electronApp(support('discord')), ...electronApp(support('Microsoft Teams')),
        ...electronApp(support('Code')), ...electronApp(support('Cursor')), ...electronApp(support('Notion')), ...electronApp(support('Figma')),
        support('Spotify', 'PersistentCache'), lib('Containers', 'com.microsoft.teams2', 'Data', 'Library', 'Caches'),
        support('Code', 'CachedExtensionVSIXs'), lib('Logs', 'zoom.us'),
      ],
    },
    {
      id: 'xcode', name: 'Xcode leftovers', icon: 'chip', safety: 'review', mode: 'cache', preselect: false,
      description: 'DerivedData, old device support files, archives of simulators and previews. Xcode rebuilds what it needs.',
      roots: [
        lib('Developer', 'Xcode', 'DerivedData'), lib('Developer', 'Xcode', 'iOS DeviceSupport'), lib('Developer', 'Xcode', 'watchOS DeviceSupport'),
        lib('Developer', 'CoreSimulator', 'Caches'), lib('Developer', 'Xcode', 'UserData', 'Previews'), lib('Caches', 'com.apple.dt.Xcode'),
      ],
    },
    {
      id: 'dev-cache', name: 'Developer caches', icon: 'code', safety: 'review', mode: 'cache', preselect: false,
      description: 'npm, Yarn, pnpm, pip, Homebrew, CocoaPods, Gradle, Cargo and Go caches. The next install downloads packages again.',
      roots: [
        path.join(env.home, '.npm', '_cacache'), lib('Caches', 'Yarn'), lib('pnpm', 'store'), lib('Caches', 'pnpm'), lib('Caches', 'pip'),
        lib('Caches', 'Homebrew'), lib('Caches', 'CocoaPods'), lib('Caches', 'go-build'), lib('Caches', 'node-gyp'), lib('Caches', 'JetBrains'),
        lib('Caches', 'ms-playwright'), path.join(env.home, '.gradle', 'caches'), path.join(env.home, '.cargo', 'registry', 'cache'),
      ],
    },
    {
      id: 'ai-cache', name: 'AI tools', icon: 'assistant', safety: 'review', mode: 'cache', preselect: false,
      description: 'Caches and downloaded models of AI apps and local model runners. Models are downloaded again when next used.',
      roots: [...electronApp(support('Claude')), lib('Caches', 'com.openai.chat'), lib('Caches', 'com.anthropic.claudefordesktop'), lib('Caches', 'com.todesktop.230313mzl4w4u92'), path.join(env.home, '.ollama', 'models'), path.join(env.home, '.cache', 'huggingface', 'hub'), path.join(env.home, '.cache', 'lm-studio', 'models'), path.join(env.home, '.lmstudio', 'models')],
    },
    {
      id: 'bin', name: 'Trash', icon: 'trash', safety: 'permanent', mode: 'bin', preselect: false,
      description: 'Files you already deleted. Emptying it removes them for good.',
      roots: [path.join(env.home, '.Trash')],
    },
  ];
}

function linux(env: TargetEnv): CacheTarget[] {
  const cache = env.xdgCache ?? path.join(env.home, '.cache');
  const cfg = path.join(env.home, '.config');
  const BROWSER = ['google-chrome', 'google-chrome-beta', 'chromium', 'BraveSoftware', 'microsoft-edge', 'vivaldi', 'opera', 'mozilla'];
  const DEV = ['pip', 'yarn', 'pnpm', 'go-build', 'JetBrains', 'node-gyp', 'ms-playwright', 'pypoetry', 'composer', 'mesa_shader_cache'];
  const AI = ['huggingface', 'lm-studio'];
  return [
    {
      id: 'user-cache', name: 'User caches', icon: 'layers', safety: 'safe', mode: 'cache', preselect: true,
      description: 'Apps keep these in ~/.cache to open faster and rebuild them when needed.',
      roots: [cache], exclude: [...BROWSER, ...DEV, ...AI, 'thumbnails'],
    },
    {
      id: 'thumbnails', name: 'Thumbnail cache', icon: 'photo', safety: 'safe', mode: 'cache', preselect: true,
      description: 'Previews your file manager drew. They are redrawn when you open a folder.',
      roots: [path.join(cache, 'thumbnails')],
    },
    {
      id: 'browser-cache', name: 'Browser caches', icon: 'globe', safety: 'safe', mode: 'cache', preselect: true,
      description: 'Chrome, Chromium, Firefox, Brave, Edge, Vivaldi and Opera rebuild these as you browse. Logins, history and tabs stay.',
      roots: [
        ...BROWSER.map((b) => path.join(cache, b)),
        ...chromium(path.join(cfg, 'google-chrome')), ...chromium(path.join(cfg, 'chromium')), ...chromium(path.join(cfg, 'BraveSoftware', 'Brave-Browser')),
        ...chromium(path.join(cfg, 'microsoft-edge')), ...chromium(path.join(cfg, 'vivaldi')),
        path.join(env.home, 'snap', 'firefox', 'common', '.cache'), path.join(env.home, '.var', 'app', 'org.mozilla.firefox', 'cache'),
        path.join(env.home, '.var', 'app', 'com.google.Chrome', 'cache'),
      ],
    },
    {
      id: 'app-cache', name: 'App caches', icon: 'apps', safety: 'safe', mode: 'cache', preselect: true,
      description: 'Slack, Discord, VS Code, Spotify and Flatpak apps rebuild these on their own.',
      roots: [
        ...electronApp(path.join(cfg, 'Slack')), ...electronApp(path.join(cfg, 'discord')), ...electronApp(path.join(cfg, 'Code')),
        ...electronApp(path.join(cfg, 'Cursor')), path.join(env.home, '.var', 'app', '*', 'cache'),
      ],
    },
    {
      id: 'dev-cache', name: 'Developer caches', icon: 'code', safety: 'review', mode: 'cache', preselect: false,
      description: 'npm, Yarn, pnpm, pip, Poetry, Gradle, Cargo and Go caches. The next install downloads packages again.',
      roots: [
        path.join(env.home, '.npm', '_cacache'), ...DEV.map((d) => path.join(cache, d)), path.join(env.home, '.gradle', 'caches'),
        path.join(env.home, '.cargo', 'registry', 'cache'),
      ],
    },
    {
      id: 'ai-cache', name: 'AI tools', icon: 'assistant', safety: 'review', mode: 'cache', preselect: false,
      description: 'Caches and downloaded models of AI apps and local model runners. Models are downloaded again when next used.',
      roots: [...electronApp(path.join(cfg, 'Claude')), path.join(env.home, '.ollama', 'models'), path.join(cache, 'huggingface', 'hub'), path.join(cache, 'lm-studio', 'models'), path.join(env.home, '.lmstudio', 'models')],
    },
    {
      id: 'bin', name: 'Trash', icon: 'trash', safety: 'permanent', mode: 'bin', preselect: false,
      description: 'Files you already deleted. Emptying it removes them for good.',
      // info/ holds the .trashinfo records; leaving them would show ghost items in the file manager.
      roots: [path.join(env.home, '.local', 'share', 'Trash', 'files'), path.join(env.home, '.local', 'share', 'Trash', 'info')],
    },
  ];
}
