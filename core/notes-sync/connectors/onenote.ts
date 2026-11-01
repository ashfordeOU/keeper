// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// OneNote through Microsoft Graph with an access token you give: pages become
// notes (HTML → Markdown); new notes become pages in the section you chose;
// edits replace the page's first content block.

import { escapeHtml, htmlToMarkdown, markdownToHtml } from '../markdown';
import { ConnectorError, expectOk, type ConnectorIO, type FetchFn, type ListContext } from './io';
import type { RemoteNote } from '../types';

export const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface GraphPage {
  id: string;
  title: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  parentSection?: { id: string; displayName: string };
  parentNotebook?: { displayName: string };
}

/** Page HTML to a note body (the page's own <title> is the note title). */
export function oneNoteHtmlToMd(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return htmlToMarkdown(body);
}

/** The HTML Graph expects when creating a page. */
export function oneNotePageHtml(title: string, md: string, created?: number): string {
  return `<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title>${created ? `<meta name="created" content="${new Date(created).toISOString()}"/>` : ''}</head><body><div>${markdownToHtml(md)}</div></body></html>`;
}

/** The id of the first block on a page fetched with includeIDs=true (the one edits replace). */
export function firstBlockId(html: string): string | undefined {
  const body = /<body[^>]*>([\s\S]*)/i.exec(html)?.[1] ?? html;
  return /<div[^>]*\sid="(div:[^"]+)"/i.exec(body)?.[1];
}

export class OneNoteApi implements ConnectorIO {
  constructor(private token: string, private fetch: FetchFn, private section?: string, private ctx: ListContext = {}) {}

  private async call(method: string, url: string, body?: string, type = 'application/json') {
    const r = await this.fetch(url.startsWith('http') ? url : `${GRAPH}${url}`, { method, headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { 'content-type': type } : {}) }, body })
      .catch(() => { throw new ConnectorError('unreachable', 'Microsoft Graph could not be reached.'); });
    return expectOk(r, 'OneNote');
  }

  async pages(): Promise<GraphPage[]> {
    const out: GraphPage[] = [];
    let next: string | undefined = `/me/onenote/pages?$select=id,title,createdDateTime,lastModifiedDateTime&$expand=parentSection($select=id,displayName),parentNotebook($select=displayName)&$top=100`;
    while (next) {
      const j = (await (await this.call('GET', next)).json()) as { value: GraphPage[]; '@odata.nextLink'?: string };
      out.push(...j.value);
      next = j['@odata.nextLink'];
    }
    return out;
  }

  async test() {
    const p = await this.pages();
    return `Connected: ${p.length} page${p.length === 1 ? '' : 's'}`;
  }

  async list() {
    const notes: RemoteNote[] = [];
    for (const p of await this.pages()) {
      const known = this.ctx.unchanged?.(p.id, p.lastModifiedDateTime);
      const body = known ? known.body : oneNoteHtmlToMd(await (await this.call('GET', `/me/onenote/pages/${p.id}/content`)).text());
      notes.push({
        sourceId: p.id, title: p.title || 'Untitled', body, tags: [],
        created: Date.parse(p.createdDateTime), modified: Date.parse(p.lastModifiedDateTime), version: p.lastModifiedDateTime,
        folder: [p.parentNotebook?.displayName, p.parentSection?.displayName].filter(Boolean).join('/') || undefined,
      });
    }
    return { notes, complete: true };
  }

  async create(n: RemoteNote) {
    if (!this.section) throw new ConnectorError('not-supported', 'Choose a OneNote section for new notes in this connection’s settings.');
    const p = (await (await this.call('POST', `/me/onenote/sections/${this.section}/pages`, oneNotePageHtml(n.title, n.body, n.created), 'text/html')).json()) as GraphPage;
    return { sourceId: p.id, version: p.lastModifiedDateTime };
  }

  async update(n: RemoteNote) {
    const html = await (await this.call('GET', `/me/onenote/pages/${n.sourceId}/content?includeIDs=true`)).text();
    const target = firstBlockId(html);
    const cmds: { target: string; action: string; content: string }[] = [{ target: 'title', action: 'replace', content: n.title }];
    if (target) cmds.push({ target, action: 'replace', content: `<div>${markdownToHtml(n.body)}</div>` });
    else cmds.push({ target: 'body', action: 'append', content: `<div>${markdownToHtml(n.body)}</div>` });
    await this.call('PATCH', `/me/onenote/pages/${n.sourceId}/content`, JSON.stringify(cmds));
    return {};
  }

  async remove(id: string) {
    await this.call('DELETE', `/me/onenote/pages/${id}`);
  }
}
