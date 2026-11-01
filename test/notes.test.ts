// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { parseYaml, stringifyYaml } from '../core/notes/yaml';
import { blockText, parseNote, readProps, sectionText, writeProps } from '../core/notes/parse';
import { applyEdits, VaultIndex, type VaultFile } from '../core/notes/vault';
import { parseQuery, searchVault } from '../core/notes/search';
import { fillTemplate, formatDate, parseDate, periodicDateOf, periodicPath } from '../core/notes/templates';
import { attachmentFolder, isHidden, readConfig } from '../core/notes/config';
import { addEdge, addNode, parseCanvas, renameInCanvas, serializeCanvas, validateCanvas } from '../core/notes/canvas';
import { parseBase, runBase } from '../core/notes/bases';
import { renderNote, splitSlides } from '../core/notes/render';
import { buildSite, extractSelection, mergeNotes, pageName } from '../core/notes/publish';
import { allowed, isForeignPlugin, validateManifest } from '../core/notes/plugins';

const f = (path: string, extra: Partial<VaultFile> = {}): VaultFile => ({ path, mtime: 1_700_000_000_000, ctime: 1_690_000_000_000, size: 100, ...extra });

function vault(files: Record<string, string>): VaultIndex {
  const v = new VaultIndex();
  for (const [p, t] of Object.entries(files)) v.set(f(p, { size: t.length }), p.endsWith('.md') ? t : undefined);
  return v;
}

/** Applies a rename to a plain file map the way the app does on disk. */
function renameIn(files: Record<string, string>, moves: { from: string; to: string }[]) {
  const v = vault(files);
  const edits = v.renameEdits(moves);
  const out = { ...files };
  for (const m of moves) { out[m.to] = out[m.from]; delete out[m.from]; }
  for (const e of edits) out[e.path] = applyEdits(out[e.path], e.edits);
  return out;
}

describe('properties (YAML frontmatter)', () => {
  it('reads the value kinds notes use', () => {
    const y = parseYaml('title: "Hello: world"\ncount: 3\ndone: true\nempty:\ntags:\n  - a\n  - b/c\naliases: [One, "Two, three"]\nwhen: 2026-10-31\nnested:\n  k: v\nlinks:\n  - "[[Note A]]"\nbody: |\n  line 1\n  line 2\n# comment\nurl: https://x.y/#a');
    expect(y).toEqual({ title: 'Hello: world', count: 3, done: true, empty: null, tags: ['a', 'b/c'], aliases: ['One', 'Two, three'], when: '2026-10-31', nested: { k: 'v' }, links: ['[[Note A]]'], body: 'line 1\nline 2\n', url: 'https://x.y/#a' });
  });
  it('round-trips through the writer', () => {
    const v = { title: 'A: b', n: 1.5, ok: false, tags: ['x', 'y'], link: '[[N]]', none: null, list: [{ a: 1, b: 'two' }], text: 'multi\nline' };
    expect(parseYaml(stringifyYaml(v))).toEqual(v);
    expect(stringifyYaml({ tags: ['a', 'b'] })).toBe('tags:\n  - a\n  - b\n');
  });
  it('adds, changes and removes the block without touching the body', () => {
    const t = '# Title\n\nBody';
    const w = writeProps(t, { status: 'draft' });
    expect(w).toBe('---\nstatus: draft\n---\n# Title\n\nBody');
    expect(readProps(w).props).toEqual({ status: 'draft' });
    expect(writeProps(w, {})).toBe(t);
  });
});

