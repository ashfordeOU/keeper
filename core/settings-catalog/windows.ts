// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Windows settings: registry values, power settings, services and optional
// features. HKCU values apply to you only; HKLM values (marked administrator)
// apply to everyone on the PC.

import { builder, c, UNSET } from './build';
import type { Op, SettingDef } from './types';

const REG = ['https://learn.microsoft.com/windows-server/administration/windows-commands/reg-add'];
const b = builder('win32', 'win', { sources: REG });
const r = (path: string, name: string, hive: 'HKCU' | 'HKLM' = 'HKCU', type: 'REG_DWORD' | 'REG_SZ' = 'REG_DWORD'): Op => ({ t: 'reg', hive, path, name, type });
const lm = (path: string, name: string, type: 'REG_DWORD' | 'REG_SZ' = 'REG_DWORD') => r(path, name, 'HKLM', type);
const svc = (name: string): Op => ({ t: 'service', name });
const feat = (name: string): Op => ({ t: 'winfeature', name });

const ADV = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';
const EXP = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer';
const CDM = 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager';
const PERS = 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
const DESK = 'Control Panel\\Desktop';
const SEARCH = 'Software\\Microsoft\\Windows\\CurrentVersion\\Search';
const WU = 'SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU';
const EXPL = { after: 'relaunch-explorer' } as const;
const POL = { removeToRestore: true } as const;
const ADMIN = { admin: true } as const;
const PRIVACY = ['https://learn.microsoft.com/windows/privacy/manage-connections-from-windows-operating-system-components-to-microsoft-services'];
const SERVICES = ['https://learn.microsoft.com/windows-server/administration/windows-commands/sc-config'];
const FEATURES = ['https://learn.microsoft.com/windows-hardware/manufacture/desktop/dism-operating-system-package-servicing-command-line-options'];
const POWER = ['https://learn.microsoft.com/windows-hardware/design/device-experiences/powercfg-command-line-options'];
const ON = '1';
const OFF = '0';

const START = [c('auto', 'Automatic'), c('demand', 'Manual'), c('disabled', 'Disabled')];
const service = (id: string, name: string, title: string, description: string, def: string, extra: Partial<SettingDef> = {}): SettingDef =>
  b.choice(`service.${id}`, 'Services', title, description, svc(name), START, def, { ...ADMIN, sources: SERVICES, after: 'restart', risk: 'medium', keywords: [name, 'service'], ...extra });
const feature = (id: string, name: string, title: string, description: string, extra: Partial<SettingDef> = {}): SettingDef =>
  b.toggle(`feature.${id}`, 'Developer', title, description, feat(name), 'on', 'off', 'off', { ...ADMIN, sources: FEATURES, after: 'restart', keywords: [name, 'optional feature', 'dism'], ...extra });

