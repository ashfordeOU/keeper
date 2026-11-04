// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The parts of Settings that are more than a switch: each registry row with a
// `panel` (core/settings-schema.ts) is drawn by one of these. `own` panels draw
// their own label; the others get the row's label above them.

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { REPORT_URL } from '../../../core/brand';
import { ACTION_INFO, CARD_INFO, GLANCE_ACTIONS, GLANCE_CARDS, GLANCE_SECTIONS, PINNED_ACTIONS, SECTION_INFO, type GlanceSettings } from '../../../core/glance';
import { accelLabel, type ShortcutStatus } from '../../../core/shortcuts';
import { changedSettings, exportSettings, getPath, labelOf, previewImport, resetPatch, settingDefaults as defaultsFor, valueText, type ImportPreview } from '../../../core/settings-schema';
import { api } from '../../api';
import { openSetupAgain } from '../../setup/FirstRun';
import { errorText } from '../../../core/ipc-error';
import { Icon } from '../../components/Icon';
import { Check, Modal, Toggle } from '../../components/ui';
import { useStore } from '../../state';
import { Row } from '../IslandSettings';
import { LanguageRow, LoginRow } from '../SettingsMore';
import { UpdatesPanel, WhatsNewHover } from '../../components/Updates';
import { UsagePanel } from '../../components/UsagePanel';
import { UsageStatsPanel } from '../../components/UsageStatsPanel';
import { ProAccountPanel, ProCatalogPanel } from '../../components/ProAccount';
import { CrashReportsPanel } from '../../components/CrashReportsPanel';
import { FeaturesPanel, SidebarPanel } from '../../components/FeaturesPanel';
import { LockedFoldersPanel } from '../../components/LockDialog';
import { BrainSettingsPanel } from '../../components/BrainPanel';
import { PlatformIntegrations } from '../../components/PlatformIntegrations';
import { AshfordeAppsPanel } from '../../components/AshfordeApps';
import { ThemeGallery, ThemeTweaks } from '../../components/ThemeGallery';
import { MeshPlaces } from '../MeshParts';
import { PimSettings } from '../../pim/PimSettings';
import { ImportPanel } from '../../pim/ImportPanel';
import { MailPanel } from '../../pim/mail-settings';
import { PermissionsPanel } from '../../components/PermissionsPanel';
import { NativeAppsPanel } from '../../components/NativeAppsPanel';
import { AccessibilityPanel } from '../../components/AccessibilityPanel';
import { ClipIgnorePanel, LauncherCommandsPanel, LauncherLinksPanel, SelectionBarPanel } from '../../components/LauncherPanels';
import { IslandAccentPanel } from '../../island/LookSettings';
import { NoticePartsPanel, QuietHoursPanel } from '../../components/Notices';
import '../../styles/glance.css';

const UsageSettings = lazy(() => import('../usage/UsageSettings').then((m) => ({ default: m.UsageSettings })));

export interface PanelDef {
  render: () => ReactNode;
  /** draws its own label and description */
  own?: boolean;
  /** a full-width block rather than a row */
  wide?: boolean;
}

// ---------------------------------------------------------------- menu bar: what the summary shows