describe('parsing notes', () => {
  const text = `---
tags: [project, area/work]
aliases: [Alpha]
related: "[[Other]]"
---
# Heading One

See [[Target#Sub heading|shown]] and ![[pic.png|200]] and [md](Folder/Thing.md#Part) and [web](https://example.com).
A block line ^block-1
- [ ] open task #todo/now
- [x] done task
\`\`\`js
const x = "[[not a link]] #nottag";
\`\`\`
Inline \`[[nope]]\` and $[[nomath]]$ text #real-tag and #123 and email a#b.

> [!warning]- Careful
> inside

Footnote[^1].

[^1]: The note.

Setext
======
`;
  const p = parseNote(text);
  it('finds links, embeds and markdown links with their parts', () => {
    const body = p.links.filter((l) => !l.inProps);
    expect(body.map((l) => [l.target, l.subpath, l.alias, l.embed, l.kind])).toEqual([
      ['Target', 'Sub heading', 'shown', false, 'wiki'],
      ['pic.png', undefined, '200', true, 'wiki'],
      ['Folder/Thing.md', 'Part', 'md', false, 'markdown'],
    ]);
    expect(p.links.find((l) => l.inProps)?.target).toBe('Other');
  });
  it('finds tags (nested, from properties) but not in code, numbers or words', () => {
    const tags = p.tags.map((t) => t.tag).sort();
    expect(tags).toEqual(['area/work', 'project', 'real-tag', 'todo/now'].sort());
  });
  it('finds headings, blocks, tasks, footnotes, callouts and aliases', () => {
    expect(p.headings.map((h) => [h.level, h.text])).toEqual([[1, 'Heading One'], [1, 'Setext']]);
    expect(p.blocks.map((b) => b.id)).toEqual(['block-1']);
    expect(p.tasks.map((t) => [t.text, t.done])).toEqual([['open task #todo/now', false], ['done task', true]]);
    expect(p.footnotes.map((x) => x.id)).toEqual(['1']);
    expect(p.callouts).toEqual([{ type: 'warning', title: 'Careful', line: expect.any(Number), fold: '-' }]);
    expect(p.aliases).toEqual(['Alpha']);
    expect(p.words).toBeGreaterThan(20);
  });
  it('cuts out sections and blocks for embeds', () => {
    const t = '# A\none\n## B\ntwo\n# C\nthree\n\npara line\nmore text ^abc\n\n- item ^li';
    expect(sectionText(t, 'A')).toBe('# A\none\n## B\ntwo');
    expect(sectionText(t, 'b')).toBe('## B\ntwo');
    expect(blockText(t, 'abc')).toBe('para line\nmore text');
    expect(blockText(t, 'li')).toBe('- item');
  });
});

describe('link resolution', () => {
  const v = vault({
    'Note.md': '[[Other]] [[sub/Deep]] [[Deep]] [[missing]] [[note]]',
    'Other.md': 'x',
    'sub/Deep.md': '[[Other]]',
    'a/Dup.md': '', 'b/Dup.md': '', 'b/c/Dup.md': '', 'b/Linker.md': '[[Dup]]', 'Linker2.md': '[[Dup]]',
    'img/pic.png': '',
  });
  it('resolves by exact path, name and case', () => {
    expect(v.resolve('Other', 'Note.md')).toBe('Other.md');
    expect(v.resolve('other', 'Note.md')).toBe('Other.md');
    expect(v.resolve('Deep', 'Note.md')).toBe('sub/Deep.md');
    expect(v.resolve('sub/Deep.md', 'Note.md')).toBe('sub/Deep.md');
    expect(v.resolve('pic.png', 'Note.md')).toBe('img/pic.png');
    expect(v.resolve('missing', 'Note.md')).toBeNull();
  });
  it('prefers the same folder, then the shortest path', () => {
    expect(v.resolve('Dup', 'b/Linker.md')).toBe('b/Dup.md');
    expect(v.resolve('Dup', 'Linker2.md')).toBe('a/Dup.md');
  });
  it('lists backlinks and unresolved links', () => {
    expect(v.backlinks('Other.md').map((b) => b.source)).toEqual(['Note.md', 'sub/Deep.md']);
    expect(v.backlinks('sub/Deep.md')[0].links).toHaveLength(2);
    expect([...v.unresolved().keys()]).toEqual(['missing']);
  });
  it('updates incrementally when files come and go', () => {
    const w = vault({ 'A.md': '[[B]]' });
    expect(w.resolve('B', 'A.md')).toBeNull();
    w.set(f('B.md'), 'hi');
    expect(w.backlinks('B.md').map((b) => b.source)).toEqual(['A.md']);
    w.set(f('A.md'), 'no links');
    expect(w.backlinks('B.md')).toEqual([]);
    w.remove('B.md');
    expect(w.has('B.md')).toBe(false);
  });
  it('finds unlinked mentions', () => {
    const w = vault({ 'Project X.md': '---\naliases: [PX]\n---\n', 'A.md': 'We talked about project x today. And [[Project X]] again. Also PX.' });
    expect(w.unlinkedMentions('Project X.md').map((m) => m.to - m.from)).toEqual([9, 2]);
  });
  it('builds the global and local graph', () => {
    const g = v.graph({ unresolved: true });
    expect(g.edges.some((e) => e.from === 'Note.md' && e.to === 'missing:missing')).toBe(true);
    const local = v.localGraph('sub/Deep.md', 1);
    expect(local.nodes.map((n) => n.id).sort()).toEqual(['Note.md', 'Other.md', 'sub/Deep.md']);
  });
  it('suggests notes and aliases for [[ autocomplete', () => {
    const w = vault({ 'Meeting notes.md': '---\naliases: [Standup]\n---\n', 'Other.md': '' });
    expect(w.suggest('stand')[0]).toMatchObject({ path: 'Meeting notes.md', alias: 'Standup' });
    expect(w.suggest('mtg')[0].path).toBe('Meeting notes.md');
  });
});

