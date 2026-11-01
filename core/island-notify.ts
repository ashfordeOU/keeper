// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Other apps' notifications in the Island, on each system:
//   Linux    the desktop notification bus (dbus-monitor), read-only
//   macOS    the Notification Centre's banners read through Accessibility in
//            keeper-helper (opt-in; it reads what is on screen, so it can break
//            when macOS changes its banners), optionally closing the banner
//   Windows  UserNotificationListener where Windows allows it (needs package
//            identity and the person's consent), otherwise the toast history
//            Windows keeps for the Action Centre (read-only copy, never written)
// Pure parsers and filters; electron/services/notify-mirror.ts runs them.

export interface MirroredNotification {
  app: string;
  title: string;
  body: string;
  /** where it came from, to open the conversation when clicked */
  appId?: string;
  at?: number;
  /** a stable id from the source, for de-duplication */
  key?: string;
}

/** Text from a Windows toast's XML payload: the first <text> is the title, the rest the body. */
export function parseToastXml(xml: string): { title: string; body: string } | null {
  const texts = [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)].map((m) => decodeXml(m[1]).trim()).filter(Boolean);
  if (!texts.length) return null;
  return { title: texts[0], body: texts.slice(1).join('\n') };
}

function decodeXml(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
}

/** "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App" → "Windows Terminal"; "com.squirrel.slack.slack" → "Slack". */
export function prettyAppId(id: string): string {
  let s = id.split('!')[0];
  s = s.replace(/_[a-z0-9]{13}$/i, '');
  // Paths (non-packaged apps) and reverse-DNS names: the last meaningful part.
  s = s.split(/[\\/]/).pop()!.replace(/\.exe$/i, '');
  const parts = s.split('.').filter((p) => !/^(com|org|net|microsoft|apple|squirrel|electron|app|desktop|exe)$/i.test(p));
  const last = parts[parts.length - 1] ?? s;
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());
}

/** One line from the Windows listener script: a notification, or why it cannot listen. */
export function parseWinListenerLine(line: string): MirroredNotification | { error: string } | null {
  const t = line.trim();
  if (!t.startsWith('{')) return null;
  try {
    const o = JSON.parse(t) as { error?: string; id?: number | string; app?: string; appId?: string; title?: string; body?: string; texts?: string[]; at?: number };
    if (o.error) return { error: String(o.error) };
    const texts = o.texts ?? [o.title ?? '', o.body ?? ''];
    const title = (texts[0] ?? '').trim();
    const body = texts.slice(1).join('\n').trim();
    if (!title && !body) return null;
    return { app: o.app || prettyAppId(o.appId ?? 'Notification'), appId: o.appId, title: title || o.app || 'Notification', body, at: o.at, key: o.id !== undefined ? `win:${o.id}` : undefined };
  } catch {
    return null;
  }
}

/** Rows from the toast history (Notification joined with NotificationHandler) newer than `afterId`. */
export function wpnRowsToNotes(rows: { Id: number; PrimaryId?: string; Payload?: string | Uint8Array | Buffer; ArrivalTime?: number | bigint; Type?: string }[], afterId: number): { notes: MirroredNotification[]; lastId: number } {
  let lastId = afterId;
  const notes: MirroredNotification[] = [];
  for (const r of [...rows].sort((a, b) => a.Id - b.Id)) {
    if (r.Id <= afterId) continue;
    lastId = Math.max(lastId, r.Id);
    if (r.Type && r.Type !== 'toast') continue;
    const xml = typeof r.Payload === 'string' ? r.Payload : r.Payload ? new TextDecoder().decode(r.Payload) : '';
    const t = parseToastXml(xml);
    if (!t) continue;
    const ft = r.ArrivalTime !== undefined ? BigInt(r.ArrivalTime) : 0n;
    const at = ft > 0n ? Number(ft / 10_000n - 11_644_473_600_000n) : undefined;
    notes.push({ app: prettyAppId(r.PrimaryId ?? 'Notification'), appId: r.PrimaryId, title: t.title, body: t.body, at, key: `wpn:${r.Id}` });
  }
  return { notes, lastId };
}

/** One event from keeper-helper's Notification Centre reader (macOS). */
export function parseMacBanner(o: unknown): MirroredNotification | null {
  if (!o || typeof o !== 'object') return null;
  const x = o as { app?: string; title?: string; subtitle?: string; body?: string; texts?: string[]; id?: string };
  const texts = (x.texts ?? []).map((s) => String(s).trim()).filter(Boolean);
  // Banners read as: app name, title, (subtitle), body — app name first only on some versions.
  let app = x.app?.trim() || '';
  let rest = texts;
  if (!app && texts.length >= 3) { app = texts[0]; rest = texts.slice(1); }
  const title = x.title?.trim() || rest[0] || '';
  const body = x.body?.trim() || [x.subtitle, ...rest.slice(1)].filter(Boolean).join('\n');
  if (!title && !body) return null;
  return { app: app || 'Notification', title: title || app, body, key: x.id ? `mac:${x.id}` : undefined };
}

/** Is this app's notification wanted? (allow list empty = all; block list always wins) */
export function wantNotification(app: string, allow: string[], block: string[] = []): boolean {
  const a = app.toLowerCase();
  if (block.some((b) => b.trim() && a.includes(b.trim().toLowerCase()))) return false;
  if (!allow.length) return true;
  return allow.some((x) => x.trim() && a.includes(x.trim().toLowerCase()));
}

/** Keeper's own notifications and quiet-time rules are not mirrored back into the Island. */
export function isOwnNotification(n: MirroredNotification): boolean {
  return /^keeper\b/i.test(n.app) || /ashforde\.keeper/i.test(n.appId ?? '');
}

/** Drops repeats (the same notice seen twice by two readers, or re-posted within a few seconds). */
export class NotifyDeduper {
  private seen = new Map<string, number>();
  constructor(private windowMs = 15_000) {}
  fresh(n: MirroredNotification, now = Date.now()): boolean {
    for (const [k, t] of this.seen) if (now - t > this.windowMs * 4) this.seen.delete(k);
    const keys = [n.key, `${n.app}\u0000${n.title}\u0000${n.body}`].filter((k): k is string => !!k);
    if (keys.some((k) => { const t = this.seen.get(k); return t !== undefined && (k === n.key || now - t < this.windowMs); })) return false;
    for (const k of keys) this.seen.set(k, now);
    return true;
  }
}

/** Where mirroring works on this system, in plain words (Settings and the docs). */
export function mirrorSupport(platform: NodeJS.Platform): { how: string; suppress: boolean; fragile: boolean } {
  if (platform === 'linux') return { how: 'Reads the desktop notification bus. The original notification still shows.', suppress: false, fragile: false };
  if (platform === 'darwin') return { how: 'Reads Notification Centre banners through Accessibility (needs the Accessibility permission). It reads what macOS draws, so a macOS update can break it until Keeper is updated.', suppress: true, fragile: true };
  return { how: 'Uses Windows’ notification listener when Windows allows it; otherwise reads the notification history Windows keeps for the Action Centre (read-only). The original toast still shows.', suppress: false, fragile: true };
}
