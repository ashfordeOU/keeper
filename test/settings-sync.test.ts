// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { applyItems, itemsOf, keepOlder, local, mergeDocs, OLDER_MAX, onlyCats, portable, stamp, SYNC_CATEGORIES, type SyncDoc, type SyncSource } from '../core/settings-sync';
import { jargonIn } from '../core/settings-schema';

const HOME_A = '/home/ana';
const HOME_B = '/Users/ana';

describe('what travels', () => {
  it('never secrets, home paths as ~/…, and nothing with a path only one computer has', () => {
    expect(portable({ name: 'x', apiKey: 'sk-1', token: 't', nested: { password: 'p', ok: 1 } }, HOME_A)).toEqual({ name: 'x', nested: { ok: 1 } });
    expect(portable({ folder: '/home/ana/Downloads', to: '/home/ana' }, HOME_A)).toEqual({ folder: '~/Downloads', to: '~' });
    expect(portable({ folder: '/mnt/backup/x' }, HOME_A)).toBeNull();
    expect(portable({ url: 'https://example.com/{query}' }, HOME_A)).toEqual({ url: 'https://example.com/{query}' });
    expect(local({ folder: '~/Downloads/Invoices' }, HOME_B)).toEqual({ folder: '/Users/ana/Downloads/Invoices' });
    expect(local('~/Documents', 'C:\\Users\\ana')).toBe('C:\\Users\\ana\\Documents');
  });

  it('reads each category as keyed items', () => {
    const src: SyncSource = {
      snippets: [{ id: 's1', abbr: ';addr', text: '1 High Street' }],
      look: { theme: 'harbour', appearance: 'dark', folders: ['/x'] },
      launcher: { links: [{ id: 'map' }], commands: [{ id: 'c1' }] },
      rules: [{ id: 'r1', folder: '/home/ana/Downloads' } as never, { id: 'r2', folder: '/mnt/nas' } as never],
      mode: { base: 'focus' },
    };
    expect(itemsOf('snippets', src, HOME_A)).toEqual({ s1: { id: 's1', abbr: ';addr', text: '1 High Street' } });
    expect(Object.keys(itemsOf('look', src, HOME_A))).toEqual(['appearance', 'theme']);
    expect(Object.keys(itemsOf('launcher', src, HOME_A))).toEqual(['link:map', 'command:c1']);
    expect(itemsOf('rules', src, HOME_A)).toEqual({ r1: { id: 'r1', folder: '~/Downloads' } });
    expect(itemsOf('mode', src, HOME_A)).toEqual({ mode: { base: 'focus' } });
  });

  it('has plain words for each category', () => {
    for (const c of SYNC_CATEGORIES) expect(jargonIn(`${c.label} ${c.hint}`)).toEqual([]);
  });
});

