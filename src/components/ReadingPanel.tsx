// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Accessibility → Reading comfort: larger text that wraps, a font
// made for reading, line and letter spacing, larger buttons, and reading aloud
// with the computer's own voice (core/a11y.ts, core/read-aloud.ts).

import { useEffect, useState } from 'react';
import { defaultA11y, LETTER_SPACINGS, LINE_SPACINGS, READING_FONTS, type A11ySettings, type ReadingFont } from '../../core/a11y';
import { api } from '../api';
import { useFeature } from '../features';
import { Row } from '../screens/IslandSettings';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Toggle } from './ui';

const FONTS: { id: ReadingFont; label: string }[] = [
  { id: 'theme', label: 'Theme’s own' },
  { id: 'hyperlegible', label: READING_FONTS.hyperlegible.name },
  { id: 'dyslexic', label: READING_FONTS.dyslexic.name },
];

export function ReadingPanel() {
  const { settings, updateSettings, toast } = useStore();
  const readAloud = useFeature('readAloud');
  const [voice, setVoice] = useState<{ ok: boolean; message?: string } | null>(null);
  useEffect(() => { void api.reading.voice().then(setVoice, () => setVoice(null)); }, []);
  if (!settings) return null;
  const a: A11ySettings = { ...defaultA11y(), ...settings.a11y };
  const set = (patch: Partial<A11ySettings>) => void updateSettings({ a11y: { ...a, ...patch } });
  const seg = <T extends string | number>(label: string, list: readonly T[], value: T, words: (v: T) => string, pick: (v: T) => void, testId?: string) => (
    <div className="seg" role="radiogroup" aria-label={label} data-testid={testId}>
      {list.map((x) => <button key={String(x)} role="radio" aria-checked={value === x} className={value === x ? 'on' : ''} onClick={() => pick(x)}>{words(x)}</button>)}
    </div>
  );
  const font = a.readingFont ?? 'theme';
  return (
    <div data-testid="reading-panel">
      <Row title="Wrap larger text" desc={a.textScale > 1 ? 'Text grows and wraps to the window instead of zooming everything.' : 'Choose a larger text size above first.'}>
        <Toggle label="Wrap larger text" disabled={a.textScale <= 1} on={!!a.reflow} onChange={(v) => set({ reflow: v })} />
      </Row>
      <Row title="Reading font" desc={font === 'theme' ? 'Fonts made for reading download once (about 40 to 240 KB).' : READING_FONTS[font].line}>
        {seg('Reading font', FONTS.map((f) => f.id), font, (v) => FONTS.find((f) => f.id === v)!.label, (v) => set({ readingFont: v }), 'reading-font')}
      </Row>
      <Row title="Line spacing" desc="More room between lines on pages, notes and mail.">
        {seg('Line spacing', LINE_SPACINGS, (a.lineSpacing ?? 0) as (typeof LINE_SPACINGS)[number], (v) => (v ? String(v) : 'Theme'), (v) => set({ lineSpacing: v }), 'line-spacing')}
      </Row>
      <Row title="Letter spacing" desc="A little more room between letters.">
        {seg('Letter spacing', LETTER_SPACINGS, (a.letterSpacing ?? 0) as (typeof LETTER_SPACINGS)[number], (v) => (v === 0 ? 'Normal' : v < 0.06 ? 'Wider' : 'Widest'), (v) => set({ letterSpacing: v }))}
      </Row>
      <Row title="Larger buttons" desc="Every button and switch at least 44 pixels tall, easier to hit.">
        <Toggle label="Larger buttons" on={!!a.bigTargets} onChange={(v) => set({ bigTargets: v })} />
      </Row>
      <Row title="Read aloud" desc={voice && !voice.ok ? voice.message ?? '' : 'Select text and choose Read Aloud in the command palette, or use it in Notes. Your computer’s own voice; nothing leaves it.'}>
        <div className="btn-row">
          {readAloud ? <button className="btn ghost" data-testid="read-aloud-try" disabled={voice?.ok === false} onClick={() => void api.reading.speak('This is how Keeper reads text aloud.').then((r) => { if (!r.ok && r.message) toast(r.message); })}><Icon name="audio" size={13} /> Try it</button> : null}
          <Toggle label="Read aloud" on={readAloud} onChange={(v) => void api.features.set('readAloud', v)} />
        </div>
      </Row>
    </div>
  );
}

/** The text to read: what is selected, or the page's main words. */
export function textToRead(): string {
  const sel = window.getSelection()?.toString().trim();
  if (sel) return sel;
  const main = document.querySelector<HTMLElement>('.cm-content, .rd-article, .content');
  return (main?.innerText ?? '').trim();
}
