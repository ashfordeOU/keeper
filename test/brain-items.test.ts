// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Search by meaning over mail, events, tasks, contacts and notes: words and
// meaning fused, unchanged items keep their vectors, gone items lose them,
// newest first in the background batches, and one ranked list with files.

import { describe, expect, it } from 'vitest';
import type { BrainHit } from '../core/brain-contract';
import { terms } from '../core/brain/chunk';
import { asSource, fuse, ItemIndex, rankTogether, sigOf, type ItemDoc } from '../core/brain/items';
import { VectorStore } from '../core/brain/vectors';

const GROUPS = [['rent', 'lease', 'landlord', 'apartment', 'flat', 'deposit', 'miete'], ['dentist', 'teeth', 'appointment'], ['invoice', 'receipt', 'payment', 'paid']];
const embed = (t: string) => {
  const v = new Float32Array(4);
  v[3] = 0.05;
  for (const w of terms(t, true)) GROUPS.forEach((g, i) => { if (g.some((x) => w.startsWith(x))) v[i] += 1; });
  return v;
};

const docs = (): ItemDoc[] => [
  { id: 'mail:a', kind: 'mail', title: 'Lease renewal', text: 'Lena: please sign the new lease for the flat by Friday.', time: 3, sub: 'Lena Fischer', cite: 'keeper://mail/a' },
  { id: 'event:b', kind: 'event', title: 'Dentist', text: 'Check-up for teeth', time: 2, sub: 'Elm Street', cite: 'keeper://event/b' },
  { id: 'task:c', kind: 'task', title: 'Pay the plumber', text: 'Invoice 4471', time: 1, cite: 'keeper://task/c' },
  { id: 'contact:d', kind: 'contact', title: 'Lena Fischer', text: 'Acme Property GmbH · lena@acme.example', cite: 'keeper://contact/lena%40acme.example' },
];

const filled = () => {
  const ix = new ItemIndex();
  ix.useVectors(new VectorStore(4));
  ix.setAll(docs());
  for (const b of ix.nextToEmbed(100)) ix.setVector(b.num, embed(b.text));
  return ix;
};

describe('the item index', () => {
  it('finds items by their words, any kind or one kind', () => {
    const ix = filled();
    expect(ix.search('lena').map((h) => h.id)).toEqual(expect.arrayContaining(['mail:a', 'contact:d']));
    expect(ix.search('lena', { kinds: ['contact'] }).map((h) => h.id)).toEqual(['contact:d']);
    const h = ix.search('sign lease')[0];
    expect(h.id).toBe('mail:a');
    expect(h.why).toContain('words');
    expect(h.snippet).toMatch(/sign/);
    expect(h.cite).toBe('keeper://mail/a');
  });
  it('finds items by meaning when the words differ', () => {
    const ix = filled();
    const hits = ix.search('money back from the landlord', { qvec: embed('money back from the landlord') });
    expect(hits[0].id).toBe('mail:a');
    expect(hits[0].why).toEqual(['meaning']);
    expect(ix.search('teeth cleaning', { qvec: embed('teeth') })[0].id).toBe('event:b');
  });
  it('embeds newest first, and only what changed', () => {
    const ix = new ItemIndex();
    ix.useVectors(new VectorStore(4));
    ix.setAll(docs());
    expect(ix.pendingCount).toBe(4);
    expect(ix.nextToEmbed(2).map((b) => b.text.split('\n')[0])).toEqual(['Lease renewal', 'Dentist']);
    for (const b of ix.nextToEmbed(10)) ix.setVector(b.num, embed(b.text));
    expect(ix.pendingCount).toBe(0);
    const d = docs();
    d[1] = { ...d[1], text: 'Teeth cleaning, bring the card' };
    expect(ix.setAll(d)).toEqual({ added: 0, changed: 1, removed: 0 });
    expect(ix.pendingCount).toBe(1);
    expect(ix.setAll(d.slice(0, 2))).toEqual({ added: 0, changed: 0, removed: 2 });
    expect(ix.embedded).toBe(1);
    expect(ix.search('plumber')).toEqual([]);
  });
  it('keeps vectors across restarts for unchanged items', () => {
    const ix = filled();
    const keys = ix.keys();
    const buf = ix.vectors!.toBuffer();
    const again = new ItemIndex();
    again.restore(JSON.parse(JSON.stringify(keys)));
    again.useVectors(VectorStore.fromBuffer(buf));
    const d = docs();
    d[0] = { ...d[0], title: 'Lease renewal (signed)' };
    again.setAll(d);
    expect(again.pendingCount).toBe(1);
    expect(again.nextToEmbed(5).map((b) => b.text.split('\n')[0])).toEqual(['Lease renewal (signed)']);
  });
  it('finds items alike in meaning', () => {
    const ix = filled();
    ix.setAll([...docs(), { id: 'note:e', kind: 'note', title: 'Flat deposit', text: 'The landlord keeps two months of rent.', cite: '/n/deposit.md' }]);
    for (const b of ix.nextToEmbed(10)) ix.setVector(b.num, embed(b.text));
    expect(ix.similar('note:e')[0].id).toBe('mail:a');
  });
  it('has signatures that change with the words', () => {
    expect(sigOf({ title: 'a', text: 'b' })).toBe(sigOf({ title: 'a', text: 'b' }));
    expect(sigOf({ title: 'a', text: 'b' })).not.toBe(sigOf({ title: 'a', text: 'c' }));
  });
});

describe('one list for every kind', () => {
  it('fuses ranks', () => {
    const f = fuse([['x', 'y'], ['y', 'z']]);
    expect(f[0].key).toBe('y');
    expect(f[0].score).toBeLessThanOrEqual(1);
  });
  it('ranks files and items together, and cites each', () => {
    const files: BrainHit[] = [{ path: '/h/lease.pdf', name: 'lease.pdf', kind: 'document', size: 10, mtime: 5, score: 0.9, why: ['words'] }];
    const items = filled().search('lease', { qvec: embed('lease') });
    const all = rankTogether(files, items, 10);
    expect(all.map((h) => h.kind)).toEqual(expect.arrayContaining(['file', 'mail']));
    expect(all.slice(0, 2).map((h) => h.kind).sort()).toEqual(['file', 'mail']);
    const src = asSource(all.find((h) => h.kind === 'mail')!);
    expect(src).toMatchObject({ path: 'keeper://mail/a', item: 'mail', kind: 'other' });
    expect(asSource(all.find((h) => h.kind === 'file')!).item).toBeUndefined();
  });
});
