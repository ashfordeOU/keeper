// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanDoc, docHeadings, HELP_DOCS, helpFor, PAGE_HELP, pagesWithoutHelp } from '../core/help';
import { HUB_TABS, NAV_PAGES } from '../core/nav';
import { jargonIn } from '../core/settings-schema';

const docs = path.resolve(__dirname, '../docs');

describe('help on every page', () => {
  it('every page in the sidebar and the palette has help', () => {
    expect(pagesWithoutHelp()).toEqual([]);
    for (const p of NAV_PAGES) expect(helpFor(p.route).title, p.id).toBe(p.label);
  });
  it('is short: one line for what it is, three things you can do, all in plain words', () => {
    for (const [id, h] of Object.entries(PAGE_HELP)) {
      expect(h.what.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length, `${id}: one sentence`).toBe(1);
      expect(h.what.length, id).toBeLessThanOrEqual(80);
      expect(h.can, id).toHaveLength(3);
      for (const c of h.can) expect(c.split(/\s+/).length, `${id}: “${c}”`).toBeLessThanOrEqual(7);
      expect(jargonIn(`${h.what} ${h.can.join(' ')}`), id).toEqual([]);
    }
  });
  it('every guide it points at is bundled, and none is a maker’s note', () => {
    for (const d of HELP_DOCS) expect(existsSync(path.join(docs, d)), d).toBe(true);
    for (const d of ['ARCHITECTURE.md', 'SECURITY-REVIEW.md', 'BETA-CHECKLIST.md', 'MAS-EDITION.md']) expect(HELP_DOCS).not.toContain(d);
  });
  it('a tab with a guide of its own gets it, under the tab’s name; other tabs get their page’s', () => {
    expect(helpFor({ name: 'firewall' })).toMatchObject({ title: 'Network & firewall', doc: 'FIREWALL.md' });
    expect(helpFor({ name: 'security' })).toMatchObject({ title: 'Privacy & Security', doc: 'SECURITY-CENTER.md' });
    expect(helpFor({ name: 'apps' })).toMatchObject({ title: 'Startup & Apps' });
    expect(helpFor({ name: 'sync', arg: 'backups' })).toMatchObject({ title: 'Backups', doc: 'SYNC.md' });
    for (const tabs of Object.values(HUB_TABS)) for (const t of tabs) expect(existsSync(path.join(docs, helpFor(t.route).doc)), t.label).toBe(true);
  });
  it('an unknown page still gets something useful', () => {
    expect(helpFor({ name: 'nowhere' })).toMatchObject({ doc: 'GUIDE.md' });
  });
  it('shows a guide without its pictures, comments or title line', () => {
    const md = '# Title\n\nIntro <!-- note -->\n\n![shot](screenshots/x.webp)\n\n## One\n\ntext <img src="a.png">\n\n## Two\n';
    const c = cleanDoc(md);
    expect(c).not.toMatch(/Title|note|screenshots|<img/);
    expect(c.startsWith('Intro')).toBe(true);
    expect(docHeadings(md)).toEqual(['One', 'Two']);
    const n = cleanDoc(readFileSync(path.join(docs, 'NOTIFICATIONS.md'), 'utf8'));
    expect(n).toMatch(/^Every notice/);
    expect(n).not.toMatch(/For developers|core\/notices\.ts|Verified/);
    expect(cleanDoc('Intro\n\nCode: `core/x.ts`, tests in\n`test/x.test.ts`.\n\n## Use\n\nText\n\n## What needs a real Mac\n\nStuff\n')).toBe('Intro\n\n## Use\n\nText');
  });
});
