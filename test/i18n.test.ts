// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Groundwork for translating all of Keeper (docs/TRANSLATING.md).
import { describe, expect, it } from 'vitest';
import { LANGUAGES, offeredLanguages, pseudo, resolveLanguage, translate } from '../src/i18n-strings';
// @ts-expect-error a plain script (scripts/i18n-extract.mjs), no types
import { extractAll, keyedUses, rtlReport, stringsIn } from '../scripts/i18n-extract.mjs';

describe('finding words that are not translatable yet', () => {
  it('finds JSX text and the words in title, aria-label, placeholder and alt, not code', () => {
    const found = stringsIn(`const A = () => <div title="Open the file" className="x">
      Hello there {name} <b>{'Quoted words'}</b> <i>{t('nav.home')}</i> <input placeholder={'Search files'} aria-label="Search" /> 42 · ✓ <img alt="" /> sendTo
    </div>;`).map((s: { text: string; kind: string }) => `${s.kind}:${s.text}`);
    expect(found).toEqual(['title:Open the file', 'text:Hello there', 'text:Quoted words', 'placeholder:Search files', 'aria-label:Search']);
  });

  it('never grows: new words go through translation keys (lower these as screens move to keys)', () => {
    const all = extractAll();
    expect(all.length).toBeLessThanOrEqual(8094);
    expect(keyedUses()).toBeGreaterThanOrEqual(60);
    const rtl = Object.values(rtlReport() as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(rtl).toBeLessThanOrEqual(640);
  }, 30_000);
});

describe('languages on offer', () => {
  it('offers only complete languages unless More settings is shown, and keeps the one chosen', () => {
    expect(offeredLanguages(false).map((l) => l.code)).toEqual(['system', 'en']);
    expect(offeredLanguages(false, 'de').map((l) => l.code)).toEqual(['system', 'en', 'de']);
    expect(offeredLanguages(true).length).toBe(LANGUAGES.length);
  });
  it('makes pseudo text longer and accented, with placeholders kept', () => {
    expect(pseudo('Open {name}')).toBe('[Øpéñ {name} ····]');
    expect(pseudo('Cancel').length).toBeGreaterThan('Cancel'.length * 1.3);
    expect(pseudo('[done]')).toBe('[done]');
    expect(resolveLanguage('qps-ploc')).toBe('qps-ploc');
    expect(translate('qps-ploc', 'common.cancel')).toBe(pseudo('Cancel'));
  });
});
