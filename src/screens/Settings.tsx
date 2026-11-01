// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings: appearance, library folders, thresholds, assistant and about.

import { lazy, Suspense, useEffect, useState } from 'react';
import { REPORT_URL } from '../../core/brand';
import { ACTION_INFO, CARD_INFO, GLANCE_ACTIONS, GLANCE_CARDS, type GlanceSettings } from '../../core/glance';
import '../styles/glance.css';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageHead, Toggle } from '../components/ui';
import { mod, useStore } from '../state';
import { INSPECTOR_MODES } from '../../core/inspector';
import { SIDEBAR_MODES } from '../../core/sidebar-layout';
import { setSidebarPinned } from '../sidebar-state';
import { Row } from './IslandSettings';
import { LanguageRow, LoginRow } from './SettingsMore';
import { UpdatesPanel, WhatsNewHover } from '../components/Updates';
import { UsagePanel } from '../components/UsagePanel';
import { UsageStatsPanel } from '../components/UsageStatsPanel';
import { ProcessesPanel } from '../components/ProcessesPanel';
import { FeaturesPanel, SidebarPanel } from '../components/FeaturesPanel';
import { LockedFoldersPanel } from '../components/LockDialog';
import { BrainSettingsPanel } from '../components/BrainPanel';
import { PlatformIntegrations } from '../components/PlatformIntegrations';
import { AshfordeAppsPanel } from '../components/AshfordeApps';
import { ThemeGallery, ThemeTweaks } from '../components/ThemeGallery';
import { MeshPlaces } from './MeshParts';
import { useT } from '../i18n';
import { PimSettings } from '../pim/PimSettings';
import { PermissionsPanel } from '../components/PermissionsPanel';
import { NativeAppsPanel } from '../components/NativeAppsPanel';
import '../styles/screens-b.css';

const MonitorSettingsPanel = lazy(() => import('./monitor/MonitorSettings').then((m) => ({ default: m.MonitorSettingsPanel })));

function MenuBarSettings({ mac, trayOn }: { mac: boolean; trayOn: boolean }) {
  const { updateSettings } = useStore();
  const [g, setG] = useState<GlanceSettings | null>(null);
  useEffect(() => { void api.glance.settings().then(setG).catch(() => undefined); }, []);
  const save = (p: Partial<GlanceSettings>) => void api.glance.setSettings(p).then(setG);
  const flip = <T extends string>(list: T[], id: T) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div className="card settings-section" data-testid="settings-menubar">
      <Row title={mac ? 'The owl in the menu bar' : 'Keeper in the tray'} desc="Click it for the glance: weather, storage, this computer, the network, Keep Awake, quick actions and your newest downloads. Right-click for a short menu."><Toggle on={trayOn} onChange={(v) => void updateSettings({ trayEnabled: v })} /></Row>
      {g ? (
        <>
          {mac ? <Row title="Show the glance on hover" desc="Rest the pointer on the owl for a moment; it closes again when you move away."><Toggle on={g.hover} onChange={(v) => save({ hover: v })} /></Row> : null}
          <Row title="Cards" desc="What the glance shows, in this order.">
            <div className="gl-chips">{GLANCE_CARDS.map((c) => <button key={c} className={`gl-chip${g.cards.includes(c) ? ' on' : ''}`} aria-pressed={g.cards.includes(c)} onClick={() => save({ cards: GLANCE_CARDS.filter((x) => flip(g.cards, c).includes(x)) })}>{CARD_INFO[c].label}</button>)}</div>
          </Row>
          <Row title="Quick actions" desc="Up to twelve buttons under the cards.">
            <div className="gl-chips">{GLANCE_ACTIONS.map((a) => <button key={a} className={`gl-chip${g.actions.includes(a) ? ' on' : ''}`} aria-pressed={g.actions.includes(a)} onClick={() => save({ actions: flip(g.actions, a) })}>{ACTION_INFO[a].label}</button>)}</div>
          </Row>
        </>
      ) : null}
    </div>
  );
}

