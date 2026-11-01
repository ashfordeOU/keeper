// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sales in the Island: today's, this week's and this month's revenue across
// payment and storefront services, read with the person's own read-only keys.
// Pure: request shapes, response parsing, totals and currency conversion.

import { convertCurrency, type Rates } from './units';

export type SalesProvider = 'stripe' | 'shopify' | 'lemonsqueezy' | 'gumroad' | 'paddle' | 'polar' | 'dodo';

export const SALES_PROVIDERS: { id: SalesProvider; label: string; keyHint: string; needsShop?: boolean }[] = [
  { id: 'stripe', label: 'Stripe', keyHint: 'A restricted key with read access to Charges (rk_live_…)' },
  { id: 'shopify', label: 'Shopify', keyHint: 'An Admin API access token with read_orders', needsShop: true },
  { id: 'lemonsqueezy', label: 'Lemon Squeezy', keyHint: 'An API key from Settings → API' },
  { id: 'gumroad', label: 'Gumroad', keyHint: 'An access token from Settings → Advanced → Applications' },
  { id: 'paddle', label: 'Paddle', keyHint: 'An API key with read permission for transactions' },
  { id: 'polar', label: 'Polar', keyHint: 'An organization access token with orders:read' },
  { id: 'dodo', label: 'Dodo Payments', keyHint: 'An API key (read-only where available)' },
];

export interface Sale {
  provider: SalesProvider;
  id: string;
  at: number;
  /** in the currency's major unit (e.g. dollars) */
  amount: number;
  currency: string;
}

export interface SalesRequest {
  url: string;
  headers: Record<string, string>;
}

/** One page of sales since `since` (ms). `cursor` continues a previous page. */
export function salesRequest(p: SalesProvider, key: string, since: number, opts: { shop?: string; cursor?: string; base?: string } = {}): SalesRequest {
  const iso = new Date(since).toISOString();
  const secs = Math.floor(since / 1000);
  const b = opts.base;
  const bearer = { authorization: `Bearer ${key}`, accept: 'application/json' };
  switch (p) {
    case 'stripe':
      return { url: `${b ?? 'https://api.stripe.com'}/v1/charges?limit=100&created[gte]=${secs}${opts.cursor ? `&starting_after=${encodeURIComponent(opts.cursor)}` : ''}`, headers: bearer };
    case 'shopify': {
      const shop = (opts.shop ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      return { url: opts.cursor ?? `${b ?? `https://${shop}`}/admin/api/2025-01/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(iso)}&fields=id,created_at,current_total_price,total_price,currency,financial_status,cancelled_at`, headers: { 'x-shopify-access-token': key, accept: 'application/json' } };
    }
    case 'lemonsqueezy':
      return { url: opts.cursor ?? `${b ?? 'https://api.lemonsqueezy.com'}/v1/orders?page[size]=100&sort=-createdAt`, headers: { ...bearer, accept: 'application/vnd.api+json' } };
    case 'gumroad':
      return { url: opts.cursor ?? `${b ?? 'https://api.gumroad.com'}/v2/sales?after=${iso.slice(0, 10)}`, headers: bearer };
    case 'paddle':
      return { url: opts.cursor ?? `${b ?? 'https://api.paddle.com'}/transactions?status=completed,billed&created_at[GTE]=${encodeURIComponent(iso)}&per_page=200`, headers: bearer };
    case 'polar':
      return { url: `${b ?? 'https://api.polar.sh'}/v1/orders/?limit=100&sorting=-created_at${opts.cursor ? `&page=${opts.cursor}` : ''}`, headers: bearer };
    case 'dodo':
      return { url: `${b ?? 'https://live.dodopayments.com'}/payments?page_size=100&created_at_gte=${encodeURIComponent(iso)}${opts.cursor ? `&page_number=${opts.cursor}` : ''}`, headers: bearer };
  }
}

/** Currencies whose minor unit is not 1/100. */
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);
export function fromMinor(amount: number, currency: string): number {
  const c = currency.toUpperCase();
  return amount / (ZERO_DECIMAL.has(c) ? 1 : THREE_DECIMAL.has(c) ? 1000 : 100);
}

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const time = (v: unknown): number => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : typeof v === 'string' ? Date.parse(v) : NaN);

