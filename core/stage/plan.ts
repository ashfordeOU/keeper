// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What each Stage switch changes on each system, and the honest support table
// (shown on the Stage page and in docs/STAGE.md).

import type { StageOs, StageSwitches, SwitchId, SwitchInfo, ValueTarget } from './types';

/** Facts about this computer the plan depends on (gathered once per start). */
export interface StageEnv {
  os: StageOs;
  /** XDG_CURRENT_DESKTOP, lower case ("ubuntu:gnome", "kde", "xfce") */
  desktop: string;
  wayland: boolean;
  /** programs found on the PATH (Linux): gsettings, gnome-extensions, xfconf-query, qdbus, qdbus6, xdotool, wmctrl, xrandr, wlr-randr, playerctl, pw-dump */
  tools: string[];
  /** gsettings schemas that exist */
  schemas: string[];
  /** GNOME Shell extensions that are installed */
  extensions: string[];
}

export const DESKTOP_ICON_EXTENSIONS = ['ding@rastersoft.com', 'gtk4-ding@smedius.gitlab.com'];
export const DOCK_SCHEMAS = ['org.gnome.shell.extensions.dash-to-dock', 'org.gnome.shell.extensions.ubuntu-dock'];

const S = (how: SwitchInfo['support']['darwin']['how'], note?: string) => ({ how, note });

