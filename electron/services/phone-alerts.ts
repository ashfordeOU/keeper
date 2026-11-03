// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Alerts to your phone: other parts call phoneAlert(); alerts that come close
// together wait a few seconds and go out as one message per channel. Nothing
// is sent while the part is off or no channel is set up for that kind of alert.
// Tokens live in the keychain (or only in memory where there is none).

import { app } from 'electron';
import type { AlertLogEntry, PhoneAlertsApi, PhoneAlertsOverview } from '../../core/api-alerts';
import {
  batchMessage, buildRequest, channelProblems, channelsFor, emailFor, normalizePhoneAlertSettings, replyProblem, scrubSecret, secretName, secretNeed,
  type AlertChannel, type AlertEvent, type AlertMessage, type AlertSource, type PhoneAlertSettings,
} from '../../core/phone-alerts';
import { getSecret, readSecretState, secureAvailable, setSecret, settings, updateSettings } from '../store';
import { featureOn, onFeature } from './features';

const FEATURE = 'phoneAlerts';
const memorySecrets = new Map<string, string>();
const queue: AlertEvent[] = [];
const log: AlertLogEntry[] = [];
const lastByChannel = new Map<string, { at: number; ok: boolean; message?: string }>();
let timer: NodeJS.Timeout | undefined;
let broadcast: (channel: string) => void = () => undefined;

const options = (): PhoneAlertSettings => normalizePhoneAlertSettings(settings().phoneAlerts);
const ua = () => `Keeper/${app.getVersion()}`;

async function secretOf(id: string): Promise<string | undefined> {
  return memorySecrets.get(id) ?? (await getSecret(secretName(id)).catch(() => undefined));
}

/**
 * Another part has something to say. Returns at once; the message goes out
 * after the batch wait (or straight away when the wait is 0).
 */
export function phoneAlert(source: AlertSource, title: string, detail?: string, o: { urgent?: boolean; good?: boolean } = {}) {
  if (!featureOn(FEATURE)) return;
  if (!channelsFor(options(), source).length) return;
  queue.push({ source, title, detail, urgent: o.urgent, good: o.good, at: Date.now() });
  // A runaway source cannot flood the phone: at most 50 waiting.
  if (queue.length > 50) queue.splice(0, queue.length - 50);
  const wait = options().batchSeconds * 1000;
  if (!timer) {
    timer = setTimeout(() => void flush(), wait);
    timer.unref?.();
  }
  broadcast('alerts-changed');
}

async function flush() {
  timer = undefined;
  const events = queue.splice(0);
  if (!events.length || !featureOn(FEATURE)) return;
  const s = options();
  // Each channel gets only the alerts it is set up for.
  for (const c of s.channels.filter((x) => x.on)) {
    const mine = events.filter((e) => c.sources.includes(e.source));
    const m = batchMessage(mine);
    if (m) await deliver(c, m).catch(() => undefined);
  }
  broadcast('alerts-changed');
}

async function deliver(c: AlertChannel, m: AlertMessage, test = false): Promise<{ ok: boolean; message: string }> {
  let secret: string | undefined;
  let result: { ok: boolean; message: string };
  try {
    if (c.kind === 'email') {
      const e = emailFor(c, m);
      const { pimCalls } = await import('./pim/route');
      await pimCalls.send({ account: e.account, to: [{ address: e.to }], cc: [], bcc: [], subject: e.subject, body: e.body, noSignature: true });
      result = { ok: true, message: `Sent to ${e.to}` };
    } else {
      secret = await secretOf(c.id);
      const r = buildRequest(c, secret, m, ua());
      const u = new URL(r.url);
      const { ownConnectionDenied } = await import('./fw');
      if (await ownConnectionDenied(u.hostname, u.protocol === 'https:' ? 443 : Number(u.port) || 80).catch(() => false)) throw new Error(`Keeper’s firewall blocks ${u.hostname}.`);
      const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body, signal: AbortSignal.timeout(20_000), redirect: 'error' });
      const text = await res.text().catch(() => '');
      const problem = replyProblem(c.kind, res.status, text);
      result = problem ? { ok: false, message: problem } : { ok: true, message: 'Delivered' };
    }
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'TimeoutError' ? 'The service did not answer.' : e.message) : String(e);
    result = { ok: false, message: scrubSecret(msg, secret) };
  }
  lastByChannel.set(c.id, { at: Date.now(), ok: result.ok, message: result.message });
  log.unshift({ at: Date.now(), channel: c.id, title: m.title, sources: [...new Set(m.events.map((e) => e.source))], ok: result.ok, message: result.message, test });
  log.splice(30);
  return result;
}

