// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Web search through the service the person chose. Each answers with the same
// shape (title, link, excerpt, date), so any AI can cite results as [n].
//
//   searxng   a SearXNG server (self-hosted or one the person trusts); no key
//   brave     Brave Search API
//   tavily    Tavily
//   exa       Exa
//   kagi      Kagi Search API
//   google    Google Programmable Search (key + engine id)
//   xai       xAI's web_search tool on its Responses API (needs an xAI key)
//   free      no key: encyclopedia and instant answers only (Wikipedia, DuckDuckGo
//             Instant Answer API). Full web results need one of the above.
//
// Bing's search API was retired by Microsoft in August 2025, so it is not offered.

import type { SearchProviderId } from './config';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  source: string;
}

export interface SearchDeps {
  fetch: typeof fetch;
  key?: string;
  searxngUrl?: string;
  googleCx?: string;
  region?: string;
  safe?: boolean;
  /** model for the xAI search tool */
  xaiModel?: string;
}

export const SEARCH_PROVIDERS: { id: SearchProviderId; label: string; needsKey: boolean; keyHint?: string; site: string }[] = [
  { id: 'free', label: 'Built in (encyclopedia and quick answers, no key)', needsKey: false, site: 'https://www.wikipedia.org' },
  { id: 'searxng', label: 'SearXNG (your own server)', needsKey: false, site: 'https://docs.searxng.org' },
  { id: 'brave', label: 'Brave Search', needsKey: true, keyHint: 'API key from api-dashboard.search.brave.com', site: 'https://brave.com/search/api/' },
  { id: 'tavily', label: 'Tavily', needsKey: true, keyHint: 'API key from app.tavily.com', site: 'https://tavily.com' },
  { id: 'exa', label: 'Exa', needsKey: true, keyHint: 'API key from dashboard.exa.ai', site: 'https://exa.ai' },
  { id: 'kagi', label: 'Kagi', needsKey: true, keyHint: 'API token from kagi.com/settings?p=api', site: 'https://help.kagi.com/kagi/api/search.html' },
  { id: 'google', label: 'Google Programmable Search', needsKey: true, keyHint: 'API key and search engine id (cx)', site: 'https://developers.google.com/custom-search' },
  { id: 'xai', label: 'xAI web search', needsKey: true, keyHint: 'xAI API key (console.x.ai)', site: 'https://docs.x.ai' },
];

async function json(res: Response, who: string): Promise<unknown> {
  if (res.status === 401 || res.status === 403) throw new Error(`${who} refused the key`);
  if (res.status === 429) throw new Error(`${who} says too many searches; try again later`);
  if (!res.ok) throw new Error(`${who} answered ${res.status}`);
  return res.json();
}

