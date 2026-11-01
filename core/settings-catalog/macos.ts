// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// macOS settings: `defaults` keys, `pmset`, Spotlight indexing and Gatekeeper.
// Most `defaults` entries restore by deleting Keeper's value, so macOS falls
// back to its own default.

import { builder, c, UNSET } from './build';
import type { Op, SettingDef, ValueType } from './types';

const DEFAULTS = ['https://ss64.com/mac/defaults.html', 'https://macos-defaults.com/'];
const PMSET = ['https://ss64.com/mac/pmset.html'];
const b = builder('darwin', 'mac', { sources: DEFAULTS });
const d = (domain: string, key: string, type: ValueType = 'bool', more: Partial<Extract<Op, { t: 'defaults' }>> = {}): Op => ({ t: 'defaults', domain, key, type, ...more });
const pm = (key: string): Op => ({ t: 'pmset', key });
const RM = { removeToRestore: true } as const;
const FINDER = { ...RM, after: 'relaunch-finder' } as const;
const DOCK = { ...RM, after: 'relaunch-dock' } as const;
const MENU = { ...RM, after: 'relaunch-menubar' } as const;
const APP = { ...RM, after: 'relaunch-app' } as const;
const G = 'NSGlobalDomain';
const F = 'com.apple.finder';
const DK = 'com.apple.dock';
const SC = 'com.apple.screencapture';
const T = 'true';
const N = 'false';

const corner = (where: string, label: string): SettingDef =>
  b.choice(`dock.hotcorner.${where}`, 'Dock & desktop', `Hot corner: ${label}`, `What happens when the pointer goes into the ${label.toLowerCase()} corner of the screen.`, d(DK, `wvous-${where}-corner`, 'int'), [
    c('1', 'Nothing'), c('2', 'Mission Control'), c('3', 'Application windows'), c('4', 'Desktop'), c('5', 'Start screen saver'), c('6', 'Disable screen saver'),
    c('10', 'Put display to sleep'), c('11', 'Launchpad'), c('12', 'Notification Center'), c('13', 'Lock screen'), c('14', 'Quick Note'),
  ], '1', { ...DOCK, keywords: ['hot corners', 'screen corner'] });

