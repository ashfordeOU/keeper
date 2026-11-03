// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { entryDates, entryPath, excerpt, isPhoto, normalizeJournalSettings, onThisDay, readEntry, streak, writeEntry, type JournalEntry } from '../core/notes/journal';

describe('journal files', () => {
  it('one file per day, in a folder per year', () => {
    expect(entryPath('Journal', '2026-11-03')).toBe('Journal/2026/2026-11-03.md');
    expect(entryPath('', '2026-11-03')).toBe('2026/2026-11-03.md');
    expect(() => entryPath('Journal', '3 Nov')).toThrow();
    expect(entryDates(['Journal/2026/2026-11-03.md', 'Journal/2025/2025-11-03.md', 'Journal/2026/notes.md', 'Other/2026/2026-11-01.md', 'Journal/2024/2025-01-01.md'], 'Journal')).toEqual(['2025-11-03', '2026-11-03']);
  });
  it('writes and reads back an entry', () => {
    const e: JournalEntry = { date: '2026-11-03', mood: 'good', weather: 'Partly cloudy', temperature: '12 °C', place: 'Tallinn', photos: ['Journal/attachments/IMG 1.jpg'], body: 'Walked to the sea.\n\nSaw a heron.' };
    const text = writeEntry(e, 'Tuesday, 3 November 2026');
    expect(text).toContain('journal: 2026-11-03');
    expect(text).toContain('mood: good');
    expect(text).toContain('# Tuesday, 3 November 2026\n\n![[Journal/attachments/IMG 1.jpg]]\n\nWalked to the sea.');
    expect(readEntry(text, '2026-11-03')).toEqual(e);
  });
  it('keeps other properties and text written elsewhere', () => {
    const before = '---\ntags: [travel]\nmood: rough\n---\nJust a line from my phone.';
    const r = readEntry(before, '2026-11-01');
    expect(r).toMatchObject({ mood: 'rough', body: 'Just a line from my phone.', photos: [] });
    const after = writeEntry({ ...r, mood: undefined }, 'Sunday, 1 November 2026', before);
    expect(after).toContain('tags:');
    expect(after).not.toContain('mood:');
  });
  it('makes a short excerpt and knows photos', () => {
    expect(excerpt('![[a.jpg]]\n# Hi\nSome **bold** words', 12)).toBe('Hi Some…');
    expect(isPhoto('IMG_2041.HEIC')).toBe(true);
    expect(isPhoto('notes.pdf')).toBe(false);
  });
  it('cleans its settings', () => {
    expect(normalizeJournalSettings({ folder: '' }).folder).toBe('');
    expect(normalizeJournalSettings(undefined).folder).toBe('Journal');
    expect(normalizeJournalSettings({ folder: '../x//y/', weather: 1 as never })).toEqual({ vault: '', folder: 'x/y', weather: false, place: false, photos: true });
  });
});

describe('streaks and On this day', () => {
  it('counts days in a row up to today or yesterday', () => {
    const d = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-11-01', '2026-11-02', '2026-11-03'];
    expect(streak(d, '2026-11-03')).toEqual({ current: 3, longest: 3 });
    expect(streak(d.slice(0, -1), '2026-11-03')).toEqual({ current: 2, longest: 3 });
    expect(streak(['2026-10-01'], '2026-11-03')).toEqual({ current: 0, longest: 1 });
    expect(streak(['2026-02-28', '2026-03-01'], '2026-03-01').current).toBe(2);
  });
  it('finds the same day in earlier years', () => {
    expect(onThisDay(['2024-11-03', '2025-11-03', '2025-11-04', '2026-11-03'], '2026-11-03')).toEqual(['2025-11-03', '2024-11-03']);
    expect(onThisDay(['2024-02-29'], '2025-02-28')).toEqual(['2024-02-29']);
  });
});