function GlancePanel() {
  const { info } = useStore();
  const mac = info?.platform === 'darwin';
  const [g, setG] = useState<GlanceSettings | null>(null);
  useEffect(() => { void api.glance.settings().then(setG).catch(() => undefined); }, []);
  const save = (p: Partial<GlanceSettings>) => void api.glance.setSettings(p).then(setG);
  const flip = <T extends string>(list: T[], id: T) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  if (!g) return null;
  const full = g.actions.length >= PINNED_ACTIONS;
  return (
    <div data-testid="settings-menubar">
      {mac ? <Row title="Open the summary when I point at the owl" desc="It closes again when you move away."><Toggle on={g.hover} onChange={(v) => save({ hover: v })} /></Row> : null}
      {GLANCE_SECTIONS.map((k) => (
        <Row key={k} title={`Show ${SECTION_INFO[k].label.toLowerCase()}`} desc={SECTION_INFO[k].help}>
          <Toggle on={g.sections[k]} onChange={(v) => save({ sections: { ...g.sections, [k]: v } })} />
        </Row>
      ))}
      <Row title="What the summary shows" desc="Readings, Keep Awake and the rows under them.">
        <div className="gl-chips">{GLANCE_CARDS.map((c) => <button key={c} className={`gl-chip${g.cards.includes(c) ? ' on' : ''}`} aria-pressed={g.cards.includes(c)} onClick={() => save({ cards: GLANCE_CARDS.filter((x) => flip(g.cards, c).includes(x)) })}>{CARD_INFO[c].label}</button>)}</div>
      </Row>
      <Row title="Quick action buttons" desc={`Pick ${PINNED_ACTIONS}, in order. The rest are under More.`}>
        <div className="gl-chips" data-testid="settings-menubar-actions">{GLANCE_ACTIONS.map((a) => {
          const on = g.actions.includes(a);
          return <button key={a} className={`gl-chip${on ? ' on' : ''}`} aria-pressed={on} disabled={!on && full} title={!on && full ? `Turn one off first (up to ${PINNED_ACTIONS})` : undefined} onClick={() => save({ actions: flip(g.actions, a) })}>{ACTION_INFO[a].label}</button>;
        })}</div>
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------- general: shortcuts from any app

/** Every global shortcut Keeper set, how it reads on this computer, and whether it works ("taken by …"). */
export function ShortcutsPanel() {
  const { info, settings } = useStore();
  const [list, setList] = useState<ShortcutStatus[] | null>(null);
  useEffect(() => {
    // The main process registers them again after a settings change; ask a moment later.
    const t = setTimeout(() => void api.prefs?.shortcuts().then(setList).catch(() => setList([])), 400);
    return () => clearTimeout(t);
  }, [settings]);
  if (!list) return null;
  const platform = info?.platform ?? '';
  const bad = list.filter((x) => x.state !== 'ok');
  return (
    <div className="shortcut-list" data-testid="settings-shortcuts">
      {bad.length ? <div className="settings-note warn" role="status"><Icon name="warning" size={14} /> {bad.length === 1 ? 'One shortcut doesn’t work' : `${bad.length} shortcuts don’t work`}: another shortcut has its keys. Change one of them where it is set.</div> : null}
      {list.map((x) => (
        <div key={x.owner} className={`shortcut-row ${x.state}`} data-testid="shortcut-row">
          <span className="grow">{x.owner}</span>
          <kbd className="keycaps">{accelLabel(x.accelerator, platform) || x.accelerator}</kbd>
          <span className={`badge ${x.state === 'ok' ? 'ok' : 'warn'}`}>{x.state === 'ok' ? 'Works' : x.state === 'invalid' ? 'Not a valid shortcut' : `Taken by ${x.takenBy}`}</span>
        </div>
      ))}
      {!list.length ? <div className="small muted">No shortcuts from other apps are set.</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- general: export and import

/** Settings → General → Export or import settings: never passwords or keys; an import shows what it changes first. */
function SettingsIoPanel() {
  const { settings, info, updateSettings, toast } = useStore();
  const [choice, setChoice] = useState({ settings: true, parts: true, folders: false });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  if (!settings) return null;
  const doExport = async () => {
    const file = exportSettings(settings, choice, info?.appVersion ?? '');
    const name = `Keeper settings ${new Date().toISOString().slice(0, 10)}.keeper-settings.json`;
    const p = await api.prefs.saveFile(name, JSON.stringify(file, null, 2)).catch((e: unknown) => { toast(errorText(e)); return null; });
    if (p) toast(`Saved to ${p}`);
  };
  const doImport = async () => {
    setError('');
    const text = await api.prefs.openFile().catch((e: unknown) => { setError(errorText(e)); return null; });
    if (!text) return;
    try {
      setPreview(previewImport(settings, text, info?.platform ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="settings-io" data-testid="settings-io">
      <div className="settings-io-choices">
        <label className="check-label"><Check on={choice.settings} onChange={(v) => setChoice({ ...choice, settings: v })} label="Settings" /> Settings</label>
        <label className="check-label"><Check on={choice.parts} onChange={(v) => setChoice({ ...choice, parts: v })} label="Parts and sets" /> Parts and sets</label>
        <label className="check-label"><Check on={choice.folders} onChange={(v) => setChoice({ ...choice, folders: v })} label="Folders" /> Folders <span className="muted">(they may differ on another computer)</span></label>
      </div>
      <div className="btn-row">
        <button className="btn" data-testid="settings-export" disabled={!choice.settings && !choice.parts} onClick={() => void doExport()}><Icon name="down" size={13} /> Export settings…</button>
        <button className="btn" data-testid="settings-import" onClick={() => void doImport()}><Icon name="arrowUp" size={13} /> Import settings…</button>
      </div>
      {error ? <div className="small warn-text" role="alert">{error}</div> : null}
      {preview ? <ImportSheet preview={preview} onCancel={() => setPreview(null)} onImport={() => { void updateSettings(preview.patch).then(() => toast(`Imported ${preview.changes.length + preview.otherChanges} settings`)); setPreview(null); }} /> : null}
    </div>
  );
}

export function ImportSheet({ preview, onCancel, onImport }: { preview: ImportPreview; onCancel: () => void; onImport: () => void }) {
  const n = preview.changes.length + preview.otherChanges;
  return (
    <Modal title="Import settings" onClose={onCancel} width={520}>
      <p data-testid="import-summary">This will change {n} setting{n === 1 ? '' : 's'}{preview.partsOn.length ? ` and turn on ${preview.partsOn.length} part${preview.partsOn.length === 1 ? '' : 's'}` : ''}{preview.partsOff.length ? `${preview.partsOn.length ? ',' : ' and'} turn off ${preview.partsOff.length}` : ''}.</p>
      <div className="change-list">
        {preview.changes.map((c) => <div key={c.id} className="change-row"><span className="grow">{c.label}</span><span className="muted">{c.from}</span><Icon name="chevronRight" size={11} /><b>{c.to}</b></div>)}
        {preview.otherChanges ? <div className="change-row muted">and {preview.otherChanges} other setting{preview.otherChanges === 1 ? '' : 's'} with no row of their own</div> : null}
        {preview.partsOn.length ? <div className="change-row"><span className="grow">Turns on</span><span>{preview.partsOn.join(', ')}</span></div> : null}
        {preview.partsOff.length ? <div className="change-row"><span className="grow">Turns off</span><span>{preview.partsOff.join(', ')}</span></div> : null}
      </div>
      {preview.skipped ? <p className="small muted">{preview.skipped} setting{preview.skipped === 1 ? '' : 's'} from a newer Keeper {preview.skipped === 1 ? 'was' : 'were'} skipped.</p> : null}
      <div className="btn-row modal-actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" data-testid="import-confirm" disabled={!n && !preview.partsOn.length && !preview.partsOff.length} onClick={onImport}>Import</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- general: reset everything

/** Lists what Reset changes, old → new, before anything happens. */
export function ResetSheet({ title, defs, onClose, exportFirst }: { title: string; defs: ReturnType<typeof changedSettings>; onClose: () => void; exportFirst?: () => void }) {
  const { settings, updateSettings, info, toast } = useStore();
  if (!settings) return null;
  const platform = info?.platform ?? '';
  const reset = () => {
    const before = settings;
    const patch = resetPatch(settings, defs);
    const undo: Partial<typeof settings> = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof typeof before]]));
    void updateSettings(patch).then(() => toast(`Reset ${defs.length} setting${defs.length === 1 ? '' : 's'}`, { label: 'Undo', run: () => void updateSettings(undo) }));
    onClose();
  };
  return (
    <Modal title={title} onClose={onClose} width={520}>
      {defs.length ? (
        <div className="change-list" data-testid="reset-list">
          {defs.map((d) => <div key={d.id} className="change-row"><span className="grow">{labelOf(d, platform)}</span><span className="muted">{valueText(d, getPath(settings, d.path!), platform)}</span><Icon name="chevronRight" size={11} /><b>{valueText(d, getPath(defaultsFor(), d.path!), platform)}</b></div>)}
        </div>
      ) : <p className="muted">Nothing here is changed.</p>}
      <p className="small muted">Accounts, folders, locked folders and keys stay as they are.</p>
      <div className="btn-row modal-actions">
        {exportFirst ? <button className="btn ghost" onClick={exportFirst}>Export first (recommended)</button> : null}
        <span className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn danger" data-testid="reset-confirm" disabled={!defs.length} onClick={reset}>Reset {defs.length} setting{defs.length === 1 ? '' : 's'}</button>
      </div>
    </Modal>
  );
}

function ResetAllPanel() {
  const { settings, info } = useStore();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  if (!settings) return null;
  const defs = changedSettings(settings, info?.platform ?? '');
  return (
    <>
      <button className="btn" data-testid="reset-all" onClick={() => setOpen(true)}>Reset all settings…</button>
      {open ? <ResetSheet title="Reset all settings" defs={defs} onClose={() => setOpen(false)} exportFirst={() => { setOpen(false); setExporting(true); }} /> : null}
      {exporting ? <Modal title="Export settings" onClose={() => setExporting(false)} width={520}><SettingsIoPanel /></Modal> : null}
    </>
  );
}

// ---------------------------------------------------------------- about

function AboutPanel() {
  const { info, go } = useStore();
  return (
    <div className="about-panel">
      <Row title="Keeper by Ashforde®" desc={<WhatsNewHover only="current"><span className="dotted">Version {info?.appVersion ?? ''}</span></WhatsNewHover>}>
        <button className="btn" onClick={() => void api.system.openExternal('https://github.com/ashfordeOU/keeper')}><Icon name="external" size={13} /> Source code</button>
      </Row>
      <Row title="Report a problem" desc="Something wrong or missing? A page opens on GitHub with a new issue ready to fill in.">
        <button className="btn" data-testid="report-problem" onClick={() => void api.system.openExternal(REPORT_URL)}><Icon name="external" size={13} /> Report a problem</button>
      </Row>
      <Row title="License" desc="Free for everyone, at home and at work, under PolyForm Shield 1.0.0. © 2026 Ashforde OÜ; Ashforde® is a registered trademark. Includes other people’s work under their own licenses.">
        <div className="btn-row">
          <button className="btn ghost" onClick={() => void api.system.openExternal('https://github.com/ashfordeOU/keeper/blob/main/LICENSE.md')}>License</button>
          <button className="btn ghost" onClick={() => void api.system.openExternal('https://github.com/ashfordeOU/keeper/blob/main/THIRD-PARTY-NOTICES.md')}>Third-party notices</button>
        </div>
      </Row>
      <Row title="Privacy" desc="Nothing leaves this computer unless you turn it on.">
        <button className="btn ghost" onClick={() => go({ name: 'settings', arg: 'privacy' })}>Details</button>
      </Row>
    </div>
  );
}

function ExportTasksPanel() {
  const { toast } = useStore();
  return <button className="btn" data-testid="export-tasks" onClick={() => void api.islandTools.exportJson().then((p) => p && toast(`Saved to ${p}`), (e: unknown) => toast(errorText(e)))}><Icon name="down" size={13} /> Export…</button>;
}

function OcrLanguagesPanel() {
  const { settings, updateSettings } = useStore();
  if (!settings) return null;
  return <input className="input" aria-label="Languages in pictures" defaultValue={settings.ocrLanguages.join(', ')} title="Language codes, such as eng, deu, fra" onBlur={(e) => void updateSettings({ ocrLanguages: e.target.value.split(/[,\s]+/).filter(Boolean) })} />;
}

export const PANELS: Record<string, PanelDef> = {
  setupAgain: { render: () => <button className="btn" data-testid="settings-setup-again" onClick={() => openSetupAgain()}><Icon name="sparkle" size={13} /> Set up again…</button> },
  login: { render: () => <LoginRow />, own: true },
  language: { render: () => <LanguageRow />, own: true },
  shortcuts: { render: () => <ShortcutsPanel />, wide: true },
  updates: { render: () => <UpdatesPanel />, own: true, wide: true },
  settingsIo: { render: () => <SettingsIoPanel />, wide: true },
  exportTasks: { render: () => <ExportTasksPanel /> },
  resetAll: { render: () => <ResetAllPanel /> },
  theme: { render: () => <ThemeGallery />, wide: true },
  themeTweaks: { render: () => <ThemeTweaks />, own: true, wide: true },
  sidebarCustom: { render: () => <SidebarPanel />, wide: true },
  features: { render: () => <FeaturesPanel />, wide: true },
  ashfordeApps: { render: () => <AshfordeAppsPanel />, wide: true },
  lockedFolders: { render: () => <LockedFoldersPanel />, wide: true },
  ocrLanguages: { render: () => <OcrLanguagesPanel /> },
  openWith: { render: () => <NativeAppsPanel />, wide: true },
  platform: { render: () => <PlatformIntegrations />, wide: true },
  glance: { render: () => <GlancePanel />, own: true, wide: true },
  usageLabel: { render: () => <Suspense fallback={null}><UsageSettings /></Suspense>, own: true, wide: true },
  brain: { render: () => <BrainSettingsPanel />, own: true, wide: true },
  pim: { render: () => <PimSettings />, own: true, wide: true },
  pimImport: { render: () => <ImportPanel />, wide: true },
  mailReading: { render: () => <MailPanel part="reading" />, wide: true },
  mailRules: { render: () => <MailPanel part="rules" />, wide: true },
  mailSmart: { render: () => <MailPanel part="smart" />, wide: true },
  mailTemplates: { render: () => <MailPanel part="templates" />, wide: true },
  mailAi: { render: () => <MailPanel part="ai" />, wide: true },
  mailNotch: { render: () => <MailPanel part="notch" />, wide: true },
  mailPrivacy: { render: () => <MailPanel part="privacy" />, wide: true },
  mailApps: { render: () => <MailPanel part="apps" />, wide: true },
  permissions: { render: () => <PermissionsPanel />, own: true, wide: true },
  usageStats: { render: () => <UsageStatsPanel />, wide: true },
  // Keeper Pro (builds with Pro switched on only; the rows are left out otherwise).
  proAccount: { render: () => <ProAccountPanel />, own: true, wide: true },
  proCatalog: { render: () => <ProCatalogPanel />, wide: true },
  crashReports: { render: () => <CrashReportsPanel />, wide: true },
  noticeParts: { render: () => <NoticePartsPanel />, wide: true },
  quietHours: { render: () => <QuietHoursPanel /> },
  a11y: { render: () => <AccessibilityPanel />, own: true, wide: true },
  resources: { render: () => <UsagePanel />, own: true, wide: true },
  meshPlaces: { render: () => <MeshPlaces />, wide: true },
  about: { render: () => <AboutPanel />, own: true, wide: true },
  launcherLinks: { render: () => <LauncherLinksPanel />, wide: true },
  launcherCommands: { render: () => <LauncherCommandsPanel />, wide: true },
  selectionBar: { render: () => <SelectionBarPanel />, wide: true },
  clipIgnore: { render: () => <ClipIgnorePanel />, wide: true },
  islandAccent: { render: () => <IslandAccentPanel />, own: true, wide: true },
};
