// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings: a list of sections with search on the left, one section on the
// right. Each section shows its Basic settings and "More settings (n)" for the
// Advanced ones. Search finds any setting by its words or what people call it
// ("dark mode"), and opens, scrolls to and flashes it. "Changed (n)" lists what
// differs from how Keeper came, each with a reset. Everything comes from one
// registry, core/settings-schema.ts.
//
// Links: settings:<section>, settings:<section>#<setting>, the old anchors
// (settings:permissions, settings:locked, …) and settings:changed.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { catalogueFor } from '../../core/permissions';
import { changedSettings, defaultValue, getPath, groupHits, labelOf, parseSettingsArg, patchFor, searchSettings, sectionDef, sectionRows, SECTIONS, settingDef, valueText, type SearchHit, type SectionId, type SettingDef } from '../../core/settings-schema';
import { FEATURES } from '../../core/features';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/ui';
import { useFeatureStates } from '../features';
import { openGuide, useHowTo } from '../guide';
import { useT } from '../i18n';
import { useStore } from '../state';
import { ResetSheet } from './settings/panels';
import { SettingRow } from './settings/SettingRow';
import '../styles/settings.css';
import '../styles/screens-b.css';

const MORE_KEY = (id: string) => `settings.more.${id}`;
const readMore = (id: string): boolean | null => {
  try { const v = localStorage.getItem(MORE_KEY(id)); return v === null ? null : v === '1'; } catch { return null; }
};
const writeMore = (id: string, open: boolean) => {
  try { localStorage.setItem(MORE_KEY(id), open ? '1' : '0'); } catch { /* storage unavailable */ }
};

/** Scrolls to a row once it exists (lazy panels load after the section opens), keeps it in view while they settle, and flashes it. */
function reveal(selector: string) {
  const started = Date.now();
  let stopped = false;
  const find = () => document.querySelector<HTMLElement>(selector);
  const tryNow = () => {
    if (stopped) return;
    const el = find();
    if (!el) { if (Date.now() - started < 4000) requestAnimationFrame(tryNow); return; }
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    window.setTimeout(() => el.classList.remove('flash'), 1400);
    // Panels above it may still grow as they load: follow it for a second.
    const pane = document.querySelector('.settings-content > *');
    const ro = new ResizeObserver(() => { if (!stopped) find()?.scrollIntoView({ block: 'center' }); });
    if (pane) ro.observe(pane);
    window.setTimeout(() => ro.disconnect(), 1200);
  };
  requestAnimationFrame(tryNow);
  return () => { stopped = true; };
}

function useVisibleSections() {
  const states = useFeatureStates();
  const { info } = useStore();
  const on = (f?: string) => !f || states?.get(f)?.on !== false;
  return SECTIONS.filter((s) => on(s.feature) || (s.id === 'pim' && on('calendars'))).map((s) => ({ ...s, label: labelOf(s, info?.platform ?? '') }));
}

export function Settings() {
  const { route, go, settings, info } = useStore();
  const t = useT();
  const platform = info?.platform ?? '';
  const target = parseSettingsArg(route.arg);
  const sections = useVisibleSections();
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const changed = settings ? changedSettings(settings, platform) : [];
  const section: SectionId | 'changed' = target.section === 'changed' || sections.some((s) => s.id === target.section) ? target.section : 'general';
  // "More settings" opened for an Advanced row someone was sent to.
  const [opened, setOpened] = useState<Record<string, number>>({});

  // ⌘F / Ctrl+F finds a setting while Settings is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopImmediatePropagation(); searchRef.current?.focus(); searchRef.current?.select(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // A link to one setting (or a search result): its section, its "More settings" if it is Advanced, then scroll and flash.
  useEffect(() => {
    if (!target.setting) { document.querySelector('.settings-content')?.scrollTo?.({ top: 0 }); return; }
    const id = target.setting;
    if (id.startsWith('feature:')) return reveal(`[data-feature="${CSS.escape(id.slice(8))}"]`);
    const d = settingDef(id);
    const row = d?.inPanel ? settingDef(d.inPanel) : d;
    if (row?.level === 'advanced') setOpened((o) => ({ ...o, [row.section]: Date.now() }));
    return reveal(`[data-setting-id="${CSS.escape(row?.id ?? id)}"]`);
  }, [route.arg]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (h: SearchHit) => {
    setQ('');
    go({ name: 'settings', arg: h.kind === 'feature' ? `features#feature:${h.id}` : `${h.section}#${h.id}` });
  };

  return (
    <div className="settings-page">
      <PageHead title={t('nav.settings')} />
      <div className="settings-panes">
        <nav className="settings-nav" aria-label="Settings sections">
          <div className="settings-search">
            <Icon name="search" size={14} />
            <input ref={searchRef} className="bare" type="search" data-testid="settings-search" aria-label="Find a setting" placeholder="Find a setting" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }} />
          </div>
          <div className="settings-sections">
            {sections.map((s) => (
              <button key={s.id} className={`settings-sec ${!q && section === s.id ? 'on' : ''}`} aria-current={!q && section === s.id ? 'page' : undefined} data-testid={`settings-sec-${s.id}`} onClick={() => { setQ(''); go({ name: 'settings', arg: s.id }); }}>
                <Icon name={s.icon} size={14} /><span className="grow">{s.label}</span>
              </button>
            ))}
          </div>
          <button className={`settings-sec settings-changed ${!q && section === 'changed' ? 'on' : ''}`} aria-current={!q && section === 'changed' ? 'page' : undefined} data-testid="settings-changed" onClick={() => { setQ(''); go({ name: 'settings', arg: 'changed' }); }}>
            <Icon name="history" size={14} /><span className="grow">Changed</span><span className="count">{changed.length}</span>
          </button>
        </nav>
        <div className="settings-content">
          {q.trim() ? <SearchResults q={q} onOpen={open} />
            : section === 'changed' ? <ChangedView defs={changed} />
              : <SectionPane key={section} id={section} forceOpen={opened[section]} />}
        </div>
      </div>
    </div>
  );
}