describe('rename updates links', () => {
  it('rewrites wikilinks, keeping headings, aliases and embeds', () => {
    const out = renameIn({ 'Old.md': '# H', 'A.md': 'x [[Old]] [[old#H|see]] ![[Old#^b1]] [[Old.md]] `[[Old]]`', 'B.md': '[[Other]]', 'Other.md': '' }, [{ from: 'Old.md', to: 'New.md' }]);
    expect(out['A.md']).toBe('x [[New]] [[New#H|see]] ![[New#^b1]] [[New]] `[[Old]]`');
    expect(out['B.md']).toBe('[[Other]]');
  });
  it('rewrites markdown links with encoded paths', () => {
    const out = renameIn({ 'docs/Old name.md': '', 'A.md': '[t](docs/Old%20name.md#Top) [u](<docs/Old name.md>)' }, [{ from: 'docs/Old name.md', to: 'docs/New name.md' }]);
    expect(out['A.md']).toBe('[t](docs/New%20name.md#Top) [u](<docs/New name.md>)');
  });
  it('uses a full path when the new name is not unique, and leaves still-working links alone on a move', () => {
    const out = renameIn({ 'a/X.md': '', 'b/Y.md': '', 'L.md': '[[X]] [[Y]]' }, [{ from: 'b/Y.md', to: 'b/X.md' }]);
    expect(out['L.md']).toBe('[[X]] [[b/X]]');
    const moved = renameIn({ 'a/Only.md': '', 'L.md': '[[Only]]' }, [{ from: 'a/Only.md', to: 'z/Only.md' }]);
    expect(moved['L.md']).toBe('[[Only]]');
  });
  it('fixes relative links inside a note that moved to another folder', () => {
    const out = renameIn({ 'n/Me.md': '[pic](../img/p.png)', 'img/p.png': '' }, [{ from: 'n/Me.md', to: 'deep/er/Me.md' }]);
    expect(out['deep/er/Me.md']).toBe('[pic](../../img/p.png)');
  });
  it('renames a folder (many moves) and updates links to all its files', () => {
    const out = renameIn({ 'f/A.md': '[[f/B]]', 'f/B.md': '', 'L.md': '[[f/A]] [[B]]' }, [{ from: 'f/A.md', to: 'g/A.md' }, { from: 'f/B.md', to: 'g/B.md' }]);
    expect(out['L.md']).toBe('[[A]] [[B]]');
    expect(out['g/A.md']).toBe('[[B]]');
  });
  it('the index follows a rename', () => {
    const v = vault({ 'Old.md': '', 'A.md': '[[Old]]' });
    const edits = v.renameEdits([{ from: 'Old.md', to: 'New.md' }]);
    const texts = new Map(edits.map((e) => [e.path, applyEdits(v.note(e.path)!.text, e.edits)]));
    v.applyRename([{ from: 'Old.md', to: 'New.md' }], texts);
    expect(v.backlinks('New.md').map((b) => b.source)).toEqual(['A.md']);
    expect(v.has('Old.md')).toBe(false);
  });
});