describe('two computers', () => {
  const t0 = 1_000;
  it('a change on one arrives on the other, and the newest change wins per item', () => {
    let a: SyncDoc = stamp({}, { snippets: { s1: { id: 's1', text: 'one' } } }, t0, 'A');
    let b: SyncDoc = stamp({}, { snippets: { s2: { id: 's2', text: 'two' } } }, t0 + 1, 'B');
    const ab = mergeDocs(a, b, ['snippets'], 5);
    expect(Object.keys(ab.doc.snippets!)).toEqual(['s1', 's2']);
    expect(ab.changed).toEqual(['snippets']);
    expect(ab.older).toEqual([]);
    a = ab.doc;
    b = mergeDocs(b, a, ['snippets']).doc;
    // Both edit s1; B's edit is later.
    a = stamp(a, { snippets: { s1: { id: 's1', text: 'one (A)' }, s2: { id: 's2', text: 'two' } } }, t0 + 10, 'A');
    b = stamp(b, { snippets: { s1: { id: 's1', text: 'one (B)' }, s2: { id: 's2', text: 'two' } } }, t0 + 20, 'B');
    const m = mergeDocs(a, b, ['snippets'], 99);
    expect((m.doc.snippets!.s1.value as { text: string }).text).toBe('one (B)');
    expect(m.older).toEqual([expect.objectContaining({ cat: 's'.concat('nippets'), key: 's1', label: 'Snippet s1', value: { id: 's1', text: 'one (A)' }, by: 'A', replaced: 99 })]);
    // The other way round changes nothing on B.
    expect(mergeDocs(b, a, ['snippets']).changed).toEqual([]);
  });

  it('a removal travels, and an unchanged item is not stamped again', () => {
    let a = stamp({}, { searches: { q1: { id: 'q1', query: 'pdfs' }, q2: { id: 'q2', query: 'photos' } } }, 1, 'A');
    const again = stamp(a, { searches: { q1: { id: 'q1', query: 'pdfs' }, q2: { id: 'q2', query: 'photos' } } }, 2, 'A');
    expect(again.searches!.q1.at).toBe(1);
    a = stamp(a, { searches: { q1: { id: 'q1', query: 'pdfs' } } }, 3, 'A');
    expect(a.searches!.q2.gone).toBe(true);
    const b = stamp({}, { searches: { q1: { id: 'q1', query: 'pdfs' }, q2: { id: 'q2', query: 'photos' } } }, 2, 'B');
    const m = mergeDocs(b, a, ['searches']);
    const out = applyItems('searches', m.doc.searches!, { searches: [{ id: 'q1', query: 'pdfs' }, { id: 'q2', query: 'photos' }, { id: 'q3', query: 'here only' }] }, HOME_B);
    expect(out.searches!.map((s) => s.id)).toEqual(['q1', 'q3']);
  });

  it('writes values back under this computer’s home folder, keeping its own order and its own items', () => {
    const doc = stamp({}, { rules: { r1: { id: 'r1', folder: '~/Downloads' }, r9: { id: 'r9', folder: '~/Desktop' } } }, 1, 'A');
    const out = applyItems('rules', doc.rules!, { rules: [{ id: 'r9' }, { id: 'local', folder: '/mnt/nas' } as never] }, HOME_B);
    expect(out.rules).toEqual([{ id: 'r9', folder: '/Users/ana/Desktop' }, { id: 'r1', folder: '/Users/ana/Downloads' }, { id: 'local', folder: '/mnt/nas' }]);
    expect(applyItems('look', stamp({}, { look: { theme: 'harbour' } }, 1, 'A').look!, {}, HOME_B)).toEqual({ look: { theme: 'harbour' } });
  });

  it('only the categories both share take part, and a tie goes the same way on both sides', () => {
    const a = stamp({}, { look: { theme: 'harbour' }, mode: { mode: 'focus' } }, 5, 'A');
    const b = stamp({}, { look: { theme: 'meadow' } }, 5, 'B');
    expect(Object.keys(onlyCats(a, ['look']))).toEqual(['look']);
    const onA = mergeDocs(a, b, ['look']).doc.look!.theme.value;
    const onB = mergeDocs(b, a, ['look']).doc.look!.theme.value;
    expect(onA).toBe(onB);
    expect(mergeDocs(a, b, ['look']).doc.mode).toEqual(a.mode);
  });

  it('keeps at most 40 older versions, newest first', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ cat: 'look' as const, key: 'theme', label: 'Theme', value: i, at: i, by: 'A', replaced: i }));
    const kept = keepOlder([], many);
    expect(kept).toHaveLength(OLDER_MAX);
    expect(kept[0].replaced).toBe(49);
  });
});

describe('the first look', () => {
  it('gives what was there before sharing no age, so a real change elsewhere wins', () => {
    const a = stamp({}, { look: { theme: 'harbour' } }, 100, 'A', 0);
    expect(a.look!.theme.at).toBe(0);
    const b = stamp(stamp({}, { look: { theme: 'meadow' } }, 50, 'B', 0), { look: { theme: 'blossom' } }, 60, 'B', 0);
    expect(b.look!.theme.at).toBe(60);
    expect(mergeDocs(a, b, ['look']).doc.look!.theme.value).toBe('blossom');
  });
});
