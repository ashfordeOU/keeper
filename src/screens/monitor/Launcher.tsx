// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The tool launcher (global shortcut): type to find any Keeper tool, Enter
// opens it in a small window of its own. Recent tools come first.

import { useEffect, useMemo, useRef, useState } from 'react';
import { launcherTools, searchTools } from '../../../core/tool-catalog';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { useFeatureStates } from '../../features';
import '../../styles/monitor.css';

export function Launcher() {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const states = useFeatureStates();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const shown = () => {
      setQ('');
      setSel(0);
      void api.sysmon.recentTools().then(setRecent).catch(() => undefined);
      setTimeout(() => input.current?.focus(), 20);
    };
    shown();
    return api.on('launcher-shown', shown);
  }, []);

  const tools = useMemo(() => launcherTools((f) => states?.get(f)?.on ?? true), [states]);
  const results = useMemo(() => searchTools(tools, q, recent).slice(0, 60), [tools, q, recent]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const open = (id: string) => void api.sysmon.openTool(id);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter' && results[sel]) open(results[sel].id);
    else if (e.key === 'Escape') void api.sysmon.closeWindow();
  };

  return (
    <div className="launch" onKeyDown={key}>
      <div className="q">
        <Icon name="grid" size={18} />
        <input ref={input} autoFocus placeholder="Find a tool — compress video, JSON, hash, speed test…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a tool" role="combobox" aria-expanded="true" aria-controls="launch-list" aria-activedescendant={results[sel] ? `launch-opt-${sel}` : undefined} />
      </div>
      <ul ref={list} role="listbox" id="launch-list" aria-label="Tools">
        {results.map((t, i) => (
          <li key={t.id} id={`launch-opt-${i}`} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''} onMouseMove={() => setSel(i)} onClick={() => open(t.id)}>
            <span className="ic"><Icon name={t.icon} size={15} /></span>
            <span className="t"><b>{t.name}</b><span>{t.desc}</span></span>
            <span className="g">{!q && recent.includes(t.id) ? 'Recent' : t.group}</span>
          </li>
        ))}
        {!results.length ? <li className="muted" role="option" aria-disabled="true" aria-selected="false">No tool matches “{q}”.</li> : null}
      </ul>
      <div className="foot"><span><kbd>↑</kbd> <kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> open in its own window</span><span><kbd>Esc</kbd> close</span></div>
    </div>
  );
}
