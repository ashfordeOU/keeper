// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mind maps: a note's headings and lists as branches, every edit written
// back into the Markdown without touching the rest, and a layout that stays
// quick for hundreds of branches.

import { describe, expect, it } from 'vitest';
import { addChild, addSibling, countNodes, findNode, isMindmapNote, layoutMindmap, moveNode, neighbour, newMindmapText, parseMindmap, removeNode, renameNode, serializeMindmap, textWidth } from '../core/notes/mindmap';

const NOTE = `---
tags: [garden]
---
# Garden plan

Intro paragraph.

## Beds
- North bed
  - [ ] Dig
  - [x] Compost
    continued line
- South bed

Some text under beds.

| a | b |
| - | - |
| 1 | 2 |

### Herbs
1. Basil
2. Mint

## Tools

\`\`\`
# not a heading
- not an item
\`\`\`

- Spade
`;

const ids = (doc: ReturnType<typeof parseMindmap>) => {
  const out: Record<string, string> = {};
  const walk = (n: typeof doc.root) => { out[n.text] = n.id; n.children.forEach(walk); };
  walk(doc.root);
  return out;
};
const shape = (n: ReturnType<typeof parseMindmap>['root']): unknown => (n.children.length ? { [n.text]: n.children.map(shape) } : n.text);

describe('reading a note as a map', () => {
  it('turns the title, headings and list items into branches, and keeps everything else', () => {
    const d = parseMindmap(NOTE, 'file');
    expect(d.rootIsHeading).toBe(true);
    expect(shape(d.root)).toEqual({ 'Garden plan': [{ Beds: [{ 'North bed': ['Dig', 'Compost'] }, 'South bed', { Herbs: ['Basil', 'Mint'] }] }, { Tools: ['Spade'] }] });
    expect(d.root.children[1].rest.join('\n')).toContain('# not a heading');
  });
  it('writes back exactly what it read', () => {
    expect(serializeMindmap(parseMindmap(NOTE, 'file'))).toBe(NOTE);
    for (const t of ['', 'just text\n', '- a\n- b\n  - c\n', '# Only\n', '## A\n### B\ntext\n## C\n', 'No title\n\n## Branch\n- leaf\n']) expect(serializeMindmap(parseMindmap(t, 'f'))).toBe(t);
  });
  it('uses the file name when there is no title line', () => {
    const d = parseMindmap('## A\n## B\n', 'My map');
    expect(d.root.text).toBe('My map');
    expect(d.rootIsHeading).toBe(false);
  });
});

describe('editing writes the Markdown', () => {
  it('adds a child and a sibling of the right kind', () => {
    const d = parseMindmap(NOTE, 'f');
    const id = ids(d);
    addChild(d, id['South bed'], 'Peas');
    addSibling(d, id.Tools, 'Shed');
    addChild(d, id['Garden plan'], 'Budget');
    addSibling(d, id.Basil, 'Thyme');
    const t = serializeMindmap(d);
    expect(t).toContain('- South bed\n  - Peas\n');
    expect(t).toContain('## Shed\n');
    expect(t).toContain('## Budget\n');
    expect(t).toContain('1. Basil\n2. Thyme\n3. Mint\n');
    expect(t.startsWith('---\ntags: [garden]\n---\n# Garden plan\n')).toBe(true);
  });
  it('renames, and renaming the middle of an untitled map gives it a title', () => {
    const d = parseMindmap('## A\n', 'file');
    renameNode(d, d.root.id, 'Ideas');
    renameNode(d, d.root.children[0].id, 'Apples\nand pears');
    expect(serializeMindmap(d)).toBe('# Ideas\n## Apples and pears\n');
  });
  it('moves branches: a heading under a list item becomes an item; text under it moves along', () => {
    const d = parseMindmap(NOTE, 'f');
    const id = ids(d);
    expect(moveNode(d, id.Herbs, id['South bed'])).toBe(true);
    const t = serializeMindmap(d);
    expect(t).toContain('- South bed\n  - Herbs\n    1. Basil\n    2. Mint\n');
    expect(t).not.toContain('### Herbs');
    expect(moveNode(d, id.Beds, id.Dig)).toBe(false);
    expect(moveNode(d, id.Spade, id.Beds, 0)).toBe(true);
    expect(serializeMindmap(d)).toContain('## Beds\n- Spade\n- North bed');
  });
  it('removes a branch with what is under it', () => {
    const d = parseMindmap(NOTE, 'f');
    const id = ids(d);
    expect(removeNode(d, id.Beds)).toBe(id.Tools);
    const t = serializeMindmap(d);
    expect(t).not.toContain('North bed');
    expect(t).not.toContain('Some text under beds');
    expect(removeNode(d, d.root.id)).toBeNull();
  });
  it('makes a new mind map note and knows it', () => {
    const d = parseMindmap(newMindmapText('Trip'), 'x');
    expect(d.root.children.map((c) => c.text)).toEqual(['First idea', 'Second idea', 'Third idea']);
    expect(isMindmapNote({ view: 'mindmap' })).toBe(true);
    expect(isMindmapNote({ view: 'Mind map' })).toBe(true);
    expect(isMindmapNote({})).toBe(false);
  });
});

describe('layout', () => {
  it('balances branches left and right, hides collapsed ones, never overlaps', () => {
    const d = parseMindmap(NOTE, 'f');
    const id = ids(d);
    const l = layoutMindmap(d, { mode: 'balanced', collapsed: new Set() });
    expect(l.nodes).toHaveLength(countNodes(d.root));
    expect(l.nodes.find((p) => p.id === id.Beds)!.side).toBe(1);
    expect(l.nodes.find((p) => p.id === id.Tools)!.side).toBe(-1);
    const c = layoutMindmap(d, { mode: 'right', collapsed: new Set([id.Beds]) });
    expect(c.nodes.find((p) => p.id === id.Beds)!.hidden).toBe(7);
    expect(c.nodes.some((p) => p.id === id.Dig)).toBe(false);
    expect(c.nodes.every((p) => p.side === 1)).toBe(true);
    for (const a of l.nodes) for (const b of l.nodes) if (a !== b) expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
  });
  it('arrow keys go to a child, the parent, and siblings', () => {
    const d = parseMindmap(NOTE, 'f');
    const id = ids(d);
    const l = layoutMindmap(d, { mode: 'right', collapsed: new Set() });
    expect(neighbour(l, d, id.Beds, 'ArrowLeft')).toBe(d.root.id);
    expect(neighbour(l, d, id.Beds, 'ArrowDown')).toBe(id.Tools);
    expect(neighbour(l, d, id['North bed'], 'ArrowRight')).toBe(id.Dig);
    expect(findNode(d, id.Mint)!.parent!.text).toBe('Herbs');
  });
  it('lays out and edits a 500-branch map quickly', () => {
    const lines = ['# Big'];
    for (let a = 0; a < 10; a++) { lines.push(`## Topic ${a}`); for (let b = 0; b < 49; b++) lines.push(`- Point ${a}.${b} with some words`); }
    const text = `${lines.join('\n')}\n`;
    const t0 = performance.now();
    const d = parseMindmap(text, 'x');
    expect(countNodes(d.root)).toBe(501);
    let l = layoutMindmap(d, { mode: 'balanced', collapsed: new Set() });
    for (let k = 0; k < 20; k++) { addChild(d, d.root.children[k % 10].id, `New ${k}`); l = layoutMindmap(d, { mode: 'balanced', collapsed: new Set() }); serializeMindmap(d); }
    expect(l.nodes).toHaveLength(521);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(textWidth('MMM', 10)).toBeGreaterThan(textWidth('iii', 10));
  });
});
