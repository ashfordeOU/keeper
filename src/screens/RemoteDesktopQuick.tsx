// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The quick-connect window: opened from anywhere with the global shortcut, the
// tray or the command palette. Type an address or a link, or pick a favourite
// or a recent connection; Enter connects and the window goes away.

import { useEffect, useMemo, useRef, useState } from 'react';
import { filterConnections, sortConnections } from '../../core/rdc/list';
import type { Connection } from '../../core/rdc/types';
import { parseTarget } from '../../core/rdc/uri';
import { api } from '../api';
import { Icon } from '../components/Icon';
import '../styles/rdc.css';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function RdcQuickWindow() {
  const [list, setList] = useState<Connection[]>([]);
  const [text, setText] = useState('');
  const [index, setIndex] = useState(0);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { void api.rdc.state().then((s) => setList(s.connections)); input.current?.focus(); }, []);
  const shown = useMemo(() => {
    const all = text.trim() ? filterConnections(list, { q: text }) : list.filter((c) => c.favourite || c.lastUsed);
    return sortConnections(all).sort((a, b) => Number(!!b.favourite) - Number(!!a.favourite) || (b.lastUsed ?? 0) - (a.lastUsed ?? 0)).slice(0, 8);
  }, [list, text]);
  const typed = text.trim() && parseTarget(text) ? text.trim() : '';
  const saved = shown.map((c) => ({ key: c.id, label: c.name, detail: `${c.protocol.toUpperCase()} · ${c.user ? `${c.user}@` : ''}${c.host}`, run: () => go(c) }));
  const typedRow = typed ? [{ key: 'typed', label: `Connect to ${typed}`, detail: 'Keeper works out how', run: () => go(typed) }] : [];
  // A saved connection that matches comes first; an address that looks like one (has a dot, a colon or a scheme) leads.
  const rows: { key: string; label: string; detail: string; run: () => Promise<void> }[] = /[.:@/]/.test(typed) || !saved.length ? [...typedRow, ...saved] : [...saved, ...typedRow];
  useEffect(() => setIndex(0), [text]);

  async function go(target: string | Connection) {
    setBusy(true);
    setMsg('');
    try {
      let conn: Connection | string = target;
      if (typeof target === 'string') {
        const q = await api.rdc.quick(target);
        if (!q.conn) { setMsg(q.message ?? 'Keeper could not tell how to connect'); return; }
        conn = q.conn;
      }
      const c = conn as Connection;
      const r = await api.rdc.connect(c.id.startsWith('tmp-') ? c : c.id);
      if (r.needPassword || r.hostKey) {
        // Questions are asked on the page, where there is room to compare a fingerprint.
        if (c.id.startsWith('tmp-')) { const saved = await api.rdc.save({ ...c, id: undefined } as never); await api.rdc.openRoute({ name: 'rdc', q: `connect:${saved.id}` }); }
        else await api.rdc.openRoute({ name: 'rdc', q: `connect:${c.id}` });
      } else if (r.session?.state === 'error') { setMsg(r.session.error ?? 'Did not connect'); return; }
      else if (r.route) await api.rdc.openRoute(r.route);
      void api.rdc.closeQuick();
    } catch (e) {
      setMsg(clean(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rdc-quickwin" data-testid="rdc-quickwin" onKeyDown={(e) => { if (e.key === 'Escape') void api.rdc.closeQuick(); }}>
      <div className="rdc-quickwin-input">
        <Icon name="laptop" size={18} />
        <input
          ref={input}
          value={text}
          placeholder="Connect to… (name, address, rdp://, vnc://, ssh user@host)"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(rows.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter' && rows[index]) void rows[index].run();
          }}
        />
        {busy ? <span className="small muted">Connecting…</span> : null}
      </div>
      {msg ? <div className="rdc-warn small" style={{ margin: '8px 12px 0' }}><Icon name="warning" size={14} /> {msg}</div> : null}
      <div className="rdc-quickwin-list">
        {!rows.length ? <div className="small muted" style={{ padding: 14 }}>Favourites and recent connections show here.</div> : null}
        {rows.map((r, i) => (
          <button key={r.key} className={`rdc-quickwin-row ${i === index ? 'on' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => void r.run()}>
            <b className="ellipsis">{r.label}</b><span className="small muted ellipsis">{r.detail}</span>
          </button>
        ))}
      </div>
      <div className="rdc-quickwin-foot small muted">↩ connect · ↑↓ choose · Esc close</div>
    </div>
  );
}
