// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's main process: windows, tray, shortcuts, the file index and every
// action the interface can ask for.

// Must stay the first import: test runs move every folder before anything reads one.
import './test-home';
import { clipboardImage, readFile as readCaptureFile } from './services/capture';
import { addBusyCheck } from './services/busy';
import { onBeforeInstall } from './services/updater';
import { BRAND, COPYRIGHT, TRADEMARK, WEBSITE } from '../core/brand';
// First, so local crash reports cover everything that follows.
import { initResilience, restoreExtraWindows } from './resilience';
import { onLimitAlert } from './svc/limits';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, protocol, screen, shell, Tray } from 'electron';
import { existsSync, promises as fsp, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IslandSettings, KeepAwakeOptions } from '../core/api';
import { askAssistant } from '../core/ai';
import { cleanTarget, cleanTargetPaths, expandRoots, listTargetEntries, measureTarget, sizeOf } from '../core/cleanup/engine';
import { fileCleanupGroups, largeFiles } from '../core/cleanup/files';
import { cacheTargets } from '../core/cleanup/targets';
import { findExactDuplicates, findFormatPairs, findSimilarImages } from '../core/duplicates';
import { DAY, MB, formatBytes, tildify } from '../core/format';
import { FileIndex } from '../core/indexer';
import { Journal, undoMoves } from '../core/journal';
import { powershell, readDownloadSource, run, targetEnv } from '../core/platform';
import { planRule } from '../core/rules';
import { checkRemovable, isInside } from '../core/safety';
import type { AllSettings } from '../core/settings';
import { squarify } from '../core/treemap';
import type { AiMessage, CleanResult, CleanupGroup, FileEntry, FileKind, JournalOp, Progress, Rule, SpaceNode } from '../core/types';
import { walk } from '../core/walk';
import { searchPlaces } from '../core/weather';
import { listApps, uninstall } from './services/apps';
import { captureText } from './services/capture';
import { colorPick, quietly, recordingState, registerCaptureIpc, registerCaptureShortcuts, screenshot, toggleRecording } from './ipc/capture';
import { FileService } from './services/files';
import { IslandService } from './services/island';
import { islandWindows, registerIslandIpc, registerIslandShortcuts } from './ipc/island';
import { registerWidgetsIpc, syncWidgets } from './ipc/widgets';
import { ambienceTrayItems, registerAmbience, registerAmbienceShortcuts } from './services/wallpaper';
import { registerIslandToolsIpc } from './ipc/island-tools';
// Island+ (calls, levels, notifications, agents) and Cues (ISLAND+CUES workstream).
import { registerIslandXIpc, stopIslandX } from './ipc/islandx';
import { cueTrayItems, handleCueLink, registerCueShortcut, registerCuesIpc, stopCues } from './ipc/cues';
import { flushIslandTools } from './services/island-tools';
import { checkProtection } from './services/protection';
import { listStartup, toggleStartup } from './services/startup';
import { disks, ejectAll, health, killProcess, wifiNetworks } from './services/system';
import { writeText } from './services/clip';
import { checkForUpdates as checkUpdatesNow, installOnQuitIfReady, installUpdate as installUpdateNow, updateStatus } from './services/updater';
import { VisionQueue } from './services/vision';
import { registerIpcX, syncFinderTags } from './ipc-x';
import { registerFileProtocol, registerPreviewIpc } from './ipc/preview';
import { registerConvertIpc } from './ipc/convert';
import { registerPlacesIpc } from './ipc/places';
import { registerTracksIpc } from './ipc/tracks';
import { registerTracksCompanion, stopTracks, trayTracksItems } from './services/tracks';
import { registerPlatformIpc } from './ipc/platform';
import { handlePlatformArgv, handlePlatformUrl, initPlatform, platformLibraryChanged, startedForSearch, stopPlatform } from './services/platform';
import { registerLockIpc } from './ipc/lock';
import { handleAwakeLink, registerAwakeIpc } from './ipc/awake';
import { handleStageLink, registerStageIpc, registerStageShortcuts, stage as stageSvc, stagePresentation, stageTrayItems } from './ipc/stage';
import { TILE_MIN } from '../core/ashforde/coexist';
import { handleVoiceLink, registerVoiceIpc, registerVoiceShortcuts, shutdownVoice, voiceTrayItems } from './ipc/voice';
import { registerGuideIpc } from './ipc/guide';
import { registerBuiltinGuideSources } from './services/guide-sources';
import { refresh as refreshGuide } from './services/guide';
import { registerLinkIpc } from './ipc/link';
import { onTrayChange, trayAccessItems } from './services/link/surfaces';
import { registerScreenIpc, stopScreen } from './ipc/screen';
import { meshTrayItems, registerMeshIpc, stopMesh } from './ipc/mesh';
import { registerRdcIpc } from './ipc/rdc';
import { handleRdcArgv, onRdcTrayChange, rdcShortcut, rdcTrayItems, setShortcutRefresher } from './services/rdc/places';
import { linkNode, stopLink } from './services/link';
import { connectionFs, list as remoteConnections } from './services/remote';
import { attachConnections, attachTransport } from './services/sync';
import { linkTransport } from './services/sync/link-adapter';
import { storeFromRemoteFs } from './services/sync/remote-adapter';
import { registerRemoteIpc } from './ipc/remote';
import { stopRemote } from './services/remote';
import { openTerminalWindow, registerTerminalIpc, stopTerminal } from './ipc/terminal';
import { registerAgentTermIpc, stopAgentTerminals } from './ipc/agentterm';
import { registerAbilitiesIpc } from './ipc/abilities';
import { unwireAbilities, wireAbilities } from './services/abilities/wire';
import { registerBrainIpc } from './ipc/brain';
import { brainSettingsChanged, startBrain, stopBrain, syncBrain } from './services/brain';
import { wireComputer } from './services/computer';
import { initWritingMenu } from './services/writing';
import { handleIntentUrl, registerIntentsHelper, type IntentDeps } from './services/intents';
import { registerAgentsIpc } from './ipc/agents';
import { agentSettingsChanged, record as recordUsage, startAgents, stopAgents } from './services/agents';
import { normalizeAgentSettings } from '../core/agents-config';
import { applyWaylandSwitch } from './services/island-place';
import { registerProcsIpc } from './ipc/procs';
import { registerSysmonIpc } from './ipc/sysmon';
import { registerLauncherShortcut, toggleLauncher } from './services/monitor-launcher';
import { setMonitorIslandAlert } from './services/monitor';
import { registerPimIpc } from './ipc/pim';
import { registerNotesIpc } from './ipc/notes';
import { allowRoot as allowPreviewRoot } from './services/preview';
import { startPim, stopPim } from './services/pim';
import { registerNetIpc } from './ipc/net';
import { registerSecurityIpc, stopSecurityIpc } from './ipc/security';
import { registerControlsIpc } from './ipc/controls';
import { registerSettingsPlusIpc } from './ipc/settingsplus';
import { ashfordeThemeChanged, monorailFocusChanged, monorailPresentationChanged, onMonorailState, registerAshfordeIpc } from './ipc/ashforde';
import { cached as controlsCached, list as controlsList, onControlsChanged, set as controlsSet, applyPreset as controlsPreset } from './services/controls';
import { PRESETS as CONTROL_PRESETS } from '../core/controls/catalog';
import { registerFirewallIpc, stopFirewall } from './ipc/fw';
import { registerSyncIpc } from './ipc/sync';
import { registerNotesyncIpc } from './ipc/notesync';
import { registerNotesCompanion } from './services/notes-sync';
import { stopSync } from './services/sync';
import { loopbackFromEnv } from './services/sync/loopback';
import { pendingOnQuit, relockOnQuit } from './services/lock';
import { remoteFolders } from './services/places';
import { emptyAndBroken, removeBrokenLink } from './services/tools';
import { readDownloadSources, readFinderTags } from '../core/platform';
import { conditions, pace, poll, startGovernor, usage, whenIdle } from './services/governor';
import { applyFeatureSet, applyPreset, featureOn, featureSets, listFeatures, liveCosts, onFeature, onFeaturesChanged, removeFeatureSet, saveFeatureSet, setFeature, setPowerSets, startPowerSets } from './services/features';
import { getSecret, hasSecret, onSettings, setSecret, settings, updateSettings } from './store';
import { registerUsageStatsIpc } from './ipc/usage-stats';

void squarify; // the interface lays out the Space Map; kept for the CLI's future text treemap

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const isMac = process.platform === 'darwin';

protocol.registerSchemesAsPrivileged([{ scheme: 'keeper-file', privileges: { stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: false, standard: false } }]);
if (!app.requestSingleInstanceLock()) app.quit();
// Linux on Wayland: the Island needs XWayland to stay on top and in place (Settings can turn this off).
applyWaylandSwitch();
app.setAsDefaultProtocolClient('keeper');
// Text fields get spelling, cut/copy/paste and writing help from the person's AI (Electron has no menu of its own).
initWritingMenu((message) => islandSvc?.alert({ kind: 'info', title: 'Writing help did not work', detail: message }));
// About Keeper (macOS app menu, Linux): Keeper by Ashforde®.
app.setAboutPanelOptions({ applicationName: BRAND, applicationVersion: app.getVersion(), copyright: `${COPYRIGHT}. ${TRADEMARK}`, website: WEBSITE, credits: 'Free to use. Source-available under the PolyForm Shield License 1.0.0.' });

let main: BrowserWindow | null = null;
let quick: BrowserWindow | null = null;
let tray: Tray | null = null;
let index: FileIndex;
let journal: Journal;
let files: FileService;
let vision: VisionQueue;
let islandSvc: IslandService;
let lastCleanup: CleanupGroup[] = [];
let quitting = false;

const preload = () => path.join(__dirname, 'preload.cjs');
const capturePreload = () => path.join(__dirname, 'capture-preload.cjs');

function broadcast(channel: string, ...args: unknown[]) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(`event:${channel}`, ...args);
}