export const SWITCHES: SwitchInfo[] = [
  { id: 'hideDesktopIcons', group: 'Desktop and apps', label: 'Hide desktop icons', desc: 'Files on the desktop disappear from view (they stay in the folder).',
    support: { darwin: S('built', 'Finder restarts once'), win32: S('built'), linux: S('partial', 'GNOME desktop-icons extension and Xfce; KDE keeps its own desktop') } },
  { id: 'hideDock', group: 'Desktop and apps', label: 'Hide the Dock or taskbar', desc: 'It slides away until you point at the screen edge.',
    support: { darwin: S('built'), win32: S('built'), linux: S('partial', 'GNOME and Ubuntu docks, KDE panels; others vary') } },
  { id: 'hideOtherApps', group: 'Desktop and apps', label: 'Hide other apps', desc: 'Only the app in front stays; recorders, call apps and the “stays on screen” list stay too.',
    support: { darwin: S('built', 'Hides them, like ⌥⌘H'), win32: S('built', 'Minimises their windows'), linux: S('partial', 'X11 with xdotool or wmctrl; Wayland does not let apps do this') } },
  { id: 'hideMenuBar', group: 'Desktop and apps', label: 'Hide the menu bar', desc: 'The menu bar (with its icons) hides until you point at the top.',
    support: { darwin: S('partial', 'Hides the whole menu bar. Hiding single icons needs macOS 26’s own Menu Bar settings'), win32: S('partial', 'Tray icons go with the taskbar; Windows decides which icons overflow'), linux: S('none', 'GNOME and KDE have no public switch for this') } },
  { id: 'apps', group: 'Desktop and apps', label: 'Hide or quit chosen apps', desc: 'Apps you list are hidden or asked to quit, and come back afterwards.',
    support: { darwin: S('built'), win32: S('built', 'Quitting asks the app to close its windows'), linux: S('partial', 'Hiding needs X11; quitting works everywhere') } },
  { id: 'dnd', group: 'Notifications and sound', label: 'Do Not Disturb', desc: 'Notifications stay quiet (through Keep Awake’s Focus support).',
    support: { darwin: S('partial', 'Runs the two Shortcuts you pick on the Keep Awake page (macOS has no public Focus switch)'), win32: S('partial', 'Turns notification banners off (registry); some Windows versions apply it only to new banners'), linux: S('partial', 'GNOME banners; other desktops vary') } },
  { id: 'muteAlerts', group: 'Notifications and sound', label: 'Mute alert sounds', desc: 'Beeps and notification sounds are silent; music and calls are not.',
    support: { darwin: S('built'), win32: S('built', 'Silences the notification sounds of the current sound scheme'), linux: S('partial', 'GNOME event sounds') } },
  { id: 'pauseMusic', group: 'Notifications and sound', label: 'Pause music', desc: 'Music pauses, and plays again afterwards if Stage paused it.',
    support: { darwin: S('built', 'Music and Spotify'), win32: S('built', 'The current media session'), linux: S('built', 'MPRIS players through playerctl') } },
  { id: 'backdrop', group: 'Look', label: 'Clean backdrop', desc: 'A solid colour, a gradient or your wallpaper blurred, behind every window.',
    support: { darwin: S('built'), win32: S('built'), linux: S('partial', 'Needs a window manager that keeps desktop windows at the bottom (most do)') } },
  { id: 'neutralCursor', group: 'Look', label: 'Normal pointer size', desc: 'An enlarged pointer goes back to the usual size while on.',
    support: { darwin: S('guide', 'macOS does not let apps change the pointer size; Keeper tells you when it is enlarged and opens the setting'), win32: S('built'), linux: S('partial', 'GNOME; most apps pick it up at once') } },
  { id: 'spotlight', group: 'Look', label: 'Pointer spotlight or highlight', desc: 'Dims everything but a circle around the pointer, or rings the pointer. Shows in recordings.',
    support: { darwin: S('built'), win32: S('built'), linux: S('partial', 'X11, and XWayland on Wayland (the pointer position updates only over XWayland windows there)') } },
  { id: 'clicks', group: 'Look', label: 'Show clicks', desc: 'A ripple where you click.',
    support: { darwin: S('built', 'Needs Input Monitoring for Keeper’s helper'), win32: S('built'), linux: S('partial', 'X11 with xinput; not on Wayland') } },
  { id: 'keystrokes', group: 'Look', label: 'Show keystrokes', desc: 'Shortcuts you press (or every key) appear at the bottom of the screen.',
    support: { darwin: S('built', 'Needs Input Monitoring; password fields never show'), win32: S('built'), linux: S('partial', 'X11 with xinput; not on Wayland') } },
  { id: 'keepAwake', group: 'Behaviour', label: 'Keep awake', desc: 'The screen stays on while Stage is on (a Keep Awake session).',
    support: { darwin: S('built'), win32: S('built'), linux: S('built') } },
  { id: 'resolution', group: 'Behaviour', label: 'Recording resolution', desc: 'The main screen switches to a size (such as 1920 × 1080) and back.',
    support: { darwin: S('built', 'Through Keeper’s helper'), win32: S('built', 'Size only; Windows needs a sign-out to change scaling'), linux: S('partial', 'X11 (xrandr) and wlroots (wlr-randr); GNOME and KDE on Wayland keep their own') } },
  { id: 'cleanClipboard', group: 'Behaviour', label: 'Clean clipboard history', desc: 'Keeper’s clipboard history shows nothing while on (it is not deleted).',
    support: { darwin: S('built'), win32: S('built'), linux: S('built') } },
  { id: 'hidePrivate', group: 'Behaviour', label: 'Hide private things in the Island', desc: 'The shelf, notifications, meeting titles and messages stay out of sight.',
    support: { darwin: S('built'), win32: S('built'), linux: S('built') } },
  { id: 'keepKeeperOut', group: 'Behaviour', label: 'Keep Keeper out of the picture', desc: 'Keeper’s own windows do not appear in screenshots and recordings (the spotlight and keystrokes still do).',
    support: { darwin: S('built'), win32: S('built', 'Windows 10 2004 or later'), linux: S('none', 'Linux has no way for an app to hide from capture') } },
];

export const switchInfo = (id: SwitchId) => SWITCHES.find((s) => s.id === id);

/** One setting change the plan asks for. */
export interface PlannedValue { switch: SwitchId; label: string; target: ValueTarget; value: string }

/** A switch that does something other than set a value (the service does these). */
export type PlannedAction = SwitchId;

export interface StagePlan {
  values: PlannedValue[];
  actions: PlannedAction[];
  /** switches that cannot work here, and why */
  skipped: { switch: SwitchId; note: string }[];
}

const has = (env: StageEnv, tool: string) => env.tools.includes(tool);
const isOn = (s: StageSwitches, id: SwitchId): boolean => {
  const v = s[id as keyof StageSwitches];
  if (id === 'apps') return s.apps.length > 0;
  if (id === 'backdrop') return s.backdrop.kind !== 'off';
  if (id === 'spotlight') return s.spotlight.mode !== 'off';
  if (id === 'keystrokes') return s.keystrokes !== 'off';
  if (id === 'resolution') return s.resolution.mode === 'set';
  return v === true;
};

