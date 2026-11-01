// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notion through its official API: pages shared with your integration become
// notes; their blocks become Markdown and back.

import { ConnectorError, expectOk, type ConnectorIO, type FetchFn, type ListContext } from './io';
import type { RemoteNote } from '../types';

export const NOTION_API = 'https://api.notion.com/v1';
export const NOTION_VERSION = '2022-06-28';

interface RichText { plain_text?: string; text?: { content: string; link?: { url: string } | null }; href?: string | null; annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; code?: boolean } }
export interface NotionBlock { id: string; type: string; has_children?: boolean; children?: NotionBlock[]; [k: string]: unknown }
interface NotionPage { id: string; created_time: string; last_edited_time: string; archived?: boolean; in_trash?: boolean; properties: Record<string, { type: string; title?: RichText[]; multi_select?: { name: string }[] }> }

export function richToMd(rt: RichText[] = []): string {
  return rt.map((r) => {
    let t = r.plain_text ?? r.text?.content ?? '';
    if (!t) return '';
    const a = r.annotations ?? {};
    if (a.code) t = '`' + t + '`';
    if (a.bold) t = `**${t}**`;
    if (a.italic) t = `*${t}*`;
    if (a.strikethrough) t = `~~${t}~~`;
    const href = r.href ?? r.text?.link?.url;
    return href ? `[${t}](${href})` : t;
  }).join('');
}

