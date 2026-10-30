import { describe, expect, it } from 'vitest';
import { parseQuery, queryToText, removeChip } from '../core/query/parse';
import { DAY, NOW } from './helpers';

const p = (s: string) => parseQuery(s, NOW);
const d = (y: number, m: number, day = 1) => new Date(y, m - 1, day).getTime();

describe('parseQuery', () => {
  it('reads type, date and size together', () => {
    const { query, chips, explanation } = p('pdfs from last week over 5 MB');
    expect(query.exts).toEqual(['pdf']);
    expect(query.size).toMatchObject({ min: 5 * 1024 * 1024 });
    expect(query.date?.from).toBe(d(2026, 10, 30) - 7 * DAY);
    expect(chips.map((c) => c.label)).toEqual(['PDFs', 'In the last 7 days', 'Larger than 5 MB']);
    expect(explanation).toBe('Showing PDFs, modified in the last 7 days, larger than 5 MB');
  });

  it('understands cameras and month names', () => {
    const { query } = p('videos from my iphone in august');
    expect(query.kinds).toEqual(['video']);
    expect(query.cameras).toEqual(['iphone']);
    expect(query.date).toMatchObject({ from: d(2026, 8), to: d(2026, 9) });
  });

  it('uses last year for months that have not started yet', () => {
    expect(p('photos from december').query.date).toMatchObject({ from: d(2025, 12), to: d(2026, 1) });
  });

  it('keeps leftover words as text to find inside files', () => {
    const { query } = p('screenshots with wifi password');
    expect(query.screenshot).toBe(true);
    expect(query.terms).toEqual(['wifi', 'password']);
  });

  it('handles "older than" with a size', () => {
    const { query } = p('zips bigger than 1gb older than 6 months');
    expect(query.exts).toEqual(['zip']);
    expect(query.size?.min).toBe(1024 ** 3);
    expect(query.date?.to).toBe(NOW - 6 * 30 * DAY);
    expect(query.date?.from).toBeUndefined();
  });

  it('maps services to download sources', () => {
    expect(p('pdfs from gmail').query.sources).toEqual(['gmail']);
    expect(p('files from chatgpt').query.sources).toEqual(['chatgpt']);
    expect(p('slack attachments').query.sources).toEqual(['slack']);
    expect(p('downloaded from github.com').query.sources).toEqual(['github']);
    expect(p('from example.org').query.sources).toEqual(['web:example.org']);
  });

  it('reads a month with a year as a range, not "since"', () => {
    const { query } = p('invoice from march 2025');
    expect(query.terms).toEqual(['invoice']);
    expect(query.date).toMatchObject({ from: d(2025, 3), to: d(2025, 4) });
  });

  it('switches the date field for created / opened', () => {
    expect(p('photos taken yesterday').query.date).toMatchObject({ field: 'created', from: d(2026, 10, 29), to: d(2026, 10, 30) });
    expect(p('documents opened this month').query.date?.field).toBe('opened');
  });

  it('reads sorting and limits', () => {
    const { query } = p('top 10 biggest files in downloads');
    expect(query.sort).toEqual({ key: 'size', desc: true });
    expect(query.limit).toBe(10);
    expect(query.locations).toEqual(['Downloads']);
  });

  it('supports quotes, exclusions, tags and explicit syntax', () => {
    const { query } = p('"tax return" pdf -draft #work ext:docx in:desktop');
    expect(query.phrases).toEqual(['tax return']);
    expect(query.exclude).toEqual(['draft']);
    expect(query.tags).toEqual(['work']);
    expect(query.exts.sort()).toEqual(['docx', 'pdf']);
    expect(query.locations).toEqual(['Desktop']);
  });

  it('size ranges', () => {
    expect(p('spreadsheets between 1 and 5 mb').query.size).toMatchObject({ min: 1024 ** 2, max: 5 * 1024 ** 2 });
    expect(p('images under 200kb').query.size).toMatchObject({ max: 200 * 1024 });
    expect(p('empty files').query.size).toMatchObject({ max: 1 });
    expect(p('huge videos').query.size?.min).toBe(1024 ** 3);
  });

  it('weekday and explicit dates', () => {
    expect(p('songs since monday').query.date?.from).toBe(d(2026, 10, 26));
    expect(p('files before 2024-01-01').query.date?.to).toBe(d(2024, 1, 1));
    expect(p('images between march and may').query.date).toMatchObject({ from: d(2026, 3), to: d(2026, 6) });
    expect(p('heic photos from 2024').query).toMatchObject({ exts: ['heic'], kinds: [], date: { from: d(2024, 1), to: d(2025, 1) } });
  });

  it('a bare extension is a type', () => {
    expect(p('dmg').query.exts).toEqual(['dmg']);
    expect(p('mp4s').query.exts).toEqual(['mp4']);
  });

  it('duplicates keyword', () => {
    expect(p('duplicate photos').query).toMatchObject({ duplicatesOnly: true, kinds: ['image'] });
  });

  it('round-trips through queryToText', () => {
    const a = p('pdfs from gmail over 5mb "tax" -draft');
    const b = parseQuery(queryToText(a.query), NOW);
    expect(b.query.exts).toEqual(a.query.exts);
    expect(b.query.sources).toEqual(a.query.sources);
    expect(b.query.size?.min).toBe(a.query.size?.min);
    expect(b.query.phrases).toEqual(a.query.phrases);
    expect(b.query.exclude).toEqual(a.query.exclude);
  });

  it('removing a chip removes only that filter', () => {
    const a = p('pdfs from gmail over 5mb');
    const chip = a.chips.find((c) => c.field === 'source')!;
    const q = removeChip(a.query, chip);
    expect(q.sources).toEqual([]);
    expect(q.exts).toEqual(['pdf']);
  });
});
