// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Pro on this computer: the license kept in the keychain, the daily read
// of the remote switch, renewing a subscription's license, and what the
// interface shows. Everything that touches the system (the keychain, the disk,
// the network, the browser) is passed in, so this runs in unit tests as it
// does in the app (electron/services/pro.ts).
//
// With Pro switched off in the build this does nothing at all: no reads, no
// timers, no network. start() returns at once and status() says only "off".

import { entitlements, PAID_FEATURES, planOf, type Entitlements, type EntitlementSource, type Plan } from '../entitlements';
import { configDue, newerConfig, offered, readProConfig, type ProConfig } from './config';
import { findToken, peekLicense, PROBLEM_TEXT, verifyLicense, type LicenseCheck, type PaidPlan } from './license';
import { providerFor, type Period } from './payments';

export const LICENSE_SECRET = 'pro.license';
/** Renew a subscription's license this long before its period ends. */
const RENEW_BEFORE_MS = 7 * 86_400_000;
const HOUR = 3_600_000;

/** Kept in the app's data folder (no secrets: the license itself is in the keychain). */
export interface ProStore {
  /** this install's random Pro reference (for the rollout and "Restore purchase"); never the telemetry ID */
  ref?: string;
  /** the last signed config, exactly as read */
  config?: string;
  configReadAt?: number;
  renewedAt?: number;
  /**
   * the license, only on computers without a keychain (Linux without a keyring); everywhere
   * else it is in the keychain. A license is not a password: it can only use up a seat.
   */
  license?: string;
}

export interface ProDeps {
  enabled: boolean;
  freeThrough: string | null;
  edition: 'direct' | 'mas';
  keys: readonly string[];
  configUrl: string;
  serverUrl: string;
  now(): number;
  fetch(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  load(): Promise<ProStore>;
  save(s: ProStore): Promise<void>;
  getSecret(name: string): Promise<string | undefined>;
  setSecret(name: string, value: string): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  randomRef(): string;
  /** a regular check (the caller decides how; returns a stop function) */
  every(ms: number, fn: () => void): () => void;
  changed?(): void;
}

export interface ProFeatureRow {
  id: string;
  name: string;
  about: string;
  plan: Plan;
  /** not built yet */
  proposal: boolean;
  has: boolean;
}

export type ProStatus =
  | { enabled: false }
  | {
    enabled: true;
    /** Pro is offered to this install now (the remote switch and the rollout) */
    offered: boolean;
    plan: Plan;
    license?: { id: string; plan: PaidPlan; seats: number; exp: number | null; state: 'active' | 'grace'; graceEndsAt?: number; via: string };
    /** a kept license that no longer works, in plain words */
    problem?: string;
    /** checkout pages exist for these plans and periods */
    buy: { plan: PaidPlan; period: Period }[];
    manage: boolean;
    edition: 'direct' | 'mas';
    features: ProFeatureRow[];
  };

export class ProClient {
  private store: ProStore = {};
  private config: ProConfig | null = null;
  private check: LicenseCheck | null = null;
  private token: string | undefined;
  private stop: (() => void) | null = null;

  constructor(private d: ProDeps) {}

  /** Starts the daily checks. Nothing happens with Pro off. */
  async start(): Promise<void> {
    if (!this.d.enabled || this.stop) return;
    await this.load();
    this.stop = this.d.every(HOUR, () => void this.tick());
    void this.tick();
  }

  dispose() {
    this.stop?.();
    this.stop = null;
  }

  private loading: Promise<void> | null = null;

  private load(): Promise<void> {
    return (this.loading ??= this.read());
  }

  private async read() {
    this.store = await this.d.load().catch(() => ({}));
    if (!this.store.ref) { this.store.ref = this.d.randomRef(); await this.d.save(this.store); }
    if (this.store.config) this.config = await readProConfig(this.store.config, this.d.keys, this.d.now());
    this.token = (await this.d.getSecret(LICENSE_SECRET).catch(() => undefined)) ?? this.store.license;
    await this.recheck();
  }

  private async recheck() {
    this.check = this.token ? await verifyLicense(this.token, this.d.keys, this.d.now(), this.config?.revoked ?? []) : null;
  }

  private running: Promise<void> | null = null;

  /** The daily read of the remote switch, and renewing a subscription's license when it is near its end. One at a time. */
  tick(): Promise<void> {
    if (!this.d.enabled) return Promise.resolve();
    this.running ??= this.work().finally(() => { this.running = null; });
    return this.running;
  }