export function Settings() {
  const { route: settingsRoute } = useStore();
  useEffect(() => {
    if (settingsRoute.arg) setTimeout(() => document.getElementById(settingsRoute.arg!)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }, [settingsRoute.arg]);
  const { settings: s, updateSettings, info, toast } = useStore();
  const t = useT();
  if (!s) return null;

  const addFolder = async (field: 'folders' | 'excluded') => {
    const p = await api.settings.pickFolder();
    if (p && !s[field].includes(p)) await updateSettings({ [field]: [...s[field], p] });
  };
  const num = (v: string, min: number) => Math.max(min, Number(v) || min);

  return (
    <div style={{ maxWidth: 820 }}>
      <PageHead title={t('nav.settings')} />

      <h2 style={{ margin: '8px 0' }}>{t('settings.appearance')}</h2>
      <div className="card settings-section">
        <div className="setting" style={{ display: 'block' }}>
          <div style={{ fontWeight: 550, marginBottom: 10 }}>{t('settings.theme')}</div>
          <ThemeGallery />
        </div>
        <Row title="Light or dark" desc="Themes made for only one of them say so on their card.">
          <div className="seg">{(['system', 'light', 'dark'] as const).map((a) => <button key={a} className={s.appearance === a ? 'on' : ''} onClick={() => void updateSettings({ appearance: a })}><Icon name={a === 'light' ? 'sun' : a === 'dark' ? 'moon' : 'settings'} size={12} /> {t(`settings.${a}`)}</button>)}</div>
        </Row>
        <ThemeTweaks />
        <LanguageRow />
        <Row id="inspector" title="Inspector" desc={`The details panel on the right of file pages. Show or hide it any time with ${mod === '⌘' ? '⌘⌥I' : 'Ctrl+Alt+I'}; drag its left edge to change its width.`}>
          <div className="seg" role="radiogroup" aria-label="When the Inspector shows">{INSPECTOR_MODES.map((m) => <button key={m.id} role="radio" aria-checked={(s.inspectorMode ?? 'selection') === m.id} className={(s.inspectorMode ?? 'selection') === m.id ? 'on' : ''} onClick={() => void updateSettings({ inspectorMode: m.id })}>{m.label}</button>)}</div>
        </Row>
      </div>

      <h2 id="features" style={{ margin: '18px 0 8px' }}>Features</h2>
      <div className="card settings-section" style={{ padding: 16 }}>
        <div className="small muted" style={{ marginBottom: 12 }}>Switch off what you do not use: it stops completely, with no windows, timers or work in the background, and leaves the sidebar and menus.</div>
        <FeaturesPanel />
      </div>

      <h2 id="sidebar" style={{ margin: '18px 0 8px' }}>Sidebar</h2>
      <div className="card settings-section">
        <Row title="Layout" desc={`Automatic shows only icons in a narrow window. Point at the icons, or press ${mod === '⌘' ? '⌘⌥S' : 'Ctrl+Alt+S'}, to open it; drag its right edge to change its width.`}>
          <div className="seg" role="radiogroup" aria-label="Sidebar layout">{SIDEBAR_MODES.map((m) => <button key={m.id} role="radio" aria-checked={(s.sidebarMode ?? 'auto') === m.id} className={(s.sidebarMode ?? 'auto') === m.id ? 'on' : ''} onClick={() => { setSidebarPinned(null); void updateSettings({ sidebarMode: m.id }); }}>{m.label}</button>)}</div>
        </Row>
        <Row title="Long sections show" desc="The items you use most come first; “Show all” opens the rest. The page you are on always stays in view.">
          <select className="input" aria-label="Items shown in a long section" value={s.sidebarSectionLimit ?? 5} onChange={(e) => void updateSettings({ sidebarSectionLimit: Number(e.target.value) })}>
            {[3, 5, 8, 12].map((n) => <option key={n} value={n}>{n} items</option>)}
            <option value={0}>Everything</option>
          </select>
        </Row>
      </div>
      <div className="card settings-section" style={{ padding: 16, marginTop: 10 }}>
        <SidebarPanel />
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>{t('settings.library')}</h2>
      <div className="card settings-section">
        <div className="setting" style={{ display: 'block' }}>
          <div style={{ fontWeight: 550 }}>Folders Keeper shows and searches</div>
          <div className="list-box">
            {s.folders.map((f) => (
              <div key={f} className="li"><Icon name="folder" size={13} /><span className="grow ellipsis">{f}</span>
                <button className="btn ghost sm icon" title="Remove" onClick={() => void updateSettings({ folders: s.folders.filter((x) => x !== f) })}><Icon name="close" size={12} /></button></div>
            ))}
          </div>
          <button className="btn sm" onClick={() => void addFolder('folders')}><Icon name="plus" size={12} /> Add folder</button>
        </div>
        <div className="setting" style={{ display: 'block' }}>
          <div style={{ fontWeight: 550 }}>Never look in</div>
          <div className="d small muted">Keeper will not index, clean or touch anything inside these.</div>
          <div className="list-box">
            {s.excluded.map((f) => (
              <div key={f} className="li"><Icon name="lock" size={13} /><span className="grow ellipsis">{f}</span>
                <button className="btn ghost sm icon" onClick={() => void updateSettings({ excluded: s.excluded.filter((x) => x !== f) })}><Icon name="close" size={12} /></button></div>
            ))}
          </div>
          <button className="btn sm" onClick={() => void addFolder('excluded')}><Icon name="plus" size={12} /> Add folder</button>
        </div>
        <Row title="Include network drives and cloud folders in the library" desc="Off by default: walking a NAS or an on-demand cloud drive is slow and can download every file. Browse them any time from the sidebar."><Toggle on={!!s.includeRemote} onChange={(v) => void updateSettings({ includeRemote: v })} /></Row>
        <Row title="Show hidden files"><Toggle on={s.showHidden} onChange={(v) => void updateSettings({ showHidden: v })} /></Row>
        <Row title="Read text in images and PDFs" desc="Runs on this computer. Makes screenshots and scans searchable."><Toggle on={s.ocrEnabled} onChange={(v) => void updateSettings({ ocrEnabled: v })} /></Row>
        <Row title="Text languages" desc="Codes such as eng, deu, fra, spa, jpn, chi_sim. Language data downloads once.">
          <input className="input" defaultValue={s.ocrLanguages.join(', ')} onBlur={(e) => void updateSettings({ ocrLanguages: e.target.value.split(/[,\s]+/).filter(Boolean) })} />
        </Row>
        <Row title="Rebuild the index" desc="Re-reads every folder. Usually not needed — Keeper watches for changes.">
          <button className="btn" onClick={() => void api.library.rescan().then(() => toast('Index rebuilt'))}><Icon name="refresh" size={13} /> Rebuild</button>
        </Row>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>Clean Up</h2>
      <div className="card settings-section">
        <Row title="Downloads count as forgotten after"><input className="input" type="number" min={7} style={{ width: 80 }} defaultValue={s.oldDownloadDays} onBlur={(e) => void updateSettings({ oldDownloadDays: num(e.target.value, 7) })} /> days</Row>
        <Row title="Large files are bigger than"><input className="input" type="number" min={10} style={{ width: 80 }} defaultValue={s.largeFileMb} onBlur={(e) => void updateSettings({ largeFileMb: num(e.target.value, 10) })} /> MB</Row>
        <Row title="Apps count as unused after"><input className="input" type="number" min={30} style={{ width: 80 }} defaultValue={s.unusedAppDays} onBlur={(e) => void updateSettings({ unusedAppDays: num(e.target.value, 30) })} /> days</Row>
      </div>

      <h2 id="locked" style={{ margin: '18px 0 8px' }}>Locked folders</h2>
      <div className="card settings-section" style={{ padding: 16 }}>
        <p className="small muted" style={{ marginTop: 0 }}>Locked folders are encrypted on disk. They open with Touch ID, Windows Hello or your account password on this computer, or with a password of their own, and always with their recovery key.</p>
        <LockedFoldersPanel />
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>Quick access</h2>
      <div className="card settings-section">
        <LoginRow />
        <Row title="Quick Search shortcut" desc="Search your files from any app. Use + between keys, e.g. CommandOrControl+Shift+Space.">
          <input className="input" defaultValue={s.quickSearchShortcut} onBlur={(e) => e.target.value !== s.quickSearchShortcut && void updateSettings({ quickSearchShortcut: e.target.value.trim() })} style={{ width: 240 }} />
        </Row>
      </div>

      <h2 id="menubar" style={{ margin: '18px 0 8px' }}>{info?.platform === 'darwin' ? 'Menu bar' : 'Tray'}</h2>
      <MenuBarSettings mac={info?.platform === 'darwin'} trayOn={s.trayEnabled} />

      <h2 id="pim" style={{ margin: '18px 0 8px' }}>Mail &amp; Calendar</h2>
      <div className="card settings-section" style={{ padding: 16 }}>
        <PimSettings />
      </div>

      <h2 id="open-with" style={{ margin: '18px 0 8px' }}>Open with</h2>
      <div className="card settings-section" style={{ padding: 16 }}>
        <NativeAppsPanel />
      </div>

      <h2 id="brain" style={{ margin: '18px 0 8px' }}>AI &amp; Brain</h2>
      <div className="card settings-section" style={{ padding: '0 0 10px' }}>
        <BrainSettingsPanel />
      </div>

      <h2 id="permissions" style={{ margin: '18px 0 8px' }}>Permissions</h2>
      <div className="card settings-section" style={{ padding: 16 }}>
        <PermissionsPanel />
      </div>

      <h2 id="platform" style={{ margin: '18px 0 8px' }}>Works with your computer</h2>
      <div className="card settings-section" style={{ padding: 0 }}>
        <PlatformIntegrations />
      </div>

      <h2 id="mesh" style={{ margin: '18px 0 8px' }}>Keeper Mesh: where its controls appear</h2>
      <div className="card settings-section" style={{ padding: 16 }}>
        <MeshPlaces />
      </div>

      <h2 id="ashforde" style={{ margin: '18px 0 8px' }}>Ashforde apps</h2>
      <div className="settings-section">
        <AshfordeAppsPanel />
      </div>

      <h2 id="privacy" style={{ margin: '18px 0 8px' }}>Privacy</h2>
      <div className="card settings-section" style={{ padding: 16 }}>
        <UsageStatsPanel />
      </div>

      <h2 id="usage" style={{ margin: '18px 0 8px' }}>Keeper’s own usage</h2>
      <div className="card settings-section" style={{ padding: 16 }}>
        <UsagePanel />
      </div>

      <h2 id="monitor" style={{ margin: '18px 0 8px' }}>System monitor</h2>
      <Suspense fallback={null}><MonitorSettingsPanel /></Suspense>

      <h2 id="processes" style={{ margin: '18px 0 8px' }}>Keeper’s processes</h2>
      <div className="card settings-section" style={{ padding: 16 }}>
        <ProcessesPanel />
      </div>

      <h2 id="tasks-notes" style={{ margin: '18px 0 8px' }}>Tasks and notes</h2>
      <div className="card settings-section">
        <Row title="Export tasks and notes" desc="Every task (all lists, with steps, repeats and notes) and every Island note, as one JSON file you keep. Nothing is uploaded.">
          <button className="btn" data-testid="export-tasks" onClick={() => void api.islandTools.exportJson().then((p) => p && toast(`Saved to ${p}`), (e: unknown) => toast(String(e)))}><Icon name="down" size={13} /> Export…</button>
        </Row>
      </div>

      <h2 id="updates" style={{ margin: '18px 0 8px' }}>{t('settings.updates')}</h2>
      <div className="card settings-section" style={{ padding: 16 }}>
        <UpdatesPanel />
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <div>
            <div style={{ fontWeight: 600 }}>Reopen where I left off</div>
            <div className="small muted">After an update, a restart or a crash, Keeper opens every window and tab where it was: same pages, same scroll, unsent drafts.</div>
          </div>
          <Toggle on={s.restorePlace !== false} onChange={(v) => void updateSettings({ restorePlace: v })} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <div>
            <div style={{ fontWeight: 600 }}>Open pages in tabs</div>
            <div className="small muted">Middle-click or ⌘/Ctrl-click anything to open it in a new tab; ⌘T / Ctrl+T for a new one. Tabs that are not in front use almost no memory.</div>
          </div>
          <Toggle on={s.tabs !== false} onChange={(v) => void updateSettings({ tabs: v })} />
        </div>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>{t('settings.about')}</h2>
      <div className="card settings-section">
        <Row title="Keeper by Ashforde®" desc={<WhatsNewHover only="current"><span style={{ textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>Version {info?.appVersion ?? ''}</span></WhatsNewHover>}>
          <button className="btn" onClick={() => void api.system.openExternal('https://github.com/ashfordeOU/keeper')}><Icon name="external" size={13} /> Source code</button>
        </Row>
        <Row title="Report a problem" desc="Something wrong or missing? Tell us on GitHub; a page opens with a new issue ready to fill in.">
          <button className="btn" data-testid="report-problem" onClick={() => void api.system.openExternal(REPORT_URL)}><Icon name="external" size={13} /> Report a problem</button>
        </Row>
        <Row title="License" desc="Free to use for everyone, at home and at work. The source code is public under the PolyForm Shield License 1.0.0: you may read and change it, but not sell it or offer a competing product.">
          <button className="btn ghost" onClick={() => void api.system.openExternal('https://github.com/ashfordeOU/keeper/blob/main/LICENSE.md')}>Read</button>
        </Row>
        <Row title="Third-party licences" desc="Keeper is built with other people's work, used under their own licences. See who made it and the terms each part comes with.">
          <button className="btn ghost" onClick={() => void api.system.openExternal('https://github.com/ashfordeOU/keeper/blob/main/THIRD-PARTY-NOTICES.md')}>Read</button>
        </Row>
        <Row title="Trademark" desc="© 2026 Ashforde OÜ. Ashforde® is a registered trademark of Ashforde OÜ. The source code is available under PolyForm Shield 1.0.0; the name and logo identify the official, signed Keeper.">
          <span className="small muted">®</span>
        </Row>
        <Row title="Privacy" desc="No account and no uploads of your files. Search, text reading and duplicate checks run on this computer. Keeper sends anonymous usage stats once a day to help us improve it; you can switch this off any time under Privacy above, where you can see exactly what is sent. The network is otherwise only used for the assistant, weather, lyrics, calendar and update checks you turn on." >
          <Icon name="lock" size={16} />
        </Row>
      </div>
    </div>
  );
}
