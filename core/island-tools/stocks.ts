// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stocks and crypto in the Island: a watchlist with quotes and an intraday
// chart. Sources: Stooq (no key, delayed quotes), Twelve Data (free key,
// intraday) and CoinGecko (crypto, no key). Pure request builders and parsers.

export interface Quote {
  symbol: string;
  price: number;
  /** change since the previous close, in percent */
  changePct?: number;
  currency?: string;
  at?: number;
  source: 'stooq' | 'twelvedata' | 'coingecko';
}

export interface Point { t: number; v: number }

/** "btc", "eth-usd", "crypto:solana" → a CoinGecko id; otherwise undefined. */
const COINS: Record<string, string> = { btc: 'bitcoin', eth: 'ethereum', sol: 'solana', xrp: 'ripple', ada: 'cardano', doge: 'dogecoin', dot: 'polkadot', ltc: 'litecoin', bnb: 'binancecoin', avax: 'avalanche-2', link: 'chainlink', matic: 'matic-network', trx: 'tron', ton: 'the-open-network', usdt: 'tether', usdc: 'usd-coin' };
export function coinId(symbol: string): string | undefined {
  const s = symbol.trim().toLowerCase();
  if (s.startsWith('crypto:')) return s.slice(7);
  return COINS[s.replace(/-usd$/, '')];
}

/** Stooq wants "aapl.us" for US shares; other markets keep their suffix (e.g. "sap.de"). */
export function stooqSymbol(symbol: string): string {
  const s = symbol.trim().toLowerCase();
  return s.includes('.') || s.startsWith('^') ? s : `${s}.us`;
}

export function stooqQuoteUrl(symbols: string[]): string {
  return `https://stooq.com/q/l/?s=${symbols.map(stooqSymbol).join('+')}&f=sd2t2ohlcp&h&e=csv`;
}

/** Stooq CSV: Symbol,Date,Time,Open,High,Low,Close,Prev (one line per symbol; "N/D" when unknown). */
export function parseStooq(csv: string, asked: string[]): Quote[] {
  const lines = csv.trim().split(/\r?\n/);
  const head = lines.shift()?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string) => head.indexOf(name);
  const out: Quote[] = [];
  for (const line of lines) {
    const c = line.split(',');
    const sym = c[col('symbol')]?.toLowerCase();
    const close = Number(c[col('close')]);
    if (!sym || !Number.isFinite(close)) continue;
    const prev = Number(c[col('prev')] ?? c[col('previous')]);
    const date = c[col('date')];
    const tm = c[col('time')];
    const original = asked.find((a) => stooqSymbol(a) === sym) ?? sym.replace(/\.us$/, '').toUpperCase();
    out.push({
      symbol: original.toUpperCase(),
      price: close,
      changePct: Number.isFinite(prev) && prev > 0 ? ((close - prev) / prev) * 100 : undefined,
      at: date && tm ? Date.parse(`${date}T${tm}Z`) || undefined : undefined,
      source: 'stooq',
    });
  }
  return out;
}

export function twelveQuoteUrl(symbols: string[], key: string): string {
  return `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols.join(','))}&apikey=${encodeURIComponent(key)}`;
}
export function twelveSeriesUrl(symbol: string, key: string): string {
  return `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=5min&outputsize=96&apikey=${encodeURIComponent(key)}`;
}

/** One symbol answers with the quote itself; several with { SYMBOL: quote }. */
export function parseTwelveQuotes(body: unknown, asked: string[]): Quote[] {
  const o = (body ?? {}) as Record<string, unknown>;
  const one = (q: Record<string, unknown>, sym: string): Quote | undefined => {
    const price = Number(q.close ?? q.price);
    if (!Number.isFinite(price) || q.status === 'error') return undefined;
    return { symbol: String(q.symbol ?? sym).toUpperCase(), price, changePct: Number(q.percent_change) || undefined, currency: typeof q.currency === 'string' ? q.currency : undefined, at: Number(q.timestamp) ? Number(q.timestamp) * 1000 : undefined, source: 'twelvedata' };
  };
  if (asked.length === 1 || 'close' in o) return [one(o, asked[0])].filter((x): x is Quote => !!x);
  return asked.map((s) => o[s] && one(o[s] as Record<string, unknown>, s)).filter((x): x is Quote => !!x);
}

export function parseTwelveSeries(body: unknown): Point[] {
  const vals = ((body ?? {}) as { values?: { datetime: string; close: string }[] }).values ?? [];
  return vals.map((v) => ({ t: Date.parse(v.datetime.replace(' ', 'T') + 'Z'), v: Number(v.close) })).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
}

export function coingeckoPriceUrl(ids: string[], vs = 'usd'): string {
  return `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=${vs}&include_24hr_change=true&include_last_updated_at=true`;
}
export function coingeckoChartUrl(id: string, vs = 'usd'): string {
  return `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=${vs}&days=1`;
}

export function parseCoingeckoPrices(body: unknown, asked: string[], vs = 'usd'): Quote[] {
  const o = (body ?? {}) as Record<string, Record<string, number>>;
  return asked.flatMap((sym) => {
    const id = coinId(sym);
    const q = id ? o[id] : undefined;
    if (!q || !Number.isFinite(q[vs])) return [];
    return [{ symbol: sym.toUpperCase(), price: q[vs], changePct: q[`${vs}_24h_change`], currency: vs.toUpperCase(), at: q.last_updated_at ? q.last_updated_at * 1000 : undefined, source: 'coingecko' as const }];
  });
}

export function parseCoingeckoChart(body: unknown): Point[] {
  const prices = ((body ?? {}) as { prices?: [number, number][] }).prices ?? [];
  return prices.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([t, v]) => ({ t, v }));
}

/** An SVG path for a sparkline in a w×h box. */
export function sparkPath(points: number[], w: number, h: number): string {
  const vals = points.filter(Number.isFinite);
  if (vals.length < 2) return '';
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  return vals.map((v, i) => `${i ? 'L' : 'M'}${((i / (vals.length - 1)) * w).toFixed(1)},${(h - ((v - lo) / span) * h).toFixed(1)}`).join(' ');
}

/** Normalizes a typed watchlist ("aapl, msft  btc") into unique symbols. */
export function parseWatchlist(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter((s) => /^[\w.^:-]{1,20}$/.test(s)))];
}
