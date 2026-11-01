// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Keeper inside your computer: Apple Intelligence, Spotlight,
// Windows agents, GNOME and KDE search, MCP for any AI app, Ask Keeper.

import { useEffect, useState } from 'react';
import type { Integration } from '../../core/platform-integrations';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Toggle } from './ui';
import '../styles/platform.css';

export function PlatformIntegrations() {
  const { settings, updateSettings, toast } = useStore();
  const [list, setList] = useState<Integration[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void api.platform.list().then(setList).catch(() => setList([]));
  }, []);

  if (!settings || !list) return <div className="small muted" style={{ padding: 16 }}>Checking what this computer offers…</div>;

  const set = async (i: Integration, on: boolean) => {
    setBusy(i.id);
    try {
      const r = await api.platform.set(i.id, on);
      setList(r.list);
      if (r.message) toast(r.message);
    } finally {
      setBusy(null);
    }
  };

  const act = async (id: string) => {
    setBusy(id);
    try {
      const r = await api.platform.action(id);
      if (r.copy) await navigator.clipboard.writeText(r.copy).catch(() => undefined);
      if (r.message) toast(r.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="platform-list">
      {list.map((i) => (
        <div key={i.id} className={`platform-row ${i.available ? '' : 'unavailable'}`}>
          <div className="platform-icon"><Icon name={ICONS[i.id] ?? 'sparkle'} size={16} /></div>
          <div className="grow">
            <div className="platform-title">
              {i.label}
              {!i.available ? <span className="badge">Not available here</span> : i.enabled && !i.toggle ? <span className="badge accent">Ready</span> : null}
            </div>
            <div className="small muted">{i.description}</div>
            {i.detail ? <div className="small platform-detail">{i.detail}</div> : null}
            {i.id === 'ask-shortcut' ? (
              <input className="input" style={{ width: 240, marginTop: 6 }} defaultValue={settings.platform.askShortcut} placeholder="e.g. CommandOrControl+Shift+K"
                onBlur={(e) => e.target.value.trim() !== settings.platform.askShortcut && void updateSettings({ platform: { ...settings.platform, askShortcut: e.target.value.trim() } }).then(() => api.platform.list().then(setList))} />
            ) : null}
            {i.steps?.length ? (
              <>
                <button className="link-like small" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? 'Hide steps' : 'How to set it up'}</button>
                {open === i.id ? <ol className="platform-steps small">{i.steps.map((s, n) => <li key={n}>{s}</li>)}</ol> : null}
              </>
            ) : null}
          </div>
          <div className="btn-row">
            {i.actions?.map((a) => (
              <button key={a.id} className="btn sm" disabled={busy === a.id} onClick={() => void act(a.id)}>{a.label}</button>
            ))}
            {i.toggle ? <Toggle on={i.enabled} onChange={(v) => i.available && busy !== i.id && void set(i, v)} /> : null}
          </div>
        </div>
      ))}
      <div className="small muted" style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--line)' }}>
        <button className="link-like" onClick={() => void api.platform.list(true).then(setList)}>Check again</button> — after turning on Apple Intelligence, installing a recognition language or updating the system.
      </div>
    </div>
  );
}

const ICONS: Record<string, string> = {
  'apple-intelligence': 'sparkle', 'mac-ocr': 'text', spotlight: 'search', shortcuts: 'bolt', 'mac-services': 'rules',
  'win-ocr': 'text', 'win-agents': 'assistant', 'win-ai': 'assistant', 'explorer-menu': 'folder', 'jump-list': 'list',
  'gnome-search': 'search', krunner: 'search', 'desktop-actions': 'list', mcp: 'terminal', 'ask-shortcut': 'sparkle', 'url-actions': 'external',
};
