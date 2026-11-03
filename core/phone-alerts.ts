// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Alerts to your phone: Keeper's own alerts (a site down, a backup that failed,
// an automation that ran, a focus session done, a new Fix-it item) sent through
// channels the person sets up: a Telegram bot, ntfy, a webhook of their own, or
// e-mail from one of their Mail accounts. Pure: the requests are built here and
// sent by electron/services/phone-alerts.ts. Tokens are never in the settings
// (they live in the keychain) and never in an error message.

export type AlertChannelKind = 'telegram' | 'ntfy' | 'webhook' | 'email';
export type AlertSource = 'monitors' | 'automations' | 'focus' | 'backups' | 'fixit';

export const ALERT_SOURCES: { id: AlertSource; label: string; feature: string }[] = [
  { id: 'monitors', label: 'Site and server checks', feature: 'monitors' },
  { id: 'backups', label: 'Backups', feature: 'sync' },
  { id: 'automations', label: 'Automations', feature: 'rules' },
  { id: 'focus', label: 'Focus and time', feature: 'focus' },
  { id: 'fixit', label: 'Fix-it List', feature: 'guide' },
];

export const CHANNEL_KINDS: { id: AlertChannelKind; label: string; line: string }[] = [
  { id: 'ntfy', label: 'ntfy', line: 'A free app for phone alerts. Pick a topic name.' },
  { id: 'telegram', label: 'Telegram', line: 'A message from your own bot.' },
  { id: 'email', label: 'E-mail', line: 'From one of your accounts in Mail.' },
  { id: 'webhook', label: 'Web address', line: 'Keeper posts each alert as JSON.' },
];

export interface AlertChannel {
  id: string;
  kind: AlertChannelKind;
  name: string;
  on: boolean;
  /** what it is used for */
  sources: AlertSource[];
  /** Telegram: the chat to send to (a number, or @channelname) */
  chatId?: string;
  /** ntfy: the server (https://ntfy.sh by default) and the topic */
  server?: string;
  topic?: string;
  /** webhook: where to post */
  url?: string;
  /** e-mail: which Mail account sends, and to whom */
  account?: string;
  to?: string;
}

export interface PhoneAlertSettings {
  channels: AlertChannel[];
  /** alerts within this many seconds go out together as one message */
  batchSeconds: number;
}

export const defaultPhoneAlertSettings = (): PhoneAlertSettings => ({ channels: [], batchSeconds: 30 });

export function normalizePhoneAlertSettings(v: unknown): PhoneAlertSettings {
  const d = defaultPhoneAlertSettings();
  if (!v || typeof v !== 'object') return d;
  const r = v as Partial<PhoneAlertSettings>;
  const sources = new Set(ALERT_SOURCES.map((s) => s.id));
  const channels = (Array.isArray(r.channels) ? r.channels : [])
    .filter((c): c is AlertChannel => !!c && typeof c === 'object' && typeof c.id === 'string' && CHANNEL_KINDS.some((k) => k.id === c.kind))
    .map((c) => ({ ...c, name: String(c.name ?? '').slice(0, 60) || kindLabel(c.kind), on: c.on !== false, sources: (Array.isArray(c.sources) ? c.sources : []).filter((s) => sources.has(s)) }))
    .slice(0, 20);
  const batch = Number(r.batchSeconds);
  return { channels, batchSeconds: Number.isFinite(batch) ? Math.max(0, Math.min(600, Math.round(batch))) : d.batchSeconds };
}

export const kindLabel = (k: AlertChannelKind) => CHANNEL_KINDS.find((x) => x.id === k)?.label ?? k;

/** The keychain name of a channel's token (bot token, ntfy access token, webhook secret). */
export const secretName = (id: string) => `alerts.${id}`;

/** Does this kind need a secret, may it have one, or never. */
export function secretNeed(kind: AlertChannelKind): 'required' | 'optional' | 'none' {
  return kind === 'telegram' ? 'required' : kind === 'email' ? 'none' : 'optional';
}

const isHttpUrl = (u: string | undefined, allowHttp = false) => {
  try {
    const x = new URL(u ?? '');
    return x.protocol === 'https:' || (allowHttp && x.protocol === 'http:');
  } catch {
    return false;
  }
};

/** What is missing or wrong, in plain words; empty when the channel can be saved. */
export function channelProblems(c: Partial<AlertChannel>, hasSecret: boolean): string[] {
  const out: string[] = [];
  if (c.kind === 'telegram') {
    if (!hasSecret) out.push('Paste your bot’s token.');
    if (!/^(-?\d{3,20}|@[A-Za-z0-9_]{5,32})$/.test((c.chatId ?? '').trim())) out.push('The chat is a number like 123456789, or @yourchannel.');
  } else if (c.kind === 'ntfy') {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test((c.topic ?? '').trim())) out.push('A topic is one word: letters, numbers, - and _.');
    if (c.server && !isHttpUrl(c.server, true)) out.push('The server must be a web address.');
  } else if (c.kind === 'webhook') {
    // Plain http only to this computer or the home network, where there may be no certificate.
    if (!isHttpUrl(c.url) && !(isHttpUrl(c.url, true) && isLocalHost(c.url!))) out.push('Use an https:// address (http:// only on your own network).');
  } else if (c.kind === 'email') {
    if (!c.account) out.push('Choose the Mail account that sends.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((c.to ?? '').trim())) out.push('Enter the address to send to.');
  } else out.push('Choose how to send.');
  return out;
}

