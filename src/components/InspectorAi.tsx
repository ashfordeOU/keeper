// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// AI actions in the Inspector: suggest a name, summarize, describe an image.
// Each one says exactly what it sends and to whom, and only runs on a click.

import { useEffect, useState } from 'react';
import type { AiProviderInfo } from '../../core/api-x';
import type { FileEntry } from '../../core/types';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import '../styles/screens-x.css';

type Action = 'name' | 'summary' | 'alt';

export function InspectorAi({ file, onRenamed }: { file: FileEntry; onRenamed: (to: string, name: string) => void }) {
  const { toast, refresh } = useStore();
  const [info, setInfo] = useState<AiProviderInfo | null>(null);
  const [asking, setAsking] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ action: Action; text: string } | null>(null);
  useEffect(() => { void api.aiActions.provider().then(setInfo).catch(() => setInfo(null)); }, []);
  useEffect(() => { setOut(null); setAsking(null); }, [file.path]);
  if (!info) return null;

  const textual = file.kind === 'document' || file.kind === 'code' || !!file.text || /^(txt|md|pdf|rtf|csv|html?)$/.test(file.ext);
  const actions: { id: Action; label: string; icon: string; sends: string }[] = [
    ...(textual || file.kind === 'image' ? [{ id: 'name' as Action, label: 'Suggest a name', icon: 'rename', sends: 'the text inside this file, its name and date' }] : []),
    ...(textual ? [{ id: 'summary' as Action, label: 'Summarize', icon: 'document', sends: 'the text inside this file' }] : []),
    ...(file.kind === 'image' ? [{ id: 'alt' as Action, label: 'Describe image', icon: 'eye', sends: 'this image' }] : []),
  ];
  if (!actions.length) return null;

  const run = async (a: Action) => {
    setAsking(null);
    setBusy(true);
    try {
      const text = a === 'name' ? await api.aiActions.suggestName(file.path) : a === 'summary' ? await api.aiActions.summarize(file.path) : await api.aiActions.altText(file.path);
      setOut({ action: a, text });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col">
      <div className="row"><h3 className="grow">Ask the assistant</h3>{busy ? <span className="spinner" /> : null}</div>
      {!info.configured ? <div className="small muted">Set up the assistant in Settings to name, summarize and describe files.</div> : (
        <div className="btn-row">
          {actions.map((a) => <button key={a.id} className="btn sm" disabled={busy} onClick={() => (info.local ? void run(a.id) : setAsking(a.id))}><Icon name={a.icon} size={12} /> {a.label}</button>)}
        </div>
      )}
      {asking ? (
        <div className="ai-consent">
          This sends {actions.find((a) => a.id === asking)!.sends} to {info.label}. Nothing else leaves your computer.
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn sm primary" onClick={() => void run(asking)}>Send</button>
            <button className="btn sm" onClick={() => setAsking(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
      {out ? (
        <div className="col" style={{ gap: 6 }}>
          <div className="ai-box">{out.text}</div>
          <div className="btn-row">
            {out.action === 'name' ? (
              <button className="btn sm primary" onClick={async () => {
                try {
                  const to = await api.files.rename(file.path, out.text);
                  onRenamed(to, out.text);
                  refresh();
                  toast(`Renamed to ${out.text}`);
                  setOut(null);
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Could not rename');
                }
              }}>Use this name</button>
            ) : null}
            <button className="btn sm" onClick={() => { void api.files.copyText(out.text); toast('Copied'); }}><Icon name="copy" size={12} /> Copy</button>
            <button className="btn sm ghost" onClick={() => setOut(null)}>Dismiss</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