describe('search operators', () => {
  const v = vault({
    'Projects/Alpha.md': '---\nstatus: active\ntags: [work]\n---\n# Plan\nShip the alpha release\n- [ ] write docs\n- [x] fix bug\n\nOther paragraph with beta',
    'Projects/Beta.md': '# Beta\nThe beta release #work/urgent\n\n## Risks\nnone yet',
    'Journal/2026-10-31.md': 'Met Sam about alpha. Then lunch.',
    'pic.png': '',
  });
  const s = (q: string) => searchVault(v.allFiles(), (p) => v.note(p), q).map((h) => h.path).sort();
  it('parses into a tree', () => {
    expect(parseQuery('a OR -b')).toEqual({ t: 'or', items: [{ t: 'term', op: 'word', value: 'a', exact: false, regex: false }, { t: 'not', item: { t: 'term', op: 'word', value: 'b', exact: false, regex: false } }] });
  });
  it('words, phrases, OR, negation and groups', () => {
    expect(s('alpha')).toEqual(['Journal/2026-10-31.md', 'Projects/Alpha.md']);
    expect(s('"alpha release"')).toEqual(['Projects/Alpha.md']);
    expect(s('alpha -lunch')).toEqual(['Projects/Alpha.md']);
    expect(s('lunch OR risks')).toEqual(['Journal/2026-10-31.md', 'Projects/Beta.md']);
    expect(s('release (docs OR yet)')).toEqual(['Projects/Alpha.md', 'Projects/Beta.md']);
  });
  it('path:, file:, tag:, content: and regex', () => {
    expect(s('path:Journal')).toEqual(['Journal/2026-10-31.md']);
    expect(s('file:png')).toEqual(['pic.png']);
    expect(s('tag:#work')).toEqual(['Projects/Alpha.md', 'Projects/Beta.md']);
    expect(s('tag:work/urgent')).toEqual(['Projects/Beta.md']);
    expect(s('/\\d{4}-\\d{2}/')).toEqual(['Journal/2026-10-31.md']);
    expect(s('content:sam')).toEqual(['Journal/2026-10-31.md']);
  });
  it('line:, block:, section:', () => {
    expect(s('line:(alpha release)')).toEqual(['Projects/Alpha.md']);
    expect(s('line:(alpha beta)')).toEqual([]);
    expect(s('block:(alpha beta)')).toEqual([]);
    expect(s('block:(paragraph beta)')).toEqual(['Projects/Alpha.md']);
    expect(s('section:(risks none)')).toEqual(['Projects/Beta.md']);
  });
  it('tasks and properties', () => {
    expect(s('task-todo:docs')).toEqual(['Projects/Alpha.md']);
    expect(s('task-done:docs')).toEqual([]);
    expect(s('task:bug')).toEqual(['Projects/Alpha.md']);
    expect(s('[status:active]')).toEqual(['Projects/Alpha.md']);
    expect(s('[status]')).toEqual(['Projects/Alpha.md']);
    expect(s('[status:done]')).toEqual([]);
  });
  it('match-case', () => {
    expect(s('match-case:Ship')).toEqual(['Projects/Alpha.md']);
    expect(s('match-case:ship')).toEqual([]);
  });
});

describe('templates and periodic notes', () => {
  const d = new Date(2026, 9, 31, 9, 5, 7); // Saturday 31 October 2026
  it('formats dates with the usual tokens', () => {
    expect(formatDate(d, 'YYYY-MM-DD')).toBe('2026-10-31');
    expect(formatDate(d, 'dddd, MMMM Do YYYY [at] HH:mm')).toBe('Saturday, October 31st 2026 at 09:05');
    expect(formatDate(d, 'gggg-[W]ww')).toBe('2026-W44');
    expect(formatDate(d, 'GGGG-[W]WW')).toBe('2026-W44');
    expect(formatDate(new Date(2027, 0, 1), 'GGGG-[W]WW')).toBe('2026-W53');
    expect(formatDate(d, 'YYYY/MM/YYYY-MM-DD ddd')).toBe('2026/10/2026-10-31 Sat');
  });
  it('reads dates back', () => {
    expect(parseDate('2026-10-31', 'YYYY-MM-DD')?.getDate()).toBe(31);
    expect(parseDate('2026-02-30', 'YYYY-MM-DD')).toBeNull();
    expect(parseDate('October 31st, 2026', 'MMMM Do, YYYY')?.getMonth()).toBe(9);
    expect(parseDate('not a date', 'YYYY-MM-DD')).toBeNull();
  });
  it('fills templates', () => {
    const t = '# {{title}}\nCreated {{date}} {{time}}\n{{date:dddd}} {{yesterday}} {{tomorrow}} {{date+7d:YYYY-MM-DD}} {{unknown}}';
    expect(fillTemplate(t, { title: 'My note', now: d })).toBe('# My note\nCreated 2026-10-31 09:05\nSaturday 2026-10-30 2026-11-01 2026-11-07 {{unknown}}');
    expect(fillTemplate('{{date}}', { title: '', now: d, dateFormat: 'DD.MM.YYYY' })).toBe('31.10.2026');
  });
  it('names daily, weekly and monthly notes from the settings', () => {
    expect(periodicPath(d, 'day', { folder: 'Journal/', format: 'YYYY/MM/YYYY-MM-DD' })).toBe('Journal/2026/10/2026-10-31.md');
    expect(periodicPath(d, 'week', {})).toBe('2026-W44.md');
    expect(periodicPath(d, 'month', { folder: 'M' })).toBe('M/2026-10.md');
    expect(periodicDateOf('Journal/2026-10-31.md', 'day', { folder: 'Journal' })?.getDate()).toBe(31);
    expect(periodicDateOf('Other/2026-10-31.md', 'day', { folder: 'Journal' })).toBeNull();
  });
});

