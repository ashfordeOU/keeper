// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// When the Island may grow, and how far. It only drops down over windows when the
// person asks for it by hovering, clicking, a shortcut or a gesture. Things that
// happen by themselves (alerts, voice, agents, activities) grow sideways inside
// the menu-bar height. On a notched Mac they show in the notch: an icon and a
// short title in the wings, or in the small hanging tab when the wings have no
// room. On other screens the pill does the same. Alerts can be set to drop down
// as a banner instead.
// Low-priority alerts (guide findings, general information) are left out of the
// Island by default. They belong on the To do page and in the tray.

import type { IslandAlert } from './api';

/** What caused the Island to want to grow. */
export type ExpandTrigger =
  | 'hover' | 'click' | 'shortcut' | 'gesture' | 'drag' | 'tray'
  | 'alert' | 'voice' | 'agent' | 'activity';

const PERSON: ExpandTrigger[] = ['hover', 'click', 'shortcut', 'gesture', 'drag', 'tray'];

export type AlertStyle = 'notch' | 'banner';

export interface ExpandRules {
  /** the Island sits in a notch (macOS) */
  notch: boolean;
  /** Settings → Island → Alerts: in the notch / pill (default), or as a banner below it */
  alertStyle?: AlertStyle;
}

/** May this trigger drop the Island down over other windows? Only the person's own actions may. */
export function mayExpand(trigger: ExpandTrigger, r: ExpandRules): boolean {
  if (PERSON.includes(trigger)) return true;
  // Banners below the notch/pill only when the person chose them, and only for alerts.
  return trigger === 'alert' && r.alertStyle === 'banner';
}

/** Time-sensitive alerts show in the Island; the rest go to To do and the tray. */
const URGENT: IslandAlert['kind'][] = ['download', 'screenshot', 'focus', 'agent', 'battery', 'call', 'cue', 'notification', 'reminder', 'update'];

export function alertWorthShowing(a: Pick<IslandAlert, 'kind' | 'ref'>, o: { showInfo?: boolean } = {}): boolean {
  if (URGENT.includes(a.kind)) return true;
  // 'info' (guide findings, keep-awake ended, network notes) and 'disk' wait on To do unless asked for.
  return !!o.showInfo;
}

/** How an alert is shown right now. 'hidden' alerts stay in the tray and on To do. */
export function alertPresentation(a: Pick<IslandAlert, 'kind' | 'ref'>, r: ExpandRules & { showInfo?: boolean }): 'inline' | 'banner' | 'hidden' {
  if (!alertWorthShowing(a, r)) return 'hidden';
  return mayExpand('alert', r) ? 'banner' : 'inline';
}

/** The short title shown beside the notch: a few words fit in a wing. */
export function shortTitle(title: string, max = 22): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,.;:·-]+$/, '')}…`;
}

/** The icon an alert shows in the wing. */
export function alertIcon(kind: IslandAlert['kind']): string {
  return ({ download: 'down', screenshot: 'screenshot', focus: 'timer', agent: 'terminal', battery: 'battery', info: 'info', notification: 'inbox', cue: 'pin', call: 'phone', disk: 'disk', reminder: 'listCheck', update: 'down' } as Record<string, string>)[kind] ?? 'info';
}
