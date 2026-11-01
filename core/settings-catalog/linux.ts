// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Linux settings: GNOME (gsettings/dconf — your account only), kernel
// parameters (sysctl, administrator, kept in /etc/sysctl.d/99-keeper.conf),
// systemd services and timers, and the clock. Files Keeper should not edit for
// you (fstab, GRUB) are explained with steps instead.

import { builder, c } from './build';
import type { Op, SettingDef, ValueType } from './types';

const GNOME = ['https://help.gnome.org/admin/system-admin-guide/stable/dconf.html.en', 'https://manpages.ubuntu.com/manpages/noble/man1/gsettings.1.html'];
const SYSCTL = ['https://docs.kernel.org/admin-guide/sysctl/index.html'];
const SYSTEMD = ['https://www.freedesktop.org/software/systemd/man/latest/systemctl.html'];
const b = builder('linux', 'linux', { sources: GNOME });
const g = (schema: string, key: string, type: ValueType = 'bool'): Op => ({ t: 'gsettings', schema, key, type });
const k = (key: string): Op => ({ t: 'sysctl', key });
const unit = (name: string, user = false): Op => ({ t: 'systemd', unit: name, user });
const T = 'true';
const N = 'false';
const RM = { removeToRestore: true, versions: 'GNOME' } as const;
const IF = 'org.gnome.desktop.interface';
const WM = 'org.gnome.desktop.wm.preferences';
const MUT = 'org.gnome.mutter';
const TP = 'org.gnome.desktop.peripherals.touchpad';
const MS = 'org.gnome.desktop.peripherals.mouse';
const KB = 'org.gnome.desktop.peripherals.keyboard';
const PRIV = 'org.gnome.desktop.privacy';
const PWR = 'org.gnome.settings-daemon.plugins.power';
const NAU = 'org.gnome.nautilus.preferences';
const KADMIN = { admin: true, sources: SYSCTL } as const;
const SVC = { admin: true, sources: SYSTEMD, risk: 'medium' } as const;
const EN = 'enabled';
const DIS = 'disabled';

const service = (id: string, name: string, title: string, description: string, def = EN, extra: Partial<SettingDef> = {}): SettingDef =>
  b.toggle(`service.${id}`, 'Services', title, description, unit(name), EN, DIS, def, { ...SVC, keywords: [name, 'systemd', 'service'], ...extra });