describe('vault settings', () => {
  const c = readConfig({ app: { attachmentFolderPath: './attachments', newLinkFormat: 'relative', trashOption: 'local', userIgnoreFilters: ['Archive/'] }, dailyNotes: { folder: 'Daily', format: 'DD-MM-YYYY', template: 'Templates/Daily' }, templates: { folder: 'Templates' }, types: { types: { due: 'date' } } });
  it('reads app, daily notes, templates and property types', () => {
    expect(c.newLinkFormat).toBe('relative');
    expect(c.trashOption).toBe('local');
    expect(c.periodic.day).toMatchObject({ folder: 'Daily', format: 'DD-MM-YYYY', template: 'Templates/Daily' });
    expect(c.templates.folder).toBe('Templates');
    expect(c.types.due).toBe('date');
  });
  it('puts attachments where the vault says', () => {
    expect(attachmentFolder(c, 'Projects/A.md')).toBe('Projects/attachments');
    expect(attachmentFolder({ ...c, attachmentFolderPath: '/' }, 'Projects/A.md')).toBe('');
    expect(attachmentFolder({ ...c, attachmentFolderPath: './' }, 'Projects/A.md')).toBe('Projects');
    expect(attachmentFolder({ ...c, attachmentFolderPath: 'Assets' }, 'Projects/A.md')).toBe('Assets');
  });
  it('hides config, trash and excluded files', () => {
    expect(isHidden('.obsidian/app.json')).toBe(true);
    expect(isHidden('.trash/x.md')).toBe(true);
    expect(isHidden('Archive/x.md', c)).toBe(true);
    expect(isHidden('Notes/x.md', c)).toBe(false);
  });
});

describe('canvas files', () => {
  const sample = `{
\t"nodes":[
\t\t{"id":"a1","type":"text","text":"Hello","x":0,"y":0,"width":250,"height":60,"color":"1","futureField":{"keep":true}},
\t\t{"id":"b2","type":"file","file":"Note.md","subpath":"#Heading","x":400,"y":0,"width":400,"height":400},
\t\t{"id":"c3","type":"link","url":"https://example.com","x":0,"y":300,"width":400,"height":300},
\t\t{"id":"g4","type":"group","label":"Group","x":-50,"y":-50,"width":900,"height":800}
\t],
\t"edges":[{"id":"e1","fromNode":"a1","fromSide":"right","toNode":"b2","toSide":"left","toEnd":"arrow","label":"see"}],
\t"metadata":{"version":"1.0-1.0"}
}`;
  it('round-trips without losing fields', () => {
    const c = parseCanvas(sample);
    expect(validateCanvas(c)).toEqual([]);
    const again = parseCanvas(serializeCanvas(c));
    expect(again).toEqual(c);
    expect(JSON.parse(serializeCanvas(c))).toEqual(JSON.parse(sample));
    expect(serializeCanvas(c)).toContain('\n\t"nodes"');
  });
  it('adds cards and arrows, and follows renames', () => {
    let c = parseCanvas('');
    c = addNode(c, { type: 'text', text: 'One', x: 0, y: 0, width: 200, height: 100 });
    c = addNode(c, { type: 'file', file: 'A.md', x: 0, y: 400, width: 200, height: 100 });
    c = addEdge(c, c.nodes[0].id, c.nodes[1].id);
    expect(c.edges[0]).toMatchObject({ fromSide: 'bottom', toSide: 'top' });
    expect(validateCanvas(c)).toEqual([]);
    expect(renameInCanvas(c, 'A.md', 'B.md')!.nodes[1]).toMatchObject({ file: 'B.md' });
  });
  it('reports broken boards', () => {
    expect(validateCanvas({ nodes: [{ id: 'x', type: 'text', text: 't', x: 0, y: 0, width: 1, height: 1 }], edges: [{ id: 'e', fromNode: 'x', toNode: 'nope' }] })).toEqual(['arrow e ends at a missing card']);
  });
});

