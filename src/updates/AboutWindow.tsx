// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The small "About Keeper" window, the same on every platform: the owl, the
// name, version and channel, what it runs on, Check for Updates…, links, and
// the licence, copyright and trademark lines.

import { useEffect, useState } from 'react';
import { BRAND, COPYRIGHT, TRADEMARK, WEBSITE } from '../../core/brand';
import { api } from '../api';
import { OwlMark } from '../components/OwlMark';
import '../styles/update-window.css';

type About = Awaited<ReturnType<typeof api.appInfo.about>>;

export function AboutWindow() {
  const [a, setA] = useState<About | null>(null);
  useEffect(() => {
    document.title = 'About Keeper';
    void api.appInfo.about().then(setA).catch(() => undefined);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') window.close(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const link = (href: string, label: string) => (
    <a href={href} onClick={(e) => { e.preventDefault(); void api.system.openExternal(href); }}>{label}</a>
  );
  return (
    <div className="about-win" data-testid="about-window">
      <OwlMark tile size={76} title={BRAND} />
      <div className="about-name">{BRAND}</div>
      <div className="about-version">{a ? <>Version {a.version} <span className="about-channel">{a.channel}</span></> : ' '}</div>
      <div className="about-runtime">{a ? `Electron ${a.electron} · Chrome ${a.chrome} · Node ${a.node}` : ' '}</div>
      <button className="btn" onClick={() => void api.appInfo.openUpdateWindow()}>Check for Updates…</button>
      <div className="about-links">
        {link(WEBSITE, 'Website')}
        <span aria-hidden>·</span>
        {link(`${WEBSITE}/releases`, 'Releases')}
        <span aria-hidden>·</span>
        {link(`${WEBSITE}/blob/main/LICENSE.md`, 'Licence')}
      </div>
      <div className="about-legal">
        <div>Source-available under the PolyForm Shield License 1.0.0</div>
        <div>{COPYRIGHT}. {TRADEMARK}</div>
      </div>
    </div>
  );
}