export interface SalesPage {
  sales: Sale[];
  /** what to pass as `cursor` for the next page, when there is one */
  next?: string;
}

/** Reads one page of a provider's response. Refunded, failed and test items are left out. */
export function parseSales(p: SalesProvider, body: unknown, since: number, linkHeader?: string): SalesPage {
  const o = (body ?? {}) as Record<string, unknown>;
  const out: Sale[] = [];
  const push = (id: unknown, at: number, amount: number, currency: unknown) => {
    if (!Number.isFinite(at) || at < since || !Number.isFinite(amount) || typeof currency !== 'string') return;
    out.push({ provider: p, id: String(id), at, amount, currency: currency.toUpperCase() });
  };
  switch (p) {
    case 'stripe': {
      const data = (o.data as Record<string, unknown>[]) ?? [];
      for (const c of data) {
        if (c.paid === false || c.status !== 'succeeded' || c.livemode === false) continue;
        const refunded = num(c.amount_refunded) || 0;
        push(c.id, time(c.created), fromMinor(num(c.amount) - refunded, String(c.currency)), c.currency);
      }
      return { sales: out, next: o.has_more && data.length ? String(data[data.length - 1].id) : undefined };
    }
    case 'shopify': {
      for (const r of (o.orders as Record<string, unknown>[]) ?? []) {
        if (r.cancelled_at || r.financial_status === 'refunded' || r.financial_status === 'voided') continue;
        push(r.id, time(r.created_at), num(r.current_total_price ?? r.total_price), r.currency);
      }
      const next = linkHeader?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      return { sales: out, next };
    }
    case 'lemonsqueezy': {
      let older = false;
      for (const d of (o.data as Record<string, unknown>[]) ?? []) {
        const a = (d.attributes ?? {}) as Record<string, unknown>;
        if (time(a.created_at) < since) older = true;
        if (a.status !== 'paid' || a.test_mode === true) continue;
        push(d.id, time(a.created_at), fromMinor(num(a.total), String(a.currency)), a.currency);
      }
      const next = ((o.links ?? {}) as Record<string, unknown>).next;
      return { sales: out, next: !older && typeof next === 'string' ? next : undefined };
    }
    case 'gumroad': {
      for (const s of (o.sales as Record<string, unknown>[]) ?? []) {
        if (s.refunded === true || s.chargedback === true || s.test === true) continue;
        const cur = typeof s.currency === 'string' ? s.currency : 'usd';
        push(s.id, time(s.created_at), fromMinor(num(s.price), cur), cur);
      }
      return { sales: out, next: typeof o.next_page_url === 'string' ? `https://api.gumroad.com${o.next_page_url}` : undefined };
    }
    case 'paddle': {
      for (const t of (o.data as Record<string, unknown>[]) ?? []) {
        const totals = (((t.details ?? {}) as Record<string, unknown>).totals ?? {}) as Record<string, unknown>;
        const cur = String(t.currency_code ?? totals.currency_code ?? '');
        push(t.id, time(t.created_at ?? t.billed_at), fromMinor(num(totals.grand_total ?? totals.total), cur), cur);
      }
      const meta = ((o.meta ?? {}) as Record<string, unknown>).pagination as Record<string, unknown> | undefined;
      return { sales: out, next: meta?.has_more && typeof meta.next === 'string' ? meta.next : undefined };
    }
    case 'polar': {
      let older = false;
      for (const r of (o.items as Record<string, unknown>[]) ?? []) {
        if (time(r.created_at) < since) older = true;
        if (r.status === 'refunded' || r.paid === false) continue;
        const cur = String(r.currency ?? 'usd');
        push(r.id, time(r.created_at), fromMinor(num(r.net_amount ?? r.total_amount ?? r.amount), cur), cur);
      }
      const pg = (o.pagination ?? {}) as Record<string, unknown>;
      const page = num(pg.page ?? 1);
      return { sales: out, next: !older && num(pg.max_page) > page ? String(page + 1) : undefined };
    }
    case 'dodo': {
      const items = (o.items as Record<string, unknown>[]) ?? [];
      for (const r of items) {
        if (r.status !== 'succeeded') continue;
        push(r.payment_id ?? r.id, time(r.created_at), fromMinor(num(r.total_amount), String(r.currency)), r.currency);
      }
      return { sales: out, next: items.length >= 100 ? String(num(o.page_number ?? 0) + 1) : undefined };
    }
  }
}

