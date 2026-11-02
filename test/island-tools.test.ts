// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import byEmoji from 'unicode-emoji-json/data-by-emoji.json';
import keywords from 'emojilib/dist/emoji-en-US.json';
import { answer, convert, convertCurrency, formatNumber, parseConversion } from '../core/island-tools/units';
import { addRecent, buildIndex, searchEmoji, withTone } from '../core/island-tools/emoji';
import { fromMinor, newSales, parseRates, parseSales, salesRequest, summarize, type Sale } from '../core/island-tools/sales';
import { claudeBlock, claudeLocal, claudeOAuthUsage, claudeTokenLines, codexRateLimits, copilotQuota, copilotToken, cursorUsage, mostUsed, warnLevel } from '../core/island-tools/usage';
import { coinId, parseCoingeckoChart, parseCoingeckoPrices, parseStooq, parseTwelveQuotes, parseTwelveSeries, parseWatchlist, sparkPath, stooqSymbol } from '../core/island-tools/stocks';
import { pixelsPerSecond, readingSeconds, scriptFromText, step, voiceActivity, wordsPerLine } from '../core/island-tools/teleprompter';
import { isConcealed } from '../core/island-tools/clipfilter';
import { moveTool, orderedTools, toggleTool } from '../core/island-tools/tools';
import { normalizeStore, noteTitle, searchNotes, sortTodos, upsert } from '../core/island-tools/notes';

describe('converter', () => {
  it('converts across every kind', () => {
    expect(convert(5, 'ft', 'cm')).toBeCloseTo(152.4, 6);
    expect(convert(100, 'c', 'f')).toBeCloseTo(212, 6);
    expect(convert(32, 'f', 'c')).toBeCloseTo(0, 6);
    expect(convert(1, 'gal', 'l')).toBeCloseTo(3.785411784, 6);
    expect(convert(100, 'kmh', 'mph')).toBeCloseTo(62.1371, 3);
    expect(convert(1, 'acre', 'm2')).toBeCloseTo(4046.856, 2);
    expect(convert(1, 'gib', 'mb')).toBeCloseTo(1073.741824, 6);
    expect(convert(2, 'h', 'min')).toBe(120);
    expect(convert(1, 'kg', 'cm')).toBeUndefined();
  });
  it('understands plain input', () => {
    expect(parseConversion('5 ft in cm')).toEqual({ value: 5, from: 'ft', to: 'cm', dim: 'length' });
    expect(parseConversion('72f to c')?.to).toBe('c');
    expect(parseConversion('1,200 sq ft to m2')).toMatchObject({ value: 1200, from: 'ft2', to: 'm2' });
    expect(parseConversion('€20 in usd')).toEqual({ value: 20, from: 'EUR', to: 'USD', dim: 'currency' });
    expect(parseConversion('5 in cm')).toMatchObject({ from: 'in', to: 'cm' });
    expect(parseConversion('3 cups')).toMatchObject({ from: 'cup' });
    expect(parseConversion('hello')).toBeUndefined();
    expect(parseConversion('5 kg in cm')).toBeUndefined();
  });
  it('answers as you type, with useful defaults and currency only when rates are given', () => {
    expect(answer('10 km')[0].text).toBe('6.21371 mi');
    expect(answer('72 f')[0].text).toBe('22.2222 °C');
    expect(answer('20 eur in usd')).toEqual([]);
    const rates = { base: 'EUR', rates: { USD: 1.1, GBP: 0.85 } };
    expect(answer('20 eur in usd', rates)[0].value).toBeCloseTo(22, 6);
    expect(convertCurrency(11, 'USD', 'GBP', rates)).toBeCloseTo(8.5, 6);
    expect(formatNumber(1234567.891)).toBe('1,234,570');
  });
});