describe('bases', () => {
  const v = vault({
    'Books/Dune.md': '---\ntags: [book]\nauthor: Frank Herbert\nrating: 5\nread: 2026-01-10\nstatus: done\n---\n',
    'Books/Emma.md': '---\ntags: [book, classic]\nauthor: Jane Austen\nrating: 3\nstatus: reading\n---\n[[Dune]]',
    'Books/Notes.md': 'not a book',
    'Other/Hyperion.md': '---\ntags: [book/scifi]\nauthor: Dan Simmons\nrating: 4\nstatus: done\n---\n',
  });
  const def = parseBase(`filters:
  and:
    - file.hasTag("book")
formulas:
  stars: 'rating * 2'
  label: 'if(rating >= 4, "great", "ok")'
properties:
  author:
    displayName: Writer
views:
  - type: table
    name: Done
    filters:
      and:
        - 'status == "done"'
    order:
      - file.name
      - author
      - formula.stars
    sort:
      - property: rating
        direction: DESC
  - type: cards
    name: In Books
    filters: 'file.inFolder("Books") && !author.contains("Herbert")'
    order: [file.basename, formula.label]
  - type: table
    name: Grouped
    groupBy:
      property: status
      direction: ASC
    limit: 2
`);
  it('filters, sorts and computes formulas', () => {
    const r = runBase(def, v, 0);
    expect(r.rows.map((x) => x.path)).toEqual(['Books/Dune.md', 'Other/Hyperion.md']);
    expect(r.columns.map((c) => c.label)).toEqual(['File name', 'Writer', 'stars']);
    expect(r.rows[0].cells['formula.stars']).toBe(10);
    expect(r.errors).toEqual([]);
  });
  it('view filters as one expression, with methods', () => {
    const r = runBase(def, v, 1);
    expect(r.rows.map((x) => [x.path, x.cells['formula.label']])).toEqual([['Books/Emma.md', 'ok']]);
  });
  it('groups and limits', () => {
    const r = runBase(def, v, 2);
    expect(r.total).toBe(3);
    expect(r.rows).toHaveLength(2);
    expect(r.groups?.map((g) => g.key)).toEqual(['done']);
  });
  it('handles dates, durations, links and or/not', () => {
    const b = parseBase(`filters:
  or:
    - 'read > date("2026-01-01") && read < now()'
    - file.hasLink("Dune")
  not:
    - 'rating < 3'
views:
  - type: table
    name: t
    order: [file.name, file.tags]
`);
    const r = runBase(b, v, 0, { now: new Date(2026, 9, 31) });
    expect(r.rows.map((x) => x.path)).toEqual(['Books/Dune.md', 'Books/Emma.md']);
    const recent = runBase(parseBase(`filters: 'file.mtime > now() - "1 week"'\nviews:\n  - {type: table, name: x}`), v, 0, { now: new Date(1_700_000_000_000 + 86_400_000) });
    expect(recent.total).toBe(4);
  });
  it('reports expression errors instead of throwing', () => {
    const r = runBase(parseBase(`filters: 'unknownFn(1)'\nviews:\n  - {type: table, name: x}`), v, 0);
    expect(r.rows).toEqual([]);
    expect(r.errors[0]).toMatch(/unknownFn/);
  });
});

