// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The small card the Inbox shortcut opens over any app: type or say a
// thought, paste a link, take a screenshot of an area, or drop a file, then
// Enter. It lands in the Inbox with the time; nothing else is asked. Esc
// closes it.

import { useEffect, useRef, useState } from 'react';
import { accelLabel } from '../../core/shortcuts';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { MicButton } from '../pim/tasks-ui';
import { useStore } from '../state';
import '../styles/today.css';

export function InboxCard() {
  const { settings, info } = useStore();
  const [text, setText] = useState('');
  const [path, setPath] = useState<{ path: string; kind: 'shot' | 'file' } | null>(null);
  const [said, setSaid] = useState('');
  const [over, setOver] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const reset = () => { setText(''); setPath(null); setSaid(''); requestAnimationFrame(() => field.current?.focus()); };
  useEffect(() => { reset(); return api.on('inbox-card', reset); }, []);
  const close = () => void api.inbox.card('close');
  const save = async () => {
    if (!text.trim() && !path) return close();
    const it = await api.inbox.add({ text, path: path?.path, kind: path?.kind, source: 'card' }).catch(() => null);
    if (!it) return;
    setSaid('Caught. It is in your Inbox.');
    setTimeout(() => { close(); reset(); }, 650);
  };
  const shot = async () => {
    await api.inbox.card('hide');
    const p = await api.capture.screenshot('area').catch(() => null);
    await api.inbox.card('show');
    if (p) setPath({ path: p, kind: 'shot' });
  };
  const key = accelLabel(settings?.today?.captureShortcut ?? '', info?.platform ?? 'linux');
  return (
    <div className={`ibc ${over ? 'over' : ''}`} data-testid="inbox-card" role="dialog" aria-label="Catch something"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; const p = f ? api.files.pathOf?.(f) ?? '' : ''; if (p) setPath({ path: p, kind: 'file' }); else { const t = e.dataTransfer.getData('text/plain'); if (t) setText((x) => (x ? `${x}\n${t}` : t)); } }}>
      <div className="ibc-head">
        <Icon name="inbox" size={14} />
        <b>Catch something</b>
        <span className="grow" />
        {key ? <kbd className="ibc-key" title="The Inbox shortcut">{key}</kbd> : null}
      </div>
      <textarea ref={field} data-testid="inbox-card-text" aria-label="What is on your mind?" placeholder="What is on your mind? Paste a link, or drop a file here." value={text} rows={3}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save(); } }} />
      {path ? <div className="ibc-att"><Icon name={path.kind === 'shot' ? 'screenshot' : 'paperclip'} size={12} /><span className="ellipsis grow" title={path.path}>{path.path.split(/[\\/]/).pop()}</span><button className="btn ghost sm icon" aria-label="Remove" title="Remove" onClick={() => setPath(null)}><Icon name="close" size={11} /></button></div> : null}
      <div className="ibc-foot">
        <MicButton target={field} />
        <button className="btn sm ghost icon" title="Screenshot of an area" aria-label="Screenshot of an area" onClick={() => void shot()}><Icon name="screenshot" size={13} /></button>
        <span className="ibc-said grow" role="status" aria-live="polite">{said || 'Enter to save · Esc to close'}</span>
        <button className="btn sm primary" data-testid="inbox-card-save" onClick={() => void save()}>Save</button>
      </div>
    </div>
  );
}