export const MACOS: SettingDef[] = [
  // ── Finder & files
  b.toggle('finder.hidden', 'Finder & files', 'Show hidden files', 'Shows files and folders whose names start with a dot (and other hidden items) in Finder. Cmd-Shift-. does the same for one window.', d(F, 'AppleShowAllFiles'), T, N, N, { ...FINDER, keywords: ['dotfiles', 'invisible'] }),
  b.toggle('finder.extensions', 'Finder & files', 'Show all file extensions', 'Always shows the part after the dot (.pdf, .app) so you can see what a file really is.', d(G, 'AppleShowAllExtensions'), T, N, N, { ...FINDER, keywords: ['file type', 'suffix'] }),
  b.toggle('finder.pathbar', 'Finder & files', 'Show the path bar', 'Shows where the current folder lives at the bottom of each Finder window.', d(F, 'ShowPathbar'), T, N, N, FINDER),
  b.toggle('finder.statusbar', 'Finder & files', 'Show the status bar', 'Shows the item count and free space at the bottom of Finder windows.', d(F, 'ShowStatusBar'), T, N, N, FINDER),
  b.toggle('finder.posixtitle', 'Finder & files', 'Full path in window title', 'Shows the complete folder path (like /Users/you/Documents) in the Finder title bar.', d(F, '_FXShowPosixPathInTitle'), T, N, N, FINDER),
  b.toggle('finder.extwarning', 'Finder & files', 'Warn when changing an extension', 'Asks before you rename report.pdf to report.txt.', d(F, 'FXEnableExtensionChangeWarning'), T, N, T, FINDER),
  b.choice('finder.searchscope', 'Finder & files', 'Where Finder searches', 'The place a search in a Finder window looks first.', d(F, 'FXDefaultSearchScope', 'string'), [c('SCev', 'This Mac'), c('SCcf', 'The current folder'), c('SCsp', 'The previous search scope')], 'SCev', FINDER),
  b.choice('finder.view', 'Finder & files', 'Default view', 'How new Finder windows show their contents.', d(F, 'FXPreferredViewStyle', 'string'), [c('icnv', 'Icons'), c('Nlsv', 'List'), c('clmv', 'Columns'), c('glyv', 'Gallery')], 'icnv', FINDER),
  b.toggle('finder.foldersfirst', 'Finder & files', 'Folders on top', 'Keeps folders above files when sorting by name.', d(F, '_FXSortFoldersFirst'), T, N, N, FINDER),
  b.toggle('finder.foldersfirst.desktop', 'Finder & files', 'Folders on top on the desktop', 'Keeps folders above files on the desktop.', d(F, '_FXSortFoldersFirstOnDesktop'), T, N, N, { ...FINDER, versions: 'macOS 13+' }),
  b.toggle('finder.desktop.hdd', 'Dock & desktop', 'Show internal disks on the desktop', 'Puts an icon for each internal disk on the desktop.', d(F, 'ShowHardDrivesOnDesktop'), T, N, N, FINDER),
  b.toggle('finder.desktop.external', 'Dock & desktop', 'Show external disks on the desktop', 'Puts an icon for each plugged-in drive on the desktop.', d(F, 'ShowExternalHardDrivesOnDesktop'), T, N, T, FINDER),
  b.toggle('finder.desktop.removable', 'Dock & desktop', 'Show CDs, DVDs and iPods on the desktop', 'Puts an icon for removable media on the desktop.', d(F, 'ShowRemovableMediaOnDesktop'), T, N, T, FINDER),
  b.toggle('finder.desktop.servers', 'Dock & desktop', 'Show connected servers on the desktop', 'Puts an icon for each mounted network share on the desktop.', d(F, 'ShowMountedServersOnDesktop'), T, N, N, FINDER),
  b.toggle('finder.desktop.icons', 'Dock & desktop', 'Show desktop icons', 'Turn off for a clean desktop (files stay in the Desktop folder).', d(F, 'CreateDesktop'), T, N, T, { ...FINDER, keywords: ['clean desktop', 'presentation'] }),
  b.toggle('finder.quit', 'Finder & files', 'Allow quitting Finder', 'Adds Quit Finder (Cmd-Q) to the Finder menu.', d(F, 'QuitMenuItem'), T, N, N, FINDER),
  b.toggle('finder.trash.30days', 'Finder & files', 'Empty the Bin after 30 days', 'Removes items that have been in the Bin for 30 days.', d(F, 'FXRemoveOldTrashItems'), T, N, N, FINDER),
  b.toggle('finder.trash.warn', 'Finder & files', 'Warn before emptying the Bin', 'Asks before the Bin is emptied.', d(F, 'WarnOnEmptyTrash'), T, N, T, FINDER),
  b.choice('finder.newwindow', 'Finder & files', 'New windows open', 'The folder a new Finder window starts in.', d(F, 'NewWindowTarget', 'string'), [c('PfHm', 'Home'), c('PfDe', 'Desktop'), c('PfDo', 'Documents'), c('PfAF', 'Recents'), c('PfCm', 'Computer')], 'PfAF', FINDER),
  b.toggle('finder.animations', 'Finder & files', 'Finder animations', 'Turn off to make Finder windows and Get Info open instantly.', d(F, 'DisableAllAnimations'), N, T, N, { ...FINDER, keywords: ['speed', 'faster'] }),
  b.toggle('finder.springload', 'Finder & files', 'Spring-loaded folders', 'Folders open when you hold a dragged item over them.', d(G, 'com.apple.springing.enabled'), T, N, T, RM),
  b.number('finder.springload.delay', 'Finder & files', 'Spring-loaded folder delay', 'How long to hover before a folder opens while dragging.', d(G, 'com.apple.springing.delay', 'float'), 0, 2, '0.5', { ...RM, unit: 'seconds' }),
  b.toggle('files.dsstore.network', 'Finder & files', 'Write .DS_Store files on network shares', 'Turn off so Finder stops leaving .DS_Store files on shared drives.', d('com.apple.desktopservices', 'DSDontWriteNetworkStores'), N, T, N, { ...RM, after: 'logout', keywords: ['ds_store', 'smb'] }),
  b.toggle('files.dsstore.usb', 'Finder & files', 'Write .DS_Store files on USB drives', 'Turn off so Finder stops leaving .DS_Store files on USB sticks.', d('com.apple.desktopservices', 'DSDontWriteUSBStores'), N, T, N, { ...RM, after: 'logout', keywords: ['ds_store'] }),
  b.toggle('files.icloud.save', 'Finder & files', 'Save new documents to iCloud', 'When off, new documents are saved on this Mac by default instead of iCloud Drive.', d(G, 'NSDocumentSaveNewDocumentsToCloud'), T, N, T, { ...APP, keywords: ['icloud drive'] }),
  b.toggle('files.savepanel', 'Finder & files', 'Expanded save dialogs', 'Opens Save dialogs with the full folder browser showing.', d(G, 'NSNavPanelExpandedStateForSaveMode'), T, N, N, APP),
  b.toggle('files.printpanel', 'Finder & files', 'Expanded print dialogs', 'Opens Print dialogs with all options showing.', d(G, 'PMPrintingExpandedStateForPrint'), T, N, N, APP),
  b.toggle('files.quarantine', 'Security', 'Ask before opening downloaded apps', 'The "are you sure you want to open it?" prompt for downloaded files. Leave it on unless you know why.', d('com.apple.LaunchServices', 'LSQuarantine'), T, N, T, { ...RM, after: 'logout', risk: 'high', warning: 'Turning this off removes a protection against malicious downloads.' }),
  b.toggle('files.textedit.plain', 'Finder & files', 'TextEdit starts in plain text', 'New TextEdit documents are plain text rather than rich text.', d('com.apple.TextEdit', 'RichText', 'int'), '0', '1', '1', APP),
  b.toggle('files.timemachine.offer', 'Storage', 'Offer new disks for Time Machine', 'Turn off to stop the "use this disk for backups?" prompt when you plug in a drive.', d('com.apple.TimeMachine', 'DoNotOfferNewDisksForBackup'), N, T, N, RM),
  b.toggle('files.imagecapture.hotplug', 'Finder & files', 'Open Photos when a phone is connected', 'Turn off to stop Photos opening every time you plug in a phone or camera.', d('com.apple.ImageCapture', 'disableHotPlug', 'bool', { currentHost: true }), N, T, N, RM),

  // ── Dock & desktop
  b.toggle('dock.autohide', 'Dock & desktop', 'Hide the Dock automatically', 'The Dock slides away until you move the pointer to the screen edge.', d(DK, 'autohide'), T, N, N, DOCK),
  b.number('dock.autohide.delay', 'Dock & desktop', 'Dock reveal delay', 'How long before a hidden Dock appears. 0 makes it instant.', d(DK, 'autohide-delay', 'float'), 0, 3, '0.5', { ...DOCK, unit: 'seconds' }),
  b.number('dock.autohide.speed', 'Dock & desktop', 'Dock slide speed', 'How long the hide and show animation takes. 0 removes it.', d(DK, 'autohide-time-modifier', 'float'), 0, 3, '1', { ...DOCK, unit: 'seconds' }),
  b.number('dock.size', 'Dock & desktop', 'Dock icon size', 'Size of Dock icons in points.', d(DK, 'tilesize', 'int'), 16, 128, '48', { ...DOCK, unit: 'points' }),
  b.toggle('dock.magnification', 'Dock & desktop', 'Magnify Dock icons', 'Icons grow as the pointer passes over them.', d(DK, 'magnification'), T, N, N, DOCK),
  b.number('dock.magnification.size', 'Dock & desktop', 'Magnified icon size', 'How large icons grow when magnified.', d(DK, 'largesize', 'int'), 16, 128, '128', { ...DOCK, unit: 'points' }),
  b.choice('dock.position', 'Dock & desktop', 'Dock position', 'Which edge of the screen the Dock sits on.', d(DK, 'orientation', 'string'), [c('bottom', 'Bottom'), c('left', 'Left'), c('right', 'Right')], 'bottom', DOCK),
  b.choice('dock.minimize.effect', 'Dock & desktop', 'Minimise effect', 'The animation used when a window is minimised.', d(DK, 'mineffect', 'string'), [c('genie', 'Genie'), c('scale', 'Scale'), c('suck', 'Suck (hidden option)')], 'genie', DOCK),
  b.toggle('dock.minimize.toapp', 'Dock & desktop', 'Minimise windows into the app icon', 'Minimised windows go into their app\'s Dock icon instead of the right side of the Dock.', d(DK, 'minimize-to-application'), T, N, N, DOCK),
  b.toggle('dock.recents', 'Dock & desktop', 'Show recent apps in the Dock', 'Shows recently used apps that are not kept in the Dock.', d(DK, 'show-recents'), T, N, T, DOCK),
  b.toggle('dock.staticonly', 'Dock & desktop', 'Only show open apps in the Dock', 'Hides kept apps that are not running.', d(DK, 'static-only'), T, N, N, DOCK),
  b.toggle('dock.launchanim', 'Dock & desktop', 'Bounce apps when they open', 'The opening animation for apps launched from the Dock.', d(DK, 'launchanim'), T, N, T, DOCK),
  b.toggle('dock.hiddendim', 'Dock & desktop', 'Dim hidden apps in the Dock', 'Hidden apps (Cmd-H) show as see-through icons.', d(DK, 'showhidden'), T, N, N, DOCK),
  b.toggle('dock.indicators', 'Dock & desktop', 'Show dots under open apps', 'The small dot under each running app.', d(DK, 'show-process-indicators'), T, N, T, DOCK),
  b.toggle('dock.scrollopen', 'Dock & desktop', 'Scroll on a Dock icon to show its windows', 'Scrolling up on an icon shows all of that app\'s windows.', d(DK, 'scroll-to-open'), T, N, N, DOCK),
  b.toggle('dock.mru', 'Windows & spaces', 'Rearrange Spaces by most recent use', 'Turn off to keep desktops (Spaces) in a fixed order.', d(DK, 'mru-spaces'), T, N, T, DOCK),
  b.toggle('dock.groupapps', 'Windows & spaces', 'Group windows by app in Mission Control', 'Mission Control groups windows from the same app.', d(DK, 'expose-group-apps'), T, N, N, DOCK),
  b.toggle('dock.spaces.displays', 'Windows & spaces', 'Separate Spaces for each display', 'Each display gets its own desktops. Turn off to span one desktop across displays.', d('com.apple.spaces', 'spans-displays'), N, T, N, { ...RM, after: 'logout' }),
  corner('tl', 'Top left'),
  corner('tr', 'Top right'),
  corner('bl', 'Bottom left'),
  corner('br', 'Bottom right'),
  b.toggle('desktop.clickshow', 'Dock & desktop', 'Click the wallpaper to show the desktop', 'Clicking the wallpaper moves all windows aside (macOS Sonoma and later).', d('com.apple.WindowManager', 'EnableStandardClickToShowDesktop'), T, N, T, { ...RM, versions: 'macOS 14+' }),
  b.toggle('desktop.stagemanager', 'Windows & spaces', 'Stage Manager', 'Arranges open apps into a strip at the side of the screen.', d('com.apple.WindowManager', 'GloballyEnabled'), T, N, N, { ...RM, versions: 'macOS 13+' }),
  b.toggle('windows.tile.margins', 'Windows & spaces', 'Gaps between tiled windows', 'Leaves space around windows tiled to the screen edges.', d('com.apple.WindowManager', 'EnableTiledWindowMargins'), T, N, T, { ...RM, versions: 'macOS 15+' }),
  b.toggle('windows.tile.drag', 'Windows & spaces', 'Tile windows by dragging to an edge', 'Dragging a window to a screen edge tiles it.', d('com.apple.WindowManager', 'EnableTilingByEdgeDrag'), T, N, T, { ...RM, versions: 'macOS 15+' }),
  b.toggle('windows.spaces.switch', 'Windows & spaces', 'Switch to the Space with an app\'s windows', 'Switching to an app jumps to the desktop where its windows are.', d(G, 'AppleSpacesSwitchOnActivate'), T, N, T, RM),
  b.toggle('windows.animations', 'Windows & spaces', 'Window opening animations', 'Turn off for windows that appear instantly.', d(G, 'NSAutomaticWindowAnimationsEnabled'), T, N, T, { ...APP, keywords: ['faster'] }),
  b.number('windows.resizetime', 'Windows & spaces', 'Window resize animation time', 'How long sheets and resize animations take. 0.001 makes them almost instant.', d(G, 'NSWindowResizeTime', 'float'), 0.001, 1, '0.2', { ...APP, unit: 'seconds' }),
  b.choice('windows.doubleclick', 'Windows & spaces', 'Double-click a title bar to', 'What double-clicking a window\'s title bar does.', d(G, 'AppleActionOnDoubleClick', 'string'), [c('Maximize', 'Zoom'), c('Fill', 'Fill the screen'), c('Minimize', 'Minimise'), c('None', 'Nothing')], 'Maximize', APP),
  b.toggle('windows.restore', 'Windows & spaces', 'Reopen windows when apps reopen', 'Apps bring back the windows that were open when they quit.', d(G, 'NSQuitAlwaysKeepsWindows'), T, N, N, APP),
  b.toggle('windows.closeconfirm', 'Windows & spaces', 'Ask to keep changes when closing documents', 'Turn on to be asked before unsaved changes are kept automatically.', d(G, 'NSCloseAlwaysConfirmsChanges'), T, N, N, APP),

  // ── Screenshots
  b.text('shots.location', 'Screenshots', 'Screenshot folder', 'The folder new screenshots are saved to.', d(SC, 'location', 'string'), '~/Desktop', { ...MENU }),
  b.choice('shots.type', 'Screenshots', 'Screenshot format', 'The file type for screenshots.', d(SC, 'type', 'string'), [c('png', 'PNG'), c('jpg', 'JPEG'), c('heic', 'HEIC'), c('pdf', 'PDF'), c('tiff', 'TIFF')], 'png', MENU),
  b.toggle('shots.shadow', 'Screenshots', 'Window shadow in screenshots', 'Turn off to capture windows without the drop shadow.', d(SC, 'disable-shadow'), N, T, N, MENU),
  b.toggle('shots.thumbnail', 'Screenshots', 'Show the floating thumbnail', 'The preview in the corner after taking a screenshot (it delays saving by a few seconds).', d(SC, 'show-thumbnail'), T, N, T, MENU),
  b.toggle('shots.date', 'Screenshots', 'Include the date in file names', 'Screenshot file names include the date and time.', d(SC, 'include-date'), T, N, T, MENU),
  b.text('shots.name', 'Screenshots', 'Screenshot file name prefix', 'The word at the start of screenshot file names.', d(SC, 'name', 'string'), 'Screenshot', MENU),
  b.toggle('shots.clicks', 'Screenshots', 'Show mouse clicks in recordings', 'Screen recordings show a circle where you click.', d(SC, 'showsClicks'), T, N, N, MENU),

  // ── Keyboard & mouse
  b.toggle('kb.pressandhold', 'Keyboard & mouse', 'Hold a key for accents', 'Holding a letter shows accented characters. Turn off for key repeat instead (useful for coding and games).', d(G, 'ApplePressAndHoldEnabled'), T, N, T, { ...APP, keywords: ['key repeat', 'vim'] }),
  b.number('kb.repeat', 'Keyboard & mouse', 'Key repeat speed', 'Time between repeats when a key is held, in 15 ms steps. Lower is faster (2 is the fastest the settings app allows).', d(G, 'KeyRepeat', 'int'), 1, 120, '6', { ...RM, after: 'logout' }),
  b.number('kb.repeat.delay', 'Keyboard & mouse', 'Delay until key repeat', 'Time before a held key starts repeating, in 15 ms steps. Lower is sooner.', d(G, 'InitialKeyRepeat', 'int'), 10, 120, '25', { ...RM, after: 'logout' }),
  b.toggle('kb.autocorrect', 'Keyboard & mouse', 'Correct spelling automatically', 'Fixes misspelled words as you type.', d(G, 'NSAutomaticSpellingCorrectionEnabled'), T, N, T, APP),
  b.toggle('kb.autocaps', 'Keyboard & mouse', 'Capitalise words automatically', 'Starts sentences with a capital letter.', d(G, 'NSAutomaticCapitalizationEnabled'), T, N, T, APP),
  b.toggle('kb.period', 'Keyboard & mouse', 'Double space types a full stop', 'Typing two spaces adds a full stop.', d(G, 'NSAutomaticPeriodSubstitutionEnabled'), T, N, T, APP),
  b.toggle('kb.quotes', 'Keyboard & mouse', 'Smart quotes', 'Turns straight quotes into curly ones. Turn off when writing code.', d(G, 'NSAutomaticQuoteSubstitutionEnabled'), T, N, T, APP),
  b.toggle('kb.dashes', 'Keyboard & mouse', 'Smart dashes', 'Turns -- into an em dash.', d(G, 'NSAutomaticDashSubstitutionEnabled'), T, N, T, APP),
  b.choice('kb.fullaccess', 'Keyboard & mouse', 'Tab moves between', 'Whether Tab moves through all controls in dialogs or only text fields.', d(G, 'AppleKeyboardUIMode', 'int'), [c('0', 'Text fields and lists only'), c('2', 'All controls')], '0', APP),
  b.toggle('kb.fnkeys', 'Keyboard & mouse', 'Use F1, F2… as standard function keys', 'Top-row keys act as F1–F12; hold fn for brightness and volume.', d(G, 'com.apple.keyboard.fnState'), T, N, N, { ...RM, after: 'logout' }),
  b.toggle('mouse.natural', 'Keyboard & mouse', 'Natural scrolling', 'Content moves the way your fingers move. Turn off for traditional wheel scrolling.', d(G, 'com.apple.swipescrolldirection'), T, N, T, { ...RM, after: 'logout', keywords: ['scroll direction', 'reverse'] }),
  b.toggle('trackpad.tap', 'Keyboard & mouse', 'Tap to click', 'A light tap on the trackpad counts as a click.', d('com.apple.AppleMultitouchTrackpad', 'Clicking'), T, N, N, { ...RM, after: 'logout' }),
  b.toggle('trackpad.drag3', 'Keyboard & mouse', 'Three-finger drag', 'Drag windows and items with three fingers without pressing.', d('com.apple.AppleMultitouchTrackpad', 'TrackpadThreeFingerDrag'), T, N, N, { ...RM, after: 'logout' }),
  b.number('mouse.speed', 'Keyboard & mouse', 'Pointer speed (mouse)', 'How fast the pointer moves with a mouse. -1 turns acceleration off.', d(G, 'com.apple.mouse.scaling', 'float'), -1, 7, '1', { ...RM, after: 'logout' }),
  b.number('trackpad.speed', 'Keyboard & mouse', 'Pointer speed (trackpad)', 'How fast the pointer moves with the trackpad.', d(G, 'com.apple.trackpad.scaling', 'float'), 0, 7, '1', { ...RM, after: 'logout' }),
  b.toggle('kb.securekeyboard', 'Security', 'Secure keyboard entry in Terminal', 'Stops other apps reading what you type in Terminal.', d('com.apple.Terminal', 'SecureKeyboardEntry'), T, N, N, APP),

  // ── Menu bar
  b.toggle('menubar.autohide', 'Menu bar & taskbar', 'Hide the menu bar automatically', 'The menu bar appears only when you move the pointer to the top.', d(G, '_HIHideMenuBar'), T, N, N, { ...RM, after: 'logout' }),
  b.toggle('menubar.seconds', 'Menu bar & taskbar', 'Show seconds in the clock', 'The menu-bar clock includes seconds.', d('com.apple.menuextra.clock', 'ShowSeconds'), T, N, N, MENU),
  b.choice('menubar.dayofweek', 'Menu bar & taskbar', 'Show the day of the week', 'Whether the clock shows the weekday.', d('com.apple.menuextra.clock', 'ShowDayOfWeek'), [c(T, 'Show'), c(N, 'Hide')], T, MENU),
  b.choice('menubar.date', 'Menu bar & taskbar', 'Show the date', 'Whether the clock shows the date.', d('com.apple.menuextra.clock', 'ShowDate', 'int'), [c('0', 'When space allows'), c('1', 'Always'), c('2', 'Never')], '0', MENU),
  b.toggle('menubar.flash', 'Menu bar & taskbar', 'Flash the time separators', 'The colons in the clock blink every second.', d('com.apple.menuextra.clock', 'FlashDateSeparators'), T, N, N, MENU),
  b.toggle('menubar.battery', 'Menu bar & taskbar', 'Battery percentage in the menu bar', 'Shows the charge as a number next to the battery icon.', d('com.apple.controlcenter', 'BatteryShowPercentage', 'bool', { currentHost: true }), T, N, N, MENU),
  b.choice('appearance.scrollbars', 'Appearance', 'Show scroll bars', 'When scroll bars are visible.', d(G, 'AppleShowScrollBars', 'string'), [c('Automatic', 'Based on mouse or trackpad'), c('WhenScrolling', 'When scrolling'), c('Always', 'Always')], 'Automatic', APP),
  b.choice('appearance.mode', 'Appearance', 'Dark mode', 'Light or dark menus and windows. Removing the value means light.', d(G, 'AppleInterfaceStyle', 'string'), [c('Dark', 'Dark'), c(UNSET, 'Light')], UNSET, { ...RM, after: 'logout' }),
  b.toggle('appearance.reducetransparency', 'Appearance', 'Reduce transparency', 'Makes menus and sidebars solid. Can save battery on older Macs.', d('com.apple.universalaccess', 'reduceTransparency'), T, N, N, { ...RM, after: 'logout', warning: 'macOS may ask Keeper for Full Disk Access to change accessibility settings.' }),
  b.toggle('appearance.reducemotion', 'Appearance', 'Reduce motion', 'Replaces sliding and zooming with fades.', d('com.apple.universalaccess', 'reduceMotion'), T, N, N, { ...RM, after: 'logout', warning: 'macOS may ask Keeper for Full Disk Access to change accessibility settings.' }),
  b.choice('appearance.sidebar', 'Appearance', 'Sidebar icon size', 'Size of icons in Finder and app sidebars.', d(G, 'NSTableViewDefaultSizeMode', 'int'), [c('1', 'Small'), c('2', 'Medium'), c('3', 'Large')], '2', APP),
  b.toggle('appearance.fontsmoothing', 'Appearance', 'Font smoothing', 'Thicker text on non-Retina displays. Turn off if text looks blurry.', d(G, 'AppleFontSmoothing', 'int'), '1', '0', '1', { ...RM, after: 'logout' }),

  // ── Browser (Safari's preferences live in a protected container)
  b.toggle('safari.develop', 'Browser', 'Safari Develop menu', 'Adds the Develop menu with Web Inspector.', d('com.apple.Safari', 'IncludeDevelopMenu'), T, N, N, { ...APP, warning: 'Safari keeps its preferences in a protected place: give Keeper Full Disk Access, or change it in Safari ▸ Settings ▸ Advanced.' }),
  b.toggle('safari.fullurl', 'Browser', 'Safari shows full web addresses', 'Shows the whole address instead of just the site name.', d('com.apple.Safari', 'ShowFullURLInSmartSearchField'), T, N, N, { ...APP, warning: 'Needs Full Disk Access for Keeper, or change it in Safari ▸ Settings ▸ Advanced.' }),
  b.toggle('safari.safedownloads', 'Browser', 'Safari opens "safe" downloads', 'Opens downloaded PDFs and images automatically. Off is safer.', d('com.apple.Safari', 'AutoOpenSafeDownloads'), T, N, T, { ...APP, risk: 'medium', warning: 'Needs Full Disk Access for Keeper, or change it in Safari ▸ Settings ▸ General.' }),
  b.toggle('chrome.swipenav', 'Browser', 'Chrome: swipe back and forward', 'Two-finger swipes go back and forward in Chrome.', d('com.google.Chrome', 'AppleEnableSwipeNavigateWithScrolls'), T, N, T, APP),

  // ── Power & sleep (pmset, administrator)
  b.number('power.displaysleep', 'Power & sleep', 'Turn the display off after', 'Minutes of inactivity before the display sleeps (all power sources). 0 means never.', pm('displaysleep'), 0, 180, '10', { sources: PMSET, unit: 'minutes', admin: true }),
  b.number('power.sleep', 'Power & sleep', 'Sleep the Mac after', 'Minutes of inactivity before the Mac sleeps. 0 means never.', pm('sleep'), 0, 180, '1', { sources: PMSET, unit: 'minutes', admin: true }),
  b.number('power.disksleep', 'Power & sleep', 'Spin down disks after', 'Minutes before hard disks spin down. 0 means never.', pm('disksleep'), 0, 180, '10', { sources: PMSET, unit: 'minutes', admin: true }),
  b.choice('power.hibernatemode', 'Power & sleep', 'Hibernate mode', 'How a laptop sleeps: 3 keeps memory powered and saves a copy to disk (default on laptops), 25 saves to disk only and powers off memory (slower wake, less drain), 0 never writes to disk.', pm('hibernatemode'), [c('0', '0 — memory only'), c('3', '3 — safe sleep (default)'), c('25', '25 — disk only')], '3', { sources: PMSET, admin: true, risk: 'medium', warning: 'Mode 0 means unsaved work is lost if the battery runs flat while asleep.' }),
  b.toggle('power.powernap', 'Power & sleep', 'Power Nap', 'Lets the Mac check mail and updates while asleep.', pm('powernap'), '1', '0', '1', { sources: PMSET, admin: true }),
  b.toggle('power.womp', 'Power & sleep', 'Wake for network access', 'Lets the network wake the Mac (for file sharing and Find My).', pm('womp'), '1', '0', '1', { sources: PMSET, admin: true, keywords: ['wake on lan'] }),
  b.toggle('power.autorestart', 'Power & sleep', 'Restart after a power failure', 'Starts the Mac again when power comes back.', pm('autorestart'), '1', '0', '0', { sources: PMSET, admin: true }),
  b.toggle('power.standby', 'Power & sleep', 'Standby', 'After a long sleep, saves memory to disk and powers down further.', pm('standby'), '1', '0', '1', { sources: PMSET, admin: true }),
  b.toggle('power.lowpower', 'Power & sleep', 'Low Power Mode', 'Lowers performance and background work to save energy (all power sources).', pm('lowpowermode'), '1', '0', '0', { sources: PMSET, admin: true, versions: 'macOS 12+' }),
  b.toggle('power.tcpkeepalive', 'Power & sleep', 'Keep network connections alive while asleep', 'Keeps Find My and Back to My Mac reachable during sleep.', pm('tcpkeepalive'), '1', '0', '1', { sources: PMSET, admin: true }),
  b.toggle('power.proximitywake', 'Power & sleep', 'Wake when an iPhone or Watch is near', 'Lets nearby devices with your Apple Account wake the Mac.', pm('proximitywake'), '1', '0', '1', { sources: PMSET, admin: true }),
  b.toggle('power.ttyskeepawake', 'Power & sleep', 'Stay awake while someone is logged in remotely', 'Prevents sleep while an SSH or Terminal session is active.', pm('ttyskeepawake'), '1', '0', '1', { sources: PMSET, admin: true, keywords: ['ssh'] }),
  b.toggle('power.appnap', 'Performance', 'App Nap', 'Slows down apps you cannot see to save energy. Turn off if background apps stall.', d(G, 'NSAppSleepDisabled'), N, T, N, APP),

  // ── Search, privacy, security, updates
  b.toggle('search.spotlight', 'Search & indexing', 'Spotlight indexing of the startup disk', 'Spotlight keeps a searchable index of the disk. Turning it off saves some energy but Spotlight and Mail search stop working well.', { t: 'mdutil', volume: '/' }, 'on', 'off', 'on', { sources: ['https://ss64.com/mac/mdutil.html'], admin: true, risk: 'medium' }),
  b.toggle('security.gatekeeper', 'Security', 'Gatekeeper', 'Checks that apps are from the App Store or identified developers before they open.', { t: 'spctl' }, 'on', 'off', 'on', { sources: ['https://ss64.com/mac/spctl.html', 'https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web'], admin: true, risk: 'high', warning: 'Turning Gatekeeper off lets any app run. On recent macOS you also have to confirm in System Settings ▸ Privacy & Security.' }),
  b.toggle('privacy.ads', 'Privacy', 'Personalised Apple ads', 'Turn off so Apple does not use your information to target ads in the App Store, News and Stocks.', d('com.apple.AdLib', 'allowApplePersonalizedAdvertising'), T, N, T, RM),
  b.choice('privacy.crashdialog', 'Privacy', 'Crash report dialog', 'What happens when an app crashes.', d('com.apple.CrashReporter', 'DialogType', 'string'), [c('basic', 'Ask (default)'), c('developer', 'Show details'), c('none', 'Never ask')], 'basic', RM),
  b.toggle('privacy.siri.suggestions', 'Privacy', 'Siri suggestions in Spotlight', 'Turn off to keep Spotlight searches on this Mac.', d('com.apple.lookup.shared', 'LookupSuggestionsDisabled'), N, T, N, RM),
  b.toggle('security.guest', 'Security', 'Guest user', 'Lets anyone log in as Guest without a password.', d('/Library/Preferences/com.apple.loginwindow', 'GuestEnabled', 'bool', { system: true }), T, N, N, { admin: true, risk: 'medium' }),
  b.toggle('security.loginnames', 'Security', 'Login window asks for name and password', 'Shows empty name and password fields instead of a list of users.', d('/Library/Preferences/com.apple.loginwindow', 'SHOWFULLNAME', 'bool', { system: true }), T, N, N, { admin: true, after: 'logout' }),
  b.text('security.loginmessage', 'Security', 'Message on the login window', 'A line of text on the login screen (for example, contact details if lost).', d('/Library/Preferences/com.apple.loginwindow', 'LoginwindowText', 'string', { system: true }), '', { admin: true, removeToRestore: true }),
  b.toggle('updates.auto.check', 'Updates', 'Check for updates automatically', 'macOS looks for updates in the background.', d('/Library/Preferences/com.apple.SoftwareUpdate', 'AutomaticCheckEnabled', 'bool', { system: true }), T, N, T, { admin: true, risk: 'medium', sources: [...DEFAULTS, 'https://support.apple.com/guide/deployment/manage-software-updates-dep0f5d38bb1/web'] }),
  b.toggle('updates.auto.download', 'Updates', 'Download updates automatically', 'Downloads updates when they are available.', d('/Library/Preferences/com.apple.SoftwareUpdate', 'AutomaticDownload', 'bool', { system: true }), T, N, T, { admin: true }),
  b.toggle('updates.critical', 'Updates', 'Install security responses and system files', 'Installs urgent security fixes automatically. Strongly recommended.', d('/Library/Preferences/com.apple.SoftwareUpdate', 'CriticalUpdateInstall', 'bool', { system: true }), T, N, T, { admin: true, risk: 'high', warning: 'Turning this off delays important security fixes.' }),
  b.toggle('updates.appstore', 'Updates', 'Update App Store apps automatically', 'Installs updates to App Store apps.', d('/Library/Preferences/com.apple.commerce', 'AutoUpdate', 'bool', { system: true }), T, N, T, { admin: true }),
  b.toggle('dev.appstore.debug', 'Developer', 'App Store debug menu', 'Shows the hidden Debug menu in the App Store app.', d('com.apple.appstore', 'ShowDebugMenu'), T, N, N, APP),
  b.toggle('dev.activitymonitor.all', 'Developer', 'Activity Monitor shows all processes', 'Opens Activity Monitor with every process listed.', d('com.apple.ActivityMonitor', 'ShowCategory', 'int'), '100', '101', '101', APP),
  b.toggle('dev.diskutility.all', 'Developer', 'Disk Utility shows all devices', 'Shows partitions and hidden volumes in Disk Utility.', d('com.apple.DiskUtility', 'SidebarShowAllDevices'), T, N, N, APP),
  b.toggle('dev.xcode.buildtime', 'Developer', 'Xcode shows build times', 'Shows how long each build took in the Xcode toolbar.', d('com.apple.dt.Xcode', 'ShowBuildOperationDuration'), T, N, N, APP),
  b.advice('sound.startup', 'Sound', 'Startup chime', 'Plays a sound when the Mac starts (Apple silicon and 2018+ Intel Macs).', { t: 'advice', read: { file: '/usr/sbin/nvram', args: ['StartupMute'] } }, [
    'Easiest: System Settings ▸ Sound ▸ "Play sound on startup".',
    'Or in Terminal: sudo nvram StartupMute=%01 (off) or sudo nvram StartupMute=%00 (on).',
  ], { sources: ['https://support.apple.com/en-us/102230'] }),
  b.toggle('sound.feedback', 'Sound', 'Play feedback when volume changes', 'A click when you press the volume keys.', d(G, 'com.apple.sound.beep.feedback', 'int'), '1', '0', '0', { ...RM, after: 'logout' }),
  b.toggle('sound.ui', 'Sound', 'Play interface sound effects', 'Sounds for things like emptying the Bin.', d(G, 'com.apple.sound.uiaudio.enabled', 'int'), '1', '0', '1', RM),

  // ── Advice: shown with steps, never changed by Keeper
  b.advice('network.hosts', 'Network', 'Hosts file', 'Maps names to addresses before DNS is asked. Keeper\'s DNS filter is usually a better way to block sites.', { t: 'advice', read: { file: '/bin/cat', args: ['/etc/hosts'] } }, [
    'Open Terminal and run: sudo nano /etc/hosts',
    'Add a line such as: 0.0.0.0 example.com',
    'Save, then flush DNS: sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder',
  ], { sources: ['https://ss64.com/mac/syntax-hosts.html'] }),
  b.advice('storage.tmsnapshots', 'Storage', 'Local Time Machine snapshots', 'macOS keeps hourly snapshots on the disk; they are deleted automatically when space is needed.', { t: 'advice', read: { file: '/usr/bin/tmutil', args: ['listlocalsnapshots', '/'] } }, [
    'See them: tmutil listlocalsnapshots /',
    'Free space now: tmutil thinlocalsnapshots / 999999999999 4',
  ], { sources: ['https://ss64.com/mac/tmutil.html'] }),
  b.advice('network.dnsflush', 'Network', 'Flush the DNS cache', 'Forget remembered website addresses, for example after changing DNS or the hosts file.', { t: 'advice' }, [
    'Keeper\'s Quick Controls has a "Flush DNS" button.',
    'Or in Terminal: sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder',
  ], { sources: ['https://support.apple.com/en-us/101986'] }),
  b.advice('sharing.screensharing', 'Security', 'Screen Sharing and Remote Management', 'Lets other computers see and control this Mac over VNC (port 5900). Keeper Remote Desktops → This computer can start it and reach it through Keeper Link.', { t: 'advice', read: { file: '/bin/launchctl', args: ['print', 'system/com.apple.screensharing'] } }, [
    'Open System Settings → General → Sharing.',
    'Turn on Screen Sharing (or Remote Management for more control), and choose who may connect.',
    'macOS 12.1 and later need this switch to be turned on here by you; the kickstart command (sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart -activate -configure -access -on -privs -all -restart -agent) can start the service but not grant control.',
  ], { sources: ['https://support.apple.com/guide/mac-help/turn-screen-sharing-on-or-off-mh11848/mac', 'https://support.apple.com/en-us/HT201710'], risk: 'high', keywords: ['vnc', 'remote desktop', 'ard', 'kickstart', '5900'] }),
];

