// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Appearance: every theme as a small live preview, plus the
// person's own touches on top (accent colour, font, density, corners).

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { contrast, resolveMode, seasonFor, themeById, themeCategory, THEMES, themeVariables, type Theme } from '../../core/themes';
import { Row } from '../screens/IslandSettings';
import { useStore } from '../state';
import { activeThemeId, hemisphereOf, onSystemAppearance, themePatch } from '../theme';

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

type Shelf = 'all' | 'main' | 'seasonal' | 'unique' | 'dark' | 'light';
const SHELVES: [Shelf, string][] = [['all', 'All'], ['main', 'Main'], ['seasonal', 'Seasonal'], ['unique', 'Unique'], ['dark', 'Dark'], ['light', 'Light']];

function onShelf(t: Theme, shelf: Shelf): boolean {
  if (shelf === 'all') return true;
  if (shelf === 'dark') return !!t.dark;
  if (shelf === 'light') return !!t.light;
  return themeCategory(t) === shelf;
}

const SEASON_LABEL = { winter: 'Winter', spring: 'Spring', summer: 'Summer', autumn: 'Autumn', festive: 'Festive' } as const;

export function ThemeGallery() {
  const { settings: s, updateSettings } = useStore();
  const systemDark = useSystemDark();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [shelf, setShelf] = useState<Shelf>('all');
  const [q, setQ] = useState('');
  if (!s) return null;
  const current = activeThemeId(s);
  const query = q.trim().toLowerCase();
  const list = THEMES.filter((t) => onShelf(t, shelf) && (!query || `${t.name} ${t.tagline} ${t.tags.join(' ')}`.toLowerCase().includes(query)));
  // Choosing a theme by hand stops following the seasons.
  const pick = (id: string) => void updateSettings({ ...themePatch(s, id), ...(s.themeSeasons ? { themeSeasons: false } : {}) });
  const surprise = () => {
    const pool = (list.length > 1 ? list : THEMES).filter((t) => t.id !== current);
    pick(pool[Math.floor(Math.random() * pool.length)].id);
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const cols = Math.max(1, Math.round((refs.current[0]?.parentElement?.clientWidth ?? 600) / 188));
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: list.length - 1 - i }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const j = Math.max(0, Math.min(list.length - 1, i + step));
    refs.current[j]?.focus();
    pick(list[j].id);
  };
  const hemi = hemisphereOf(s);
  const season = seasonFor(new Date(), hemi);
  return (
    <>
      <div className="tg-tools">
        <div className="seg" role="tablist" aria-label="Show themes">
          {SHELVES.map(([v, label]) => <button key={v} role="tab" aria-selected={shelf === v} className={shelf === v ? 'on' : ''} onClick={() => setShelf(v)}>{label}</button>)}
        </div>
        <input className="input tg-search" type="search" placeholder="Search themes" aria-label="Search themes" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn sm" onClick={surprise} title="Pick a theme at random">Surprise me</button>
      </div>
      <div className="tg-seasons">
        <label className="tg-seasons-on">
          <input type="checkbox" checked={!!s.themeSeasons} onChange={(e) => void updateSettings({ themeSeasons: e.target.checked })} />
          <span><b>Follow the seasons</b> <span className="muted small">— switches to the theme for the time of year{s.themeSeasons ? ` (now ${SEASON_LABEL[season]})` : ''}</span></span>
        </label>
        {s.themeSeasons ? (
          <div className="seg" aria-label="Hemisphere">
            {([['auto', `Automatic (${hemi === 'south' ? 'south' : 'north'})`], ['north', 'North'], ['south', 'South']] as const).map(([v, label]) => (
              <button key={v} className={(s.hemisphere ?? 'auto') === v ? 'on' : ''} onClick={() => void updateSettings({ hemisphere: v })}>{label}</button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="tg" role="radiogroup" aria-label="Theme">
        {list.map((t, i) => {
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
              tabIndex={on || (!list.some((x) => x.id === current) && i === 0) ? 0 : -1}
              onClick={() => pick(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              title={t.tags.join(', ')}
            >
              <Preview t={t} mode={mode} />
              <div className="tg-name">{t.name}{only ? <span className="tg-mode">{only}</span> : null}{t.season ? <span className="tg-mode">{SEASON_LABEL[t.season]}</span> : null}</div>
              <div className="tg-line">{t.tagline}</div>
            </button>
          );
        })}
        {!list.length ? <div className="muted small" style={{ padding: 12 }}>No theme matches “{q}”.</div> : null}
      </div>
    </>
  );
}

/** Accent colour, font, density and corners, on top of whichever theme is chosen. */
export function ThemeTweaks() {
  const { settings: s, updateSettings } = useStore();
  const systemDark = useSystemDark();
  if (!s) return null;
  const t = themeById(activeThemeId(s));
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