function SectionPane({ id, forceOpen }: { id: SectionId; forceOpen?: number }) {
  const { settings, info } = useStore();
  const platform = info?.platform ?? '';
  const states = useFeatureStates();
  const def = sectionDef(id)!;
  const rows = sectionRows(id, platform);
  const shown = (d: SettingDef) => !d.feature || states?.get(d.feature)?.on !== false;
  const basic = rows.basic.filter(shown);
  const advanced = rows.advanced.filter(shown);
  const [more, setMore] = useState<boolean>(() => readMore(id) ?? !!settings?.settingsAdvanced);
  const [resetting, setResetting] = useState(false);
  useEffect(() => { if (readMore(id) === null) setMore(!!settings?.settingsAdvanced); }, [id, settings?.settingsAdvanced]);
  useEffect(() => { if (forceOpen) setMore(true); }, [forceOpen]);
  const changedHere = settings ? changedSettings(settings, platform).filter((d) => d.section === id) : [];
  const draw = (list: SettingDef[]) => {
    const out: { group?: string; rows: SettingDef[] }[] = [];
    for (const d of list) {
      const last = out[out.length - 1];
      if (last && last.group === d.group) last.rows.push(d);
      else out.push({ group: d.group, rows: [d] });
    }
    return out.map((g, i) => (
      <Fragment key={`${g.group ?? ''}${i}`}>
        {g.group ? <h3 className="settings-group">{g.group}</h3> : null}
        <div className="card settings-card settings-section">{g.rows.map((d) => <SettingRow key={d.id} def={d} />)}</div>
      </Fragment>
    ));
  };
  return (
    <section className="settings-section-pane" aria-labelledby={id}>
      <h2 id={id} className="settings-h2">{labelOf(def, platform)}</h2>
      {draw(basic)}
      {advanced.length ? (
        <>
          <button className="settings-more" data-testid="settings-more" aria-expanded={more} onClick={() => { setMore(!more); writeMore(id, !more); }}>
            <Icon name={more ? 'chevronDown' : 'chevronRight'} size={12} /> {more ? 'Fewer settings' : `More settings (${advanced.length})`}
          </button>
          {more ? <div className="settings-advanced">{draw(advanced)}</div> : null}
        </>
      ) : null}
      <div className="settings-foot">
        <button className="btn ghost sm" data-testid="settings-reset-section" disabled={!changedHere.length} onClick={() => setResetting(true)}>Reset this section…</button>
      </div>
      {resetting ? <ResetSheet title={`Reset ${labelOf(def, platform)}`} defs={changedHere} onClose={() => setResetting(false)} /> : null}
    </section>
  );
}

/** Words of the query in bold. */
function Marked({ text, q }: { text: string; q: string }) {
  const words = q.trim().split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'ig'));
  return <>{parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : <Fragment key={i}>{p}</Fragment>))}</>;
}