  private async work(): Promise<void> {
    await this.load();
    const now = this.d.now();
    if (configDue(this.store.configReadAt, now)) {
      this.store.configReadAt = now;
      await this.d.save(this.store);
      try {
        const res = await this.d.fetch(this.d.configUrl);
        if (res.ok) {
          const text = await res.text();
          const got = await readProConfig(text, this.d.keys, now);
          const keep = newerConfig(this.config, got);
          if (keep && keep === got) { this.config = got; this.store.config = text; await this.d.save(this.store); }
        }
      } catch { /* offline: try again tomorrow */ }
    }
    const p = this.check?.ok ? this.check.payload : this.token ? peekLicense(this.token) : null;
    if (this.token && p?.exp != null && now > p.exp - RENEW_BEFORE_MS && (!this.store.renewedAt || now - this.store.renewedAt >= 86_400_000)) {
      this.store.renewedAt = now;
      await this.d.save(this.store);
      await this.renew();
    }
    await this.recheck();
    this.d.changed?.();
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
    try {
      const res = await this.d.fetch(`${this.d.serverUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return JSON.parse(await res.text());
    } catch {
      return null;
    }
  }

  private async renew() {
    const r = await this.post('/v1/refresh', { token: this.token });
    const next = typeof r?.token === 'string' ? r.token : null;
    if (next) {
      const c = await verifyLicense(next, this.d.keys, this.d.now(), this.config?.revoked ?? []);
      if (c.ok) { this.token = next; await this.keep(next); }
    }
  }

  /** In the keychain; in the data file only where there is no keychain. '' removes it from both. */
  private async keep(token: string) {
    const inKeychain = await this.d.setSecret(LICENSE_SECRET, token).catch(() => false);
    const file = token && !inKeychain ? token : undefined;
    if (this.store.license !== file) {
      this.store.license = file;
      await this.d.save(this.store);
    }
  }

  private sources(): EntitlementSource[] {
    return this.check ? [{ kind: 'license', check: this.check }] : [];
  }

  entitlements(): Entitlements {
    return entitlements({ enabled: this.d.enabled, freeThrough: this.d.freeThrough, sources: this.sources(), now: this.d.now() });
  }

  async status(): Promise<ProStatus> {
    if (!this.d.enabled) return { enabled: false };
    await this.load();
    const e = this.entitlements();
    const c = this.check;
    const links = this.config?.checkout;
    const buy: { plan: PaidPlan; period: Period }[] = [];
    if (this.d.edition === 'direct') for (const plan of ['pro', 'team'] as const) for (const period of ['month', 'year'] as const) if (links?.[plan]?.[period]) buy.push({ plan, period });
    return {
      enabled: true,
      offered: offered(this.config, this.store.ref ?? ''),
      plan: e.plan,
      license: c?.ok ? { id: c.payload.id, plan: c.payload.plan, seats: c.payload.seats, exp: c.payload.exp, state: c.state, graceEndsAt: c.graceEndsAt, via: c.payload.via } : undefined,
      problem: c && !c.ok ? PROBLEM_TEXT[c.reason] : undefined,
      buy,
      manage: !!links?.manage && this.d.edition === 'direct',
      edition: this.d.edition,
      features: PAID_FEATURES.map((f) => ({ id: f.id, name: f.name, about: f.about, plan: planOf(f.id, this.d.freeThrough), proposal: !f.introducedIn, has: e.has(f.id) })),
    };
  }

  private on() {
    if (!this.d.enabled) throw new Error('Keeper Pro isn’t part of this version.');
  }

  /** A pasted license, or a keeper://license?token=… link. */
  async activate(text: string): Promise<ProStatus> {
    this.on();
    await this.load();
    const token = findToken(text);
    if (!token) throw new Error(PROBLEM_TEXT.malformed);
    const c = await verifyLicense(token, this.d.keys, this.d.now(), this.config?.revoked ?? []);
    if (!c.ok) throw new Error(PROBLEM_TEXT[c.reason]);
    // Seats are counted by the server when it can be reached; offline, the license works anyway.
    const r = await this.post('/v1/activate', { token, seat: this.store.ref });
    if (r && r.ok === false && r.reason === 'seats') throw new Error(`This license is in use on ${c.payload.seats} computer${c.payload.seats === 1 ? '' : 's'}. Remove it from one first.`);
    await this.keep(token);
    this.token = token;
    this.check = c;
    this.d.changed?.();
    return this.status();
  }

  /** Removes the license from this computer, freeing its seat for another one. */
  async deactivate(): Promise<ProStatus> {
    this.on();
    await this.load();
    if (this.token) await this.post('/v1/deactivate', { token: this.token, seat: this.store.ref });
    await this.keep('');
    this.token = undefined;
    this.check = null;
    this.d.changed?.();
    return this.status();
  }

  /** Opens the hosted checkout in the browser. The license comes back by e-mail or a keeper:// link. */
  async checkout(plan: PaidPlan, period: Period): Promise<void> {
    this.on();
    await this.load();
    const links = this.config?.checkout;
    const provider = providerFor(this.d.edition, links?.provider);
    const base = links?.[plan]?.[period];
    const url = provider && base ? provider.checkoutUrl(base, { plan, period, ref: this.store.ref ?? '' }) : null;
    if (!url) throw new Error('Buying isn’t open right now. Try again later.');
    await this.d.openExternal(url);
  }

  async manage(): Promise<void> {
    this.on();
    await this.load();
    const url = this.config?.checkout?.manage;
    if (!url) throw new Error('Nothing to manage yet.');
    await this.d.openExternal(url);
  }

  /** Sends the licenses bought with this address to it again. Says the same whether or not there are any. */
  async restore(email: string): Promise<string> {
    this.on();
    const e = String(email ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('That doesn’t look like an e-mail address.');
    const r = await this.post('/v1/restore', { email: e });
    if (!r) throw new Error('Keeper couldn’t reach Ashforde. Check the connection and try again.');
    return 'If a license was bought with that address, it is on its way.';
  }
}
