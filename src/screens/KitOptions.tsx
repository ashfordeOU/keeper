// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Options for the file kit's tools, drawn from their descriptions in
// core/filekit/tools.ts, and the format list for "Convert to…".

import { useEffect, useState } from 'react';
import type { EngineInfo } from '../../core/api-filekit';
import { extOf } from '../../core/classify';
import { KIT_INFO, type KitArgs, type KitField, type KitInfo, type KitOp } from '../../core/filekit/tools';
import { familyOf, targetsFor, type Target } from '../../core/filekit/matrix';
import { api } from '../api';

/** Formats every chosen file can become (the ones they share). */
export function commonTargets(files: string[]): Target[] {
  if (!files.length) return [];
  const lists = files.map((f) => targetsFor(extOf(f.split(/[\\/]/).pop() ?? '')));
  return lists[0].filter((t) => lists.every((l) => l.some((x) => x.format === t.format)));
}

export function KitOptions({ op, set, files }: { op: KitOp; set: (o: KitOp) => void; files: string[] }) {
  const info = KIT_INFO[op.tool] as KitInfo;
  const args = op.args ?? {};
  const put = (k: string, v: string | number | boolean) => set({ ...op, args: { ...args, [k]: v } });
  const targets = op.tool === 'convert.to' ? commonTargets(files) : [];
  // Pick the first format the files can become.
  useEffect(() => {
    if (op.tool !== 'convert.to') return;
    if (targets.length && !targets.some((t) => t.format === args.format)) set({ ...op, args: { ...args, format: targets[0].format } });
  }, [op.tool, files.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (info.fields ?? []).filter((f) => !f.when || f.when.is.includes(args[f.when.key] as never));
  return (
    <>
      {op.tool === 'convert.to' ? (
        <div className="conv-field">
          <span className="conv-label">To</span>
          {files.length && !targets.length ? (
            <div className="small muted">{files.some((f) => !familyOf(extOf(f.split(/[\\/]/).pop() ?? ''))) ? 'Keeper does not know how to convert one of these kinds of file yet.' : 'These files have no format in common; convert them separately.'}</div>
          ) : !files.length ? (
            <div className="small muted">Add files to see what they can become.</div>
          ) : (
            <div className="kit-formats" role="radiogroup" aria-label="Format">
              {targets.map((t) => (
                <button key={t.format} role="radio" aria-checked={args.format === t.format} className={`kit-format ${args.format === t.format ? 'on' : ''}`} onClick={() => put('format', t.format)} title={t.engine ? `Uses ${ENGINE_NAMES[t.engine]} when installed` : undefined}>
                  <b>.{t.format}</b>
                  <span>{t.label}{t.engine ? ' ·' : ''}{t.engine ? <i> {ENGINE_NAMES[t.engine]}</i> : null}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {shown.filter((f) => !(op.tool === 'convert.to' && f.key === 'format')).map((f) => <KitFieldInput key={f.key} field={f} value={args[f.key]} onChange={(v) => put(f.key, v)} />)}
      {info.engine ? <div className="small muted">Uses {ENGINE_NAMES[info.engine] ?? info.engine} when it is installed on this computer.</div> : null}
      {op.tool === 'convert.to' ? <Engines /> : null}
      {!shown.length && op.tool !== 'convert.to' ? <div className="small muted">No options needed.</div> : null}
    </>
  );
}

export const ENGINE_NAMES: Record<string, string> = {
  office: 'LibreOffice', pandoc: 'Pandoc', calibre: 'Calibre', ghostscript: 'Ghostscript', poppler: 'poppler', graphviz: 'Graphviz', duckdb: 'DuckDB', ffmpeg: 'the video engine', fonttools: 'fontTools', qpdf: 'qpdf',
};

function KitFieldInput({ field: f, value, onChange }: { field: KitField; value: KitArgs[string]; onChange: (v: string | number | boolean) => void }) {
  const label = <span className="conv-label">{f.label}</span>;
  const hint = f.hint ? <span className="small muted">{f.hint}</span> : null;
  switch (f.kind) {
    case 'bool':
      return <label className="row small"><input type="checkbox" checked={value === true || value === 'true'} onChange={(e) => onChange(e.target.checked)} /> {f.label}</label>;
    case 'select':
      return (
        <label className="conv-field">{label}
          <select className="input" value={String(value ?? f.default ?? '')} onChange={(e) => onChange(e.target.value)}>
            {(f.options ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>{hint}
        </label>
      );
    case 'number':
      return <label className="conv-field">{label}<input className="input" type="number" min={f.min} max={f.max} step={f.step ?? 1} value={value === undefined ? '' : Number(value)} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />{hint}</label>;
    case 'textarea':
      return <label className="conv-field">{label}<textarea className="input mono" rows={5} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />{hint}</label>;
    case 'file':
      return (
        <div className="conv-field">{label}
          <div className="row">
            <span className="ellipsis small grow" title={String(value ?? '')}>{value ? String(value).split(/[\\/]/).pop() : 'None chosen'}</span>
            <button className="btn sm" onClick={() => void api.settings.pickFiles().then((p) => p[0] && onChange(p[0]))}>Choose…</button>
          </div>{hint}
        </div>
      );
    default:
      return <label className="conv-field">{label}<input className="input" type={f.kind === 'password' ? 'password' : 'text'} autoComplete={f.kind === 'password' ? 'off' : undefined} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />{hint}</label>;
  }
}

/** The free programs some routes use, and whether each is installed. */
function Engines() {
  const [list, setList] = useState<EngineInfo[] | null>(null);
  return (
    <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !list) void api.filekit.engines().then(setList); }}>
      <summary className="small">Programs Keeper can use for more formats</summary>
      {!list ? <div className="small muted">Looking…</div> : (
        <div className="col small" style={{ gap: 4, marginTop: 6 }}>
          {list.map((e) => (
            <div key={e.id} className="row" style={{ gap: 8 }}>
              <span style={{ color: e.found ? 'var(--ok)' : 'var(--text-3)' }}>{e.found ? '●' : '○'}</span>
              <b>{e.name}</b>
              <span className="muted grow">{e.for} · {e.license}</span>
              {e.found ? <span className="muted">installed</span> : <button className="btn sm ghost" onClick={() => void api.system.openExternal(e.url)}>Get it</button>}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