const progress = (p: Progress) => broadcast('progress', p);
let changeTimer: NodeJS.Timeout | undefined;
function libraryChanged() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    broadcast('library-changed');
    void updateTray();
    platformLibraryChanged();
    void syncBrain();
  }, 250);
}

declare const __KEEPER_OFFICIAL__: boolean | undefined;
// Automated tests can skip the first-run tour; official builds ignore this.
const NO_TOUR = !(typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__) && process.env.KEEPER_SKIP_TOUR === '1';

function load(win: BrowserWindow, view: string) {
  const extra: Record<string, string> = view === 'app' && NO_TOUR ? { notour: '1' } : {};
  if (DEV_URL) void win.loadURL(`${DEV_URL}?${new URLSearchParams({ view, ...extra })}`);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view, ...extra } });
}

function lockDown(win: BrowserWindow) {
  // Links open in the browser; the app never navigates away from itself.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!DEV_URL || !url.startsWith(DEV_URL)) e.preventDefault();
  });
}

// ---------------------------------------------------------------- windows

function createMain() {
  main = new BrowserWindow({
    // Linux shows this in the taskbar; macOS and Windows use the packaged app icon.
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    // A small minimum so a window arranger (Monorail) can make it a half-width column or half of a slide; narrow widths fold the sidebar.
    width: 1280, height: 820, minWidth: TILE_MIN.width, minHeight: TILE_MIN.height, show: false, title: BRAND,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111114' : '#f6f5f2',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? undefined : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ddd' : '#333', height: 52 },
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: { preload: preload(), contextIsolation: true, sandbox: true },
  });
  lockDown(main);
  load(main, 'app');
  // Started at login: stay in the tray until the user opens Keeper.
  main.once('ready-to-show', () => { if (!(process.argv.includes('--hidden') || startedForSearch) || main?.isVisible()) main?.show(); });
  main.on('close', (e) => {
    // Keep running in the tray so Quick Search, the Island and rules keep working.
    if (!quitting && settings().trayEnabled) {
      e.preventDefault();
      main?.hide();
      if (isMac) app.dock?.hide();
      releaseMainLater();
    }
  });
  main.on('show', () => clearTimeout(releaseTimer));
  main.on('closed', () => (main = null));
}

// A window closed to the tray keeps its page in memory for a while so it reopens
// instantly; after that the page is let go (about 150 MB) and Keeper reopens it
// where you were, in about a second. Performance mode keeps it.
let releaseTimer: NodeJS.Timeout | undefined;
function releaseMainLater() {
  clearTimeout(releaseTimer);
  const mode = settings().resourceMode ?? 'balanced';
  if (mode === 'performance') return;
  releaseTimer = setTimeout(() => {
    if (main && !main.isDestroyed() && !main.isVisible()) main.destroy();
  }, (mode === 'minimal' ? 2 : 15) * 60_000);
}

function showMain(route?: string) {
  if (!main) createMain();
  if (isMac) void app.dock?.show();
  main!.show();
  main!.focus();
  if (route) setTimeout(() => main?.webContents.send('event:navigate', route), main!.webContents.isLoading() ? 800 : 0);
}

function toggleQuick() {
  if (quick && quick.isVisible()) {
    quick.hide();
    return;
  }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const w = 680;
  const h = 460;
  if (!quick) {
    quick = new BrowserWindow({
      width: w, height: h, frame: false, transparent: true, resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true,
      fullscreenable: false, hasShadow: false, webPreferences: { preload: preload(), contextIsolation: true, sandbox: true },
    });
    lockDown(quick);
    load(quick, 'quick');
    quick.on('blur', () => quick?.hide());
  }
  quick.setBounds({ x: Math.round(d.workArea.x + (d.workArea.width - w) / 2), y: Math.round(d.workArea.y + d.workArea.height * 0.18), width: w, height: h });
  quick.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  quick.show();
  quick.focus();
  quick.webContents.send('event:library-changed');
}

/** "Ask Keeper": with a question, straight to the assistant; without, Quick Search in ask mode. */
function askKeeper(q?: string) {
  if (q) return showMain(`assistant:${q}`);
  if (!quick?.isVisible()) toggleQuick();
  const send = () => quick?.webContents.send('event:quick-mode', 'ask');
  if (quick?.webContents.isLoading()) quick.webContents.once('did-finish-load', send);
  else send();
}

// The Island's windows (one per display when asked) live in ipc/island.ts.
function createIsland() {
  islandWindows.ensure();
}

function destroyIsland() {
  islandWindows.destroyAll();
}

// ---------------------------------------------------------------- tray

/** Tray entries for app updates: what is new, or a way to look. */
function trayUpdateItems(): Electron.MenuItemConstructorOptions[] {
  const u = updateStatus();
  if (u.state === 'ready') return [{ label: `Restart to Update to ${u.version}`, click: () => void installUpdateNow() }, { type: 'separator' }];
  if (u.state === 'available') return [{ label: `Keeper ${u.version} Is Available…`, click: () => showMain('settings:updates') }, { type: 'separator' }];
  if (u.state === 'downloading') return [{ label: `Downloading Keeper ${u.version}… ${u.percent ?? 0}%`, enabled: false }, { type: 'separator' }];
  return [{ label: 'Check for Updates…', click: () => { showMain('settings:updates'); void checkUpdatesNow(true); } }];
}

/** The tray's Quick Controls: a few switches from the last reading, presets, and the page. */
let trayControlsRead = false;
function trayControls(): Electron.MenuItemConstructorOptions[] {
  const v = controlsCached();
  if (!v && !trayControlsRead) {
    // Read once, a little after start; afterwards the menu follows changes made anywhere.
    trayControlsRead = true;
    setTimeout(() => void controlsList().then(() => updateTray()).catch(() => undefined), 10_000).unref?.();
  }
  const state = new Map(v?.states.map((s) => [s.id, s]) ?? []);
  const toggles: Electron.MenuItemConstructorOptions[] = [];
  for (const [id, label] of [['wifi', 'Wi-Fi'], ['bluetooth', 'Bluetooth'], ['vpn', 'VPN'], ['osFirewall', 'System Firewall'], ['dnsFilter', 'DNS Filter'], ['microphone', 'Microphone for Apps'], ['camera', 'Camera for Apps']] as const) {
    const st = state.get(id);
    if (!st || st.how === 'none' || st.how === 'guide' || typeof st.value !== 'boolean') continue;
    const on = st.value;
    toggles.push({ label: `${label}${st.how === 'admin' ? ' (password)' : ''}`, type: 'checkbox', checked: on, click: () => void controlsSet(id, !on).then((r) => {
      // Making things less protected is confirmed on the page, never from a menu click.
      if (r.needsConfirm) showMain('controls');
      else if (!r.ok) islandSvc?.alert({ kind: 'info', title: 'Quick Controls', detail: r.message });
    }) });
  }
  return [
    ...(toggles.length ? toggles : [{ label: v ? 'Nothing to switch here' : 'Reading…', enabled: false }]),
    { type: 'separator' },
    { label: 'Presets', submenu: CONTROL_PRESETS.map((p) => ({ label: p.name, click: () => void controlsPreset(p.id).then((r) => {
      if (r.needsConfirm) showMain('controls');
      else islandSvc?.alert({ kind: 'info', title: p.name, detail: r.message });
    }) })) },
    { label: 'Open Quick Controls…', click: () => showMain('controls') },
  ];
}

// Devices, remote sessions and help codes change the tray's Keeper Link entries.
onTrayChange(() => void updateTray());
// Recent and favourite remote desktops, and what is open now (Remote Desktops → Places → Tray).
onRdcTrayChange(() => void updateTray());
setShortcutRefresher(() => registerShortcuts());

