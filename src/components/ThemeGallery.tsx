// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings → Appearance: every theme as a small live preview, plus the
// person's own touches on top (accent colour, font, density, corners).

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { contrast, resolveMode, themeById, THEMES, themeVariables, type Theme } from '../../core/themes';
import { Row } from '../screens/IslandSettings';
import { useStore } from '../state';
import { currentThemeId, onSystemAppearance, themePatch } from '../theme';

const ACCENTS = ['#5b5bf0', '#d6337a', '#c2410c', '#b45309', '#15803d', '#0d9488', '#0369a1', '#7c3aed', '#18181b'];

function useSystemDark(): boolean {
  const q = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  const [d, setD] = useState(q);
  useEffect(() => onSystemAppearance(() => setD(q())), []);
  return d;
}

function Preview({ t, mode }: { t: Theme; mode: 'light' | 'dark' }) {
  const vars = themeVariables(t, mode) as CSSProperties;
  return (
    <div className="tg-prev" style={vars} aria-hidden>
      <div className="tg-side">
        <div className="tg-owl" />
        <div className="tg-nav on" style={{ width: '80%' }} />
        <div className="tg-nav" style={{ width: '64%' }} />
        <div className="tg-nav" style={{ width: '72%' }} />
        <div className="tg-nav" style={{ width: '52%' }} />
      </div>
      <div className="tg-main">
        <div className="tg-h">Home</div>
        <div className="tg-sub">12 files tidied today</div>
        <div className="tg-tiles">
          {(['c-image', 'c-video', 'c-audio', 'c-document'] as const).map((k) => <i key={k} style={{ background: `var(--${k})` }} />)}
        </div>
        <div className="tg-bar">
          <span className="tg-btn">Tidy up</span>
          <span className="tg-pill" />
        </div>
      </div>
    </div>
  );
}

export function ThemeGallery() {
  const { settings: s, updateSettings } = useStore();
  const systemDark = useSystemDark();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!s) return null;
  const current = currentThemeId(s);
  const pick = (id: string) => void updateSettings(themePatch(s, id));
  const onKey = (e: KeyboardEvent, i: number) => {
    const cols = Math.max(1, Math.round((refs.current[0]?.parentElement?.clientWidth ?? 600) / 188));
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: THEMES.length - 1 - i }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const j = Math.max(0, Math.min(THEMES.length - 1, i + step));
    refs.current[j]?.focus();
    pick(THEMES[j].id);
  };
  return (
    <div className="tg" role="radiogroup" aria-label="Theme">
      {THEMES.map((t, i) => {
        const mode = resolveMode(t, s.appearance, systemDark);
        const only = !t.light ? 'Dark only' : !t.dark ? 'Light only' : '';
        const on = t.id === current;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            className={`tg-card ${on ? 'on' : ''}`}
            role="radio"
            aria-checked={on}
            tabIndex={on || (!THEMES.some((x) => x.id === current) && i === 0) ? 0 : -1}
            onClick={() => pick(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            title={t.tags.join(', ')}
          >
            <Preview t={t} mode={mode} />
            <div className="tg-name">{t.name}{only ? <span className="tg-mode">{only}</span> : null}</div>
            <div className="tg-line">{t.tagline}</div>
          </button>
        );
      })}
    </div>
  );
}

/** Accent colour, font, density and corners, on top of whichever theme is chosen. */
export function ThemeTweaks() {
  const { settings: s, updateSettings } = useStore();
  const systemDark = useSystemDark();
  if (!s) return null;
  const t = themeById(currentThemeId(s));
  const mode = resolveMode(t, s.appearance, systemDark);
  const surface = (mode === 'dark' ? t.dark : t.light)?.['bg-elev'] ?? '#ffffff';
  const weak = s.accent && contrast(s.accent, surface) < 3;
  const seg = <K extends 'font' | 'density' | 'corners'>(key: K, options: [string, string][]) => (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} className={s[key] === v ? 'on' : ''} onClick={() => void updateSettings({ [key]: v } as Partial<typeof s>)}>{label}</button>
      ))}
    </div>
  );
  return (
    <>
      <Row title="Accent colour" desc={weak ? 'This colour is hard to see on this theme’s panels; a darker or brighter one will read better.' : 'Buttons, links and highlights. “Theme” keeps the theme’s own.'}>
        <div className="tg-swatches">
          <button className={`btn sm ${!s.accent ? 'primary' : ''}`} onClick={() => void updateSettings({ accent: '' })}>Theme</button>
          {ACCENTS.map((c) => (
            <button key={c} className={`tg-swatch ${s.accent === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Accent ${c}`} aria-pressed={s.accent === c} onClick={() => void updateSettings({ accent: c })} />
          ))}
          <input type="color" className="tg-swatch" aria-label="Custom accent colour" value={s.accent || '#5b5bf0'} onChange={(e) => void updateSettings({ accent: e.target.value })} />
        </div>
      </Row>
      <Row title="Font" desc="Uses fonts already on your computer; nothing is downloaded.">
        {seg('font', [['theme', 'Theme'], ['system', 'System'], ['rounded', 'Rounded'], ['serif', 'Serif'], ['mono', 'Mono']])}
      </Row>
      <Row title="Density" desc="Compact fits more on screen.">
        {seg('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']])}
      </Row>
      <Row title="Corners">
        {seg('corners', [['theme', 'Theme'], ['rounded', 'Rounded'], ['sharp', 'Sharp']])}
      </Row>
    </>
  );
}