export const WINDOWS: SettingDef[] = [
  // ── File Explorer
  b.toggle('explorer.extensions', 'Finder & files', 'Show file extensions', 'Always shows the part after the dot (.pdf, .exe) so you can see what a file really is.', r(ADV, 'HideFileExt'), OFF, ON, ON, { ...EXPL, keywords: ['file type', 'suffix'] }),
  b.toggle('explorer.hidden', 'Finder & files', 'Show hidden files', 'Shows files and folders marked hidden.', r(ADV, 'Hidden'), ON, '2', '2', EXPL),
  b.toggle('explorer.superhidden', 'Finder & files', 'Show protected system files', 'Shows Windows\' own protected files. Leave off unless you need it.', r(ADV, 'ShowSuperHidden'), ON, OFF, OFF, { ...EXPL, risk: 'medium', warning: 'Deleting protected files can stop Windows starting.' }),
  b.choice('explorer.launchto', 'Finder & files', 'File Explorer opens to', 'The page a new File Explorer window shows.', r(ADV, 'LaunchTo'), [c('1', 'This PC'), c('2', 'Home / Quick access'), c('3', 'Downloads')], '2', EXPL),
  b.toggle('explorer.checkboxes', 'Finder & files', 'Item check boxes', 'Shows a check box next to files for selecting several.', r(ADV, 'AutoCheckSelect'), ON, OFF, OFF, EXPL),
  b.toggle('explorer.separate', 'Finder & files', 'Open folders in a separate process', 'More stable File Explorer at the cost of a little memory.', r(ADV, 'SeparateProcess'), ON, OFF, OFF, EXPL),
  b.toggle('explorer.fullpath', 'Finder & files', 'Full path in the title bar', 'Shows the complete folder path in File Explorer\'s title.', r('Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\CabinetState', 'FullPath'), ON, OFF, OFF, EXPL),
  b.toggle('explorer.recent', 'Privacy', 'Show recent files in Home', 'Lists recently opened files in File Explorer.', r(EXP, 'ShowRecent'), ON, OFF, ON, EXPL),
  b.toggle('explorer.frequent', 'Privacy', 'Show frequent folders in Home', 'Lists folders you use often.', r(EXP, 'ShowFrequent'), ON, OFF, ON, EXPL),
  b.toggle('explorer.cloud', 'Privacy', 'Show files from Office.com in Home', 'Includes cloud files in File Explorer\'s Home.', r(EXP, 'ShowCloudFilesInQuickAccess'), ON, OFF, ON, EXPL),
  b.toggle('explorer.syncnotify', 'Privacy', 'Show sync provider notifications', 'Turn off to hide OneDrive and other tips inside File Explorer.', r(ADV, 'ShowSyncProviderNotifications'), ON, OFF, ON, EXPL),
  b.toggle('explorer.classicmenu', 'Finder & files', 'Classic right-click menu', 'Shows the full Windows 10-style right-click menu without "Show more options".', r('Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32', '', 'HKCU', 'REG_SZ'), '', UNSET, UNSET, { ...EXPL, ...POL, versions: 'Windows 11', keywords: ['context menu', 'show more options'] }),
  b.toggle('explorer.longpaths', 'Developer', 'Allow long file paths', 'Lets apps that support it use paths longer than 260 characters.', lm('SYSTEM\\CurrentControlSet\\Control\\FileSystem', 'LongPathsEnabled'), ON, OFF, OFF, { ...ADMIN, after: 'restart', sources: ['https://learn.microsoft.com/windows/win32/fileio/maximum-file-path-limitation'] }),
  b.toggle('explorer.thumbcache', 'Performance', 'Keep thumbnail cache', 'Turn off to stop Windows deleting the thumbnail cache during cleanup.', lm('SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VolumeCaches\\Thumbnail Cache', 'Autorun'), OFF, ON, ON, ADMIN),
  b.toggle('explorer.shake', 'Windows & spaces', 'Shake a window to minimise others', 'Grabbing a title bar and shaking minimises every other window.', r(ADV, 'DisallowShaking'), OFF, ON, ON, EXPL),
  b.toggle('explorer.snap', 'Windows & spaces', 'Snap windows', 'Drag windows to the edges to arrange them.', r(DESK, 'WindowArrangementActive', 'HKCU', 'REG_SZ'), ON, OFF, ON, { after: 'logout' }),
  b.toggle('explorer.snaplayouts', 'Windows & spaces', 'Snap layouts on the maximise button', 'Shows layout choices when you hover over the maximise button.', r(ADV, 'EnableSnapAssistFlyout'), ON, OFF, ON, { ...EXPL, versions: 'Windows 11' }),
  b.toggle('explorer.snapassist', 'Windows & spaces', 'Suggest what to snap next', 'After snapping one window, shows others to fill the space.', r(ADV, 'SnapAssist'), ON, OFF, ON, EXPL),

  // ── Taskbar & Start
  b.choice('taskbar.align', 'Menu bar & taskbar', 'Taskbar alignment', 'Where taskbar icons sit.', r(ADV, 'TaskbarAl'), [c('0', 'Left'), c('1', 'Centre')], '1', { ...EXPL, versions: 'Windows 11' }),
  b.toggle('taskbar.widgets', 'Menu bar & taskbar', 'Widgets button', 'Shows the news and weather Widgets button.', r(ADV, 'TaskbarDa'), ON, OFF, ON, { ...EXPL, versions: 'Windows 11', warning: 'Some Windows builds protect this value; if it fails, use Settings ▸ Personalisation ▸ Taskbar.' }),
  b.toggle('taskbar.chat', 'Menu bar & taskbar', 'Chat / Teams button', 'Shows the Chat button.', r(ADV, 'TaskbarMn'), ON, OFF, ON, { ...EXPL, versions: 'Windows 11' }),
  b.toggle('taskbar.taskview', 'Menu bar & taskbar', 'Task View button', 'Shows the Task View (virtual desktops) button.', r(ADV, 'ShowTaskViewButton'), ON, OFF, ON, EXPL),
  b.toggle('taskbar.copilot', 'Menu bar & taskbar', 'Copilot button', 'Shows the Copilot button on the taskbar.', r(ADV, 'ShowCopilotButton'), ON, OFF, ON, { ...EXPL, versions: 'Windows 11 23H2+' }),
  b.choice('taskbar.search', 'Menu bar & taskbar', 'Search on the taskbar', 'How the Search box appears.', r(SEARCH, 'SearchboxTaskbarMode'), [c('0', 'Hidden'), c('1', 'Icon only'), c('2', 'Search box'), c('3', 'Icon and label')], '2', EXPL),
  b.choice('taskbar.combine', 'Menu bar & taskbar', 'Combine taskbar buttons', 'Whether windows of the same app share one button.', r(ADV, 'TaskbarGlomLevel'), [c('0', 'Always, hide labels'), c('1', 'When the taskbar is full'), c('2', 'Never')], '0', EXPL),
  b.toggle('taskbar.endtask', 'Menu bar & taskbar', 'End task on right-click', 'Adds "End task" to taskbar right-click menus.', r(ADV + '\\TaskbarDeveloperSettings', 'TaskbarEndTask'), ON, OFF, OFF, { ...EXPL, versions: 'Windows 11 23H2+' }),
  b.toggle('taskbar.alldisplays', 'Menu bar & taskbar', 'Taskbar on all displays', 'Shows the taskbar on every monitor.', r(ADV, 'MMTaskbarEnabled'), ON, OFF, OFF, EXPL),
  b.toggle('taskbar.seconds', 'Menu bar & taskbar', 'Show seconds in the clock', 'The taskbar clock includes seconds (uses a little more power).', r(ADV, 'ShowSecondsInSystemClock'), ON, OFF, OFF, { ...EXPL, versions: 'Windows 11 22H2+' }),
  b.toggle('taskbar.badges', 'Menu bar & taskbar', 'Badges on taskbar apps', 'Shows unread counts on taskbar icons.', r(ADV, 'TaskbarBadges'), ON, OFF, ON, EXPL),
  b.toggle('taskbar.smallicons', 'Menu bar & taskbar', 'Small taskbar buttons', 'Makes the taskbar thinner (Windows 10).', r(ADV, 'TaskbarSmallIcons'), ON, OFF, OFF, { ...EXPL, versions: 'Windows 10' }),
  b.toggle('start.recentdocs', 'Privacy', 'Recent files in Start and Jump Lists', 'Shows recently opened items in Start, Jump Lists and File Explorer.', r(ADV, 'Start_TrackDocs'), ON, OFF, ON, EXPL),
  b.toggle('start.recentapps', 'Privacy', 'Most used apps in Start', 'Tracks app launches to show your most-used apps.', r(ADV, 'Start_TrackProgs'), ON, OFF, ON, EXPL),
  b.toggle('start.recommendations', 'Menu bar & taskbar', 'Tips and app promotions in Start', 'Shows recommendations for tips, shortcuts and new apps.', r(ADV, 'Start_IrisRecommendations'), ON, OFF, ON, { ...EXPL, versions: 'Windows 11' }),
  b.choice('start.layout', 'Menu bar & taskbar', 'Start layout', 'Balance between pinned apps and recommendations.', r(ADV, 'Start_Layout'), [c('0', 'Default'), c('1', 'More pins'), c('2', 'More recommendations')], '0', { ...EXPL, versions: 'Windows 11 22H2+' }),
  b.toggle('start.websearch', 'Search & indexing', 'Web results in Start search', 'Turn off so Start only searches this PC (no Bing results).', r('Software\\Policies\\Microsoft\\Windows\\Explorer', 'DisableSearchBoxSuggestions'), OFF, ON, OFF, { ...EXPL, ...POL, after: 'logout', sources: ['https://learn.microsoft.com/windows/client-management/mdm/policy-csp-search'], keywords: ['bing'] }),
  b.toggle('search.cloud', 'Search & indexing', 'Search your Microsoft account content', 'Lets Windows Search include OneDrive, Outlook and Bing content.', r('Software\\Microsoft\\Windows\\CurrentVersion\\SearchSettings', 'IsMSACloudSearchEnabled'), ON, OFF, ON, {}),
  b.toggle('search.history', 'Privacy', 'Search history on this device', 'Remembers your searches to improve results.', r('Software\\Microsoft\\Windows\\CurrentVersion\\SearchSettings', 'IsDeviceSearchHistoryEnabled'), ON, OFF, ON, {}),
  b.toggle('search.highlights', 'Search & indexing', 'Search highlights', 'Shows trending searches and pictures in the search box.', r('Software\\Microsoft\\Windows\\CurrentVersion\\SearchSettings', 'IsDynamicSearchBoxEnabled'), ON, OFF, ON, {}),

  // ── Appearance & feel
  b.toggle('appearance.appslight', 'Appearance', 'Apps use light mode', 'Turn off for dark mode in apps.', r(PERS, 'AppsUseLightTheme'), ON, OFF, ON, { keywords: ['dark mode'] }),
  b.toggle('appearance.systemlight', 'Appearance', 'Windows uses light mode', 'Turn off for a dark taskbar and Start.', r(PERS, 'SystemUsesLightTheme'), ON, OFF, OFF, { keywords: ['dark mode'] }),
  b.toggle('appearance.transparency', 'Appearance', 'Transparency effects', 'See-through taskbar, Start and windows. Turn off to save a little power.', r(PERS, 'EnableTransparency'), ON, OFF, ON, {}),
  b.toggle('appearance.accentbars', 'Appearance', 'Accent colour on title bars', 'Colours window borders and title bars.', r('Software\\Microsoft\\Windows\\DWM', 'ColorPrevalence'), ON, OFF, OFF, {}),
  b.toggle('appearance.accentstart', 'Appearance', 'Accent colour on Start and taskbar', 'Colours Start and the taskbar (needs dark mode).', r(PERS, 'ColorPrevalence'), ON, OFF, OFF, {}),
  b.number('perf.menudelay', 'Performance', 'Menu show delay', 'How long before submenus open.', r(DESK, 'MenuShowDelay', 'HKCU', 'REG_SZ'), 0, 1000, '400', { after: 'logout', unit: 'ms', keywords: ['faster'] }),
  b.toggle('perf.autoendtasks', 'Performance', 'Close hung apps automatically at shutdown', 'Ends apps that are not responding instead of waiting.', r(DESK, 'AutoEndTasks', 'HKCU', 'REG_SZ'), ON, OFF, OFF, { after: 'logout', risk: 'medium', warning: 'Apps closed this way lose unsaved work.' }),
  b.number('perf.jpegquality', 'Appearance', 'Wallpaper JPEG quality', 'Windows recompresses JPEG wallpapers; 100 keeps them sharp.', r(DESK, 'JPEGImportQuality'), 60, 100, '85', { after: 'logout', unit: '%' }),
  b.number('kb.delay', 'Keyboard & mouse', 'Key repeat delay', 'How long before a held key repeats (0 shortest – 3 longest).', r('Control Panel\\Keyboard', 'KeyboardDelay', 'HKCU', 'REG_SZ'), 0, 3, '1', { after: 'logout' }),
  b.number('kb.speed', 'Keyboard & mouse', 'Key repeat rate', 'How fast a held key repeats (0 slowest – 31 fastest).', r('Control Panel\\Keyboard', 'KeyboardSpeed', 'HKCU', 'REG_SZ'), 0, 31, '31', { after: 'logout' }),
  b.toggle('mouse.accel', 'Keyboard & mouse', 'Enhance pointer precision', 'Mouse acceleration. Many gamers turn it off.', r('Control Panel\\Mouse', 'MouseSpeed', 'HKCU', 'REG_SZ'), ON, OFF, ON, { after: 'logout', keywords: ['acceleration'] }),
  b.number('mouse.sensitivity', 'Keyboard & mouse', 'Pointer speed', 'Pointer speed (1 slowest – 20 fastest).', r('Control Panel\\Mouse', 'MouseSensitivity', 'HKCU', 'REG_SZ'), 1, 20, '10', { after: 'logout' }),
  b.toggle('kb.stickykeys', 'Keyboard & mouse', 'Sticky Keys shortcut (press Shift 5 times)', 'Turn off to stop the Sticky Keys prompt in games.', r('Control Panel\\Accessibility\\StickyKeys', 'Flags', 'HKCU', 'REG_SZ'), '510', '506', '510', { after: 'logout' }),
  b.toggle('kb.capsbeep', 'Sound', 'Toggle keys sound', 'Plays a tone when Caps Lock, Num Lock or Scroll Lock is pressed.', r('Control Panel\\Accessibility\\ToggleKeys', 'Flags', 'HKCU', 'REG_SZ'), '63', '58', '58', { after: 'logout' }),
  b.toggle('perf.startupdelay', 'Performance', 'Delay startup apps', 'Windows waits a few seconds before starting startup apps. Turn off to start them at once.', r(EXP + '\\Serialize', 'StartupDelayInMSec'), OFF, UNSET, UNSET, { ...POL, keywords: ['boot'] }),
  b.toggle('perf.gamemode', 'Performance', 'Game Mode', 'Prioritises games and pauses some background work.', r('Software\\Microsoft\\GameBar', 'AutoGameModeEnabled'), ON, OFF, ON, {}),
  b.toggle('perf.gamedvr', 'Performance', 'Record game clips in the background', 'Game Bar records gameplay in the background. Turn off for better performance.', r('System\\GameConfigStore', 'GameDVR_Enabled'), ON, OFF, OFF, {}),
  b.toggle('perf.gamebar', 'Performance', 'Open Game Bar with the controller button', 'The Xbox button opens Game Bar.', r('Software\\Microsoft\\GameBar', 'UseNexusForGameBarEnabled'), ON, OFF, ON, {}),
  b.toggle('perf.hags', 'Performance', 'Hardware-accelerated GPU scheduling', 'Lets the graphics card manage its own memory. Can reduce latency.', lm('SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', 'HwSchMode'), '2', '1', '1', { ...ADMIN, after: 'restart' }),
  b.toggle('perf.throttling', 'Performance', 'Power throttling', 'Windows slows background apps to save battery. Turn off for full speed.', lm('SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling', 'PowerThrottlingOff'), OFF, ON, OFF, { ...ADMIN, ...POL, after: 'restart' }),

  // ── Privacy
  b.toggle('privacy.adid', 'Privacy', 'Advertising ID', 'Lets apps show you personalised ads using a per-user ID.', r('Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', 'Enabled'), ON, OFF, ON, { sources: PRIVACY }),
  b.choice('privacy.telemetry', 'Privacy', 'Diagnostic data', 'How much diagnostic data Windows sends to Microsoft. 0 only works on Enterprise and Education; Home and Pro treat it as 1.', lm('SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry'), [c('0', 'Security only (Enterprise)'), c('1', 'Required'), c('3', 'Optional')], '3', { ...ADMIN, ...POL, sources: ['https://learn.microsoft.com/windows/client-management/mdm/policy-csp-system', ...PRIVACY], keywords: ['telemetry'] }),
  b.toggle('privacy.tailored', 'Privacy', 'Tailored experiences', 'Microsoft uses diagnostic data to personalise tips and ads.', r('Software\\Microsoft\\Windows\\CurrentVersion\\Privacy', 'TailoredExperiencesWithDiagnosticDataEnabled'), ON, OFF, ON, { sources: PRIVACY }),
  b.toggle('privacy.inking', 'Privacy', 'Inking and typing personalisation', 'Builds a personal dictionary from what you type and write.', r('Software\\Microsoft\\InputPersonalization', 'RestrictImplicitTextCollection'), OFF, ON, OFF, { sources: PRIVACY }),
  b.toggle('privacy.typinginsights', 'Privacy', 'Improve inking and typing', 'Sends typing data to Microsoft.', r('Software\\Microsoft\\Input\\TIPC', 'Enabled'), ON, OFF, ON, { sources: PRIVACY }),
  b.toggle('privacy.activity', 'Privacy', 'Activity history', 'Windows keeps a history of apps and files you used.', lm('SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'PublishUserActivities'), ON, OFF, ON, { ...ADMIN, ...POL, sources: PRIVACY }),
  b.toggle('privacy.clipboardhistory', 'Privacy', 'Clipboard history (Win+V)', 'Keeps a list of things you copied.', r('Software\\Microsoft\\Clipboard', 'EnableClipboardHistory'), ON, OFF, OFF, {}),
  b.toggle('privacy.speech', 'Privacy', 'Online speech recognition', 'Sends voice to Microsoft for dictation and voice typing.', r('Software\\Microsoft\\Speech_OneCore\\Settings\\OnlineSpeechPrivacy', 'HasAccepted'), ON, OFF, OFF, { sources: PRIVACY }),
  b.choice('privacy.feedback', 'Privacy', 'Feedback requests', 'How often Windows asks for feedback.', r('Software\\Microsoft\\Siuf\\Rules', 'NumberOfSIUFInPeriod'), [c(OFF, 'Never'), c(UNSET, 'Automatically')], UNSET, { ...POL, sources: PRIVACY }),
  b.toggle('privacy.copilot', 'Privacy', 'Windows Copilot', 'Turn off to remove Copilot (policy).', r('Software\\Policies\\Microsoft\\Windows\\WindowsCopilot', 'TurnOffWindowsCopilot'), OFF, ON, OFF, { ...POL, after: 'logout', versions: 'Windows 11 23H2+' }),
  b.toggle('privacy.recall', 'Privacy', 'Recall snapshots', 'Turn off so Windows does not save snapshots of your screen (Copilot+ PCs).', r('Software\\Policies\\Microsoft\\Windows\\WindowsAI', 'DisableAIDataAnalysis'), OFF, ON, OFF, { ...POL, after: 'logout', versions: 'Windows 11 24H2 Copilot+ PCs', sources: ['https://learn.microsoft.com/windows/client-management/manage-recall'] }),
  b.toggle('privacy.lockscreentips', 'Privacy', 'Tips and fun facts on the lock screen', 'Shows Microsoft content on the lock screen.', r(CDM, 'RotatingLockScreenOverlayEnabled'), ON, OFF, ON, {}),
  b.toggle('privacy.suggestions.settings', 'Privacy', 'Suggested content in Settings', 'Shows suggestions inside the Settings app.', r(CDM, 'SubscribedContent-338393Enabled'), ON, OFF, ON, {}),
  b.toggle('privacy.suggestions.tips', 'Privacy', 'Tips and suggestions while using Windows', 'Pop-up tips about Windows features.', r(CDM, 'SubscribedContent-338389Enabled'), ON, OFF, ON, {}),
  b.toggle('privacy.suggestions.start', 'Privacy', 'Suggested apps in Start', 'Shows app suggestions in Start.', r(CDM, 'SystemPaneSuggestionsEnabled'), ON, OFF, ON, {}),
  b.toggle('privacy.silentinstall', 'Privacy', 'Install suggested apps silently', 'Lets Windows install promoted apps automatically.', r(CDM, 'SilentInstalledAppsEnabled'), ON, OFF, ON, {}),
  b.toggle('privacy.welcome', 'Privacy', '"Finish setting up" screen after updates', 'Shows the Windows welcome experience after updates.', r(CDM, 'SubscribedContent-310093Enabled'), ON, OFF, ON, {}),
  b.toggle('privacy.location', 'Privacy', 'Location services', 'Lets Windows and apps find your location (for everyone on this PC).', lm('SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\location', 'Value', 'REG_SZ'), 'Allow', 'Deny', 'Allow', ADMIN),
  b.toggle('privacy.bingstart', 'Privacy', 'Bing in Start (Windows 10)', 'Turn off so Start searches only this PC.', r(SEARCH, 'BingSearchEnabled'), ON, OFF, ON, { versions: 'Windows 10', sources: ['https://www.pureinfotech.com/disable-bing-search-windows-10/'] }),
  b.toggle('privacy.cortana', 'Privacy', 'Cortana consent', 'Lets Cortana use your data.', r(SEARCH, 'CortanaConsent'), ON, OFF, OFF, { versions: 'Windows 10' }),

  // ── Security & network
  b.toggle('security.rdp', 'Security', 'Remote Desktop', 'Lets other computers connect to this PC with Remote Desktop.', lm('SYSTEM\\CurrentControlSet\\Control\\Terminal Server', 'fDenyTSConnections'), OFF, ON, ON, { ...ADMIN, risk: 'high', warning: 'Only turn this on with a strong password and the firewall restricting who can connect.', keywords: ['rdp', '3389'] }),
  b.toggle('security.rdpnla', 'Security', 'Require Network Level Authentication for Remote Desktop', 'People must sign in before a remote session starts. Keep on.', lm('SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp', 'UserAuthentication'), ON, OFF, ON, { ...ADMIN, risk: 'high', warning: 'Without it, anyone who can reach the PC sees the Windows sign-in screen remotely.' }),
  b.toggle('security.uac', 'Security', 'User Account Control', 'Asks before apps make system changes. Keep on.', lm('SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 'EnableLUA'), ON, OFF, ON, { ...ADMIN, after: 'restart', risk: 'high', warning: 'Turning UAC off lets every program act as administrator.' }),
  b.choice('security.uacprompt', 'Security', 'UAC prompt for administrators', 'How Windows asks administrators to approve changes.', lm('SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 'ConsentPromptBehaviorAdmin'), [c('2', 'Always ask (secure desktop)'), c('5', 'Ask for non-Windows apps (default)'), c('0', 'Never ask')], '5', { ...ADMIN, risk: 'high' }),
  b.toggle('security.autorun', 'Security', 'AutoPlay for drives', 'Turn off so plugged-in drives never run or open anything automatically.', r('Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\AutoplayHandlers', 'DisableAutoplay'), OFF, ON, OFF, {}),
  b.toggle('security.smb1', 'Network', 'SMB 1.0 file sharing', 'The old, insecure version of Windows file sharing. Keep off unless an old device needs it.', feat('SMB1Protocol'), 'on', 'off', 'off', { ...ADMIN, sources: ['https://learn.microsoft.com/windows-server/storage/file-server/troubleshoot/detect-enable-and-disable-smbv1-v2-v3'], after: 'restart', risk: 'high', warning: 'SMB1 was used by WannaCry; turning it on weakens security.' }),
  b.toggle('network.llmnr', 'Network', 'LLMNR name resolution', 'Turn off a legacy name lookup that attackers can abuse on shared networks.', lm('SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient', 'EnableMulticast'), ON, OFF, ON, { ...ADMIN, ...POL, risk: 'medium' }),
  b.choice('network.deliveryopt', 'Network', 'Delivery Optimisation', 'Whether Windows shares update downloads with other PCs.', lm('SOFTWARE\\Policies\\Microsoft\\Windows\\DeliveryOptimization', 'DODownloadMode'), [c('0', 'This PC only (HTTP)'), c('1', 'PCs on my local network'), c('3', 'PCs on my network and the internet'), c('99', 'Off (simple download)')], '1', { ...ADMIN, ...POL }),
  b.toggle('network.throttling', 'Network', 'Network throttling for media', 'Windows limits network work while media plays. Turn off for lower latency in games.', lm('SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile', 'NetworkThrottlingIndex'), '10', '4294967295', '10', { ...ADMIN, after: 'restart' }),
  b.choice('dev.psexec', 'Developer', 'PowerShell script policy (you)', 'Whether PowerShell runs scripts for your account.', r('Software\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell', 'ExecutionPolicy', 'HKCU', 'REG_SZ'), [c('Restricted', 'Restricted'), c('RemoteSigned', 'RemoteSigned'), c('AllSigned', 'AllSigned'), c(UNSET, 'Not set')], UNSET, { ...POL, risk: 'medium', sources: ['https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_execution_policies'] }),
  b.toggle('dev.devmode', 'Developer', 'Developer Mode', 'Lets you install apps from any source and use developer features.', lm('SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock', 'AllowDevelopmentWithoutDevLicense'), ON, OFF, OFF, { ...ADMIN, risk: 'medium' }),
  b.choice('dev.sudo', 'Developer', 'sudo for Windows', 'Lets you run elevated commands from a normal terminal.', lm('SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Sudo', 'Enabled'), [c('0', 'Off'), c('1', 'In a new window'), c('2', 'With input disabled'), c('3', 'Inline')], '0', { ...ADMIN, versions: 'Windows 11 24H2+', risk: 'medium', sources: ['https://learn.microsoft.com/windows/sudo/'] }),
  feature('wsl', 'Microsoft-Windows-Subsystem-Linux', 'Windows Subsystem for Linux', 'Run Linux tools and distributions on Windows.', { keywords: ['wsl', 'linux'] }),
  feature('vmp', 'VirtualMachinePlatform', 'Virtual Machine Platform', 'Needed by WSL 2 and some emulators.'),
  feature('hyperv', 'Microsoft-Hyper-V-All', 'Hyper-V', 'Microsoft\'s virtual machine software (Pro, Enterprise and Education).'),
  feature('sandbox', 'Containers-DisposableClientVM', 'Windows Sandbox', 'A throwaway desktop for trying untrusted apps (Pro and above).'),
  feature('telnet', 'TelnetClient', 'Telnet client', 'The telnet command for testing ports.'),
  feature('netfx3', 'NetFx3', '.NET Framework 3.5', 'Needed by some older apps.'),
  feature('nfs', 'ServicesForNFS-ClientOnly', 'NFS client', 'Connect to NFS shares from Linux or NAS boxes.'),
  feature('tftp', 'TFTP', 'TFTP client', 'For flashing routers and network devices.'),

  // ── Power
  b.toggle('power.hibernate', 'Power & sleep', 'Hibernation', 'Saves your session to disk so the PC can power off completely. Turning it off frees disk space (hiberfil.sys) and removes Fast Startup.', { t: 'powercfg', what: 'hibernate' }, 'on', 'off', 'on', { ...ADMIN, sources: POWER }),
  b.toggle('power.faststartup', 'Power & sleep', 'Fast Startup', 'Shuts down to a hibernated state for a faster start. Turn off if dual-booting or when drivers misbehave after shutdown.', lm('SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power', 'HiberbootEnabled'), ON, OFF, ON, { ...ADMIN, sources: POWER, keywords: ['dual boot'] }),
  b.number('power.monitor.ac', 'Power & sleep', 'Turn off the screen after (plugged in)', 'Minutes. 0 means never.', { t: 'powercfg', what: 'monitor-timeout-ac' }, 0, 300, '10', { unit: 'minutes', sources: POWER }),
  b.number('power.monitor.dc', 'Power & sleep', 'Turn off the screen after (on battery)', 'Minutes. 0 means never.', { t: 'powercfg', what: 'monitor-timeout-dc' }, 0, 300, '5', { unit: 'minutes', sources: POWER }),
  b.number('power.sleep.ac', 'Power & sleep', 'Sleep after (plugged in)', 'Minutes. 0 means never.', { t: 'powercfg', what: 'standby-timeout-ac' }, 0, 300, '30', { unit: 'minutes', sources: POWER }),
  b.number('power.sleep.dc', 'Power & sleep', 'Sleep after (on battery)', 'Minutes. 0 means never.', { t: 'powercfg', what: 'standby-timeout-dc' }, 0, 300, '15', { unit: 'minutes', sources: POWER }),
  b.toggle('power.usbsuspend', 'Power & sleep', 'USB selective suspend', 'Turns idle USB devices off to save power. Turn off if devices drop out.', lm('SYSTEM\\CurrentControlSet\\Services\\USB', 'DisableSelectiveSuspend'), OFF, ON, OFF, { ...ADMIN, ...POL, after: 'restart' }),

  // ── Updates
  b.toggle('updates.auto', 'Updates', 'Automatic updates', 'Windows downloads and installs updates by itself. Turning this off (policy) means you must update by hand.', lm(WU, 'NoAutoUpdate'), OFF, ON, OFF, { ...ADMIN, ...POL, risk: 'high', warning: 'You will miss security fixes unless you update manually.', sources: ['https://learn.microsoft.com/windows/deployment/update/waas-wu-settings'] }),
  b.toggle('updates.restart', 'Updates', 'Restart automatically while signed in', 'Turn off so Windows never restarts for updates while you are signed in.', lm(WU, 'NoAutoRebootWithLoggedOnUsers'), OFF, ON, OFF, { ...ADMIN, ...POL, sources: ['https://learn.microsoft.com/windows/deployment/update/waas-wu-settings'] }),
  b.toggle('updates.drivers', 'Updates', 'Include driver updates', 'Turn off so Windows Update does not replace drivers you installed yourself.', lm('SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate', 'ExcludeWUDriversInQualityUpdate'), OFF, ON, OFF, { ...ADMIN, ...POL }),
  b.toggle('updates.msproducts', 'Updates', 'Updates for other Microsoft products', 'Office and other Microsoft apps update through Windows Update.', lm('SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings', 'AllowMUUpdateService'), ON, OFF, OFF, ADMIN),
  b.toggle('updates.storeauto', 'Updates', 'Microsoft Store updates apps automatically', 'Policy: 2 turns automatic Store updates off.', lm('SOFTWARE\\Policies\\Microsoft\\WindowsStore', 'AutoDownload'), '4', '2', '4', { ...ADMIN, ...POL }),

  // ── Storage
  b.toggle('storage.sense', 'Storage', 'Storage Sense', 'Frees space automatically by emptying the Recycle Bin and temporary files.', r('Software\\Microsoft\\Windows\\CurrentVersion\\StorageSense\\Parameters\\StoragePolicy', '01'), ON, OFF, OFF, {}),
  b.toggle('storage.reserved', 'Storage', 'Reserved storage for updates', 'Windows keeps about 7 GB free for updates.', lm('SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ReserveManager', 'ShippedWithReserves'), ON, OFF, ON, { ...ADMIN, after: 'restart' }),

  // ── Time & language
  b.toggle('time.utc', 'Time & language', 'Hardware clock in UTC', 'Turn on when dual-booting with Linux so both agree on the time.', lm('SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation', 'RealTimeIsUniversal'), ON, OFF, OFF, { ...ADMIN, ...POL, after: 'restart', keywords: ['dual boot', 'clock'] }),
  b.choice('time.firstday', 'Time & language', 'First day of the week', 'Which day calendars start on.', r('Control Panel\\International', 'iFirstDayOfWeek', 'HKCU', 'REG_SZ'), [c('0', 'Monday'), c('6', 'Sunday'), c('5', 'Saturday')], '0', { after: 'logout' }),
  b.choice('time.clock24', 'Time & language', 'Time format', 'The time format used by Windows.', r('Control Panel\\International', 'sShortTime', 'HKCU', 'REG_SZ'), [c('HH:mm', '24-hour'), c('h:mm tt', '12-hour')], 'HH:mm', { after: 'logout' }),

  // ── Services
  service('diagtrack', 'DiagTrack', 'Connected User Experiences and Telemetry', 'Sends diagnostic data to Microsoft.', 'auto', { risk: 'low' }),
  service('dmwappush', 'dmwappushservice', 'Device management push messages', 'Used by telemetry and mobile device management.', 'demand', { risk: 'low' }),
  service('sysmain', 'SysMain', 'SysMain (Superfetch)', 'Preloads apps into memory. Turning it off can help on PCs with slow disks.', 'auto'),
  service('wsearch', 'WSearch', 'Windows Search indexer', 'Indexes files for fast search. Turning it off makes Start and Outlook search slower.', 'auto'),
  service('spooler', 'Spooler', 'Print Spooler', 'Needed to print. Turn off on PCs that never print (it has had security flaws).', 'auto'),
  service('remoteregistry', 'RemoteRegistry', 'Remote Registry', 'Lets other computers edit this PC\'s registry. Should stay disabled.', 'disabled', { risk: 'high' }),
  service('xblauth', 'XblAuthManager', 'Xbox Live sign-in', 'Needed for Xbox and Game Pass apps.', 'demand', { risk: 'low' }),
  service('fax', 'Fax', 'Fax', 'Sending and receiving faxes.', 'demand', { risk: 'low' }),
  service('maps', 'MapsBroker', 'Downloaded Maps Manager', 'Keeps offline maps updated.', 'auto', { risk: 'low' }),
  service('wer', 'WerSvc', 'Windows Error Reporting', 'Sends crash reports to Microsoft.', 'demand', { risk: 'low' }),
  service('geolocation', 'lfsvc', 'Geolocation', 'Supplies location to apps.', 'demand', { risk: 'low' }),
  service('bluetooth', 'bthserv', 'Bluetooth Support', 'Needed for Bluetooth devices.', 'demand'),
  service('wmp', 'WMPNetworkSvc', 'Windows Media Player sharing', 'Shares your media library on the network.', 'demand', { risk: 'low' }),
  service('ssh', 'sshd', 'OpenSSH Server', 'Accepts SSH connections (if installed).', 'demand', { risk: 'high' }),
  service('rdp', 'TermService', 'Remote Desktop Services', 'Accepts Remote Desktop connections.', 'demand', { risk: 'high' }),

  // ── Advice
  b.advice('network.hosts', 'Network', 'Hosts file', 'Maps names to addresses before DNS is asked. Keeper\'s DNS filter is usually a better way to block sites.', { t: 'advice', read: { file: 'cmd', args: ['/c', 'type', '%SystemRoot%\\System32\\drivers\\etc\\hosts'] } }, [
    'Open Notepad as administrator.',
    'Open C:\\Windows\\System32\\drivers\\etc\\hosts (choose "All files").',
    'Add a line such as: 0.0.0.0 example.com — then save and run ipconfig /flushdns.',
  ], { sources: ['https://learn.microsoft.com/troubleshoot/windows-server/networking/reset-hosts-file'] }),
  b.advice('dev.winget', 'Developer', 'Install apps from the command line', 'winget installs and updates apps (Keeper\'s Applications page uses it where available).', { t: 'advice', read: { file: 'winget', args: ['--version'] } }, ['Keeper ▸ Applications ▸ Updates lists apps winget can update.', 'Or: winget upgrade --all'], { sources: ['https://learn.microsoft.com/windows/package-manager/winget/'] }),
  b.advice('storage.compact', 'Storage', 'Compact OS', 'Compresses Windows system files to save several GB on small disks.', { t: 'advice' }, ['Run as administrator: compact.exe /compactos:query', 'Turn on: compact.exe /compactos:always'], { sources: ['https://learn.microsoft.com/windows-server/administration/windows-commands/compact'] }),
  b.advice('security.rdpfirewall', 'Security', 'Remote Desktop firewall rule', 'Remote Desktop also needs the "Remote Desktop" firewall rule. Keeper Remote Desktops → This computer turns both on together, with Network Level Authentication. Windows Home cannot host Remote Desktop.', { t: 'advice', read: { file: 'netsh', args: ['advfirewall', 'firewall', 'show', 'rule', 'name=Remote Desktop - User Mode (TCP-In)'] } }, [
    'Settings → System → Remote Desktop → turn it on (Pro, Enterprise or Education).',
    'Or as administrator: Enable-NetFirewallRule -Group "@FirewallAPI.dll,-28752"',
    'Keep it off the internet: reach it through a VPN or Keeper Link instead of forwarding port 3389 on your router.',
  ], { sources: ['https://learn.microsoft.com/windows-server/remote/remote-desktop-services/clients/remote-desktop-allow-access'], risk: 'high', keywords: ['rdp', '3389', 'firewall', 'remote desktop'] }),
];
