// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Browser tabs: every open tab in every browser linked through Keeper's
// extension, with mute, sleep, close, site permissions, tracker blocking,
// site data and per-site proxy.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CONTENT_LABEL, allowedValues, flattenTabs, type BrowserSession, type ContentType, type ContentValue } from '../../core/browser-tabs';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Modal, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import { formatBytes } from '../../core/format';
import '../styles/controls.css';
import '../styles/settingsplus.css';

type Tab = ReturnType<typeof flattenTabs>[number];
const TYPES: ContentType[] = ['camera', 'microphone', 'location', 'notifications', 'javascript', 'cookies', 'popups', 'sound', 'automaticDownloads'];

export function Browsers() {
  const { toast } = useStore();
  const [data, setData] = useState<{ sessions: BrowserSession[]; limits: { browser: string; text: string }[] } | null>(null);
  const [q, setQ] = useState('');
  const [site, setSite] = useState<{ tab: Tab; settings: Record<string, string> } | null>(null);
  const [proxy, setProxy] = useState('');

  const load = useCallback(() => void api.browserTabs.sessions().then(setData), []);
  useEffect(() => { load(); return api.on('browsers-changed', load); }, [load]);

  const tabs = useMemo(() => flattenTabs(data?.sessions ?? []).filter((t) => !q || `${t.title} ${t.url}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const act = (t: Tab, a: 'mute' | 'unmute' | 'discard' | 'close' | 'focus' | 'reload') => void api.browserTabs.tab(t.session, t.id, a).then((r) => (r.ok ? load() : toast(r.message ?? 'The browser refused')));
  const host = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };
  const openSite = async (t: Tab) => {
    try {
      setSite({ tab: t, settings: await api.browserTabs.siteSettings(t.session, t.url) });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  if (!data) return <div className="page sp-page"><PageHead title="Browser tabs" /></div>;
  return (
    <div className="page sp-page" data-testid="browsers-page">
      <PageHead title="Browser tabs" sub="All open tabs across your browsers, with per-tab and per-site controls. Data and memory figures are estimates from what the browser reports.">
        <button className="btn sm" onClick={() => void api.browserTabs.syncBlocking().then((r) => toast(r.message))}><Icon name="shield" size={13} /> Send blocklists to browsers</button>
        <button className="btn sm" onClick={() => void api.browserTabs.installHost().then((r) => toast(r.message))}><Icon name="link" size={13} /> Link browsers</button>
      </PageHead>

      {!data.sessions.length ? (
        <Empty icon="globe" title="No browser is linked yet">
          Install Keeper’s extension (Chrome, Edge, Brave, Vivaldi, Opera or Firefox), then press “Link browsers”. Tabs appear here while the browser is open.
        </Empty>
      ) : (
        <>
          <div className="qc-summary muted">{data.sessions.map((s) => <span key={s.id} className="qc-how qc-how-direct">{s.browser}: {s.tabs.length} tabs</span>)}</div>
          <div className="qc-search"><Icon name="search" size={14} /><input placeholder="Find a tab" value={q} onChange={(e) => setQ(e.target.value)} data-testid="tabs-search" /></div>
          <div className="card" data-testid="tabs-list">
            {tabs.map((t) => (
              <div key={`${t.session}-${t.id}`} className="sp-tab" data-testid={`tab-${t.id}`}>
                <div style={{ minWidth: 0 }}>
                  <div className="qc-label">{t.audible ? <Icon name="audio" size={12} /> : null}{t.title || host(t.url)} <span className="qc-how">{t.browser}</span>{t.discarded ? <span className="qc-how">asleep</span> : null}{t.muted ? <span className="qc-how">muted</span> : null}{t.incognito ? <span className="qc-how">private</span> : null}</div>
                  <div className="url">{t.url}</div>
                  <div className="sp-parties">
                    {t.bytes ? `${formatBytes(t.bytes)} · ${t.requests ?? 0} requests` : null}
                    {t.parties?.length ? ` · talks to ${t.parties.length} other site${t.parties.length === 1 ? '' : 's'}: ` : null}
                    {t.parties?.slice(0, 6).map((p) => <span key={p.host} className={p.blocked ? 'blocked' : ''} title={p.blocked ? `${p.blocked} blocked` : `${p.requests} requests`}>{p.host}{p.blocked ? ' ✓' : ''} </span>)}
                  </div>
                </div>
                <div className="btn-row">
                  <button className="btn ghost sm" onClick={() => act(t, t.muted ? 'unmute' : 'mute')}>{t.muted ? 'Unmute' : 'Mute'}</button>
                  <button className="btn ghost sm" disabled={t.discarded || t.active} title="Frees the tab's memory; it reloads when you open it" onClick={() => act(t, 'discard')}>Sleep</button>
                  <button className="btn ghost sm" onClick={() => act(t, 'focus')}>Show</button>
                  {/^https?:/.test(t.url) ? <button className="btn ghost sm" onClick={() => void openSite(t)}>Site settings</button> : null}
                  <button aria-label="Close tab" title="Close tab" className="btn ghost sm" onClick={() => act(t, 'close')}><Icon name="close" size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="card">
        <div className="qc-h">What each browser allows</div>
        {data.limits.map((l) => <div key={l.browser} className="qc-row"><div className="qc-txt"><div className="qc-label">{l.browser}</div><div className="muted qc-desc">{l.text}</div></div></div>)}
      </div>

      {site ? (
        <Modal title={`Site settings: ${host(site.tab.url)}`} onClose={() => setSite(null)} width={620}>
          <div className="sp-site" data-testid="site-settings">
            {TYPES.map((ty) => (
              <label key={ty}>{CONTENT_LABEL[ty]}
                <select className="input" value={site.settings[ty] ?? 'default'} onChange={(e) => void api.browserTabs.setSite(site.tab.session, host(site.tab.url), ty, e.target.value as ContentValue).then((r) => { toast(r.ok ? 'Saved' : r.message ?? 'Refused'); if (r.ok) setSite({ ...site, settings: { ...site.settings, [ty]: e.target.value } }); })}>
                  {allowedValues(ty).map((v) => <option key={v} value={v}>{v === 'default' ? 'Browser default' : v.replace('_', ' ')}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="qc-row"><div className="qc-txt"><div className="qc-label">Tracker blocking on this site</div><div className="muted qc-desc">Turn off if the site breaks.</div></div><Toggle on={true} onChange={(on) => void api.browserTabs.siteBlocking(site.tab.session, host(site.tab.url), on).then((r) => toast(r.ok ? (on ? 'Blocking on' : 'Blocking off for this site') : r.message ?? ''))} /></div>
          <div className="qc-row"><div className="qc-txt"><div className="qc-label">Clear this site’s data</div><div className="muted qc-desc">Cookies, cache and local storage for {new URL(site.tab.url).origin}.</div></div><button className="btn sm" onClick={() => void api.browserTabs.clearSite(site.tab.session, new URL(site.tab.url).origin).then((r) => toast(r.ok ? 'Cleared' : r.message ?? ''))}>Clear</button></div>
          <div className="qc-row"><div className="qc-txt"><div className="qc-label">Send this site through a proxy</div><div className="muted qc-desc">For example a SOCKS5 proxy from your VPN app (host:port). Other sites stay direct. For a VPN per site, use the VPN app’s split tunnelling.</div></div>
            <form className="sp-ctl" onSubmit={(e) => { e.preventDefault(); const [h, p] = proxy.split(':'); void api.browserTabs.siteProxy(site.tab.session, proxy ? [host(site.tab.url)] : [], proxy ? { type: 'SOCKS5', host: h, port: Number(p) } : null).then((r) => toast(r.ok ? (proxy ? 'Proxy set' : 'Proxy removed') : r.message ?? '')); }}>
              <input className="input" placeholder="127.0.0.1:1080" value={proxy} onChange={(e) => setProxy(e.target.value)} />
              <button className="btn sm">{proxy ? 'Set' : 'Remove'}</button>
            </form>
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>Encrypted DNS: Keeper’s DNS filter (Firewall) covers every browser; in Chrome set “Use secure DNS” to your system resolver so the filter applies.</div>
        </Modal>
      ) : null}
    </div>
  );
}