export const LINUX: SettingDef[] = [
  // ── Appearance
  b.choice('gnome.colorscheme', 'Appearance', 'Light or dark style', 'Asks apps to use a light or dark look.', g(IF, 'color-scheme', 'string'), [c('default', 'Default'), c('prefer-dark', 'Dark'), c('prefer-light', 'Light')], 'default', { ...RM, versions: 'GNOME 42+', keywords: ['dark mode'] }),
  b.text('gnome.gtktheme', 'Appearance', 'GTK theme', 'The theme name for GTK 3 apps (for example Adwaita or Adwaita-dark).', g(IF, 'gtk-theme', 'string'), 'Adwaita', RM),
  b.text('gnome.icontheme', 'Appearance', 'Icon theme', 'The icon theme name.', g(IF, 'icon-theme', 'string'), 'Adwaita', RM),
  b.text('gnome.cursortheme', 'Appearance', 'Cursor theme', 'The pointer theme name.', g(IF, 'cursor-theme', 'string'), 'Adwaita', RM),
  b.number('gnome.cursorsize', 'Appearance', 'Cursor size', 'Pointer size in pixels.', g(IF, 'cursor-size', 'int'), 16, 128, '24', RM),
  b.number('gnome.textscale', 'Appearance', 'Text scaling', 'Makes all text larger or smaller.', g(IF, 'text-scaling-factor', 'float'), 0.5, 3, '1.0', RM),
  b.toggle('gnome.animations', 'Appearance', 'Animations', 'Turn off for an instant, snappier desktop.', g(IF, 'enable-animations'), T, N, T, { ...RM, keywords: ['faster'] }),
  b.toggle('gnome.hotcorner', 'Dock & desktop', 'Activities hot corner', 'Moving the pointer to the top-left corner opens the Activities overview.', g(IF, 'enable-hot-corners'), T, N, T, RM),
  b.toggle('gnome.battery', 'Menu bar & taskbar', 'Battery percentage in the top bar', 'Shows the charge as a number.', g(IF, 'show-battery-percentage'), T, N, N, RM),
  b.toggle('gnome.clock.seconds', 'Menu bar & taskbar', 'Show seconds in the clock', 'The top-bar clock includes seconds.', g(IF, 'clock-show-seconds'), T, N, N, RM),
  b.toggle('gnome.clock.weekday', 'Menu bar & taskbar', 'Show the weekday in the clock', 'The top-bar clock shows the day.', g(IF, 'clock-show-weekday'), T, N, N, RM),
  b.toggle('gnome.clock.date', 'Menu bar & taskbar', 'Show the date in the clock', 'The top-bar clock shows the date.', g(IF, 'clock-show-date'), T, N, T, RM),
  b.choice('gnome.clock.format', 'Time & language', 'Clock format', '24-hour or 12-hour time.', g(IF, 'clock-format', 'string'), [c('24h', '24-hour'), c('12h', '12-hour')], '24h', RM),
  b.choice('gnome.fontaa', 'Appearance', 'Font antialiasing', 'How text edges are smoothed.', g(IF, 'font-antialiasing', 'string'), [c('grayscale', 'Standard (greyscale)'), c('rgba', 'Subpixel (LCD)'), c('none', 'None')], 'grayscale', RM),
  b.choice('gnome.fonthinting', 'Appearance', 'Font hinting', 'How strongly text is fitted to pixels.', g(IF, 'font-hinting', 'string'), [c('none', 'None'), c('slight', 'Slight'), c('medium', 'Medium'), c('full', 'Full')], 'slight', RM),
  b.toggle('gnome.overlayscroll', 'Appearance', 'Overlay scroll bars', 'Scroll bars appear only while scrolling.', g(IF, 'overlay-scrolling'), T, N, T, RM),
  b.choice('gnome.buttons', 'Windows & spaces', 'Title bar buttons', 'Which buttons appear on window title bars.', g(WM, 'button-layout', 'string'), [c('appmenu:close', 'Close only'), c('appmenu:minimize,maximize,close', 'Minimise, maximise, close'), c('close,minimize,maximize:appmenu', 'On the left (Mac style)')], 'appmenu:close', RM),
  b.choice('gnome.focusmode', 'Windows & spaces', 'Window focus', 'Whether windows need a click to focus or follow the pointer.', g(WM, 'focus-mode', 'string'), [c('click', 'Click to focus'), c('sloppy', 'Focus follows mouse'), c('mouse', 'Focus follows mouse strictly')], 'click', RM),
  b.choice('gnome.doubleclick', 'Windows & spaces', 'Double-click a title bar to', 'What double-clicking a title bar does.', g(WM, 'action-double-click-titlebar', 'string'), [c('toggle-maximize', 'Maximise'), c('minimize', 'Minimise'), c('toggle-shade', 'Roll up'), c('none', 'Nothing')], 'toggle-maximize', RM),
  b.number('gnome.workspaces', 'Windows & spaces', 'Number of workspaces', 'Used when dynamic workspaces are off.', g(WM, 'num-workspaces', 'int'), 1, 36, '4', RM),
  b.toggle('gnome.dynamicws', 'Windows & spaces', 'Dynamic workspaces', 'GNOME adds and removes workspaces as needed.', g(MUT, 'dynamic-workspaces'), T, N, T, RM),
  b.toggle('gnome.ws.primary', 'Windows & spaces', 'Workspaces on the primary display only', 'Other displays stay the same when you switch workspace.', g(MUT, 'workspaces-only-on-primary'), T, N, T, RM),
  b.toggle('gnome.edgetiling', 'Windows & spaces', 'Edge tiling', 'Drag windows to screen edges to tile them.', g(MUT, 'edge-tiling'), T, N, T, RM),
  b.toggle('gnome.centerwindows', 'Windows & spaces', 'Centre new windows', 'New windows open in the middle of the screen.', g(MUT, 'center-new-windows'), T, N, N, RM),
  b.toggle('gnome.attachmodal', 'Windows & spaces', 'Attach dialogs to windows', 'Dialogs stay attached to their parent window.', g(MUT, 'attach-modal-dialogs'), T, N, T, RM),
  b.toggle('gnome.appswitch.ws', 'Windows & spaces', 'Alt-Tab shows windows from the current workspace only', 'Limits the app switcher to this workspace.', g('org.gnome.shell.app-switcher', 'current-workspace-only'), T, N, N, RM),
  b.toggle('gnome.sound.events', 'Sound', 'Event sounds', 'Plays sounds for alerts and actions.', g('org.gnome.desktop.sound', 'event-sounds'), T, N, T, RM),
  b.toggle('gnome.sound.overamp', 'Sound', 'Allow volume above 100%', 'Lets the volume slider go past 100% (may distort).', g('org.gnome.desktop.sound', 'allow-volume-above-100-percent'), T, N, N, RM),

  // ── Keyboard & mouse
  b.toggle('gnome.tap', 'Keyboard & mouse', 'Tap to click', 'A light tap on the touchpad counts as a click.', g(TP, 'tap-to-click'), T, N, N, RM),
  b.toggle('gnome.natural.tp', 'Keyboard & mouse', 'Natural scrolling (touchpad)', 'Content moves the way your fingers move.', g(TP, 'natural-scroll'), T, N, T, RM),
  b.toggle('gnome.natural.mouse', 'Keyboard & mouse', 'Natural scrolling (mouse)', 'Reverses the mouse wheel.', g(MS, 'natural-scroll'), T, N, N, RM),
  b.toggle('gnome.dwt', 'Keyboard & mouse', 'Disable touchpad while typing', 'Ignores the touchpad while keys are pressed.', g(TP, 'disable-while-typing'), T, N, T, RM),
  b.choice('gnome.tp.click', 'Keyboard & mouse', 'Touchpad click method', 'How right-clicks work on the touchpad.', g(TP, 'click-method', 'string'), [c('fingers', 'Two-finger click'), c('areas', 'Bottom-right corner'), c('default', 'Hardware default')], 'fingers', RM),
  b.number('gnome.tp.speed', 'Keyboard & mouse', 'Touchpad speed', 'From -1 (slow) to 1 (fast).', g(TP, 'speed', 'float'), -1, 1, '0.0', RM),
  b.number('gnome.mouse.speed', 'Keyboard & mouse', 'Mouse speed', 'From -1 (slow) to 1 (fast).', g(MS, 'speed', 'float'), -1, 1, '0.0', RM),
  b.choice('gnome.mouse.accel', 'Keyboard & mouse', 'Mouse acceleration', 'Flat turns acceleration off (preferred for games).', g(MS, 'accel-profile', 'string'), [c('default', 'Default'), c('flat', 'Flat'), c('adaptive', 'Adaptive')], 'default', RM),
  b.toggle('gnome.lefthanded', 'Keyboard & mouse', 'Left-handed mouse', 'Swaps the left and right buttons.', g(MS, 'left-handed'), T, N, N, RM),
  b.toggle('gnome.kb.repeat', 'Keyboard & mouse', 'Key repeat', 'Holding a key repeats it.', g(KB, 'repeat'), T, N, T, RM),
  b.number('gnome.kb.delay', 'Keyboard & mouse', 'Delay until key repeat', 'Milliseconds before a held key repeats.', g(KB, 'delay', 'int'), 100, 2000, '500', { ...RM, unit: 'ms' }),
  b.number('gnome.kb.interval', 'Keyboard & mouse', 'Key repeat interval', 'Milliseconds between repeats. Lower is faster.', g(KB, 'repeat-interval', 'int'), 5, 500, '30', { ...RM, unit: 'ms' }),
  b.toggle('gnome.numlock', 'Keyboard & mouse', 'Remember Num Lock', 'Keeps Num Lock as it was at the last session.', g(KB, 'remember-numlock-state'), T, N, T, RM),
  b.toggle('gnome.middlepaste', 'Keyboard & mouse', 'Middle-click paste', 'Middle-clicking pastes the last selected text.', g(IF, 'gtk-enable-primary-paste'), T, N, T, RM),
  b.toggle('gnome.locate', 'Keyboard & mouse', 'Locate the pointer with Ctrl', 'Pressing Ctrl shows where the pointer is.', g(IF, 'locate-pointer'), T, N, N, RM),

  // ── Privacy & security
  b.toggle('gnome.recent', 'Privacy', 'Remember recent files', 'Keeps a list of files you opened.', g(PRIV, 'remember-recent-files'), T, N, T, RM),
  b.number('gnome.recent.age', 'Privacy', 'Keep recent files for', 'Days to remember recent files (-1 forever).', g(PRIV, 'recent-files-max-age', 'int'), -1, 365, '30', { ...RM, unit: 'days' }),
  b.toggle('gnome.trash.auto', 'Privacy', 'Empty the Trash automatically', 'Deletes old items from the Trash.', g(PRIV, 'remove-old-trash-files'), T, N, N, RM),
  b.toggle('gnome.temp.auto', 'Privacy', 'Delete old temporary files', 'Removes old files from the temporary folder.', g(PRIV, 'remove-old-temp-files'), T, N, N, RM),
  b.number('gnome.trash.age', 'Privacy', 'Delete Trash and temporary files after', 'Days to keep files in the Trash.', g(PRIV, 'old-files-age', 'int'), 1, 365, '30', { ...RM, unit: 'days' }),
  b.toggle('gnome.usagestats', 'Privacy', 'Remember app usage', 'GNOME tracks which apps you use for search ranking.', g(PRIV, 'remember-app-usage'), T, N, T, RM),
  b.toggle('gnome.techproblems', 'Privacy', 'Report technical problems', 'Sends crash reports to your distribution.', g(PRIV, 'report-technical-problems'), T, N, T, RM),
  b.toggle('gnome.camera', 'Privacy', 'Camera access', 'Lets sandboxed apps use the camera (GNOME privacy switch).', g(PRIV, 'disable-camera'), N, T, N, RM),
  b.toggle('gnome.mic', 'Privacy', 'Microphone access', 'Lets apps use the microphone (GNOME privacy switch).', g(PRIV, 'disable-microphone'), N, T, N, RM),
  b.toggle('gnome.location', 'Privacy', 'Location services', 'Lets apps find your location.', g('org.gnome.system.location', 'enabled'), T, N, N, RM),
  b.toggle('gnome.lockscreen.notif', 'Privacy', 'Notifications on the lock screen', 'Shows notifications while the screen is locked.', g('org.gnome.desktop.notifications', 'show-in-lock-screen'), T, N, T, RM),
  b.toggle('gnome.notif.banners', 'Privacy', 'Notification banners', 'Shows notification pop-ups (Do Not Disturb when off).', g('org.gnome.desktop.notifications', 'show-banners'), T, N, T, { ...RM, keywords: ['do not disturb', 'dnd'] }),
  b.toggle('gnome.lock', 'Security', 'Lock the screen when blank', 'Locks the screen after it blanks.', g('org.gnome.desktop.screensaver', 'lock-enabled'), T, N, T, RM),
  b.choice('gnome.lock.delay', 'Security', 'Lock delay after blank', 'Seconds between the screen blanking and locking.', g('org.gnome.desktop.screensaver', 'lock-delay', 'int'), [c('0', 'Immediately'), c('30', '30 seconds'), c('60', '1 minute'), c('300', '5 minutes'), c('1800', '30 minutes')], '0', RM),
  b.number('gnome.idle', 'Power & sleep', 'Blank the screen after', 'Seconds of inactivity before the screen blanks (0 = never).', g('org.gnome.desktop.session', 'idle-delay', 'int'), 0, 3600, '300', { ...RM, unit: 'seconds' }),
  b.toggle('gnome.automount', 'Security', 'Mount drives automatically', 'Plugged-in drives are mounted.', g('org.gnome.desktop.media-handling', 'automount'), T, N, T, RM),
  b.toggle('gnome.autorun', 'Security', 'Never run software from media', 'Turn on so inserted media never offers to run programs.', g('org.gnome.desktop.media-handling', 'autorun-never'), T, N, N, RM),

  // ── Power
  b.choice('gnome.power.button', 'Power & sleep', 'Power button action', 'What the power button does.', g(PWR, 'power-button-action', 'string'), [c('suspend', 'Suspend'), c('interactive', 'Ask'), c('hibernate', 'Hibernate'), c('nothing', 'Nothing')], 'suspend', RM),
  b.choice('gnome.sleep.ac', 'Power & sleep', 'Automatic suspend when plugged in', 'What happens after inactivity on mains power.', g(PWR, 'sleep-inactive-ac-type', 'string'), [c('suspend', 'Suspend'), c('nothing', 'Nothing'), c('hibernate', 'Hibernate')], 'suspend', RM),
  b.number('gnome.sleep.ac.timeout', 'Power & sleep', 'Suspend after (plugged in)', 'Seconds of inactivity before suspend on mains power.', g(PWR, 'sleep-inactive-ac-timeout', 'int'), 0, 86400, '900', { ...RM, unit: 'seconds' }),
  b.choice('gnome.sleep.bat', 'Power & sleep', 'Automatic suspend on battery', 'What happens after inactivity on battery.', g(PWR, 'sleep-inactive-battery-type', 'string'), [c('suspend', 'Suspend'), c('nothing', 'Nothing'), c('hibernate', 'Hibernate')], 'suspend', RM),
  b.number('gnome.sleep.bat.timeout', 'Power & sleep', 'Suspend after (on battery)', 'Seconds of inactivity before suspend on battery.', g(PWR, 'sleep-inactive-battery-timeout', 'int'), 0, 86400, '900', { ...RM, unit: 'seconds' }),
  b.toggle('gnome.dim', 'Power & sleep', 'Dim the screen when inactive', 'Dims the display before it blanks.', g(PWR, 'idle-dim'), T, N, T, RM),
  b.toggle('gnome.ambient', 'Power & sleep', 'Automatic screen brightness', 'Adjusts brightness from the light sensor.', g(PWR, 'ambient-enabled'), T, N, T, RM),
  b.toggle('gnome.powersaver.low', 'Power & sleep', 'Power saver on low battery', 'Turns on power saving when the battery is low.', g('org.gnome.settings-daemon.plugins.power', 'power-saver-profile-on-low-battery'), T, N, T, { ...RM, versions: 'GNOME 40+' }),

  // ── Files & search
  b.choice('gnome.files.view', 'Finder & files', 'Files: default view', 'How the Files app shows folders.', g(NAU, 'default-folder-viewer', 'string'), [c('icon-view', 'Icons'), c('list-view', 'List')], 'icon-view', RM),
  b.toggle('gnome.files.hidden', 'Finder & files', 'Show hidden files', 'Shows files starting with a dot in file dialogs.', g('org.gtk.Settings.FileChooser', 'show-hidden'), T, N, N, { ...RM, keywords: ['dotfiles'] }),
  b.toggle('gnome.files.hidden4', 'Finder & files', 'Show hidden files (GTK 4 apps)', 'Shows dotfiles in GTK 4 file dialogs.', g('org.gtk.gtk4.Settings.FileChooser', 'show-hidden'), T, N, N, RM),
  b.toggle('gnome.files.foldersfirst', 'Finder & files', 'Folders before files', 'Sorts folders above files in file dialogs.', g('org.gtk.Settings.FileChooser', 'sort-directories-first'), T, N, N, RM),
  b.toggle('gnome.files.delete', 'Finder & files', 'Show "Delete permanently"', 'Adds a delete option that skips the Trash.', g(NAU, 'show-delete-permanently'), T, N, N, RM),
  b.toggle('gnome.files.create', 'Finder & files', 'Show "Create Link"', 'Adds a Create Link option to the Files menu.', g(NAU, 'show-create-link'), T, N, N, RM),
  b.choice('gnome.files.click', 'Finder & files', 'Open items with', 'Single or double click to open files.', g(NAU, 'click-policy', 'string'), [c('double', 'Double click'), c('single', 'Single click')], 'double', RM),
  b.toggle('gnome.files.typeahead', 'Finder & files', 'Type-ahead in Files', 'Typing selects files instead of starting a search.', g(NAU, 'type-ahead-search'), T, N, T, RM),
  b.choice('gnome.files.thumbs', 'Finder & files', 'Show thumbnails', 'When Files creates previews.', g(NAU, 'show-image-thumbnails', 'string'), [c('always', 'Always'), c('local-only', 'On this computer only'), c('never', 'Never')], 'local-only', RM),
  b.toggle('gnome.search.disable', 'Search & indexing', 'Search in the overview', 'Lets apps provide results in the Activities search. Turn off to disable all search providers.', g('org.gnome.desktop.search-providers', 'disable-external'), N, T, N, RM),
  b.toggle('gnome.tracker.removable', 'Search & indexing', 'Index removable drives', 'Tracker indexes USB drives.', g('org.freedesktop.Tracker3.Miner.Files', 'index-removable-devices'), T, N, N, RM),
  b.toggle('gnome.tracker.battery', 'Search & indexing', 'Index while on battery', 'Lets Tracker index files on battery.', g('org.freedesktop.Tracker3.Miner.Files', 'index-on-battery'), T, N, T, RM),
  b.toggle('gnome.datetime.auto', 'Time & language', 'Automatic time zone', 'GNOME sets the time zone from your location.', g('org.gnome.desktop.datetime', 'automatic-timezone'), T, N, N, RM),
  b.toggle('gnome.weeknumbers', 'Time & language', 'Week numbers in the calendar', 'Shows ISO week numbers in the top-bar calendar.', g('org.gnome.desktop.calendar', 'show-weekdate'), T, N, N, RM),

  // ── Kernel (sysctl)
  b.number('kernel.swappiness', 'Performance', 'Swappiness', 'How eagerly the kernel moves memory to swap (0–200). Lower keeps apps in memory longer; 10 is common on desktops.', k('vm.swappiness'), 0, 200, '60', { ...KADMIN, keywords: ['swap', 'memory'] }),
  b.number('kernel.vfscache', 'Performance', 'VFS cache pressure', 'How eagerly the kernel drops cached file information. Lower keeps it longer.', k('vm.vfs_cache_pressure'), 1, 1000, '100', KADMIN),
  b.number('kernel.dirtyratio', 'Performance', 'Dirty ratio', 'Percent of memory that can hold unwritten data before writers must wait.', k('vm.dirty_ratio'), 1, 90, '20', { ...KADMIN, unit: '%' }),
  b.number('kernel.dirtybg', 'Performance', 'Dirty background ratio', 'Percent of memory with unwritten data before writing starts in the background.', k('vm.dirty_background_ratio'), 1, 90, '10', { ...KADMIN, unit: '%' }),
  b.number('kernel.inotify.watches', 'Developer', 'File watch limit', 'How many files each user can watch for changes. Editors and build tools need more for big projects ("ENOSPC: System limit for number of file watchers reached").', k('fs.inotify.max_user_watches'), 8192, 4194304, '65536', { ...KADMIN, sources: [...SYSCTL, 'https://man7.org/linux/man-pages/man7/inotify.7.html'], keywords: ['enospc', 'watchers', 'vscode'] }),
  b.number('kernel.inotify.instances', 'Developer', 'File watcher instance limit', 'How many watchers each user can create.', k('fs.inotify.max_user_instances'), 128, 65536, '128', { ...KADMIN, sources: [...SYSCTL, 'https://man7.org/linux/man-pages/man7/inotify.7.html'] }),
  b.number('kernel.maxmap', 'Developer', 'Max memory map count', 'Some games and databases (Elasticsearch, Steam games) need a higher limit.', k('vm.max_map_count'), 65530, 2147483642, '65530', { ...KADMIN, keywords: ['steam', 'elasticsearch'] }),
  b.toggle('kernel.ipv6.off', 'Network', 'Turn off IPv6', 'Disables IPv6 on all interfaces. Rarely needed; can break some networks.', k('net.ipv6.conf.all.disable_ipv6'), '1', '0', '0', { ...KADMIN, risk: 'medium' }),
  b.toggle('kernel.forward', 'Network', 'IP forwarding', 'Lets this computer route traffic between networks (needed for hotspots, containers and VPN gateways).', k('net.ipv4.ip_forward'), '1', '0', '0', { ...KADMIN, risk: 'medium', keywords: ['router', 'nat'] }),
  b.choice('kernel.tcpcc', 'Network', 'TCP congestion control', 'BBR can improve throughput on lossy or long-distance links.', k('net.ipv4.tcp_congestion_control'), [c('cubic', 'CUBIC (default)'), c('bbr', 'BBR'), c('reno', 'Reno')], 'cubic', { ...KADMIN, warning: 'BBR needs the tcp_bbr kernel module.' }),
  b.choice('kernel.qdisc', 'Network', 'Default queueing discipline', 'fq pairs well with BBR; fq_codel reduces bufferbloat.', k('net.core.default_qdisc'), [c('fq_codel', 'fq_codel'), c('fq', 'fq'), c('pfifo_fast', 'pfifo_fast')], 'fq_codel', KADMIN),
  b.choice('kernel.rpfilter', 'Network', 'Reverse path filtering', 'Drops packets whose source address could not have come from that interface (spoofing protection).', k('net.ipv4.conf.all.rp_filter'), [c('0', 'Off'), c('1', 'Strict'), c('2', 'Loose')], '2', { ...KADMIN, risk: 'medium' }),
  b.toggle('kernel.icmpecho', 'Network', 'Ignore pings', 'Stops answering ping requests.', k('net.ipv4.icmp_echo_ignore_all'), '1', '0', '0', KADMIN),
  b.toggle('kernel.syncookies', 'Security', 'TCP SYN cookies', 'Protects against SYN flood attacks. Keep on.', k('net.ipv4.tcp_syncookies'), '1', '0', '1', { ...KADMIN, risk: 'medium' }),
  b.choice('kernel.sysrq', 'Security', 'Magic SysRq key', 'Which emergency keyboard commands are allowed (176 is a common safe set).', k('kernel.sysrq'), [c('0', 'Off'), c('1', 'All'), c('176', 'Sync, remount, reboot'), c('438', 'Distribution default (some)')], '176', KADMIN),
  b.toggle('kernel.dmesg', 'Security', 'Restrict kernel log to administrators', 'Only administrators can read dmesg.', k('kernel.dmesg_restrict'), '1', '0', '1', KADMIN),
  b.choice('kernel.kptr', 'Security', 'Hide kernel addresses', 'Hides kernel pointers from unprivileged users.', k('kernel.kptr_restrict'), [c('0', 'Show'), c('1', 'Hide from users'), c('2', 'Hide from everyone')], '1', KADMIN),
  b.choice('kernel.ptrace', 'Security', 'Process tracing (Yama)', 'Who may attach debuggers to processes.', k('kernel.yama.ptrace_scope'), [c('0', 'Anyone (same user)'), c('1', 'Parents only'), c('2', 'Administrators only'), c('3', 'Nobody')], '1', { ...KADMIN, risk: 'medium' }),
  b.toggle('kernel.unprivns', 'Security', 'Unprivileged user namespaces', 'Needed by browser sandboxes, Flatpak and rootless containers.', k('kernel.unprivileged_userns_clone'), '1', '0', '1', { ...KADMIN, risk: 'high', warning: 'Turning this off breaks Chrome\'s sandbox and Flatpak. Only on Debian-patched kernels.' }),
  b.number('kernel.panic', 'Performance', 'Reboot after a kernel panic', 'Seconds before restarting after a panic (0 = wait forever).', k('kernel.panic'), 0, 600, '0', KADMIN),

  // ── systemd services
  service('bluetooth', 'bluetooth.service', 'Bluetooth', 'Bluetooth devices. Turn off if you never use Bluetooth.'),
  service('cups', 'cups.service', 'Printing (CUPS)', 'Needed to print.'),
  service('avahi', 'avahi-daemon.service', 'Local network discovery (Avahi)', 'Finds printers and shares on the local network (.local names).'),
  service('ssh', 'ssh.service', 'SSH server (Debian/Ubuntu)', 'Lets other computers log in with SSH.', DIS, { risk: 'high', warning: 'Only turn on with key-based login or strong passwords.' }),
  service('sshd', 'sshd.service', 'SSH server (Fedora/Arch)', 'Lets other computers log in with SSH.', DIS, { risk: 'high', warning: 'Only turn on with key-based login or strong passwords.' }),
  service('fstrim', 'fstrim.timer', 'Weekly SSD trim', 'Tells SSDs which blocks are free, keeping them fast.', EN, { risk: 'low' }),
  service('modem', 'ModemManager.service', 'Mobile broadband modems', 'Turn off if you have no 4G/5G modem.'),
  service('aptdaily', 'apt-daily-upgrade.timer', 'Daily automatic upgrades (apt)', 'Installs updates in the background on Debian and Ubuntu.', EN),
  service('unattended', 'unattended-upgrades.service', 'Unattended security upgrades', 'Installs security updates automatically.', EN, { risk: 'high', warning: 'Turning this off delays security fixes.' }),
  service('waitonline', 'NetworkManager-wait-online.service', 'Wait for the network at boot', 'Delays boot until the network is up. Turning it off can speed boot.', EN),
  service('firewalld', 'firewalld.service', 'firewalld', 'Fedora\'s firewall service.', EN, { risk: 'high', warning: 'Turning the firewall service off leaves every port open.' }),
  service('ufw', 'ufw.service', 'Uncomplicated Firewall', 'Ubuntu\'s firewall service (rules managed in Keeper\'s Firewall page).', EN, { risk: 'high', warning: 'Turning the firewall service off leaves every port open.' }),
  service('cronie', 'cron.service', 'cron', 'Runs scheduled jobs.', EN),
  service('tlp', 'tlp.service', 'TLP power saving', 'Laptop power tuning (if installed).', EN, { risk: 'low' }),
  service('ppd', 'power-profiles-daemon.service', 'Power profiles daemon', 'Provides the Balanced / Power saver / Performance switch.', EN, { risk: 'low' }),
  service('docker', 'docker.service', 'Docker', 'Starts Docker at boot.', EN, { risk: 'low' }),
  b.toggle('service.tracker', 'Search & indexing', 'File indexer (Tracker)', 'Indexes files for search in your session. Turning it off saves CPU and battery but GNOME search finds fewer files.', unit('tracker-miner-fs-3.service', true), EN, DIS, EN, { sources: SYSTEMD, keywords: ['tracker', 'indexing'] }),
  b.toggle('time.ntp', 'Time & language', 'Set the time automatically', 'Synchronises the clock with internet time servers.', { t: 'timedatectl', what: 'ntp' }, 'on', 'off', 'on', { sources: ['https://www.freedesktop.org/software/systemd/man/latest/timedatectl.html'] }),
  b.toggle('time.localrtc', 'Time & language', 'Hardware clock in local time', 'Turn on only when dual-booting with Windows without the UTC fix.', { t: 'timedatectl', what: 'local-rtc' }, 'on', 'off', 'off', { sources: ['https://www.freedesktop.org/software/systemd/man/latest/timedatectl.html'], risk: 'medium', keywords: ['dual boot'] }),

  // ── Advice (files Keeper explains but never edits for you)
  b.advice('boot.grubtimeout', 'Performance', 'Boot menu timeout (GRUB)', 'How long the boot menu waits.', { t: 'advice', read: { file: 'grep', args: ['-E', '^GRUB_TIMEOUT', '/etc/default/grub'] } }, [
    'Open /etc/default/grub as administrator (sudoedit /etc/default/grub).',
    'Change GRUB_TIMEOUT=5 to the number of seconds you want.',
    'Apply: sudo update-grub (Debian/Ubuntu) or sudo grub2-mkconfig -o /boot/grub2/grub.cfg (Fedora).',
  ], { sources: ['https://www.gnu.org/software/grub/manual/grub/html_node/Simple-configuration.html'], risk: 'medium' }),
  b.advice('storage.noatime', 'Storage', 'noatime for disks', 'Stops writing an access time on every read; saves SSD writes. Most systems already use relatime, which is close.', { t: 'advice', read: { file: 'findmnt', args: ['-no', 'OPTIONS', '/'] } }, [
    'Back up /etc/fstab first: sudo cp /etc/fstab /etc/fstab.bak',
    'Add noatime to the options column of the / line (for example: defaults,noatime).',
    'Check with: sudo findmnt --verify — then restart.',
  ], { sources: ['https://man7.org/linux/man-pages/man8/mount.8.html'], risk: 'high', warning: 'A mistake in fstab can stop the system from starting.' }),
  b.advice('network.hosts', 'Network', 'Hosts file', 'Maps names to addresses before DNS is asked. Keeper\'s DNS filter is usually a better way to block sites.', { t: 'advice', read: { file: 'cat', args: ['/etc/hosts'] } }, [
    'sudoedit /etc/hosts',
    'Add a line such as: 0.0.0.0 example.com',
  ], { sources: ['https://man7.org/linux/man-pages/man5/hosts.5.html'] }),
  b.advice('time.locale', 'Time & language', 'System language and keyboard layout', 'The language and console keyboard for the whole system.', { t: 'advice', read: { file: 'localectl', args: ['status'] } }, [
    'See options: localectl list-locales',
    'Change: sudo localectl set-locale LANG=en_GB.UTF-8',
    'Keyboard: sudo localectl set-x11-keymap gb',
  ], { sources: ['https://www.freedesktop.org/software/systemd/man/latest/localectl.html'] }),
  b.advice('time.zone', 'Time & language', 'Time zone', 'The system time zone.', { t: 'advice', read: { file: 'timedatectl', args: ['show', '-p', 'Timezone', '--value'] } }, [
    'List: timedatectl list-timezones',
    'Set: sudo timedatectl set-timezone Europe/London',
  ], { sources: ['https://www.freedesktop.org/software/systemd/man/latest/timedatectl.html'] }),
  b.advice('storage.swap', 'Storage', 'Swap space', 'Disk space used when memory is full; zram compresses memory instead.', { t: 'advice', read: { file: 'swapon', args: ['--show'] } }, [
    'See swap: swapon --show',
    'Fedora and recent Ubuntu use zram by default (zram-generator).',
    'A swap file: sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile',
  ], { sources: ['https://man7.org/linux/man-pages/man8/swapon.8.html'] }),
];
