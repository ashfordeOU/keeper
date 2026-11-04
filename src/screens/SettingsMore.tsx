// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings rows for language, launch at login and app updates.

import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../core/api-x';
import { relativeTime } from '../../core/format';
import { api } from '../api';
import { Toggle } from '../components/ui';
import { LANGUAGES, offeredLanguages, useT } from '../i18n';
import { useStore } from '../state';
import { Row } from './IslandSettings';

export function LanguageRow() {
  const t = useT();
  const { settings, updateSettings } = useStore();
  if (!settings) return null;
  return (
    <Row title={t('settings.language')} desc={LANGUAGES.find((l) => l.code === settings.language)?.partial ? 'Only some of Keeper is in this language so far; the rest stays in English.' : 'File names and anything you write stay as they are.'}>
      <select className="input" data-testid="language" value={settings.language || 'system'} onChange={(e) => void updateSettings({ language: e.target.value })}>
        {offeredLanguages(!!settings.settingsAdvanced, settings.language).map((l) => <option key={l.code} value={l.code}>{l.name}{l.partial ? ' · partly translated' : ''}</option>)}
      </select>
    </Row>
  );
}

export function LoginRow() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { void api.appInfo.loginItem().then(setOn); }, []);
  if (on === null) return null;
  return (
    <Row title="Open at login" desc="Keeper starts quietly, so Quick Search, the Island and automations are ready.">
      <Toggle on={on} onChange={async (v) => setOn(await api.appInfo.setLoginItem(v))} />
    </Row>
  );
}

const LABEL: Record<UpdateStatus['state'], string> = {
  idle: 'Not checked yet', checking: 'Checking…', available: 'A new version is available', downloading: 'Downloading…', ready: 'Ready to install',
  none: 'Keeper is up to date', error: 'Could not check', unsupported: 'Your package manager updates Keeper', installing: 'Installing…',
};

export function UpdateRow() {
  const t = useT();
  const [s, setS] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    void api.appInfo.updateStatus().then(setS);
    const h = setInterval(() => void api.appInfo.updateStatus().then(setS), 3000);
    return () => clearInterval(h);
  }, []);
  if (!s) return null;
  const detail = [s.version ? `Version ${s.version}` : '', s.state === 'downloading' && s.percent !== undefined ? `${s.percent}%` : '', s.message ?? '', s.checkedAt ? `checked ${relativeTime(s.checkedAt)}` : ''].filter(Boolean).join(' · ');
  return (
    <Row title={LABEL[s.state]} desc={detail || 'Updates download in the background and install when you quit Keeper.'}>
      {s.state === 'ready' ? <button className="btn primary" onClick={() => void api.appInfo.installUpdate()}>Restart and update</button>
        : <button className="btn" disabled={s.state === 'checking' || s.state === 'downloading' || s.state === 'unsupported'} onClick={async () => setS(await api.appInfo.checkForUpdates())}>{t('settings.checkUpdates')}</button>}
    </Row>
  );
}
