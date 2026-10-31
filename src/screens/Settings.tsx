// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings: appearance, library folders, thresholds, assistant and about.

import { useEffect, useState } from 'react';
import type { AiProvider } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageHead, Toggle } from '../components/ui';
import { useAsync, useStore } from '../state';
import { Row } from './IslandSettings';
import { LanguageRow, LoginRow } from './SettingsMore';
import { UpdatesPanel, WhatsNewHover } from '../components/Updates';
import { LockedFoldersPanel } from '../components/LockDialog';
import { ThemeGallery, ThemeTweaks } from '../components/ThemeGallery';
import { useT } from '../i18n';
import '../styles/screens-b.css';

// Mirrors core/ai.ts DEFAULT_MODELS without pulling the provider SDK into the interface bundle.
const DEFAULT_MODELS: Record<AiProvider, string> = { anthropic: 'claude-opus-5-5', openai: 'gpt-5', ollama: 'llama3.2' };

const PROVIDERS: { id: AiProvider; label: string }[] = [
  { id: 'anthropic', label: 'Claude' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'ollama', label: 'Local' },
];

export function Settings() {
  const { route: settingsRoute } = useStore();
  useEffect(() => {
    if (settingsRoute.arg) setTimeout(() => document.getElementById(settingsRoute.arg!)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }, [settingsRoute.arg]);
  const { settings: s, updateSettings, info, toast } = useStore();
  const t = useT();
  const [key, setKey] = useState('');
  const provider = s?.ai.provider ?? 'anthropic';
  const hasKey = useAsync(() => (provider === 'ollama' ? Promise.resolve(true) : api.settings.hasSecret(provider)), [provider]);
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
        <Row title={info?.platform === 'darwin' ? 'Menu bar icon' : 'Tray icon'} desc="Lists your newest downloads with thumbnails; drag them straight into other apps."><Toggle on={s.trayEnabled} onChange={(v) => void updateSettings({ trayEnabled: v })} /></Row>
        <Row title="Downloads shown">
          <select className="input" value={s.trayCount} onChange={(e) => void updateSettings({ trayCount: Number(e.target.value) })}>{[5, 10, 15, 20].map((n) => <option key={n}>{n}</option>)}</select>
        </Row>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>{t('nav.assistant')}</h2>
      <div className="card settings-section">
        <Row title="Provider" desc="Local runs a model on this computer — nothing leaves it.">
          <div className="seg">{PROVIDERS.map((p) => <button key={p.id} className={provider === p.id ? 'on' : ''} onClick={() => void updateSettings({ ai: { ...s.ai, provider: p.id, model: '' } })}>{p.label}</button>)}</div>
        </Row>
        <Row title="Model"><input className="input" placeholder={DEFAULT_MODELS[provider]} defaultValue={s.ai.model} key={provider} onBlur={(e) => void updateSettings({ ai: { ...s.ai, model: e.target.value.trim() } })} /></Row>
        {provider === 'ollama' ? (
          <Row title="Local server address"><input className="input" defaultValue={s.ai.ollamaUrl} onBlur={(e) => void updateSettings({ ai: { ...s.ai, ollamaUrl: e.target.value.trim() } })} /></Row>
        ) : (
          <Row title="API key" desc={hasKey.data ? 'Saved, encrypted by your system keychain.' : 'Stored encrypted on this computer only.'}>
            <input className="input" type="password" placeholder={hasKey.data ? '••••••••' : 'Paste your key'} value={key} onChange={(e) => setKey(e.target.value)} />
            <button className="btn" disabled={!key} onClick={async () => { const ok = await api.settings.setSecret(provider, key); setKey(''); hasKey.reload(); toast(ok ? 'Key saved' : 'Could not save the key securely on this system'); }}>Save</button>
          </Row>
        )}
      </div>

      <h2 id="updates" style={{ margin: '18px 0 8px' }}>{t('settings.updates')}</h2>
      <div className="card settings-section" style={{ padding: 16 }}>
        <UpdatesPanel />
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <div>
            <div style={{ fontWeight: 600 }}>Reopen where I left off</div>
            <div className="small muted">After an update or a restart, Keeper opens the same page, scrolled to the same spot.</div>
          </div>
          <Toggle on={s.restorePlace !== false} onChange={(v) => void updateSettings({ restorePlace: v })} />
        </div>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>{t('settings.about')}</h2>
      <div className="card settings-section">
        <Row title="Keeper by Ashforde®" desc={<WhatsNewHover only="current"><span style={{ textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>Version {info?.appVersion ?? ''}</span></WhatsNewHover>}>
          <button className="btn" onClick={() => void api.system.openExternal('https://github.com/ashfordeOU/keeper')}><Icon name="external" size={13} /> Source code</button>
        </Row>
        <Row title="License" desc="Free software under the GNU Affero General Public License, version 3 or later. You can use, study, share and change it.">
          <button className="btn ghost" onClick={() => void api.system.openExternal('https://www.gnu.org/licenses/agpl-3.0.html')}>Read</button>
        </Row>
        <Row title="Trademark" desc="© 2026 Ashforde OÜ. Ashforde® is a registered trademark of Ashforde OÜ. The source code is free software; the name and logo identify the official Keeper.">
          <span className="small muted">®</span>
        </Row>
        <Row title="Privacy" desc="No account, no tracking, no uploads. Search, text reading and duplicate checks run on this computer. The network is only used for the optional assistant, weather, lyrics, calendar and update checks you turn on." >
          <Icon name="lock" size={16} />
        </Row>
      </div>
    </div>
  );
}