export interface SalesSummary {
  currency: string;
  today: number;
  week: number;
  month: number;
  count: { today: number; week: number; month: number };
  /** totals per day, oldest first, for a sparkline (30 days) */
  daily: number[];
  byProvider: { provider: SalesProvider; month: number }[];
  /** amounts in currencies with no rate (kept apart rather than guessed) */
  unconverted: { currency: string; amount: number }[];
  latest?: Sale;
}

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Totals in `currency`, converting with `rates` when given. */
export function summarize(sales: Sale[], currency: string, now = Date.now(), rates?: Rates): SalesSummary {
  const cur = currency.toUpperCase();
  const today0 = startOfDay(now);
  const week0 = today0 - 6 * 86_400_000;
  const month0 = today0 - 29 * 86_400_000;
  const s: SalesSummary = { currency: cur, today: 0, week: 0, month: 0, count: { today: 0, week: 0, month: 0 }, daily: Array(30).fill(0), byProvider: [], unconverted: [] };
  const per = new Map<SalesProvider, number>();
  const seen = new Set<string>();
  for (const x of sales) {
    const key = `${x.provider}:${x.id}`;
    if (seen.has(key) || x.at < month0) continue;
    seen.add(key);
    const v = x.currency === cur ? x.amount : rates ? convertCurrency(x.amount, x.currency, cur, rates) : undefined;
    if (v === undefined) {
      const u = s.unconverted.find((y) => y.currency === x.currency);
      if (u) u.amount += x.amount;
      else s.unconverted.push({ currency: x.currency, amount: x.amount });
      continue;
    }
    s.month += v;
    s.count.month++;
    if (x.at >= week0) { s.week += v; s.count.week++; }
    if (x.at >= today0) { s.today += v; s.count.today++; }
    const day = Math.floor((startOfDay(x.at) - month0) / 86_400_000);
    if (day >= 0 && day < 30) s.daily[day] += v;
    per.set(x.provider, (per.get(x.provider) ?? 0) + v);
    if (!s.latest || x.at > s.latest.at) s.latest = x;
  }
  s.byProvider = [...per].map(([provider, month]) => ({ provider, month })).sort((a, b) => b.month - a.month);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  s.today = r2(s.today); s.week = r2(s.week); s.month = r2(s.month);
  s.daily = s.daily.map(r2);
  return s;
}

/** Sales that were not in the previous fetch (for a "new sale" ping). */
export function newSales(prev: Sale[], next: Sale[]): Sale[] {
  const had = new Set(prev.map((s) => `${s.provider}:${s.id}`));
  return next.filter((s) => !had.has(`${s.provider}:${s.id}`));
}

/** Exchange rates from the ECB reference feed (frankfurter.app JSON shape), opt-in. */
export function parseRates(body: unknown): Rates | undefined {
  const o = (body ?? {}) as Record<string, unknown>;
  if (typeof o.base !== 'string' || typeof o.rates !== 'object' || !o.rates) return undefined;
  return { base: o.base.toUpperCase(), rates: o.rates as Record<string, number>, date: typeof o.date === 'string' ? o.date : undefined };
}