function isLocalHost(u: string): boolean {
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local') || h === '[::1]';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- messages

export interface AlertEvent {
  source: AlertSource;
  title: string;
  detail?: string;
  /** a problem (site down, backup failed): sent with high priority where the channel has one */
  urgent?: boolean;
  /** a good outcome (back up again) */
  good?: boolean;
  at: number;
}

export interface AlertMessage {
  title: string;
  body: string;
  urgent: boolean;
  events: AlertEvent[];
}

const sourceLabel = (s: AlertSource) => ALERT_SOURCES.find((x) => x.id === s)?.label ?? s;

/** Several alerts that came close together become one message, the most urgent first. */
export function batchMessage(events: AlertEvent[]): AlertMessage | null {
  if (!events.length) return null;
  const list = [...events].sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || a.at - b.at);
  const urgent = list.some((e) => e.urgent);
  if (list.length === 1) {
    const e = list[0];
    return { title: clip(e.title, 120), body: clip(e.detail ? e.detail : sourceLabel(e.source), 900), urgent, events: list };
  }
  const shown = list.slice(0, 12);
  const body = shown.map((e) => `• ${clip(e.title, 120)}${e.detail ? ` — ${clip(e.detail, 160)}` : ''}`).join('\n') + (list.length > shown.length ? `\n…and ${list.length - shown.length} more` : '');
  const sources = [...new Set(list.map((e) => e.source))];
  return { title: `${list.length} alerts from Keeper${sources.length === 1 ? ` · ${sourceLabel(sources[0])}` : ''}`, body, urgent, events: list };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------------------------------------------------------------- requests

export interface AlertRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

/** The HTTP request that delivers a message to a channel (not e-mail, which goes through Mail). */
export function buildRequest(c: AlertChannel, secret: string | undefined, m: AlertMessage, ua = 'Keeper'): AlertRequest {
  const headers: Record<string, string> = { 'user-agent': ua };
  if (c.kind === 'telegram') {
    if (!secret) throw new Error('This Telegram channel has no bot token.');
    return {
      url: `https://api.telegram.org/bot${encodeURIComponent(secret)}/sendMessage`.replace(/%3A/gi, ':'),
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: (c.chatId ?? '').trim(), text: `${m.urgent ? '⚠️ ' : ''}${m.title}\n${m.body}`, disable_web_page_preview: true, disable_notification: !m.urgent }),
    };
  }
  if (c.kind === 'ntfy') {
    const server = (c.server?.trim() || 'https://ntfy.sh').replace(/\/+$/, '');
    // Header values must be plain ASCII: other letters go in the body only.
    const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, '').slice(0, 250);
    return {
      url: `${server}/${encodeURIComponent((c.topic ?? '').trim())}`,
      method: 'POST',
      headers: { ...headers, 'content-type': 'text/plain; charset=utf-8', title: ascii(m.title) || 'Keeper', priority: m.urgent ? 'high' : 'default', tags: m.urgent ? 'warning' : m.events.every((e) => e.good) ? 'white_check_mark' : 'bell', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
      body: m.body,
    };
  }
  if (c.kind === 'webhook') {
    return {
      url: (c.url ?? '').trim(),
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify({ app: 'keeper', title: m.title, text: m.body, urgent: m.urgent, alerts: m.events.map((e) => ({ source: e.source, title: e.title, detail: e.detail ?? null, urgent: !!e.urgent, at: new Date(e.at).toISOString() })) }),
    };
  }
  throw new Error('E-mail alerts are sent through Mail.');
}

/** The e-mail for a message. */
export function emailFor(c: AlertChannel, m: AlertMessage): { account: string; to: string; subject: string; body: string } {
  return { account: c.account ?? '', to: (c.to ?? '').trim(), subject: `${m.urgent ? '[Alert] ' : ''}${m.title}`, body: `${m.body}\n\n— Sent by Keeper on this computer. Change this in Keeper → Phone Alerts.` };
}

/** An error to show: the token never appears in it. */
export function scrubSecret(text: string, secret: string | undefined): string {
  let out = text;
  if (secret) out = out.split(secret).join('•••');
  return out.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot•••');
}

/** What a channel's reply means, in plain words. */
export function replyProblem(kind: AlertChannelKind, status: number, body: string): string | undefined {
  if (status >= 200 && status < 300) {
    if (kind === 'telegram') {
      try {
        if ((JSON.parse(body) as { ok?: boolean }).ok === false) return 'Telegram did not take the message.';
      } catch { /* not JSON: fine */ }
    }
    return undefined;
  }
  if (kind === 'telegram') {
    if (status === 401 || status === 404) return 'Telegram did not accept the bot token.';
    if (status === 400 || status === 403) return 'Telegram could not reach that chat. Send your bot a message first, then check the chat number.';
  }
  if (kind === 'ntfy' && (status === 401 || status === 403)) return 'The ntfy server wants an access token for this topic.';
  if (status === 429) return 'Too many alerts: the service asked Keeper to slow down.';
  return `The service answered ${status}.`;
}

/** The channels that should get an alert from this source. */
export function channelsFor(s: PhoneAlertSettings, source: AlertSource): AlertChannel[] {
  return s.channels.filter((c) => c.on && c.sources.includes(source));
}

/** A short description of a channel for its card: "ntfy.sh · keeper-alerts". */
export function channelLine(c: AlertChannel): string {
  if (c.kind === 'telegram') return `Telegram · chat ${c.chatId ?? ''}`;
  if (c.kind === 'ntfy') return `${(c.server?.trim() || 'https://ntfy.sh').replace(/^https?:\/\//, '').replace(/\/+$/, '')} · ${c.topic ?? ''}`;
  if (c.kind === 'webhook') {
    try { return new URL(c.url ?? '').host; } catch { return 'Web address'; }
  }
  return `E-mail to ${c.to ?? ''}`;
}
