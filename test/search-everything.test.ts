// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { best, groupHits, queryWords, scoreText, withTimeout, type EverythingHit } from '../core/search-everything';

describe('the one search box', () => {
  it('needs every word, ranks title and word starts higher, ignores accents and case', () => {
    const w = queryWords('Café  INVOICE');
    expect(w).toEqual(['cafe', 'invoice']);
    expect(scoreText(w, 'Invoice from Café Nero')).toBeGreaterThan(scoreText(w, 'Monthly', 'invoice for the cafe'));
    expect(scoreText(w, 'Invoice')).toBe(-1);
    const list = ['Team lunch', 'Lunch with Anna', 'Brunch', 'Lunch'];
    expect(best(list, queryWords('lunch'), (t) => [t], 5)).toEqual(['Lunch', 'Team lunch', 'Lunch with Anna']);
  });

  it('groups in a fixed order and leaves out empty groups', () => {
    const h = (kind: EverythingHit['kind'], id: string): EverythingHit => ({ kind, id, title: id, route: 'home' });
    const g = groupHits([h('setting', 's'), h('mail', 'm'), h('note', 'n'), h('mail', 'm2')]);
    expect(g.map((x) => x.kind)).toEqual(['mail', 'note', 'setting']);
    expect(g[0].hits.map((x) => x.id)).toEqual(['m', 'm2']);
  });

  it('a slow or failing source is left out instead of holding the rest', async () => {
    expect(await withTimeout(new Promise((r) => setTimeout(() => r(1), 200)), 20)).toBeUndefined();
    expect(await withTimeout(Promise.reject(new Error('x')), 20)).toBeUndefined();
    expect(await withTimeout(Promise.resolve(3), 20)).toBe(3);
  });
});
