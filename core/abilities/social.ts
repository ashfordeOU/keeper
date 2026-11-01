// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Recent public posts: X through xAI's x_search tool (the person's xAI key),
// Hacker News (public), Mastodon hashtags (public), Bluesky (the person's app
// password: Bluesky's post search needs a signed-in session) and Reddit (the
// person's own Reddit app id, as Reddit's API terms require).

import { xaiToolSearch } from './search';

export type SocialSource = 'x' | 'hackernews' | 'mastodon' | 'bluesky' | 'reddit';

export interface Post {
  source: SocialSource;
  author: string;
  text: string;
  url: string;
  date?: string;
  score?: number;
}

export interface SocialDeps {
  fetch: typeof fetch;
  xaiKey?: string;
  mastodonInstance?: string;
  bluesky?: { handle: string; appPassword: string };
  redditClientId?: string;
}

/** Which sources can answer with what the person set up. */
export function availableSources(d: Omit<SocialDeps, 'fetch'>): SocialSource[] {
  const out: SocialSource[] = ['hackernews'];
  if (d.mastodonInstance) out.push('mastodon');
  if (d.xaiKey) out.unshift('x');
  if (d.bluesky?.handle && d.bluesky.appPassword) out.push('bluesky');
  if (d.redditClientId) out.push('reddit');
  return out;
}

const clip = (s: unknown, n = 500) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** "#rust tips" → "rust"; Mastodon searches hashtags without signing in. */
export function hashtagOf(query: string): string {
  const tag = query.match(/#(\w+)/)?.[1] ?? query.split(/\s+/).sort((a, b) => b.length - a.length)[0] ?? '';
  return tag.replace(/[^\p{L}\p{N}_]/gu, '');
}

export async function socialSearch(query: string, sources: SocialSource[], limit: number, d: SocialDeps): Promise<{ posts: Post[]; errors: string[] }> {
  const n = Math.max(1, Math.min(25, Math.round(limit) || 8));
  const errors: string[] = [];
  const results = await Promise.all(sources.map(async (s): Promise<Post[]> => {
    try {
      switch (s) {
        case 'x': {
          const r = await xaiToolSearch('x_search', query, { fetch: d.fetch, key: d.xaiKey });
          const posts = r.citations.filter((c) => /(x|twitter)\.com\//.test(c.url)).map((c) => ({ source: 'x' as const, author: c.url.match(/(?:x|twitter)\.com\/([^/]+)/)?.[1] ?? '', text: c.title ?? '', url: c.url }));
          return [{ source: 'x' as const, author: 'Summary from xAI', text: clip(r.text, 1200), url: posts[0]?.url ?? 'https://x.com/search?q=' + encodeURIComponent(query) }, ...posts].slice(0, n);
        }
        case 'hackernews': {
          const j = (await (await d.fetch(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=(story,comment)&hitsPerPage=${n}`)).json()) as { hits?: { objectID: string; author: string; title?: string; story_title?: string; comment_text?: string; story_text?: string; url?: string; created_at: string; points?: number }[] };
          return (j.hits ?? []).map((h) => ({ source: 'hackernews' as const, author: h.author, text: clip(h.title ?? h.comment_text ?? h.story_text ?? h.story_title), url: `https://news.ycombinator.com/item?id=${h.objectID}`, date: h.created_at, score: h.points }));
        }
        case 'mastodon': {
          const inst = (d.mastodonInstance ?? 'mastodon.social').replace(/^https?:\/\//, '').replace(/\/+$/, '');
          const tag = hashtagOf(query);
          if (!tag) return [];
          const j = (await (await d.fetch(`https://${inst}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${n}`)).json()) as { url: string; content: string; created_at: string; account: { acct: string }; favourites_count?: number }[];
          return (Array.isArray(j) ? j : []).map((p) => ({ source: 'mastodon' as const, author: p.account.acct, text: clip(p.content), url: p.url, date: p.created_at, score: p.favourites_count }));
        }
        case 'bluesky': {
          if (!d.bluesky?.appPassword) throw new Error('Bluesky search needs your handle and an app password');
          const sess = (await (await d.fetch('https://bsky.social/xrpc/com.atproto.server.createSession', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: d.bluesky.handle, password: d.bluesky.appPassword }) })).json()) as { accessJwt?: string };
          if (!sess.accessJwt) throw new Error('Bluesky did not accept the app password');
          const j = (await (await d.fetch(`https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=${n}&sort=latest`, { headers: { authorization: `Bearer ${sess.accessJwt}` } })).json()) as { posts?: { uri: string; author: { handle: string }; record: { text?: string; createdAt?: string }; likeCount?: number }[] };
          return (j.posts ?? []).map((p) => ({ source: 'bluesky' as const, author: p.author.handle, text: clip(p.record.text), url: `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split('/').pop()}`, date: p.record.createdAt, score: p.likeCount }));
        }
        case 'reddit': {
          if (!d.redditClientId) throw new Error('Reddit search needs your Reddit app id');
          const tok = (await (await d.fetch('https://www.reddit.com/api/v1/access_token', { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${d.redditClientId}:`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Keeper/1.0' }, body: 'grant_type=https%3A%2F%2Foauth.reddit.com%2Fgrants%2Finstalled_client&device_id=DO_NOT_TRACK_THIS_DEVICE' })).json()) as { access_token?: string };
          if (!tok.access_token) throw new Error('Reddit did not accept the app id');
          const j = (await (await d.fetch(`https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&limit=${n}&sort=new&raw_json=1`, { headers: { authorization: `Bearer ${tok.access_token}`, 'user-agent': 'Keeper/1.0' } })).json()) as { data?: { children?: { data: { title: string; selftext?: string; author: string; permalink: string; created_utc: number; score: number } }[] } };
          return (j.data?.children ?? []).map(({ data: p }) => ({ source: 'reddit' as const, author: p.author, text: clip(`${p.title}\n${p.selftext ?? ''}`), url: `https://www.reddit.com${p.permalink}`, date: new Date(p.created_utc * 1000).toISOString(), score: p.score }));
        }
      }
    } catch (e) {
      errors.push(`${s}: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }));
  return { posts: results.flat(), errors };
}

export function formatPosts(posts: Post[]): string {
  if (!posts.length) return 'No posts found.';
  return posts.map((p, i) => `[${i + 1}] ${p.source} · ${p.author}${p.date ? ` · ${p.date.slice(0, 16).replace('T', ' ')}` : ''}${p.score !== undefined ? ` · ${p.score}` : ''} — ${p.url}\n${p.text}`).join('\n\n');
}