describe('emoji', () => {
  const index = buildIndex(byEmoji as never, keywords as never);
  it('has the full set', () => expect(index.length).toBeGreaterThan(1800));
  it('finds by name and keyword, best first', () => {
    expect(searchEmoji(index, 'thumbs up')[0].e).toBe('👍');
    expect(searchEmoji(index, 'pizza')[0].e).toBe('🍕');
    expect(searchEmoji(index, 'haha').map((x) => x.e)).toContain('😃');
    expect(searchEmoji(index, 'zzzqqq')).toEqual([]);
  });
  it('adds skin tones only where supported, and keeps recents', () => {
    const wave = index.find((x) => x.e === '👋')!;
    expect(withTone(wave, 3)).toBe('👋🏽');
    expect(withTone(index.find((x) => x.e === '🍕')!, 3)).toBe('🍕');
    expect(addRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
  });
});

describe('sales', () => {
  const since = Date.parse('2026-10-01T00:00:00Z');
  it('builds read-only requests', () => {
    expect(salesRequest('stripe', 'rk', since).url).toContain('/v1/charges?limit=100&created[gte]=');
    expect(salesRequest('shopify', 'tok', since, { shop: 'https://demo.myshopify.com/' }).url).toMatch(/^https:\/\/demo\.myshopify\.com\/admin\/api\/.*orders\.json/);
    expect(salesRequest('shopify', 'tok', since).headers['x-shopify-access-token']).toBe('tok');
  });
  it('reads each service, leaving out refunds, failures and test sales', () => {
    const stripe = parseSales('stripe', { has_more: true, data: [
      { id: 'ch1', created: since / 1000 + 10, amount: 1999, amount_refunded: 0, currency: 'usd', status: 'succeeded', paid: true, livemode: true },
      { id: 'ch2', created: since / 1000 + 20, amount: 500, currency: 'usd', status: 'failed', paid: false, livemode: true },
      { id: 'ch3', created: since / 1000 + 30, amount: 1000, amount_refunded: 400, currency: 'jpy', status: 'succeeded', paid: true, livemode: true },
    ] }, since);
    expect(stripe.sales.map((s) => s.amount)).toEqual([19.99, 600]);
    expect(stripe.next).toBe('ch3');
    const shop = parseSales('shopify', { orders: [{ id: 1, created_at: '2026-10-02T10:00:00Z', current_total_price: '42.50', currency: 'EUR', financial_status: 'paid' }, { id: 2, created_at: '2026-10-02T10:00:00Z', total_price: '9', currency: 'EUR', financial_status: 'refunded' }] }, since, '<https://x/next>; rel="next"');
    expect(shop.sales).toHaveLength(1);
    expect(shop.next).toBe('https://x/next');
    const ls = parseSales('lemonsqueezy', { data: [{ id: '9', attributes: { status: 'paid', total: 1200, currency: 'USD', created_at: '2026-10-03T00:00:00Z', test_mode: false } }] }, since);
    expect(ls.sales[0].amount).toBe(12);
    expect(parseSales('gumroad', { sales: [{ id: 'g', price: 500, currency: 'usd', created_at: '2026-10-04T00:00:00Z' }, { id: 'h', price: 500, refunded: true, created_at: '2026-10-04T00:00:00Z' }] }, since).sales).toHaveLength(1);
    expect(parseSales('paddle', { data: [{ id: 'txn', currency_code: 'USD', created_at: '2026-10-05T00:00:00Z', details: { totals: { grand_total: '2500' } } }], meta: { pagination: { has_more: false } } }, since).sales[0].amount).toBe(25);
    expect(parseSales('polar', { items: [{ id: 'o', created_at: '2026-10-05T00:00:00Z', net_amount: 900, currency: 'usd' }], pagination: { page: 1, max_page: 1 } }, since).sales[0].amount).toBe(9);
    expect(parseSales('dodo', { items: [{ payment_id: 'p', created_at: '2026-10-05T00:00:00Z', total_amount: 300, currency: 'USD', status: 'succeeded' }] }, since).sales[0].amount).toBe(3);
  });
  it('totals in one currency, keeps what cannot be converted apart, and spots new sales', () => {
    const now = Date.parse('2026-10-31T12:00:00');
    const sales: Sale[] = [
      { provider: 'stripe', id: 'a', at: now - 3600_000, amount: 10, currency: 'USD' },
      { provider: 'stripe', id: 'a', at: now - 3600_000, amount: 10, currency: 'USD' },
      { provider: 'shopify', id: 'b', at: now - 3 * 86_400_000, amount: 20, currency: 'EUR' },
      { provider: 'gumroad', id: 'c', at: now - 20 * 86_400_000, amount: 5, currency: 'CHF' },
    ];
    const s = summarize(sales, 'usd', now, { base: 'EUR', rates: { USD: 1.1 } });
    expect(s.today).toBe(10);
    expect(s.week).toBe(32);
    expect(s.month).toBe(32);
    expect(s.unconverted).toEqual([{ currency: 'CHF', amount: 5 }]);
    expect(s.daily).toHaveLength(30);
    expect(newSales(sales.slice(0, 1), sales).map((x) => x.id)).toEqual(['b', 'c']);
    expect(fromMinor(1000, 'KWD')).toBe(1);
    expect(parseRates({ base: 'EUR', date: '2026-10-30', rates: { USD: 1.1 } })?.rates.USD).toBe(1.1);
  });
});

describe('AI usage', () => {
  const now = Date.parse('2026-10-31T12:30:00Z');
  const line = (ts: string, id: string, i: number, o: number) => JSON.stringify({ type: 'assistant', timestamp: ts, requestId: id, message: { id, model: 'claude-opus-5-5', usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: 0 } } });
  it('counts Claude Code tokens once per message and finds the open 5-hour block', () => {
    const jsonl = [line('2026-10-31T10:05:00Z', 'm1', 100, 50), line('2026-10-31T10:05:00Z', 'm1', 100, 50), line('2026-10-31T11:00:00Z', 'm2', 10, 5), 'not json', line('2026-10-25T01:00:00Z', 'm0', 1000, 0)].join('\n');
    const lines = claudeTokenLines(jsonl);
    expect(lines).toHaveLength(3);
    const block = claudeBlock(lines, now)!;
    expect(block.tokens).toBe(165);
    expect(new Date(block.end).toISOString()).toBe('2026-10-31T15:00:00.000Z');
    expect(claudeLocal(lines, now)[1].tokens).toBe(1165);
  });
  it('reads Anthropic\'s usage answer in both shapes', () => {
    expect(claudeOAuthUsage({ five_hour: { utilization: 42, resets_at: '2026-10-31T15:00:00Z' }, seven_day: { utilization: 0.71 } }).map((w) => [w.label, Math.round(w.usedPercent!)])).toEqual([['5-hour session', 42], ['Weekly', 71]]);
    expect(claudeOAuthUsage({ limits: [{ name: 'weekly_opus', utilization: 12 }] })[0].label).toBe('Weekly opus');
  });
  it('reads Codex limits from the newest report, older and newer field names', () => {
    const older = JSON.stringify({ timestamp: '2026-10-31T12:00:00Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 30, window_minutes: 300, resets_in_seconds: 600 }, secondary: { used_percent: 55, window_minutes: 10080, resets_in_seconds: 86400 } } } });
    const w = codexRateLimits(`{"x":1}\n${older}\n`)!;
    expect(w.map((x) => x.label)).toEqual(['5-hour session', 'Weekly']);
    expect(new Date(w[0].resetsAt!).toISOString()).toBe('2026-10-31T12:10:00.000Z');
    const newer = JSON.stringify({ payload: { rate_limit: { primary_window: { used_percent: 90, limit_window_seconds: 18000, reset_at: 1793462400 } } } });
    expect(codexRateLimits(newer)![0]).toMatchObject({ label: '5-hour session', usedPercent: 90 });
    expect(codexRateLimits('{"type":"message"}')).toBeUndefined();
  });
  it('reads Copilot and Cursor quotas', () => {
    expect(copilotToken(JSON.stringify({ 'github.com:Iv1.abc': { oauth_token: 'gho_x', user: 'me' } }))).toBe('gho_x');
    const q = copilotQuota({ quota_reset_date: '2026-11-01', quota_snapshots: { premium_interactions: { entitlement: 300, remaining: 71, unlimited: false }, chat: { unlimited: true } } });
    expect(q).toHaveLength(1);
    expect(Math.round(q[0].usedPercent!)).toBe(76);
    expect(q[0].used).toBe(229);
    const c = cursorUsage({ 'gpt-4': { numRequests: 250, maxRequestUsage: 500 }, startOfMonth: '2026-10-05T00:00:00Z' });
    expect(c[0].usedPercent).toBe(50);
    expect(new Date(c[0].resetsAt!).getUTCMonth()).toBe(10);
  });
  it('picks the window nearest its limit', () => {
    const m = mostUsed([{ tool: 'codex', label: 'Codex', state: 'ok', windows: [{ label: 'Weekly', usedPercent: 85 }], source: '', updatedAt: 0 }, { tool: 'claude', label: 'Claude Code', state: 'ok', windows: [{ label: '5-hour session', usedPercent: 40 }], source: '', updatedAt: 0 }]);
    expect(m?.tool).toBe('codex');
    expect(warnLevel(85)).toBe('high');
    expect(warnLevel(99)).toBe('full');
  });
});

describe('stocks', () => {
  it('reads Stooq, Twelve Data and CoinGecko', () => {
    expect(stooqSymbol('aapl')).toBe('aapl.us');
    expect(stooqSymbol('sap.de')).toBe('sap.de');
    const q = parseStooq('Symbol,Date,Time,Open,High,Low,Close,Prev\nAAPL.US,2026-10-30,22:00:05,230,232,229,231.5,230\nXYZ.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D', ['AAPL', 'XYZ']);
    expect(q).toHaveLength(1);
    expect(q[0].symbol).toBe('AAPL');
    expect(q[0].changePct).toBeCloseTo(0.652, 2);
    expect(parseTwelveQuotes({ symbol: 'MSFT', close: '410.2', percent_change: '1.2', currency: 'USD' }, ['MSFT'])[0].price).toBe(410.2);
    expect(parseTwelveQuotes({ MSFT: { close: '1' }, NVDA: { status: 'error' } }, ['MSFT', 'NVDA'])).toHaveLength(1);
    expect(parseTwelveSeries({ values: [{ datetime: '2026-10-30 15:55:00', close: '2' }, { datetime: '2026-10-30 15:50:00', close: '1' }] }).map((p) => p.v)).toEqual([1, 2]);
    expect(coinId('BTC')).toBe('bitcoin');
    expect(parseCoingeckoPrices({ bitcoin: { usd: 70000, usd_24h_change: -1.5 } }, ['BTC'])[0]).toMatchObject({ symbol: 'BTC', price: 70000 });
    expect(parseCoingeckoChart({ prices: [[1, 2], [3, 4]] })).toHaveLength(2);
    expect(sparkPath([1, 2, 3], 100, 10)).toBe('M0.0,10.0 L50.0,5.0 L100.0,0.0');
    expect(parseWatchlist('aapl, msft  btc aapl')).toEqual(['AAPL', 'MSFT', 'BTC']);
  });
});

describe('teleprompter', () => {
  it('paces by words a minute and stops at the end', () => {
    const wpl = wordsPerLine(600, 24);
    expect(wpl).toBeGreaterThan(5);
    const pps = pixelsPerSecond(140, wpl, 34);
    expect(pps).toBeGreaterThan(5);
    expect(step(0, 0.2, pps, 1000, true)).toBeCloseTo(pps * 0.2, 6);
    expect(step(0, 5, pps, 1000, true)).toBeCloseTo(pps * 0.25, 6);
    expect(step(990, 1, 50, 1000, true)).toBe(1000);
    expect(step(10, 1, 50, 1000, false)).toBe(10);
    expect(readingSeconds('one two three four five six seven', 140)).toBe(3);
    expect(scriptFromText('# Title\n**Hello** [there](http://x)')).toBe('Title\nHello there');
  });
  it('follows the voice: speaking above the floor, the floor adapting only in quiet', () => {
    let floor = 0.01;
    const quiet = voiceActivity(0.012, floor);
    expect(quiet.speaking).toBe(false);
    floor = quiet.floor;
    const talk = voiceActivity(0.08, floor);
    expect(talk.speaking).toBe(true);
    expect(talk.floor).toBe(floor);
  });
});

describe('clipboard secrecy', () => {
  it('skips concealed and transient copies on every system', () => {
    expect(isConcealed(['public.utf8-plain-text', 'org.nspasteboard.ConcealedType'])).toBe(true);
    expect(isConcealed(['org.nspasteboard.TransientType'])).toBe(true);
    expect(isConcealed(['ExcludeClipboardContentFromMonitorProcessing'])).toBe(true);
    expect(isConcealed(['CanIncludeInClipboardHistory'], { CanIncludeInClipboardHistory: 0 })).toBe(true);
    expect(isConcealed(['CanIncludeInClipboardHistory'], { CanIncludeInClipboardHistory: 1 })).toBe(false);
    expect(isConcealed(['x-kde-passwordManagerHint'], { 'x-kde-passwordManagerHint': 'secret' })).toBe(true);
    expect(isConcealed(['text/plain', 'text/html'])).toBe(false);
  });
});

describe('tool order', () => {
  it('keeps the person\'s order, adds new tools, hides turned-off ones', () => {
    const t = orderedTools(['notes', 'home', 'gone'], ['sales', 'stocks', 'prompter', 'shortcuts', 'emoji']);
    expect(t[0]).toBe('notes');
    expect(t[1]).toBe('home');
    expect(t).not.toContain('sales');
    expect(t).not.toContain('emoji');
    expect(t).toContain('ask');
    // Every tool is offered in More unless turned off (or its feature is off, which `available` checks).
    expect(orderedTools(undefined, undefined)).toContain('sales');
    expect(orderedTools(undefined, undefined, (id) => id !== 'sales')).not.toContain('sales');
    expect(moveTool(undefined, 'emoji', 0)[0]).toBe('emoji');
    expect(toggleTool(undefined, 'sales', true)).not.toContain('sales');
    expect(toggleTool([], 'ask', false)).toEqual(['ask']);
  });
});

describe('notes and to-dos', () => {
  it('titles, searches, sorts and upserts', () => {
    const s = normalizeStore({ notes: [{ id: '1', text: '# Groceries\nmilk', created: 1, updated: 1 }, { id: '2', text: 'Call Ana', created: 2, updated: 2, pinned: true }], todos: [{ id: 'a', text: 'x', done: true, starred: false, created: 1, doneAt: 5 }, { id: 'b', text: 'y', done: false, starred: true, created: 2 }, { id: 'c', text: 'z', done: false, starred: false, created: 1 }] });
    expect(noteTitle(s.notes[0])).toBe('Groceries');
    expect(searchNotes(s.notes, 'milk').map((n) => n.id)).toEqual(['1']);
    expect(searchNotes(s.notes, '').map((n) => n.id)).toEqual(['2', '1']);
    expect(sortTodos(s.todos).map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(upsert(s.todos, { ...s.todos[0], text: 'X' })[0].text).toBe('X');
    expect(normalizeStore(null).stocks.length).toBeGreaterThan(0);
  });
});