/** Neutral pointer sizes per system. */
export const NEUTRAL_CURSOR = { win32: '32', linux: '24' } as const;

function linuxValues(s: StageSwitches, env: StageEnv, out: StagePlan) {
  const gnome = env.schemas.includes('org.gnome.desktop.interface');
  const qdbus = has(env, 'qdbus6') ? 'qdbus6' : has(env, 'qdbus') ? 'qdbus' : '';
  const kde = /kde|plasma/.test(env.desktop);
  const xfce = /xfce/.test(env.desktop) && has(env, 'xfconf-query');
  if (s.hideDesktopIcons) {
    const ext = DESKTOP_ICON_EXTENSIONS.find((u) => env.extensions.includes(u));
    if (ext && has(env, 'gnome-extensions')) out.values.push({ switch: 'hideDesktopIcons', label: 'Desktop icons (GNOME)', target: { t: 'gnome-ext', uuid: ext }, value: 'false' });
    else if (xfce) out.values.push({ switch: 'hideDesktopIcons', label: 'Desktop icons (Xfce)', target: { t: 'xfconf', channel: 'xfce4-desktop', prop: '/desktop-icons/style', type: 'int' }, value: '0' });
    else out.skipped.push({ switch: 'hideDesktopIcons', note: kde ? 'KDE’s desktop keeps its icons; Keeper cannot hide them' : 'No desktop icons to hide here' });
  }
  if (s.hideDock) {
    const dock = DOCK_SCHEMAS.find((x) => env.schemas.includes(x));
    if (dock) {
      out.values.push({ switch: 'hideDock', label: 'Dock fixed', target: { t: 'gsettings', schema: dock, key: 'dock-fixed' }, value: 'false' });
      out.values.push({ switch: 'hideDock', label: 'Dock hides', target: { t: 'gsettings', schema: dock, key: 'autohide' }, value: 'true' });
    } else if (kde && qdbus) out.values.push({ switch: 'hideDock', label: 'Panels hide', target: { t: 'kde-panel', qdbus }, value: 'autohide' });
    else if (xfce) out.values.push({ switch: 'hideDock', label: 'Panel hides (Xfce)', target: { t: 'xfconf', channel: 'xfce4-panel', prop: '/panels/panel-1/autohide-behavior', type: 'int' }, value: '2' });
    else out.skipped.push({ switch: 'hideDock', note: 'No dock or panel Keeper knows how to hide here' });
  }
  if (s.hideMenuBar) out.skipped.push({ switch: 'hideMenuBar', note: 'Linux desktops have no public switch to hide the top bar' });
  if (s.muteAlerts) {
    if (env.schemas.includes('org.gnome.desktop.sound')) out.values.push({ switch: 'muteAlerts', label: 'Event sounds', target: { t: 'gsettings', schema: 'org.gnome.desktop.sound', key: 'event-sounds' }, value: 'false' });
    else out.skipped.push({ switch: 'muteAlerts', note: 'Only GNOME’s event sounds can be muted here' });
  }
  if (s.neutralCursor) {
    if (gnome) out.values.push({ switch: 'neutralCursor', label: 'Pointer size', target: { t: 'gsettings', schema: 'org.gnome.desktop.interface', key: 'cursor-size' }, value: NEUTRAL_CURSOR.linux });
    else out.skipped.push({ switch: 'neutralCursor', note: 'Only GNOME’s pointer size can be changed here' });
  }
}

/**
 * Turns a preset's switches into setting changes and actions for this
 * computer. Settings that are already as wanted are skipped later (after
 * reading them), so nothing is recorded that does not need putting back.
 */