const clip = (s: unknown, n = 400) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function webSearch(provider: SearchProviderId, query: string, limit: number, d: SearchDeps, recentDays?: number): Promise<SearchResult[]> {
  const n = Math.max(1, Math.min(10, Math.round(limit) || 6));
  const q = encodeURIComponent(query);
  switch (provider) {
    case 'searxng': {
      const base = (d.searxngUrl ?? '').replace(/\/+$/, '');
      if (!base) throw new Error('Enter your SearXNG address in Settings');
      const range = recentDays ? (recentDays <= 1 ? '&time_range=day' : recentDays <= 7 ? '&time_range=week' : recentDays <= 31 ? '&time_range=month' : '&time_range=year') : '';
      const j = (await json(await d.fetch(`${base}/search?q=${q}&format=json&safesearch=${d.safe === false ? 0 : 1}${range}${d.region ? `&language=${encodeURIComponent(d.region)}` : ''}`), 'SearXNG')) as { results?: { title: string; url: string; content?: string; publishedDate?: string }[] };
      return (j.results ?? []).slice(0, n).map((r) => ({ title: clip(r.title, 200), url: r.url, snippet: clip(r.content), date: r.publishedDate ?? undefined, source: 'SearXNG' }));
    }
    case 'brave': {
      const fresh = recentDays ? (recentDays <= 1 ? '&freshness=pd' : recentDays <= 7 ? '&freshness=pw' : recentDays <= 31 ? '&freshness=pm' : '&freshness=py') : '';
      const j = (await json(await d.fetch(`https://api.search.brave.com/res/v1/web/search?q=${q}&count=${n}${fresh}&safesearch=${d.safe === false ? 'off' : 'moderate'}`, { headers: { accept: 'application/json', 'x-subscription-token': d.key ?? '' } }), 'Brave Search')) as { web?: { results?: { title: string; url: string; description?: string; page_age?: string; age?: string }[] } };
      return (j.web?.results ?? []).slice(0, n).map((r) => ({ title: clip(r.title, 200), url: r.url, snippet: clip(r.description), date: r.page_age ?? r.age, source: 'Brave Search' }));
    }
    case 'tavily': {
      const j = (await json(await d.fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${d.key ?? ''}` }, body: JSON.stringify({ query, max_results: n, ...(recentDays ? { days: recentDays, topic: 'news' } : {}) }) }), 'Tavily')) as { results?: { title: string; url: string; content?: string; published_date?: string }[] };
      return (j.results ?? []).slice(0, n).map((r) => ({ title: clip(r.title, 200), url: r.url, snippet: clip(r.content), date: r.published_date, source: 'Tavily' }));
    }
    case 'exa': {
      const since = recentDays ? new Date(Date.now() - recentDays * 86_400_000).toISOString() : undefined;
      const j = (await json(await d.fetch('https://api.exa.ai/search', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': d.key ?? '' }, body: JSON.stringify({ query, numResults: n, ...(since ? { startPublishedDate: since } : {}), contents: { text: { maxCharacters: 600 } } }) }), 'Exa')) as { results?: { title?: string; url: string; text?: string; publishedDate?: string }[] };
      return (j.results ?? []).slice(0, n).map((r) => ({ title: clip(r.title ?? r.url, 200), url: r.url, snippet: clip(r.text), date: r.publishedDate, source: 'Exa' }));
    }
    case 'kagi': {
      const j = (await json(await d.fetch(`https://kagi.com/api/v0/search?q=${q}&limit=${n}`, { headers: { authorization: `Bot ${d.key ?? ''}` } }), 'Kagi')) as { data?: { t: number; title?: string; url?: string; snippet?: string; published?: string }[] };
      return (j.data ?? []).filter((r) => r.t === 0 && r.url).slice(0, n).map((r) => ({ title: clip(r.title, 200), url: r.url!, snippet: clip(r.snippet), date: r.published, source: 'Kagi' }));
    }
    case 'google': {
      if (!d.googleCx) throw new Error('Enter your Programmable Search engine id (cx) in Settings');
      const j = (await json(await d.fetch(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(d.key ?? '')}&cx=${encodeURIComponent(d.googleCx)}&q=${q}&num=${n}${recentDays ? `&dateRestrict=d${recentDays}` : ''}&safe=${d.safe === false ? 'off' : 'active'}`), 'Google')) as { items?: { title: string; link: string; snippet?: string }[] };
      return (j.items ?? []).slice(0, n).map((r) => ({ title: clip(r.title, 200), url: r.link, snippet: clip(r.snippet), source: 'Google' }));
    }
    case 'xai': {
      const r = await xaiToolSearch('web_search', query, d);
      return r.citations.slice(0, n).map((c, i) => ({ title: c.title ?? c.url, url: c.url, snippet: i === 0 ? clip(r.text, 600) : '', source: 'xAI' }));
    }
    case 'free': {
      return freeSearch(query, n, d);
    }
  }
}

/** No key needed: Wikipedia's search and DuckDuckGo's Instant Answer API (an official, public API). */
async function freeSearch(query: string, n: number, d: SearchDeps): Promise<SearchResult[]> {
  const lang = (d.region ?? '').slice(0, 2).toLowerCase() || 'en';
  const out: SearchResult[] = [];
  const q = encodeURIComponent(query);
  const [ia, wiki] = await Promise.allSettled([
    d.fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`).then((r) => r.json() as Promise<{ AbstractText?: string; AbstractURL?: string; Heading?: string; RelatedTopics?: { Text?: string; FirstURL?: string }[] }>),
    d.fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=${n}&format=json&origin=*`).then((r) => r.json() as Promise<{ query?: { search?: { title: string; snippet: string; timestamp?: string }[] } }>),
  ]);
  if (ia.status === 'fulfilled' && ia.value.AbstractText && ia.value.AbstractURL) out.push({ title: ia.value.Heading || query, url: ia.value.AbstractURL, snippet: clip(ia.value.AbstractText), source: 'DuckDuckGo Instant Answer' });
  if (wiki.status === 'fulfilled') for (const r of wiki.value.query?.search ?? []) out.push({ title: r.title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`, snippet: clip(r.snippet), date: r.timestamp, source: 'Wikipedia' });
  if (ia.status === 'fulfilled') for (const t of ia.value.RelatedTopics ?? []) if (t.Text && t.FirstURL && out.length < n) out.push({ title: t.Text.split(' - ')[0], url: t.FirstURL, snippet: clip(t.Text), source: 'DuckDuckGo Instant Answer' });
  if (!out.length && ia.status === 'rejected' && wiki.status === 'rejected') throw new Error('The built-in search could not be reached');
  return out.slice(0, n);
}

export interface XaiSearch {
  text: string;
  citations: { url: string; title?: string }[];
}

/**
 * xAI's server-side search tools (web_search, x_search) on its Responses API.
 * The older "live search" parameter was retired by xAI in 2026 and answers 410.
 */
export async function xaiToolSearch(tool: 'web_search' | 'x_search', query: string, d: SearchDeps): Promise<XaiSearch> {
  if (!d.key) throw new Error('Add an xAI key to search X and the web through xAI');
  const res = await d.fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${d.key}` },
    body: JSON.stringify({ model: d.xaiModel || 'grok-4', input: [{ role: 'user', content: `Search for: ${query}\nList what you found as short bullet points with their sources.` }], tools: [{ type: tool }] }),
  });
  const j = (await json(res, 'xAI')) as { output?: { type: string; content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[] }[]; citations?: (string | { url: string; title?: string })[] };
  let text = '';
  const cites: { url: string; title?: string }[] = [];
  for (const o of j.output ?? []) {
    if (o.type !== 'message') continue;
    for (const c of o.content ?? []) {
      if (c.text) text += c.text;
      for (const a of c.annotations ?? []) if (a.url && !cites.some((x) => x.url === a.url)) cites.push({ url: a.url, title: a.title });
    }
  }
  for (const c of j.citations ?? []) {
    const url = typeof c === 'string' ? c : c.url;
    if (url && !cites.some((x) => x.url === url)) cites.push({ url, title: typeof c === 'string' ? undefined : c.title });
  }
  return { text: text.trim(), citations: cites };
}

/** Numbered lines for the AI: [1] Title — link (date)\n excerpt */
export function formatResults(results: SearchResult[], offset = 0): string {
  if (!results.length) return 'No results.';
  return results.map((r, i) => `[${i + 1 + offset}] ${r.title} — ${r.url}${r.date ? ` (${r.date.slice(0, 10)})` : ''}\n${r.snippet}`).join('\n\n');
}