/** Notion blocks to Markdown. */
export function blocksToMd(blocks: NotionBlock[], depth = 0): string {
  const pad = '  '.repeat(depth);
  const out: string[] = [];
  let n = 1;
  let prevListy = false;
  for (const b of blocks) {
    const isListy = ['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle'].includes(b.type);
    if (depth === 0 && prevListy && !isListy) out.push('');
    prevListy = isListy;
    const v = (b[b.type] ?? {}) as { rich_text?: RichText[]; checked?: boolean; language?: string; caption?: RichText[]; type?: string; file?: { url: string }; external?: { url: string } };
    const text = richToMd(v.rich_text);
    if (b.type !== 'numbered_list_item') n = 1;
    switch (b.type) {
      case 'heading_1': out.push(`${pad}# ${text}`); break;
      case 'heading_2': out.push(`${pad}## ${text}`); break;
      case 'heading_3': out.push(`${pad}### ${text}`); break;
      case 'bulleted_list_item': case 'toggle': out.push(`${pad}- ${text}`); break;
      case 'numbered_list_item': out.push(`${pad}${n++}. ${text}`); break;
      case 'to_do': out.push(`${pad}- [${v.checked ? 'x' : ' '}] ${text}`); break;
      case 'quote': case 'callout': out.push(`${pad}> ${text}`); break;
      case 'code': out.push('```' + (v.language && v.language !== 'plain text' ? v.language : ''), richToMd(v.rich_text).replace(/`/g, ''), '```'); break;
      case 'divider': out.push('---'); break;
      case 'image': out.push(`![${richToMd(v.caption)}](${v.file?.url ?? v.external?.url ?? ''})`); break;
      case 'child_page': case 'child_database': break;
      default: if (text) out.push(`${pad}${text}`);
    }
    const listy = ['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle'].includes(b.type);
    if (b.children?.length) out.push(blocksToMd(b.children, listy ? depth + 1 : depth));
    if (!listy && depth === 0) out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '');
}

const rich = (s: string) => {
  const parts: { type: 'text'; text: { content: string } }[] = [];
  for (let i = 0; i < s.length || i === 0; i += 1900) parts.push({ type: 'text', text: { content: s.slice(i, i + 1900) } });
  return parts;
};

/** Markdown to Notion blocks (plain text inside each block; nesting is flattened). */
export function mdToBlocks(md: string): Record<string, unknown>[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: Record<string, unknown>[] = [];
  const blk = (type: string, v: Record<string, unknown>) => out.push({ object: 'block', type, [type]: v });
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = /^\s*```(\w*)/.exec(l);
    if (fence) {
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      blk('code', { rich_text: rich(code.join('\n')), language: fence[1] || 'plain text' });
      continue;
    }
    if (!l.trim()) continue;
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) blk(`heading_${m[1].length}`, { rich_text: rich(m[2]) });
    else if ((m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(l))) blk('to_do', { rich_text: rich(m[2]), checked: m[1] !== ' ' });
    else if ((m = /^\s*[-*+]\s+(.*)$/.exec(l))) blk('bulleted_list_item', { rich_text: rich(m[1]) });
    else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) blk('numbered_list_item', { rich_text: rich(m[1]) });
    else if ((m = /^\s*>\s?(.*)$/.exec(l))) blk('quote', { rich_text: rich(m[1]) });
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) out.push({ object: 'block', type: 'divider', divider: {} });
    else blk('paragraph', { rich_text: rich(l) });
  }
  return out;
}

export function notionTitle(p: NotionPage): { title: string; prop: string } {
  for (const [k, v] of Object.entries(p.properties ?? {})) if (v.type === 'title') return { title: richToMd(v.title), prop: k };
  return { title: 'Untitled', prop: 'title' };
}

export class NotionApi implements ConnectorIO {
  private titleProp = new Map<string, string>();
  constructor(private token: string, private fetch: FetchFn, private parent?: string, private ctx: ListContext = {}) {}

  private async call<T>(method: string, p: string, body?: unknown): Promise<T> {
    const r = await this.fetch(`${NOTION_API}${p}`, { method, headers: { authorization: `Bearer ${this.token}`, 'notion-version': NOTION_VERSION, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .catch(() => { throw new ConnectorError('unreachable', 'Notion could not be reached.'); });
    await expectOk(r, 'Notion');
    return (await r.json()) as T;
  }

  private async children(id: string, depth = 0): Promise<NotionBlock[]> {
    const out: NotionBlock[] = [];
    let cursor: string | undefined;
    do {
      const j = await this.call<{ results: NotionBlock[]; has_more: boolean; next_cursor: string | null }>('GET', `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
      out.push(...j.results);
      cursor = j.has_more ? j.next_cursor ?? undefined : undefined;
    } while (cursor);
    if (depth < 2) for (const b of out) if (b.has_children && b.type !== 'child_page' && b.type !== 'child_database') b.children = await this.children(b.id, depth + 1);
    return out;
  }

  async pages(): Promise<NotionPage[]> {
    const out: NotionPage[] = [];
    let cursor: string | undefined;
    do {
      const j = await this.call<{ results: NotionPage[]; has_more: boolean; next_cursor: string | null }>('POST', '/search', { filter: { property: 'object', value: 'page' }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      out.push(...j.results);
      cursor = j.has_more ? j.next_cursor ?? undefined : undefined;
    } while (cursor);
    return out;
  }

  async test() {
    const p = await this.pages();
    return `Connected: ${p.length} page${p.length === 1 ? '' : 's'} shared with the integration`;
  }

  async list() {
    const notes: RemoteNote[] = [];
    for (const p of await this.pages()) {
      if (p.archived || p.in_trash) continue;
      const { title, prop } = notionTitle(p);
      this.titleProp.set(p.id, prop);
      const tags = Object.values(p.properties).find((v) => v.type === 'multi_select')?.multi_select?.map((m) => m.name) ?? [];
      const known = this.ctx.unchanged?.(p.id, p.last_edited_time);
      const body = known ? known.body : blocksToMd(await this.children(p.id));
      notes.push({ sourceId: p.id, title: known?.title ?? title, body, tags, created: Date.parse(p.created_time), modified: Date.parse(p.last_edited_time), version: p.last_edited_time });
    }
    return { notes, complete: true };
  }

  async create(n: RemoteNote) {
    if (!this.parent) throw new ConnectorError('not-supported', 'Choose a Notion page for new notes in this connection’s settings.');
    const blocks = mdToBlocks(n.body);
    const p = await this.call<NotionPage>('POST', '/pages', { parent: { page_id: this.parent }, properties: { title: { title: rich(n.title) } }, children: blocks.slice(0, 100) });
    for (let i = 100; i < blocks.length; i += 100) await this.call('PATCH', `/blocks/${p.id}/children`, { children: blocks.slice(i, i + 100) });
    return { sourceId: p.id, version: p.last_edited_time };
  }

  async update(n: RemoteNote) {
    const prop = this.titleProp.get(n.sourceId) ?? 'title';
    await this.call('PATCH', `/pages/${n.sourceId}`, { properties: { [prop]: { title: rich(n.title) } } });
    const old = await this.children(n.sourceId, 2);
    for (const b of old) if (b.type !== 'child_page' && b.type !== 'child_database') await this.call('DELETE', `/blocks/${b.id}`);
    const blocks = mdToBlocks(n.body);
    let last: NotionPage | undefined;
    for (let i = 0; i < blocks.length; i += 100) last = await this.call<NotionPage>('PATCH', `/blocks/${n.sourceId}/children`, { children: blocks.slice(i, i + 100) });
    void last;
    const p = await this.call<NotionPage>('GET', `/pages/${n.sourceId}`);
    return { version: p.last_edited_time };
  }

  async remove(id: string) {
    await this.call('PATCH', `/pages/${id}`, { archived: true });
  }
}