export function planStage(s: StageSwitches, env: StageEnv): StagePlan {
  const out: StagePlan = { values: [], actions: [], skipped: [] };
  if (env.os === 'darwin') {
    if (s.hideDesktopIcons) out.values.push({ switch: 'hideDesktopIcons', label: 'Desktop icons', target: { t: 'mac-defaults', domain: 'com.apple.finder', key: 'CreateDesktop', type: 'bool', after: 'Finder' }, value: 'false' });
    if (s.hideDock) out.values.push({ switch: 'hideDock', label: 'Dock hides', target: { t: 'mac-osa', prop: 'dock-autohide' }, value: 'true' });
    if (s.hideMenuBar) out.values.push({ switch: 'hideMenuBar', label: 'Menu bar hides', target: { t: 'mac-osa', prop: 'menubar-autohide' }, value: 'true' });
    if (s.muteAlerts) out.values.push({ switch: 'muteAlerts', label: 'Alert volume', target: { t: 'mac-osa', prop: 'alert-volume' }, value: '0' });
    if (s.neutralCursor) out.actions.push('neutralCursor');
  } else if (env.os === 'win32') {
    const adv = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion';
    if (s.hideDesktopIcons) out.values.push({ switch: 'hideDesktopIcons', label: 'Desktop icons', target: { t: 'win-desktop-icons' }, value: 'false' });
    if (s.hideDock || s.hideMenuBar) out.values.push({ switch: s.hideDock ? 'hideDock' : 'hideMenuBar', label: 'Taskbar hides', target: { t: 'win-taskbar' }, value: 'true' });
    if (s.dnd) out.values.push({ switch: 'dnd', label: 'Notification banners', target: { t: 'win-reg', path: `${adv}\\PushNotifications`, name: 'ToastEnabled', type: 'DWORD' }, value: '0' });
    if (s.muteAlerts) {
      for (const ev of ['.Default', 'Notification.Default', 'Notification.IM', 'Notification.Mail', 'Notification.Reminder', 'Notification.SMS', 'SystemNotification']) {
        out.values.push({ switch: 'muteAlerts', label: `Sound: ${ev.replace(/^\./, '').replace('Notification.', '')}`, target: { t: 'win-reg', path: `HKCU:\\AppEvents\\Schemes\\Apps\\.Default\\${ev}\\.Current`, name: '(default)', type: 'String' }, value: '' });
      }
    }
    if (s.neutralCursor) out.values.push({ switch: 'neutralCursor', label: 'Pointer size', target: { t: 'win-reg', path: 'HKCU:\\Control Panel\\Cursors', name: 'CursorBaseSize', type: 'DWORD', after: 'cursors' }, value: NEUTRAL_CURSOR.win32 });
  } else {
    linuxValues(s, env, out);
  }
  if (env.os === 'linux' && s.keepKeeperOut) out.skipped.push({ switch: 'keepKeeperOut', note: 'Linux has no way for an app to hide from capture' });
  for (const id of ['hideOtherApps', 'apps', 'dnd', 'pauseMusic', 'backdrop', 'spotlight', 'clicks', 'keystrokes', 'keepAwake', 'resolution', 'cleanClipboard', 'hidePrivate', 'keepKeeperOut'] as SwitchId[]) {
    if (!isOn(s, id)) continue;
    if (id === 'dnd' && env.os === 'win32') continue;
    if (id === 'keepKeeperOut' && env.os === 'linux') continue;
    if (id === 'hideOtherApps' && env.os === 'linux' && (env.wayland && !canReachX(env))) { out.skipped.push({ switch: id, note: 'Wayland does not let apps hide other apps’ windows' }); continue; }
    if ((id === 'clicks' || id === 'keystrokes') && env.os === 'linux' && !has(env, 'xinput')) { out.skipped.push({ switch: id, note: 'Needs xinput on X11 (not available on Wayland)' }); continue; }
    if (id === 'resolution' && env.os === 'linux' && !has(env, 'xrandr') && !has(env, 'wlr-randr')) { out.skipped.push({ switch: id, note: 'Needs xrandr (X11) or wlr-randr (wlroots)' }); continue; }
    out.actions.push(id);
  }
  return out;
}

/** XWayland is enough for xdotool to minimise X11 windows, but native Wayland windows are out of reach. */
function canReachX(env: StageEnv): boolean {
  return has(env, 'xdotool') || has(env, 'wmctrl');
}

/** Is a running app one that stays on screen (the person's list, recorders and call apps, Keeper)? */
export function staysOnScreen(app: string, keep: string[], always: string[]): boolean {
  const a = app.toLowerCase().replace(/\.(exe|app)$/, '');
  if (/^(keeper|electron)$/.test(a)) return true;
  return [...keep, ...always].some((k) => {
    const n = k.toLowerCase().replace(/\.(exe|app)$/, '');
    return n && (a === n || a.startsWith(n + ' ') || (n.length > 3 && a.includes(n)));
  });
}