function SearchResults({ q, onOpen }: { q: string; onOpen: (h: SearchHit) => void }) {
  const { settings, info, go } = useStore();
  const platform = info?.platform ?? '';
  const perms = useMemo(() => catalogueFor(platform).map((p) => ({ id: p.id, name: p.name })), [platform]);
  const hits = useMemo(() => searchSettings(q, settings, platform, perms), [q, settings, platform, perms]);
  const [all, setAll] = useState<string | null>(null);
  const how = useHowTo(hits.length ? '' : q);
  if (!hits.length) {
    return (
      <div className="settings-noresults" data-testid="settings-noresults">
        <p>No settings match “{q}”. Try fewer words{how.length ? ', or ask:' : '.'}</p>
        {how.slice(0, 3).map((h) => <button key={h.id} className="btn ghost" onClick={() => openGuide(`flow:${h.id}`)}><Icon name="sparkle" size={13} /> How do I… {h.title.toLowerCase()}?</button>)}
      </div>
    );
  }
  return (
    <div className="settings-results" data-testid="settings-results" aria-label="Settings that match">
      {groupHits(hits, 3).map((g) => {
        const list = all === g.section ? hits.filter((h) => h.section === g.section) : g.hits;
        return (
          <div key={g.section} className="settings-result-group">
            {list.map((h) => (
              <div key={`${h.kind}:${h.id}:${h.label}`} className="settings-result">
                <button className="settings-result-main" data-testid="settings-result" onClick={() => onOpen(h)}>
                  <span className="crumbs small muted">{h.crumbs.slice(0, -1).join(' › ')} ›</span>
                  <span className="settings-result-label"><Marked text={h.label} q={q} /></span>
                  {h.advanced ? <span className="adv-tag">Advanced</span> : null}
                  {h.off ? <span className="small muted">({h.off.name} is off)</span> : null}
                </button>
                {h.off ? <button className="btn sm" onClick={() => void api.features.set(h.off!.feature, true).then(() => go({ name: 'settings', arg: `${h.section}#${h.id}` }))}>Turn on</button> : null}
              </div>
            ))}
            {g.more && all !== g.section ? <button className="settings-result-more small" onClick={() => setAll(g.section)}>{g.more} more in {labelOf(sectionDef(g.section)!, platform)}</button> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Changed (n): every setting that differs from how Keeper came, old → new, each with a reset; and parts changed from the recommended set. */
function ChangedView({ defs }: { defs: SettingDef[] }) {
  const { settings, info, go, updateSettings, toast } = useStore();
  const [all, setAll] = useState(false);
  if (!settings) return null;
  const platform = info?.platform ?? '';
  const partChanges = FEATURES.filter((f) => !f.always && !f.bridge && settings.features?.[f.id] !== undefined && settings.features[f.id] !== f.defaultOn).length;
  const reset = (d: SettingDef) => {
    const top = d.path!.split('.')[0] as keyof typeof settings;
    const before = settings[top];
    void updateSettings(patchFor(settings, d.path!, defaultValue(d))).then(() => toast(`Reset ‘${labelOf(d, platform)}’`, { label: 'Undo', run: () => void updateSettings({ [top]: before } as Partial<typeof settings>) }));
  };
  return (
    <section className="settings-section-pane" aria-labelledby="changed">
      <h2 id="changed" className="settings-h2">Changed</h2>
      {defs.length ? (
        <div className="card settings-card" data-testid="changed-list">
          {defs.map((d) => (
            <div key={d.id} className="changed-row" data-testid="changed-row">
              <button className="grow changed-name" onClick={() => go({ name: 'settings', arg: `${d.section}#${d.id}` })}>
                <span className="crumbs small muted">{labelOf(sectionDef(d.section)!, platform)} ›</span> {labelOf(d, platform)}
              </button>
              <span className="muted">{valueText(d, defaultValue(d), platform)}</span><Icon name="chevronRight" size={11} /><b>{valueText(d, getPath(settings, d.path!), platform)}</b>
              <button className="btn ghost sm" data-testid={`reset-${d.id}`} onClick={() => reset(d)}>Reset</button>
            </div>
          ))}
        </div>
      ) : <p className="muted" data-testid="changed-empty">Everything is as Keeper came.</p>}
      {partChanges ? <p className="small"><button className="link-btn" onClick={() => go({ name: 'settings', arg: 'features' })}>Parts: {partChanges} change{partChanges === 1 ? '' : 's'} from Recommended</button></p> : null}
      {defs.length ? <div className="settings-foot"><button className="btn ghost sm" onClick={() => setAll(true)}>Reset all {defs.length}…</button></div> : null}
      {all ? <ResetSheet title="Reset changed settings" defs={defs} onClose={() => setAll(false)} /> : null}
    </section>
  );
}