describe('rendering and publishing', () => {
  const v = vault({ 'A.md': '# Hi\n\nSee [[B#Part|bee]] and [[Missing]], ==mark== #tag/x $x^2$\n\n> [!tip] Title\n> body [[B]]\n\n![[B#Part]]\n\n```mermaid\ngraph TD\n```\n\n- [x] done\n\nText[^1]\n\n[^1]: Foot.\n<script>alert(1)</script>', 'B.md': '# Part\nPart text\n# Other\nno', 'Private.md': '[[A]]', 'p.png': '' });
  const html = renderNote(v.note('A.md')!.text, { resolve: (t) => v.resolve(t, 'A.md'), href: (p) => `#/${p}`, read: (p) => v.note(p)?.text ?? null });
  it('renders links, embeds, callouts, math and mermaid placeholders', () => {
    expect(html).toContain('<a class="internal-link" data-href="B.md" href="#/B.md#Part">bee</a>');
    expect(html).toContain('is-unresolved');
    expect(html).toContain('<mark>mark</mark>');
    expect(html).toContain('data-tag="tag/x"');
    expect(html).toContain('data-tex="x^2"');
    expect(html).toContain('data-callout="tip"');
    expect(html).toMatch(/callout-content">.*internal-link/s);
    expect(html).toContain('Part text');
    expect(html).not.toContain('no</p>');
    expect(html).toContain('class="nt-mermaid"');
    expect(html).toContain('task-list-item is-checked');
    expect(html).toContain('class="footnotes"');
    expect(html).not.toContain('<script>');
  });
  it('splits slides on ---', () => {
    expect(splitSlides('---\na: 1\n---\n# One\n---\n# Two\n```\n---\n```\n')).toEqual(['# One', '# Two\n```\n---\n```']);
  });
  it('publishes only chosen notes, with working links and no scripts', () => {
    const site = buildSite(v, ['A.md', 'B.md'], { title: 'Site' });
    const a = site.find((x) => x.path === pageName('A.md'))!.content as string;
    expect(a).toContain('href="b.html#Part"');
    expect(site.map((x) => x.path).sort()).toEqual(['a.html', 'b.html', 'index.html', 'style.css']);
    expect(site.some((x) => /<script/i.test(typeof x.content === 'string' ? x.content : ''))).toBe(false);
    const b = site.find((x) => x.path === 'b.html')!.content as string;
    expect(b).toContain('Linked from');
    expect(b).not.toContain('Private');
  });
  it('merges and extracts notes', () => {
    const w = vault({ 'A.md': 'a text', 'B.md': '---\nx: 1\n---\nb text', 'L.md': '[[B]]' });
    const m = mergeNotes(w, 'B.md', 'A.md');
    expect(m.text).toBe('a text\n\nb text\n');
    expect(applyEdits('[[B]]', m.edits.find((e) => e.path === 'L.md')!.edits)).toBe('[[A]]');
    expect(extractSelection('one two three', 4, 7, 'Two')).toEqual({ source: 'one [[Two]] three', extracted: 'two\n' });
  });
});

describe('plugins', () => {
  it('checks manifests and permissions', () => {
    const m = validateManifest({ id: 'word-tools', name: 'Word tools', version: '1.0.0', permissions: ['read', 'commands'] });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(allowed('vault.read', m.manifest, ['read', 'commands'])).toBe(true);
    expect(allowed('vault.write', m.manifest, ['read', 'commands', 'write'])).toBe(false);
    expect(allowed('vault.read', m.manifest, [])).toBe(false);
    expect(allowed('fs.readFile', m.manifest, ['read'])).toBe(false);
    expect(validateManifest({ id: 'X', name: 'x', version: '1', permissions: [] }).ok).toBe(false);
    expect(isForeignPlugin({ id: 'dataview', minAppVersion: '0.13.11' })).toBe(true);
  });
});

describe('large vaults', () => {
  it('indexes, searches and renames in a 10,000-note vault quickly', () => {
    const v = new VaultIndex();
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const links = [1, 7, 31].map((k) => `[[Note ${(i * k + 3) % 10_000}]]`).join(' ');
      v.set(f(`Folder ${i % 50}/Note ${i}.md`), `---\ntags: [t${i % 20}]\n---\n# Note ${i}\n\nSome words about topic ${i % 97} ${links} #area/${i % 7}\n- [ ] task ${i}\n`);
    }
    const indexed = performance.now() - t0;
    const t1 = performance.now();
    const hits = searchVault(v.allFiles(), (p) => v.note(p), 'tag:#t3 "topic 42"');
    const searched = performance.now() - t1;
    const t2 = performance.now();
    const back = v.backlinks('Folder 10/Note 10.md');
    const edits = v.renameEdits([{ from: 'Folder 10/Note 10.md', to: 'Folder 10/Renamed.md' }]);
    const linked = performance.now() - t2;
    expect(hits.length).toBeGreaterThan(0);
    expect(back.length).toBeGreaterThan(0);
    expect(edits.length).toBe(back.length);
    expect(indexed).toBeLessThan(15_000);
    expect(searched).toBeLessThan(3_000);
    expect(linked).toBeLessThan(1_000);
    console.log(`10k notes: index ${Math.round(indexed)} ms, search ${Math.round(searched)} ms, backlinks+rename ${Math.round(linked)} ms`);
  }, 60_000);
});
