// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The top bar's View menu: a labelled button with a small pop-over for this
// window (open the page in a new window, the command palette) and the look
// (a theme, light or dark) straight away. The full gallery (seasons, tweaks)
// stays in Settings → Appearance; ⌘⇧L still swaps between the last two themes.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { resolveMode, THEMES, type Theme } from '../../core/themes';
import type { Appearance } from '../../core/types';
import { useStore } from '../state';
import { activeThemeId, themePatch } from '../theme';
import { Icon } from './Icon';

const prefersDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

function swatch(t: Theme, appearance: Appearance): { bg: string; elev: string; accent: string; text: string } {
  const tok = (resolveMode(t, appearance, prefersDark()) === 'dark' ? t.dark : t.light) ?? t.dark ?? t.light!;
  const get = (k: string, d: string) => ((tok as unknown as Record<string, string>)[k] ?? d);
  return { bg: get('bg', '#111'), elev: get('elev', '#222'), accent: get('accent', '#6366f1'), text: get('text', '#eee') };
}

export interface ViewAction { label: string; icon: string; kbd?: string; testId?: string; run: () => void }

export function ThemeQuickPicker({ title, actions = [], label = 'View' }: { title: string; /** window actions listed above the themes */ actions?: ViewAction[]; /** the button's visible word */ label?: ReactNode }) {
  const { settings, updateSettings, go } = useStore();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  if (!settings) return null;
  const current = activeThemeId(settings);
  const appearance = settings.appearance ?? 'system';
  return (
    <div className="theme-quick" ref={box}>
      <button className={`btn ghost sm topbar-labelled ${open ? 'on' : ''}`} data-testid="view-menu" title={title} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="palette" size={15} /> {label} <Icon name="chevronDown" size={11} />
      </button>
      {open ? (
        <div className="theme-quick-pop" role="dialog" aria-label="View">
          {actions.length ? (
            <div className="theme-quick-actions">
              {actions.map((a) => (
                <button key={a.label} className="theme-quick-action" data-testid={a.testId} onClick={() => { setOpen(false); a.run(); }}>
                  <Icon name={a.icon} size={14} /> <span className="grow">{a.label}</span>{a.kbd ? <kbd>{a.kbd}</kbd> : null}
                </button>
              ))}
            </div>
          ) : null}
          <div className="theme-quick-head">
            <strong>Theme</strong>
            <div className="seg" role="radiogroup" aria-label="Light or dark">
              {(['system', 'light', 'dark'] as const).map((a) => (
                <button key={a} role="radio" aria-checked={appearance === a} className={appearance === a ? 'on' : ''} onClick={() => void updateSettings({ appearance: a })}>
                  <Icon name={a === 'light' ? 'sun' : a === 'dark' ? 'moon' : 'settings'} size={12} /> {a === 'system' ? 'Auto' : a === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </div>
          <div className="theme-quick-grid" role="listbox" aria-label="Themes">
            {THEMES.map((t) => {
              const c = swatch(t, appearance);
              const on = t.id === current;
              return (
                <button key={t.id} role="option" aria-selected={on} className={`theme-quick-item ${on ? 'on' : ''}`} title={t.tagline} onClick={() => void updateSettings(themePatch(settings, t.id))}>
                  <span className="theme-quick-sw" style={{ background: c.bg, borderColor: c.elev }} aria-hidden>
                    <i style={{ background: c.elev }} />
                    <i style={{ background: c.accent }} />
                    <i style={{ background: c.text }} />
                  </span>
                  <span className="theme-quick-name">{t.name}</span>
                  {on ? <Icon name="check" size={12} /> : null}
                </button>
              );
            })}
          </div>
          <button className="btn sm ghost theme-quick-more" onClick={() => { setOpen(false); go({ name: 'settings', arg: 'appearance' }); }}>
            All theme options… <Icon name="chevronRight" size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
