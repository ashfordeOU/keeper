// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The notification center: every notice from Keeper's parts comes through
// notice(), is kept in one list (notices.json in the app's data folder, the
// newest 200), and is shown now, held for the next batch or only listed, as
// chosen per part in Settings → Notifications (core/notices.ts decides).
// Held notices go out as one calm summary. There is one timer, and only while
// something is held. With the part switched off, notices are shown as before.

import { app, Notification } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NoticesApi, NoticesView } from '../../core/api-notices';
import { addNotice, batchSummary, decide, holdReason, markAllDone, markDone, normalizeNoticeSettings, openNotices, releaseAt, type DeliveryContext, type Notice } from '../../core/notices';
import { featureOn } from './features';

export interface NoticeInput {
  part: string;
  title: string;
  detail?: string;
  route?: { name: string; arg?: string };
  /** always shown at once (an alarm, a scam warning) */
  urgent?: boolean;
}

interface Deps {
  broadcast: (channel: string, ...args: unknown[]) => void;
  settings: () => { notices?: unknown };
  /** shows one notice now: the Island when it is on, otherwise the system */
  show: (title: string, detail?: string, route?: { name: string; arg?: string }) => void;
  /** Keeper's focus timer is running */
  focusOn: () => boolean;
}

let deps: Deps | null = null;
let list: Notice[] = [];
let snoozedUntil = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let releaseTime = 0;
let loaded = false;
// The system's Do Not Disturb, where it can be read (GNOME today), looked at when a notice comes.
let systemQuiet = false;
let systemCheckedAt = 0;
const SYSTEM_READABLE = process.platform === 'linux' && /gnome|unity|budgie|cinnamon/i.test(process.env.XDG_CURRENT_DESKTOP ?? '');

const file = () => path.join(app.getPath('userData'), 'notices.json');

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as { items?: Notice[]; snoozedUntil?: number };
    list = Array.isArray(raw.items) ? raw.items.filter((n) => n && typeof n.id === 'string' && typeof n.title === 'string').slice(0, 200) : [];
    snoozedUntil = typeof raw.snoozedUntil === 'number' ? raw.snoozedUntil : 0;
  } catch {
    list = [];
  }
}

let saving: Promise<void> = Promise.resolve();
let saveQueued = false;
function save() {
  if (saveQueued) return;
  saveQueued = true;
  saving = saving.then(async () => {
    await new Promise((r) => setTimeout(r, 500));
    saveQueued = false;
    const tmp = `${file()}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ items: list, snoozedUntil }));
    await fsp.rename(tmp, file());
  }).catch(() => { saveQueued = false; });
}

const settings = () => normalizeNoticeSettings(deps?.settings().notices);

function ctx(now = new Date()): DeliveryContext {
  return { now, focus: deps?.focusOn() ?? false, systemQuiet, snoozedUntil };
}

function readSystemQuiet() {
  if (!SYSTEM_READABLE || Date.now() - systemCheckedAt < 60_000) return;
  systemCheckedAt = Date.now();
  execFile('gsettings', ['get', 'org.gnome.desktop.notifications', 'show-banners'], { timeout: 2000 }, (err, out) => {
    if (!err) systemQuiet = String(out).trim() === 'false';
  });
}

function changed() {
  save();
  deps?.broadcast('notices-changed', openNotices(list).length);
}

function view(): NoticesView {
  load();
  const c = ctx();
  return { items: list, open: openNotices(list).length, snoozedUntil: snoozedUntil > Date.now() ? snoozedUntil : 0, hold: holdReason(settings(), c), nextRelease: releaseTime, systemReadable: SYSTEM_READABLE };
}

/** Shows what is held, as one summary, when nothing holds it any more; otherwise waits again. */
function release() {
  timer = null;
  releaseTime = 0;
  const held = list.filter((n) => n.held && !n.done);
  if (!held.length) return;
  const s = settings();
  const c = ctx();
  const at = releaseAt(held, s, c);
  if (at > Date.now() + 1000) return schedule(at);
  const sum = batchSummary(held);
  deps?.show(sum.title, sum.detail, held.length === 1 ? held[0].route : { name: 'notices' });
  list = list.map((n) => (n.held ? { ...n, held: false } : n));
  changed();
}

function schedule(at: number) {
  if (timer && releaseTime && releaseTime <= at) return;
  if (timer) clearTimeout(timer);
  releaseTime = at;
  // A long wait is looked at again within the hour (the clock may have changed, or the computer slept).
  timer = setTimeout(release, Math.max(1000, Math.min(at - Date.now(), 3600_000)));
}

/** A notice from any part of Keeper. `showNow` shows it the part's own way (Mail's actions…); otherwise a plain one is shown. */
export function notice(n: NoticeInput, showNow?: () => void) {
  if (!deps || !featureOn('notices')) {
    if (showNow) showNow();
    else deps?.show(n.title, n.detail, n.route);
    return;
  }
  load();
  readSystemQuiet();
  const s = settings();
  const c = ctx();
  const what = decide(n, s, c);
  const item: Notice = { id: Math.random().toString(36).slice(2, 10), part: n.part, title: n.title.slice(0, 200), detail: n.detail?.slice(0, 400), at: Date.now(), route: n.route, urgent: n.urgent || undefined, held: what === 'hold' || undefined };
  list = addNotice(list, item);
  changed();
  if (what === 'show') {
    if (showNow) showNow();
    else deps.show(item.title, item.detail, item.route);
  } else if (what === 'hold') {
    schedule(releaseAt(list.filter((x) => x.held && !x.done), s, c));
  }
}

/** A helper for callers that take (title, detail). */
export const noticeFor = (part: string, route?: NoticeInput['route']) => (title: string, detail?: string) => notice({ part, title, detail, route });

export const noticesApi: NoticesApi = {
  async list() {
    return view();
  },
  async done(id) {
    load();
    list = markDone(list, id);
    changed();
    return view();
  },
  async doneAll() {
    load();
    list = markAllDone(list);
    changed();
    return view();
  },
  async snoozeAll(ms) {
    load();
    snoozedUntil = ms > 0 ? Date.now() + Math.min(ms, 7 * 86_400_000) : 0;
    changed();
    // Anything held is looked at again when the snooze ends.
    const held = list.filter((n) => n.held && !n.done);
    if (held.length) {
      if (timer) clearTimeout(timer);
      timer = null;
      releaseTime = 0;
      schedule(releaseAt(held, settings(), ctx()));
    }
    return view();
  },
  async test() {
    notice({ part: 'keeper', title: 'This is how notices look', detail: 'They gather in the bell, grouped by part.', urgent: true });
    return view();
  },
  async clearDone() {
    load();
    list = list.filter((n) => !n.done);
    changed();
    return view();
  },
};

export function startNotices(d: Deps) {
  deps = d;
}

/** Settings changed (quiet hours, a part set to Now): held notices are looked at again. */
export function noticesSettingsChanged() {
  if (!deps || !list.some((n) => n.held && !n.done)) return;
  if (timer) clearTimeout(timer);
  timer = null;
  releaseTime = 0;
  release();
}

export function stopNotices() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** The plain way to show one notice when the Island is off: the system's own notification. */
export function systemNotification(title: string, detail: string | undefined, onClick?: () => void) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body: detail ?? '', silent: true });
  if (onClick) n.on('click', onClick);
  n.show();
}