async function updateTray() {
  if (!settings().trayEnabled) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    // macOS tints a black template image to match the menu bar; elsewhere the colour icon reads on any taskbar.
    const icon = isMac
      ? nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'trayTemplate.png'))
      : nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'tray-color.png')).resize({ width: process.platform === 'win32' ? 16 : 22, quality: 'best' });
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    if (icon.isEmpty()) tray.setTitle?.('K');
    tray.setToolTip(BRAND);
    tray.on('click', () => !isMac && showMain());
    // Files dropped on the tray icon go to the shelf (macOS).
    tray.on('drop-files', (_e, paths) => void islandSvc.addToShelf(paths));
  }
  const recent = index.recent(settings().trayCount, (f) => f.root === 'Downloads');
  const items: Electron.MenuItemConstructorOptions[] = recent.map((f) => ({
    label: f.name.length > 42 ? f.name.slice(0, 40) + '…' : f.name,
    sublabel: `${formatBytes(f.size)}${f.source ? ` · ${f.source.name}` : ''}`,
    click: () => void shell.openPath(f.path),
    submenu: [
      { label: 'Open', click: () => void shell.openPath(f.path) },
      { label: 'Show in Keeper', click: () => showMain(`search:${f.name}`) },
      { label: isMac ? 'Show in Finder' : 'Show in folder', click: () => shell.showItemInFolder(f.path) },
      { label: 'Add to Shelf', click: () => void islandSvc.addToShelf([f.path]) },
    ],
  }));
  const awake = islandSvc?.awake.on;
  // Pinned shelves stay one click away in the tray.
  const pinned: Electron.MenuItemConstructorOptions[] = (islandSvc?.state().shelves ?? []).filter((sh) => sh.pinned).map((sh) => ({
    label: `${sh.name} (${sh.items.length})`,
    submenu: [
      ...sh.items.slice(0, 15).map((f) => ({ label: f.name.length > 42 ? f.name.slice(0, 40) + '…' : f.name, click: () => void shell.openPath(f.path) })),
      { type: 'separator' as const },
      { label: 'Open in the Island', click: () => { islandSvc.selectShelf(sh.id); islandWindows.openOn('shelf'); } },
    ],
  }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: BRAND, enabled: false },
    { type: 'separator' },
    { label: 'Recent downloads', enabled: false },
    ...(items.length ? items : [{ label: 'Nothing yet', enabled: false }]),
    ...(pinned.length ? [{ type: 'separator' as const }, { label: 'Shelves', enabled: false }, ...pinned] : []),
    { type: 'separator' },
    { label: 'Open Keeper', click: () => showMain() },
    { label: 'Quick Search', accelerator: settings().quickSearchShortcut, click: toggleQuick },
    ...(featureOn('toolLauncher') ? [{ label: 'Tool Launcher…', click: () => toggleLauncher() }] : []),
    { label: 'Terminal', click: () => openTerminalWindow() },
    { label: 'Copy Text from Screen', accelerator: settings().island.captureShortcut, click: () => void doCapture() },
    { label: 'Take Screenshot', submenu: [
      { label: 'Area…', click: () => quietly(() => screenshot('area')) },
      { label: 'Window…', click: () => quietly(() => screenshot('window')) },
      { label: 'Whole Screen', click: () => quietly(() => screenshot('full')) },
    ] },
    recordingState().recording
      ? { label: 'Stop Recording', click: () => quietly(() => toggleRecording()) }
      : { label: 'Record Screen', submenu: [
        { label: 'Whole Screen', click: () => quietly(() => toggleRecording('full')) },
        { label: 'Window…', click: () => quietly(() => toggleRecording('window')) },
        { label: 'Area…', click: () => quietly(() => toggleRecording('area')) },
      ] },
    { label: 'Pick a Colour', click: () => quietly(() => colorPick()) },
    // Keep Awake (Settings → Features can switch it off; its own menu-bar icon is optional, see ipc/awake.ts).
    ...(featureOn('keepAwake') ? [{ label: awake ? 'Stop Keeping Awake' : 'Keep Awake', submenu: awake ? undefined : [
      { label: 'Until I turn it off', click: () => islandSvc.keepAwake(true) },
      ...settings().awake.quick.map((m) => ({ label: m < 60 ? `For ${m} minutes` : `For ${m / 60} hour${m === 60 ? '' : 's'}`, click: () => islandSvc.keepAwake(true, { minutes: m }) })),
      { label: 'Let the screen sleep', click: () => islandSvc.keepAwake(true, { allowDisplaySleep: true }) },
      { type: 'separator' as const },
      { label: 'Keep Awake…', click: () => showMain('awake') },
    ], click: awake ? () => { islandSvc.keepAwake(false); void updateTray(); } : undefined }] : []),
    // Keeper Mesh: on/off, exit node and addresses, where the person put them (Mesh → Where controls appear).
    ...meshTrayItems(),
    // Wallpaper, vibes and ambient sound (Settings on the Wallpaper & Vibes page can hide this).
    ...ambienceTrayItems(),
    // Cues: a new cue for what is in front, and the ones due today (Cues → Settings can hide this).
    ...cueTrayItems(),
    // Stage mode (Settings → Features; its page chooses whether it shows here).
    ...stageTrayItems(),
    // Dictation and meeting recording (Voice; its page chooses whether they show here).
    ...voiceTrayItems(),
    { label: 'Clean Up…', click: () => showMain('cleanup') },
    ...(featureOn('quickControls') ? [{ label: 'Quick Controls', submenu: trayControls() }] : []),
    // Keeper Link: sessions with Stop, your devices, Get Help / Help Someone (places chosen under Devices → Remote Access).
    ...trayAccessItems(showMain),
    // Remote Desktops: built at once from memory (never waits), so nothing started after the tray is held up.
    ...(() => { try { return rdcTrayItems(); } catch { return []; } })(),
    // Places & Tracks: where devices, items and people are (Settings in Places & Tracks can hide this).
    ...trayTracksItems(showMain),
    { type: 'separator' },
    ...trayUpdateItems(),
    { label: 'Quit Keeper', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------------------------------------------------------------- shortcuts & deep links

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const s = settings();
  const reg = (acc: string, fn: () => void) => {
    try {
      if (acc) globalShortcut.register(acc, fn);
    } catch {
      /* invalid or taken */
    }
  };
  // A feature that is off gives its shortcut back to the system.
  if (featureOn('quickSearch')) reg(s.quickSearchShortcut, toggleQuick);
  // Quick connect to a remote desktop from anywhere (Remote Desktops → Places).
  const rdcKey = rdcShortcut();
  if (rdcKey) reg(rdcKey.accelerator, rdcKey.run);
  if (featureOn('assistant')) reg(s.platform?.askShortcut, () => askKeeper());
  if (featureOn('capture')) reg(s.island.captureShortcut, () => void doCapture());
  // Dictation (Voice): its toggle and edit-by-voice shortcuts; holding the talk key needs no shortcut.
  registerVoiceShortcuts(reg);
  if (featureOn('island')) registerIslandShortcuts();
  // Stage mode's shortcut, its presets' shortcuts and the display keys.
  registerStageShortcuts(reg);
  registerAmbienceShortcuts();
  if (featureOn('capture')) void registerCaptureShortcuts();
  registerLauncherShortcut();
  registerCueShortcut();
}

/** Text from the clipboard's picture or a file, copied like a screen capture. */
async function captureFrom(read: () => Promise<{ text: string; code?: string } | null>, empty: string) {
  try {
    const r = await read();
    const out = r ? (r.code && !r.text ? r.code : r.text) : '';
    if (out) await writeText(out);
    islandSvc.alert({ kind: 'info', title: out ? 'Copied the text' : empty, detail: r?.code ? `QR code: ${r.code}` : out.slice(0, 120) });
  } catch (e) {
    islandSvc.alert({ kind: 'info', title: 'Could not read the text', detail: e instanceof Error ? e.message : String(e) });
  }
}

async function doCapture() {
  try {
    const r = await captureText(capturePreload(), settings().ocrLanguages);
    if (!r) return null;
    const out = r.code && !r.text ? r.code : r.text;
    if (out) await writeText(out);
    islandSvc.alert({ kind: 'info', title: out ? 'Copied text from the screen' : 'No text found', detail: r.code ? `QR code: ${r.code}` : out.slice(0, 120) });
    return r;
  } catch (e) {
    dialog.showErrorBox('Copy text from screen', e instanceof Error ? e.message : String(e));
    return null;
  }
}

const intentDeps: IntentDeps = {
  showMain: (route) => showMain(route),
  focus: (action, minutes) => void islandSvc?.focusAction(action, minutes),
  runRule: async (n) => {
    const r = settings().rules.find((x) => x.id === n || x.name.toLowerCase() === n.toLowerCase());
    if (!r) throw new Error('No automation with that name');
    return runRule(r);
  },
  relockAll: async () => {
    const { list, relock } = await import('./services/lock');
    const open = list().filter((f) => f.state === 'unlocked');
    for (const f of open) await relock(f.vault).catch(() => undefined);
    return open.length;
  },
};

function handleDeepLink(url: string) {
  if (handlePlatformUrl(url)) return;
  // Pages, the focus timer, locking folders and automations, for Siri, Shortcuts and desktop assistants.
  if (handleIntentUrl(url, intentDeps)) return;
  try {
    const u = new URL(url);
    const action = u.hostname || u.pathname.replace(/^\/+/, '');
    if (action === 'open' && u.searchParams.get('path')) {
      const p = u.searchParams.get('path')!;
      showMain(`browse:${path.dirname(p)}`);
    } else if (action === 'search') showMain(`search:${u.searchParams.get('q') ?? ''}`);
    // keeper://capture/clipboard reads the picture on the clipboard; keeper://capture/file?path=… reads an image or PDF.
    else if (action === 'capture' && /clipboard/.test(u.pathname)) void captureFrom(() => clipboardImage(settings().ocrLanguages), 'No picture on the clipboard');
    else if (action === 'capture' && /file/.test(u.pathname) && u.searchParams.get('path')) void captureFrom(() => readCaptureFile(u.searchParams.get('path')!, settings().ocrLanguages), 'No text found');
    else if (action === 'capture') void doCapture();
    else if (action === 'settings') showMain(`settings:${u.pathname.replace(/^\/+/, '') || u.searchParams.get('section') || ''}`);
    else if (action === 'screenshot') quietly(() => screenshot((u.searchParams.get('mode') as 'full' | 'window' | 'area') ?? 'area'));
    else if (action === 'record') quietly(() => toggleRecording((u.searchParams.get('mode') as 'full' | 'window' | 'area') ?? 'full'));
    else if (action === 'color') quietly(() => colorPick());
    else if (action === 'quick') toggleQuick();
    else if (action === 'clean') showMain('cleanup');
    // keeper://terminal?cwd=/path opens the Terminal window in a folder.
    else if (action === 'terminal') openTerminalWindow(u.searchParams.get('cwd') ? { cwd: u.searchParams.get('cwd')! } : {});
    // keeper://awake?for=30m, ?until=18:30, ?app=Name; keeper://awake/off, /toggle, /extend
    else if (action === 'awake') handleAwakeLink(u);
    // keeper://stage/on?preset=recording, /off, /toggle
    else if (action === 'stage') handleStageLink(u);
    // keeper://dictation/toggle|start|stop|cancel|edit, keeper://meeting/start|stop|pause|resume
    else if (action === 'dictation' || action === 'meeting') handleVoiceLink(u);
    // keeper://help?code=123456789&pw=… ("Ask for help" links) opens Help Someone with the code filled in.
    // keeper://cue?text=…&attach=page,app opens a new cue beside the app in front; keeper://cues opens the page.
    else if (action === 'cue') handleCueLink(u);
    else if (action === 'help') showMain(`devices:help=${u.searchParams.get('code') ?? ''}${u.searchParams.get('pw') ? `.${u.searchParams.get('pw')}` : ''}`);
    else showMain(action || undefined);
  } catch {
    showMain();
  }
}

app.on('open-url', (e, url) => {
  e.preventDefault();
  if (app.isReady()) handleDeepLink(url);
  else app.once('ready', () => handleDeepLink(url));
});
app.on('second-instance', (_e, argv) => {
  // A .rdp or .vnc file double-clicked or "Connect with Keeper" in the file manager.
  if (handleRdcArgv(argv)) return;
  if (handlePlatformArgv(argv)) return;
  const link = argv.find((a) => a.startsWith('keeper://'));
  if (link) handleDeepLink(link);
  else showMain();
});

// ---------------------------------------------------------------- library

function makeIndex(s: AllSettings) {
  const folders = s.folders.filter((f) => existsSync(f)).map((f) => ({ path: f, label: path.basename(f) }));
  // Looked up each time, so "Where downloads came from" can be switched off and on.
  const hooks = {
    get readSource() { return featureOn('sources') ? readDownloadSource : undefined; },
    get readSources() { return featureOn('sources') ? readDownloadSources : undefined; },
    readTags: process.platform === 'darwin' ? readFinderTags : undefined,
  };
  return new FileIndex(path.join(app.getPath('userData'), 'index.json'), folders, s.excluded, hooks);
}

async function rescan() {
  await index.scan({ onProgress: progress, showHidden: settings().showHidden });
  progress({ task: 'index', phase: 'Done', done: index.files.size, total: index.files.size });
  libraryChanged();
  vision.schedule(index.all());
}

const sortFiles = (list: FileEntry[], key: string = 'date', desc = true) => {
  const dir = desc ? -1 : 1;
  return list.sort((a, b) =>
    key === 'name' ? dir * -1 * a.name.localeCompare(b.name, undefined, { numeric: true }) * -1 * -1
      : key === 'size' ? dir * (a.size - b.size)
      : key === 'kind' ? a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
      : dir * (a.mtime - b.mtime));
};

// ---------------------------------------------------------------- cleanup

const BUILD_DIRS: Record<string, string[]> = {
  node_modules: ['package.json'],
  target: ['Cargo.toml', 'pom.xml'],
  '.next': ['package.json'],
  '.nuxt': ['package.json'],
  '.venv': ['pyproject.toml', 'requirements.txt', 'setup.py'],
  venv: ['pyproject.toml', 'requirements.txt', 'setup.py'],
  '__pycache__': [],
  '.gradle': ['build.gradle', 'build.gradle.kts', 'settings.gradle'],
  'DerivedData': [],
  '.dart_tool': ['pubspec.yaml'],
};

/** Dependency and build folders in projects nobody has touched for a month. */
async function oldBuildFolders(signal?: AbortSignal): Promise<FileEntry[]> {
  const found: FileEntry[] = [];
  const now = Date.now();
  for (const folder of settings().folders.filter(existsSync)) {
    await walk(folder, {
      includeDirs: true,
      showHidden: true,
      signal,
      maxDepth: 6,
      excluded: settings().excluded,
      enterDir: (_d, name) => !(name in BUILD_DIRS) && !name.startsWith('.') ,
      onEntry: async (e) => {
        if (!e.stats.isDirectory() || !(e.name in BUILD_DIRS)) return;
        const project = path.dirname(e.path);
        const markers = BUILD_DIRS[e.name];
        if (markers.length && !markers.some((m) => existsSync(path.join(project, m)))) return;
        const touched = Math.max(...[project, ...markers.map((m) => path.join(project, m))].map((p) => { try { return statSync(p).mtimeMs; } catch { return 0; } }));
        if (now - touched < 30 * DAY) return;
        const { size } = await sizeOf(e.path);
        if (size < 20 * MB) return;
        found.push({ path: e.path, name: `${path.basename(project)}/${e.name}`, ext: '', kind: 'other', size, mtime: touched, btime: touched, atime: 0, root: path.basename(folder) });
      },
    });
  }
  return found.sort((a, b) => b.size - a.size);
}

async function scanCleanup(): Promise<CleanupGroup[]> {
  const s = settings();
  const env = targetEnv();
  const home = os.homedir();
  const groups: CleanupGroup[] = [];
  const targets = cacheTargets(env);
  let i = 0;
  for (const t of targets) {
    progress({ task: 'cleanup', phase: t.name, done: i++, total: targets.length + 3 });
    if (t.mode === 'bin' && process.platform === 'win32') {
      const r = await powershell("(New-Object -ComObject Shell.Application).NameSpace(10).Items() | Measure-Object -Property Size -Sum | ForEach-Object { \"$($_.Count) $($_.Sum)\" }");
      const [count, size] = r.stdout.trim().split(' ').map(Number);
      if (size > 0) groups.push({ id: t.id, name: t.name, description: t.description, icon: t.icon, mode: 'bin', safety: t.safety, size, count, locations: ['Recycle Bin'], preselect: false });
      continue;
    }
    const m = await measureTarget(t);
    if (m.size > 0) groups.push({ id: t.id, name: t.name, description: t.description, icon: t.icon, mode: t.mode, safety: t.safety, size: m.size, count: m.count, locations: m.roots.map((r) => tildify(r, home)), preselect: t.preselect, note: t.adminNote });
  }
  progress({ task: 'cleanup', phase: 'Your files', done: i++, total: targets.length + 3 });
  groups.push(...fileCleanupGroups(index.all(), { oldDownloadDays: s.oldDownloadDays, dirExists: (p) => existsSync(p) && statSync(p).isDirectory() }));
  progress({ task: 'cleanup', phase: 'Old project folders', done: i++, total: targets.length + 3 });
  const builds = await oldBuildFolders();
  if (builds.length) groups.push({ id: 'build-folders', name: 'Old project build folders', description: 'node_modules, target, .venv and similar folders in projects untouched for 30+ days. Reinstalling dependencies brings them back.', icon: 'code', mode: 'cache', safety: 'review', preselect: false, items: builds, size: builds.reduce((n, f) => n + f.size, 0), count: builds.length, locations: [...new Set(builds.map((b) => b.root))] });
  progress({ task: 'cleanup', phase: 'Applications', done: i++, total: targets.length + 3 });
  try {
    const unused = (await listApps()).filter((a) => !a.system && a.lastUsed > 0 && Date.now() - a.lastUsed > s.unusedAppDays * DAY);
    if (unused.length) {
      const items: FileEntry[] = unused.map((a) => ({ path: a.path, name: a.name, ext: 'app', kind: 'app' as FileKind, size: a.size, mtime: a.lastUsed, btime: a.lastUsed, atime: a.lastUsed, root: 'Applications' }));
      groups.push({ id: 'unused-apps', name: 'Unused apps', description: `Apps you have not opened in ${Math.round(s.unusedAppDays / 30)} months.`, icon: 'app', mode: 'files', safety: 'review', preselect: false, items, size: items.reduce((n, f) => n + f.size, 0), count: items.length, locations: ['Applications'] });
    }
  } catch {
    /* app list unavailable */
  }
  try {
    const roots = s.folders.filter(existsSync);
    const { empty, broken } = await emptyAndBroken(roots, s.excluded);
    const asEntry = (p: string, kind: FileKind): FileEntry => ({ path: p, name: path.basename(p), ext: '', kind, size: 0, mtime: 0, btime: 0, atime: 0, root: path.basename(roots.find((r) => p.startsWith(r + path.sep)) ?? path.dirname(p)) });
    if (empty.length) groups.push({ id: 'empty-folders', name: 'Empty folders', description: 'Folders with nothing inside (system clutter files like .DS_Store do not count). They go to the Trash.', icon: 'folder', mode: 'files', safety: 'safe', preselect: false, items: empty.map((p) => asEntry(p, 'other')), size: 0, count: empty.length, locations: [...new Set(empty.map((p) => tildify(path.dirname(p), home)))].slice(0, 5) });
    if (broken.length) groups.push({ id: 'broken-links', name: 'Broken links', description: 'Shortcuts and links that point to files or folders that no longer exist. Only the link is removed.', icon: 'warning', mode: 'files', safety: 'safe', preselect: false, items: broken.map((p) => asEntry(p, 'other')), size: 0, count: broken.length, locations: [...new Set(broken.map((p) => tildify(path.dirname(p), home)))].slice(0, 5) });
  } catch {
    /* folders unreadable */
  }
  progress({ task: 'cleanup', phase: 'Done', done: 1, total: 1 });
  lastCleanup = groups;
  return groups;
}

async function clean(req: { id: string; paths?: string[] }[]): Promise<CleanResult> {
  const env = targetEnv();
  const home = os.homedir();
  const ctx = { platform: process.platform, home, excluded: settings().excluded };
  const total: CleanResult = { freed: 0, removed: 0, failed: 0, skipped: [] };
  const ops: JournalOp[] = [];
  const toTrash: string[] = [];
  for (const r of req) {
    const group = lastCleanup.find((g) => g.id === r.id);
    if (!group) continue;
    // Only paths Keeper itself listed for this group are accepted.
    const allowed = new Set((group.items ?? []).map((f) => f.path));
    const chosen = (r.paths ?? [...allowed]).filter((p) => allowed.has(p));
    if (group.id === 'broken-links') {
      for (const p of chosen) {
        if (await removeBrokenLink(p, settings().folders)) { total.removed++; ops.push({ type: 'delete', from: p, size: 0 }); } else total.failed++;
      }
      continue;
    }
    if (group.id === 'build-folders') {
      for (const p of chosen) {
        const v = await checkRemovable(p, ctx);
        if (!v.ok || !settings().folders.some((f) => isInside(p, f))) continue;
        const item = group.items!.find((f) => f.path === p)!;
        await fsp.rm(p, { recursive: true, force: true }).then(() => { total.freed += item.size; total.removed++; ops.push({ type: 'delete', from: p, size: item.size }); }, () => total.failed++);
      }
    } else if (group.id === 'unused-apps') {
      for (const p of chosen) {
        const a = (await listApps()).find((x) => x.path === p);
        if (!a) continue;
        try {
          const res = await uninstall(a.id);
          total.freed += res.freed;
          total.removed += res.removed;
          total.skipped.push(...res.skipped);
        } catch (e) {
          total.failed++;
          total.skipped.push(e instanceof Error ? e.message : String(e));
        }
      }
    } else if (group.mode === 'files') {
      toTrash.push(...chosen);
    } else if (group.mode === 'bin' && process.platform === 'win32') {
      const ok = (await powershell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue; $true')).ok;
      if (ok) { total.freed += group.size; total.removed += group.count; ops.push({ type: 'delete', from: 'Recycle Bin', size: group.size }); }
    } else {
      const target = cacheTargets(env).find((t) => t.id === group.id);
      if (!target) continue;
      // Advanced mode: only the entries the user ticked, each re-checked to be inside this group.
      const out = r.paths ? await cleanTargetPaths(target, ctx, r.paths) : await cleanTarget(target, ctx);
      total.freed += out.freed;
      total.removed += out.removed;
      total.failed += out.failed;
      if (out.inUse) total.skipped.push(`${out.inUse} item${out.inUse === 1 ? '' : 's'} in ${target.name} are in use and were kept`);
      if (out.denied) total.skipped.push(target.adminNote ?? `${out.denied} item${out.denied === 1 ? '' : 's'} in ${target.name} need admin rights`);
      if (out.freed) ops.push({ type: 'delete', from: target.name, size: out.freed });
    }
  }
  if (toTrash.length) {
    const r = await files.trash(toTrash, 'Clean Up');
    total.freed += r.freed;
    total.removed += r.removed;
    total.failed += r.failed;
    total.skipped.push(...r.skipped);
    if (r.journalId) {
      const trashOps = journal.get(r.journalId)?.ops ?? [];
      ops.push(...trashOps);
    }
  }
  const entry = await journal.record(`Cleaned up ${formatBytes(total.freed)}`, ops);
  total.journalId = entry?.id;
  libraryChanged();
  return total;
}

// ---------------------------------------------------------------- space map

const spaceCache = new Map<string, { at: number; node: SpaceNode }>();

async function spaceTree(dir: string): Promise<SpaceNode> {
  const hit = spaceCache.get(dir);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.node;
  const cleanRoots = (await Promise.all(cacheTargets(targetEnv()).map((t) => expandRoots(t.roots)))).flat();
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const children: SpaceNode[] = [];
  let done = 0;
  const queue = entries.filter((e) => !e.isSymbolicLink());
  const work = async () => {
    while (queue.length) {
      const e = queue.shift()!;
      const p = path.join(dir, e.name);
      progress({ task: 'space', phase: `Measuring ${e.name}`, done: done++, total: entries.length });
      try {
        if (e.isDirectory()) {
          const { size, files: n } = await sizeOf(p);
          children.push({ name: e.name, path: p, size, files: n, kind: 'folder', cleanable: cleanRoots.some((r) => r === p || isInside(r, p) || isInside(p, r)) });
        } else if (e.isFile()) {
          const st = await fsp.stat(p);
          children.push({ name: e.name, path: p, size: st.size, files: 1, kind: 'file' });
        }
      } catch {
        /* no permission */
      }
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  progress({ task: 'space', phase: 'Done', done: 1, total: 1 });
  const node: SpaceNode = { name: path.basename(dir) || dir, path: dir, size: children.reduce((n, c) => n + c.size, 0), files: children.reduce((n, c) => n + c.files, 0), kind: 'folder', children: children.sort((a, b) => b.size - a.size) };
  spaceCache.set(dir, { at: Date.now(), node });
  return node;
}

// ---------------------------------------------------------------- rules

async function runRule(r: Rule, auto = false): Promise<CleanResult> {
  const plan = planRule(index.all(), r);
  if (!plan.length) return { freed: 0, removed: 0, failed: 0, skipped: [] };
  let res: CleanResult;
  if (r.action.type === 'trash') res = await files.trash(plan.map((p) => p.file.path), `${auto ? 'Automation' : 'Rule'}: ${r.name}`);
  else if (r.action.type === 'move') {
    // Group by destination folder so each move is one history entry.
    res = { freed: 0, removed: 0, failed: 0, skipped: [] };
    const byDir = new Map<string, string[]>();
    for (const p of plan) byDir.set(path.dirname(p.to!), [...(byDir.get(path.dirname(p.to!)) ?? []), p.file.path]);
    for (const [dir, paths] of byDir) {
      const out = await files.move(paths, dir, `${auto ? 'Automation' : 'Rule'}: ${r.name}`);
      res.removed += out.removed;
      res.failed += out.failed;
      res.journalId = out.journalId;
    }
  } else {
    for (const p of plan) index.setTags(p.file.path, [...(p.file.tags ?? []), r.action.tag]);
    res = { freed: 0, removed: plan.length, failed: 0, skipped: [] };
  }
  const rules = settings().rules.map((x) => (x.id === r.id ? { ...x, lastRun: Date.now() } : x));
  await updateSettings({ rules });
  libraryChanged();
  return res;
}

async function runEnabledRules() {
  for (const r of settings().rules.filter((x) => x.enabled)) await runRule(r, true).catch(() => undefined);
}

// Updates are handled by electron/services/updater.ts (registered in ipc-x.ts).

// ---------------------------------------------------------------- IPC

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

/**
 * Lists cross to the window as structured clones; recognised text can be long,
 * so lists carry only its start (enough to show that text exists). Full text is
 * fetched on demand (inspect, readText).
 */
function lite(f: FileEntry): FileEntry {
  return f.text && f.text.length > 160 ? { ...f, text: f.text.slice(0, 160), textCut: true } : f;
}

function registerIpc() {
  handle('system.info', () => ({ platform: process.platform, arch: process.arch, osVersion: os.release(), appVersion: app.getVersion(), home: os.homedir(), sep: path.sep }));
  handle('system.disks', disks);
  handle('system.health', health);
  handle('system.killProcess', (pid: number) => killProcess(pid));
  handle('system.ejectAll', ejectAll);
  handle('system.wifiNetworks', wifiNetworks);
  handle('system.openExternal', async (url: string) => {
    if (url.startsWith('keeper://')) return handleDeepLink(url);
    if (/^(https?|mailto):/.test(url)) await shell.openExternal(url);
  });

  handle('capture.text', () => doCapture());
  handle('weather.get', (force?: boolean) => islandSvc.pollWeather(force).then((w) => w ?? null));
  handle('weather.search', (name: string) => searchPlaces(name));

  handle('settings.get', () => settings());
  handle('settings.set', (patch: Partial<AllSettings> & { island?: Partial<IslandSettings> }) => updateSettings(patch as Partial<AllSettings>));
  handle('settings.setSecret', (name: string, value: string) => setSecret(name, value));
  handle('settings.hasSecret', (name: string) => hasSecret(name));
  handle('settings.pickFolder', async () => {
    const r = await dialog.showOpenDialog(main ?? undefined!, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  handle('library.status', () => ({ indexing: index.scanning, files: index.files.size, lastScan: index.lastScan, ocrPending: vision.pending }));
  handle('library.rescan', () => rescan());
  handle('library.totals', () => index.totals());
  handle('library.recent', (n: number, kind?: string) => index.recent(n, (f) => !kind || (kind === 'screenshot' ? !!f.screenshot : kind === 'download' ? f.root === 'Downloads' : f.kind === kind)).map(lite));
  handle('library.list', (o: { kind?: FileKind; screenshot?: boolean; root?: string; source?: string; tag?: string; sort?: string; desc?: boolean; limit?: number }) => {
    const list = index.all().filter((f) => (!o.kind || f.kind === o.kind) && (!o.screenshot || f.screenshot) && (!o.root || f.root === o.root) && (!o.source || f.source?.id === o.source) && (!o.tag || f.tags?.includes(o.tag)));
    const sorted = sortFiles(list, o.sort, o.desc ?? o.sort !== 'name');
    return (o.limit ? sorted.slice(0, o.limit) : sorted).map(lite);
  });
  let dupeCache: Set<string> | undefined;
  handle('library.search', (text: string, limit = 300) => {
    const { parsed, hits } = index.query(text, { duplicatePaths: dupeCache });
    return { parsed, hits: hits.slice(0, limit).map((h) => ({ ...h, file: lite(h.file) })) };
  });
  handle('library.bySource', () => index.bySource());
  handle('library.tags', () => index.allTags());
  handle('library.setTags', (p: string, tags: string[]) => { index.setTags(p, tags); syncFinderTags(p, index.files.get(p)?.tags ?? []); libraryChanged(); });
  handle('library.inspect', async (p: string) => index.files.get(p) ?? (await index.refresh(p)) ?? null);
  handle('library.readText', async (paths: string[]) => {
    const out = [];
    for (const p of paths) {
      let text = index.files.get(p)?.text ?? index.extras.get(p)?.text;
      if (text === undefined) {
        const { loadImage, ocrFile } = await import('./services/vision');
        const img = await loadImage(p);
        text = img ? await ocrFile(p, img, settings().ocrLanguages) : '';
        index.setText(p, text);
      }
      out.push({ path: p, text });
    }
    return out;
  });
  handle('library.largeFiles', (minMb: number) => largeFiles(index.all(), minMb).map(lite));

  handle('files.browse', (dir: string, hidden?: boolean) => files.browse(dir, hidden));
  handle('files.thumbnail', (p: string, size: number) => files.thumbnail(p, size));
  handle('files.icon', (p: string) => files.icon(p));
  // Usage learning (off unless turned on) notes opens, moves and trashes made in Keeper.
  handle('files.open', (p: string) => { recordUsage({ type: 'open', path: p }); return files.open(p); });
  handle('files.openWith', (p: string) => files.openWith(p));
  handle('files.reveal', (p: string) => files.reveal(p));
  handle('files.copyPaths', (paths: string[]) => files.copyPaths(paths));
  handle('files.copyText', (t: string) => files.copyText(t));
  handle('files.trash', (paths: string[], title?: string) => { for (const p of paths) recordUsage({ type: 'trash', path: p }); return files.trash(paths, title); });
  handle('files.move', async (paths: string[], dir: string) => {
    const r = await files.move(paths, dir);
    for (const op of journal.get(r.journalId ?? '')?.ops ?? []) if (op.type === 'move' && op.to) recordUsage({ type: 'move', from: op.from, to: op.to });
    return r;
  });
  handle('files.copy', (paths: string[], dir: string) => files.copy(paths, dir));
  handle('files.rename', (p: string, name: string) => files.rename(p, name));
  handle('files.previewRename', (paths: string[], steps: never) => files.previewRename(paths, steps));
  handle('files.applyRename', (paths: string[], steps: never) => files.applyRename(paths, steps));
  handle('files.newFolder', (dir: string, name: string) => files.newFolder(dir, name));
  handle('files.compress', (paths: string[]) => files.compress(paths));
  ipcMain.on('files.startDrag', (e, paths: string[]) => {
    const list = paths.filter((p) => existsSync(p));
    if (!list.length) return;
    const icon = nativeImage.createFromPath(list[0]);
    e.sender.startDrag({ file: list[0], files: list, icon: icon.isEmpty() ? nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=') : icon.resize({ width: 64 }) });
  });

  handle('duplicates.scan', async (opts: { similar?: boolean; threshold?: number } = {}) => {
    const all = index.all();
    const exact = await findExactDuplicates(all, {
      cache: index.hashes,
      onProgress: (done, total, current) => done % 25 === 0 && progress({ task: 'duplicates', phase: 'Comparing files', done, total, current }),
    });
    const taken = new Set(exact.flatMap((g) => g.files.map((f) => f.path)));
    const pairs = findFormatPairs(all, taken);
    pairs.forEach((g) => g.files.forEach((f) => taken.add(f.path)));
    const similar = opts.similar === false ? [] : findSimilarImages(all.filter((f) => f.kind === 'image'), index.dhashes(), opts.threshold ?? 6, taken);
    progress({ task: 'duplicates', phase: 'Done', done: 1, total: 1 });
    index.saveSoon();
    const groups = [...exact, ...pairs, ...similar];
    dupeCache = new Set(groups.flatMap((g) => g.files.map((f) => f.path)));
    return groups;
  });

  handle('cleanup.scan', scanCleanup);
  handle('cleanup.clean', clean);
  handle('cleanup.details', async (id: string, dir?: string) => {
    const group = lastCleanup.find((g) => g.id === id);
    if (!group) throw new Error('Scan again to see what is inside');
    if (group.items) {
      return group.items.map((f) => ({ path: f.path, name: f.name, isDir: false, size: f.size, files: 1, mtime: f.mtime }));
    }
    const target = cacheTargets(targetEnv()).find((t) => t.id === id);
    if (!target) return [];
    return (await listTargetEntries(target, dir, { limit: 2000 })).map(({ root: _root, ...e }) => e);
  });
  handle('space.tree', (p: string) => spaceTree(p));
  handle('startup.list', listStartup);
  handle('startup.toggle', (id: string, enabled: boolean) => toggleStartup(id, enabled));
  handle('apps.list', listApps);
  handle('apps.uninstall', (id: string) => uninstall(id));
  handle('protection.check', checkProtection);

  handle('rules.list', () => settings().rules);
  handle('rules.save', async (r: Rule) => {
    const rules = settings().rules.some((x) => x.id === r.id) ? settings().rules.map((x) => (x.id === r.id ? r : x)) : [...settings().rules, r];
    return (await updateSettings({ rules })).rules;
  });
  handle('rules.remove', async (id: string) => (await updateSettings({ rules: settings().rules.filter((r) => r.id !== id) })).rules);
  handle('rules.plan', (id: string) => {
    const r = settings().rules.find((x) => x.id === id);
    return r ? planRule(index.all(), r) : [];
  });
  handle('rules.run', (id: string) => {
    const r = settings().rules.find((x) => x.id === id);
    if (!r) throw new Error('Rule not found');
    return runRule(r);
  });

  handle('history.list', async () => {
    await journal.load();
    return journal.list();
  });
  handle('history.undo', async (id: string) => {
    await journal.load();
    const e = journal.get(id);
    if (!e || e.undone) return { restored: 0, failed: [] };
    const res = await undoMoves(e);
    // Items sent to the Trash: point the user at it (restoring from the system Trash is up to the OS).
    const trashed = e.ops.filter((o) => o.type === 'trash');
    if (trashed.length && process.platform === 'darwin') await run('/usr/bin/open', [path.join(os.homedir(), '.Trash')]);
    else if (trashed.length && process.platform === 'win32') await run('explorer.exe', ['shell:RecycleBinFolder']);
    else if (trashed.length) await shell.openPath(path.join(os.homedir(), '.local', 'share', 'Trash', 'files'));
    for (const op of e.ops) if (op.type === 'move' && op.to) index.rename(op.to, op.from);
    await journal.markUndone(id);
    libraryChanged();
    return { restored: res.restored, failed: res.failed.concat(trashed.length ? [`${trashed.length} item(s) are in the Trash — put them back from there`] : []) };
  });

  handle('usage.get', () => usage());
  handle('features.list', () => listFeatures());
  handle('features.set', (id: string, on: boolean) => setFeature(id, on));
  handle('features.preset', (id: Parameters<typeof applyPreset>[0]) => applyPreset(id));
  handle('features.sets', () => featureSets());
  handle('features.saveSet', (name: string, id?: string) => saveFeatureSet(name, id));
  handle('features.removeSet', (id: string) => removeFeatureSet(id));
  handle('features.applySet', (ref: string) => applyFeatureSet(ref));
  handle('features.setPowerSets', (b: string, p: string) => setPowerSets(b, p));
  handle('features.live', () => liveCosts());
  startPowerSets();
  onFeaturesChanged(() => {
    broadcast('features-changed');
    // Shortcuts of features that went off are released; ones that came on are taken.
    registerShortcuts();
  });
  // Quick Search off: its window goes too (it is made again on first use).
  onFeature('quickSearch', (on) => { if (!on && quick && !quick.isDestroyed()) { quick.destroy(); quick = null; } });
  handle('ai.ask', async (history: AiMessage[]) => {
    const s = settings();
    const d = (await disks()).find((x) => x.system);
    const dupes = await findExactDuplicates(index.all().filter((f) => f.size > 5 * MB));
    return askAssistant(history, {
      platform: `${process.platform} ${os.release()}`,
      disk: d ? { total: d.total, free: d.free } : undefined,
      cleanup: lastCleanup.length ? lastCleanup : fileCleanupGroups(index.all()),
      largest: largeFiles(index.all(), 100),
      duplicates: dupes,
      downloads: index.all().filter((f) => f.root === 'Downloads').sort((a, b) => a.mtime - b.mtime),
      home: os.homedir(),
    }, { provider: s.ai.provider, model: s.ai.model, apiKey: await getSecret(s.ai.provider), ollamaUrl: s.ai.ollamaUrl });
  });

  handle('island.state', () => islandSvc.state());
  handle('island.addToShelf', (paths: string[]) => islandSvc.addToShelf(paths));
  handle('island.removeFromShelf', (p: string) => islandSvc.removeFromShelf(p));
  handle('island.clearShelf', () => islandSvc.clearShelf());
  handle('island.copyClip', (id: string) => islandSvc.copyClip(id));
  handle('island.pinClip', (id: string) => islandSvc.pinClip(id));
  handle('island.removeClip', (id: string) => islandSvc.removeClip(id));
  handle('island.clearClips', () => islandSvc.clearClips());
  handle('island.focus', (action: 'start' | 'pause' | 'resume' | 'stop', minutes?: number) => islandSvc.focusAction(action, minutes));
  handle('island.keepAwake', (on: boolean, opts?: KeepAwakeOptions) => { const r = islandSvc.keepAwake(on, opts); void updateTray(); return r; });
  handle('island.presentation', (on: boolean) => stagePresentation(on));
  handle('island.media', (a: 'toggle' | 'next' | 'previous' | 'seek', v?: number) => islandSvc.media(a, v));
  handle('island.openAgent', (id: string) => islandSvc.openAgent(id));
  handle('island.dismiss', (id: string) => islandSvc.dismiss(id));
  ipcMain.on('island.setExpanded', (e, v: boolean) => islandWindows.setExpanded(e.sender, v));
  ipcMain.on('island.setInteractive', (e, v: boolean) => islandWindows.setInteractive(e.sender, !!v));
}

// ---------------------------------------------------------------- start

app.whenReady().then(async () => {
  // Decides when background work runs and how often regular checks look (battery, idle, locked screen).
  startGovernor();
  // Local files for previews and the music player: read-only, seekable, only from allowed places.
  registerFileProtocol();
  registerPreviewIpc();
  registerConvertIpc({ journal: () => journal, progress, changed: libraryChanged, window: () => main, refresh: (p) => index.refresh(p) });

  const s = settings();
  index = makeIndex(s);
  journal = new Journal(path.join(app.getPath('userData'), 'history.json'));
  files = new FileService(index, journal, libraryChanged);
  vision = new VisionQueue(index, () => ({ ocr: settings().ocrEnabled && featureOn('ocr'), text: featureOn('docText'), langs: settings().ocrLanguages }), libraryChanged);
  // Switching text reading on later catches up on what was skipped.
  for (const f of ['ocr', 'docText'] as const) onFeature(f, (on) => { if (on && index) vision.schedule(index.all()); });
  onFeature('sources', (on) => { if (on && index) void index.enrichSources().then(() => index.saveSoon()); });
  islandSvc = new IslandService(index, () => broadcast('island-changed'));
  onLimitAlert((title, detail) => islandSvc?.alert({ kind: 'info', title, detail }));
  // Keep Awake: sessions, triggers, closed-lid mode, statistics (before the Island starts, which hands it keep-awake requests).
  registerAwakeIpc({ islandSvc, broadcast, updateTray: () => void updateTray(), show: (route) => showMain(route) });
  registerStageIpc({ islandSvc, broadcast, updateTray: () => void updateTray(), show: (route) => showMain(route), reregister: () => registerShortcuts(), recording: () => recordingState().recording });
  // Voice: dictation anywhere (talk key, pill, Island) and meeting recording (Island, tray, call detection).
  registerVoiceIpc({ islandSvc, broadcast, updateTray: () => void updateTray(), show: (route) => showMain(route), preload: preload(), lockDown, reregister: () => registerShortcuts() });
  registerIpc();
  registerIslandIpc({
    islandSvc, files, index, preload: preload(), lockDown, broadcast, updateTray: () => void updateTray(), setTrayTitle: (t) => tray?.setTitle(t),
    ocrImage: async (img) => (await import('./services/vision')).ocrImage(img, settings().ocrLanguages),
    // Shelf "Resize images" uses the same converter as the Convert screen; results land in a new folder.
    resize: async (paths, width) => {
      const { Converter } = await import('./services/convert');
      const conv = new Converter({ modelsDir: path.join(app.getPath('userData'), 'models') });
      const r = await conv.run({ op: { tool: 'image.resize', maxSide: width }, inputs: paths });
      for (const out of r.outputs) await index.refresh(out);
      libraryChanged();
      return r.outputs;
    },
  });
  // Island+: calls, levels, notifications, more agents, the launcher button; Cues beside the app or page they belong to.
  registerIslandXIpc({ islandSvc, emit: () => broadcast('island-changed'), openLauncher: () => toggleLauncher(), show: (route) => showMain(route || undefined) });
  registerCuesIpc({
    preload: preload(), lockDown, broadcast, show: (route) => showMain(route), updateTray: () => void updateTray(),
    island: (kind, title, detail, ref) => islandSvc?.alert({ kind: 'cue', title, detail, ref: kind === 'hint' ? 'hint' : ref }),
    setCueHere: (c) => islandSvc?.plus?.setCueHere(c),
    openIsland: (tool) => islandWindows.openOn(tool),
  });
  // Desktop widgets (moved out of ipc/island.ts), then wallpaper, vibes, ambient sound and folder icons.
  registerWidgetsIpc({ preload: preload(), lockDown, broadcast });
  registerAmbience({
    preload: preload(), lockDown, broadcast, show: (route) => showMain(route), updateTray: () => void updateTray(),
    alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }),
    startFocus: (minutes) => { if (featureOn('focus')) islandSvc?.focusAction('start', minutes); },
    focusActive: () => islandSvc?.focus.mode === 'focus',
    battery: () => islandSvc?.state().battery ?? null,
  });
  // The Island's tools: Ask, AI usage, sales, stocks, notes, to-dos, teleprompter, shortcuts.
  registerIslandToolsIpc({ rules: () => settings().rules.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled })), runRule: async (id) => { const r = settings().rules.find((x) => x.id === id); if (r) await runRule(r); } });
  // Updates wait for work a restart would interrupt, and the window saves where you are first.
  addBusyCheck(() => (recordingState().recording ? 'Recording the screen' : undefined));
  onBeforeInstall(() => broadcast('save-place'));
  registerIpcX({
    index, journal, events: () => islandSvc.events, window: () => main, changed: libraryChanged, broadcast,
    onUpdate: (u) => {
      if (u.countdown !== undefined) islandSvc.alert({ kind: 'info', title: `Keeper updates in ${Math.ceil(u.countdown / 60)} min`, detail: 'You’ll come back to the same page. Postpone it in Keeper.' });
      else islandSvc.alert({ kind: 'info', title: u.state === 'ready' ? `Keeper ${u.version} is ready to install` : `Keeper ${u.version} is available`, detail: u.state === 'ready' ? (u.message ?? 'Restart Keeper to finish updating') : 'Open Settings → Updates to see what’s new' });
      void updateTray();
    },
  });
  registerPlacesIpc({
    journal: () => journal,
    broadcast,
    changed: libraryChanged,
    // Network drives and cloud folders stay out of the library walk unless the person includes them.
    setRemoteExclusions: (paths) => { index.excluded = [...new Set([...settings().excluded, ...paths])]; },
  });
  registerLockIpc({ broadcast, changed: libraryChanged });
  // Places & Tracks: nothing runs until a source is switched on.
  registerTracksIpc({ broadcast, trayChanged: () => void updateTray() });
  // Guided fixes: what the person should do about space, security, privacy and more, and how.
  registerGuideIpc({ broadcast, preload: preload(), alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }) });
  registerBuiltinGuideSources({ index: () => index });
  // First look a minute after start, then twice a day; opening the To do list checks again.
  setTimeout(() => void refreshGuide(), 60_000).unref?.();
  setInterval(() => void refreshGuide(), 12 * 3600_000).unref?.();
  // Remote screens over Link: view and control other devices, phones, Wake-on-LAN (attaches once Link is up).
  void registerScreenIpc({ broadcast, show: (route) => showMain(route), preload: preload(), alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }) }).catch(() => undefined);
  // Remote Desktops: saved connections by any protocol, and letting others reach this computer (nothing runs until used).
  registerRdcIpc({
    broadcast,
    preload: preload(),
    showMain: (route) => showMain(route),
    // A session opens as a tab of the main window, or in a window of its own (Remote Desktops → Places).
    openTab: (route, ownWindow) => { showMain(); setTimeout(() => main?.webContents.send('event:navigate-tab', { ...route, window: ownWindow }), main?.webContents.isLoading() ? 800 : 0); },
  });
  // Keeper Link: paired devices, the phone companion and the tunnel.
  void registerLinkIpc({ broadcast, show: (route) => showMain(route) })
    .then(() => {
      // Folder sync runs over Link once it is up (each device allows "sync" per device in Devices).
      const n = linkNode();
      if (n && !process.env.KEEPER_SYNC_LOOPBACK) void attachTransport(linkTransport(n), 'link');
      // Notes Everywhere: search, read and jot notes from the phone companion.
      if (n) registerNotesCompanion(n);
      // Places & Tracks: the phone's position while its companion page is open.
      if (n) registerTracksCompanion(n);
      // Keeper Mesh: a WireGuard network between paired devices (off until switched on).
      void registerMeshIpc({ node: linkNode, broadcast, show: (route) => showMain(route), onChange: () => void updateTray() }).catch(() => undefined);
    })
    .catch(() => undefined);
  // Backups and mirrors to cloud services and servers go through Keeper's connections.
  const syncConnections = () => attachConnections(
    async (id) => storeFromRemoteFs(await connectionFs(id), remoteConnections().connections.find((c) => c.id === id)?.name ?? id),
    () => {
      const { connections, status } = remoteConnections();
      return connections.map((c) => ({ kind: 'connection' as const, id: c.id, label: c.name, detail: c.device === 'nas' ? 'nas' : c.kind === 'rclone' ? 'cloud' : c.device ?? c.kind, online: status.find((s) => s.id === c.id)?.state !== 'offline' }));
    },
  );
  // Cloud & servers: cloud services, servers, home servers and other computers.
  void registerRemoteIpc({ broadcast, thumbnail: (p, size) => files.thumbnail(p, size) });
  registerBrainIpc();
  registerAbilitiesIpc();
  registerAgentsIpc();
  registerProcsIpc();
  // System monitor: live readings (menu bar, pop-over), long-term history, dev servers, agents, sensors, the tool launcher.
  registerSysmonIpc({ preload: preload(), load, lockDown, showMain: (route) => showMain(route), devUrl: DEV_URL });
  setMonitorIslandAlert((title, detail) => islandSvc?.alert({ kind: 'info', title, detail }));
  // Mail, calendars, reminders, alarms and contacts.
  registerPimIpc();
  // Notes: vaults are read only while the Notes page is open.
  registerNotesIpc({ broadcast, allowRoot: allowPreviewRoot });
  void startPim({
    broadcast,
    alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }),
    islandEvents: (evs) => islandSvc?.setPimEvents(evs),
    islandTimers: (t) => islandSvc?.setCountdowns(t),
  });
  registerNetIpc({ alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }) });
  // Privacy & Security: permissions, browsers, posture, real-time malware protection and quarantine.
  registerSecurityIpc({ broadcast, alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }) });
  // Quick Controls: system switches, read only when asked.
  registerControlsIpc({ broadcast, alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }), show: (r) => showMain(r) });
  // System Settings+, per-app controls and browser tab controls: nothing runs until used.
  registerSettingsPlusIpc({ broadcast });
  // Ashforde apps (Monorail on macOS): off until switched on in Settings → Ashforde apps.
  registerAshfordeIpc({
    broadcast, alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }),
    // Monorail's focus and presentation modes follow Keeper's and back (docs/KEEPER-MONORAIL.md).
    coexist: {
      focus: (on) => { if (islandSvc && (islandSvc.focus.mode === 'focus') !== on) islandSvc.focusAction(on ? 'start' : 'stop'); },
      presentation: (on) => stagePresentation(on),
      focusOn: () => islandSvc?.focus.mode === 'focus',
      awakeOn: () => !!islandSvc?.awake.on,
      stageOn: () => !!stageSvc()?.on,
    },
  });
  onMonorailState((m) => islandSvc?.setMonorail(m));
  if (islandSvc) islandSvc.modeHook = (kind, on) => (kind === 'focus' ? monorailFocusChanged(on) : monorailPresentationChanged(on));
  onControlsChanged(() => void updateTray());
  // Firewall: rules, alerts, the DNS filter and traffic history (nothing runs until switched on).
  registerFirewallIpc({ alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }), broadcast });
  // Anonymous usage stats: on by default, off with one switch; at most one small report a day (Settings → Privacy).
  registerUsageStatsIpc();
  // Sync, backups and mirrors. Keeper Link and cloud connections attach when they are ready
  // (attachTransport / attachConnections); KEEPER_SYNC_LOOPBACK is for tests only.
  // Notes Everywhere: the hub of notes from every notes app (nothing runs until an app is connected).
  void registerNotesyncIpc({ userData: app.getPath('userData'), broadcast }).catch(() => undefined);
  void registerSyncIpc({
    userData: app.getPath('userData'),
    broadcast,
    transport: () => {
      const t = loopbackFromEnv();
      return t ? { transport: t, kind: 'loopback' } : { transport: null, kind: 'none', message: 'Pair another device in Devices to sync folders between them.' };
    },
    whenIdle: (k) => whenIdle(k),
    pace: (k) => pace(k),
    poll: (name, everyMs, fn) => poll(name, { baseMs: everyMs, idleFactor: 2 }, fn, { now: false }),
    onBattery: () => conditions().onBattery,
    idleSeconds: () => conditions().idleSec,
  }).then(syncConnections);
  // The terminal: sessions live in a separate host process so they outlive the window.
  registerTerminalIpc({
    preload: path.join(__dirname, 'preload.cjs'),
    alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }),
    getSecret,
    setSecret,
  });
  registerCaptureIpc({
    preload: capturePreload(),
    langs: () => settings().ocrLanguages,
    folders: () => settings().folders,
    added: async (p, shelf) => {
      await index.refresh(p);
      if (shelf) await islandSvc.addToShelf([p]);
      libraryChanged();
    },
    alert: (title, detail, p) => islandSvc.alert({ kind: p ? 'screenshot' : 'info', title, detail, path: p }),
    recording: (r) => {
      islandSvc.recording = r.recording && r.since ? { since: r.since } : undefined;
      broadcast('island-changed');
      void updateTray();
    },
    navigate: (route) => showMain(route),
  });

  // The window opens straight away; the saved library fills it in a moment later.
  // Started at login to sit in the tray: the window's page loads only when it is first opened.
  // Tabs, drafts and windows survive crashes; a watchdog brings Keeper back if it stops unexpectedly.
  initResilience({ preload, lockDown, restore: () => settings().restorePlace !== false, main: () => main });
  if (!process.argv.includes('--hidden') || settings().resourceMode === 'performance') createMain();
  restoreExtraWindows();
  await index.load();
  registerPlatformIpc({ ask: askKeeper });
  const platformDeps = { index: () => index, showMain, ask: askKeeper };
  onFeature('platform', (on) => (on ? void initPlatform(platformDeps) : stopPlatform()), { now: true });
  onFeature('widgets', () => syncWidgets());
  // The brain reads passages and serves AI apps once the saved library is in.
  void startBrain({ index: () => index, broadcast }).then(() => startAgents({
    // AI agents: actions behind permissions, the model gateway, skills, learning and the knowledge graph.
    index: () => index, journal: () => journal, files: () => files, broadcast, changed: libraryChanged,
    alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }),
    runRule: async (id) => {
      const r = settings().rules.find((x) => x.id === id);
      if (!r) throw new Error('No automation with that id');
      return runRule(r);
    },
    focus: (action, minutes) => void islandSvc.focusAction(action, minutes),
    setTags: (p, tags) => { index.setTags(p, tags); syncFinderTags(p, index.files.get(p)?.tags ?? []); },
    openTerminal: (o) => {
      openTerminalWindow();
      // A window that was closed needs a moment to load before it takes the command.
      setTimeout(() => openTerminalWindow({ ...(o.cwd ? { cwd: o.cwd } : {}), run: o.run, title: o.title ?? '' }), 1200);
    },
  })).then(() =>
    // Agents' own terminals (sub-workers, headless runs) and the hub where agents of every kind work together.
    registerAgentTermIpc({ broadcast, alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }) }),
  ).catch(() => undefined);
  // macOS: Siri, Spotlight and Shortcuts learn Keeper's actions from its small helper app (once per version).
  void registerIntentsHelper();
  // Linux: the same actions on the session bus (org.ashfordeou.Keeper.Actions) for desktop assistants and launchers.
  if (process.platform === 'linux' && process.env.DBUS_SESSION_BUS_ADDRESS) {
    void import('./services/platform/dbus-actions').then(({ exportActions }) => exportActions({
      openUrl: (url) => handleDeepLink(url),
      ask: async (q) => (await import('./services/brain')).askBrain(q).then((r) => r.answer),
      search: async (q, n) => (await import('./services/brain')).search(q, { limit: n }).then((hits) => hits.map((h) => h.path)),
    })).catch(() => undefined);
  }
  // Abilities for every AI (web, research, posts, pictures, code, memory, schedules, personas, projects, teams).
  const abilityDeps = {
    broadcast,
    alert: (title: string, detail?: string) => islandSvc?.alert({ kind: 'info', title, detail }),
    ocr: async (p: string) => {
      const { loadImage, ocrFile } = await import('./services/vision');
      const img = await loadImage(p);
      return img ? ocrFile(p, img, settings().ocrLanguages) : '';
    },
  };
  onFeature('abilities', (on) => (on ? void wireAbilities(abilityDeps).catch(() => undefined) : unwireAbilities()), { now: true });
  // An AI using this computer: off unless allowed under Agents; Stop in the Island or ⌃⌥⌘. / Ctrl+Alt+Shift+.
  void wireComputer({ broadcast, alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }) });
  // Keeper's browser for AIs, private desktops, task plans, saved sign-ins and recorded workflows.
  void import('./services/cu').then((m) => m.initCu({ broadcast, alert: (title, detail) => islandSvc?.alert({ kind: 'info', title, detail }), downloaded: () => libraryChanged() })).catch((e) => console.error('computer use', e));
  libraryChanged();
  createIsland();
  syncWidgets();
  await updateTray();
  registerShortcuts();
  void islandSvc.start();
  void rescan();

  const link = process.argv.find((a) => a.startsWith('keeper://'));
  if (link) handleDeepLink(link);
  else if (!handleRdcArgv(process.argv)) handlePlatformArgv(process.argv);

  // File changes in watched folders arrive at once; this full re-read catches the rest.
  poll('library.rescan', { baseMs: 30 * 60_000, idleFactor: 2 }, async () => { await whenIdle('scan'); await rescan(); }, { now: false });
  poll('rules.run', { baseMs: 60 * 60_000, idleFactor: 1 }, () => runEnabledRules(), { now: false, feature: 'rules' });
  setTimeout(() => void runEnabledRules(), 5 * 60_000);

  onSettings((next, prev) => {
    if (next.theme !== prev.theme || next.themeSeasons !== prev.themeSeasons) ashfordeThemeChanged();
    if (JSON.stringify(next.brain) !== JSON.stringify(prev.brain)) void brainSettingsChanged(next.brain, prev.brain);
    if (JSON.stringify(next.agents) !== JSON.stringify(prev.agents)) void agentSettingsChanged(normalizeAgentSettings(next.agents), normalizeAgentSettings(prev.agents));
    if (next.folders.join() !== prev.folders.join() || next.excluded.join() !== prev.excluded.join() || next.showHidden !== prev.showHidden || next.includeRemote !== prev.includeRemote) {
      index.folders = next.folders.filter(existsSync).map((f) => ({ path: f, label: path.basename(f) }));
      index.excluded = next.includeRemote ? next.excluded : [...new Set([...next.excluded, ...remoteFolders()])];
      void rescan();
    }
    if (next.platform?.askShortcut !== prev.platform?.askShortcut) registerShortcuts();
    if (next.quickSearchShortcut !== prev.quickSearchShortcut || next.island.captureShortcut !== prev.island.captureShortcut || next.island.dictationShortcut !== prev.island.dictationShortcut) registerShortcuts();
    if (next.trayEnabled !== prev.trayEnabled || next.trayCount !== prev.trayCount) void updateTray();
    if (next.island.enabled !== prev.island.enabled) (next.island.enabled ? createIsland() : destroyIsland());
    else if ((['edge', 'displays', 'size', 'blendNotch', 'cameraEdge', 'followCamera', 'offsetX', 'offsetY'] as const).some((k) => next.island[k] !== prev.island[k])) islandWindows.ensure(true);
    if (['pasteShortcut', 'shelfShortcut', 'hideShortcut', 'awakeShortcut'].some((k) => next.island[k as 'pasteShortcut'] !== prev.island[k as 'pasteShortcut'])) registerShortcuts();
    if (next.island.calendarUrl !== prev.island.calendarUrl) void islandSvc.pollCalendar();
    if (JSON.stringify(next.island.place) !== JSON.stringify(prev.island.place) || next.island.units !== prev.island.units) void islandSvc.pollWeather(true);
    broadcast('island-changed');
    // Every window (Island, Quick Search, widgets) follows look, theme and language changes.
    broadcast('settings-changed', next);
  });

  app.on('activate', () => showMain());
});

// Folders set to lock again when Keeper quits are locked first; quitting then carries on.
let relocking = false;
app.on('before-quit', (e) => {
  void stopFirewall();
  void flushIslandTools().catch(() => undefined);
  if (!relocking && pendingOnQuit()) {
    e.preventDefault();
    relocking = true;
    void relockOnQuit().finally(() => app.quit());
    return;
  }
  quitting = true;
  installOnQuitIfReady();
  stopPlatform();
  shutdownVoice();
  stopSecurityIpc();
  void stopPim();
  void stopRemote();
  void stopAgents();
  unwireAbilities();
  stopBrain();
  void stopAgentTerminals();
  void stopTerminal();
  stopSync();
  stopScreen();
  void stopMesh();
  void stopLink();
  void stopTracks();
  globalShortcut.unregisterAll();
  vision?.stop();
  islandSvc?.stop();
  stopIslandX();
  stopCues();
  try {
    index?.saveSync();
  } catch {
    /* disk full or read-only: the next scan rebuilds it */
  }
});

app.on('window-all-closed', () => {
  if (!settings().trayEnabled) app.quit();
});