async function overview(): Promise<PhoneAlertsOverview> {
  const s = options();
  const channels = await Promise.all(s.channels.map(async (c) => {
    if (secretNeed(c.kind) === 'none') return { ...c, hasSecret: false, last: lastByChannel.get(c.id) };
    if (memorySecrets.has(c.id)) return { ...c, hasSecret: true, last: lastByChannel.get(c.id) };
    const st = await readSecretState(secretName(c.id)).catch(() => ({ state: 'missing' as const }));
    return { ...c, hasSecret: st.state === 'ok', secretLocked: st.state === 'locked' || st.state === 'unavailable', last: lastByChannel.get(c.id) };
  }));
  let accounts: PhoneAlertsOverview['accounts'] = [];
  if (featureOn('mail')) {
    try {
      const { pimCalls } = await import('./pim/route');
      accounts = (await pimCalls.accounts()).filter((a) => a.kind === 'imap' || a.kind === 'google' || a.kind === 'microsoft').map((a) => ({ id: a.id, label: a.label, email: a.email }));
    } catch { /* Mail not ready */ }
  }
  return { channels, settings: s, log: log.slice(0, 20), waiting: queue.length, accounts, memoryOnly: !secureAvailable() };
}

async function saveSettings(next: PhoneAlertSettings) {
  await updateSettings({ phoneAlerts: next });
  broadcast('alerts-changed');
}

export const phoneAlertsApi: PhoneAlertsApi = {
  overview,
  async save(channel, secret) {
    const s = options();
    const id = channel.id || `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (secret !== undefined && secretNeed(channel.kind) !== 'none') {
      const clean = secret.trim();
      if (!clean) { memorySecrets.delete(id); await setSecret(secretName(id), ''); }
      else if (await setSecret(secretName(id), clean)) memorySecrets.delete(id);
      else memorySecrets.set(id, clean);
    }
    const has = memorySecrets.has(id) || !!(await secretOf(id));
    const problems = channelProblems(channel, has);
    if (problems.length) throw new Error(problems[0]);
    const clean: AlertChannel = { ...channel, id };
    const channels = s.channels.some((c) => c.id === id) ? s.channels.map((c) => (c.id === id ? clean : c)) : [...s.channels, clean];
    await saveSettings(normalizePhoneAlertSettings({ ...s, channels }));
    return overview();
  },
  async remove(id) {
    const s = options();
    memorySecrets.delete(id);
    await setSecret(secretName(id), '').catch(() => undefined);
    lastByChannel.delete(id);
    await saveSettings({ ...s, channels: s.channels.filter((c) => c.id !== id) });
    return overview();
  },
  async test(id) {
    const c = options().channels.find((x) => x.id === id);
    if (!c) throw new Error('That channel is gone.');
    const m = batchMessage([{ source: c.sources[0] ?? 'monitors', title: 'Keeper can reach you here', detail: 'This is a test from Keeper. Alerts you chose will arrive like this.', at: Date.now(), good: true }])!;
    const r = await deliver(c, m, true);
    broadcast('alerts-changed');
    return r;
  },
  async setBatch(seconds) {
    await saveSettings({ ...options(), batchSeconds: seconds });
    return overview();
  },
};

export function startPhoneAlerts(d: { broadcast: (channel: string) => void }) {
  broadcast = d.broadcast;
  onFeature(FEATURE, (on) => {
    if (on) return;
    // Off: what was waiting is dropped, nothing goes out.
    clearTimeout(timer);
    timer = undefined;
    queue.length = 0;
  });
}
