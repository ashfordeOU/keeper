// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One Settings row, drawn from the registry (core/settings-schema.ts): its label
// and help, the control for its kind, an "Advanced" tag, and — once changed — a
// bar on its left edge and a reset button (also on right-click), with Undo.

import { useState } from 'react';
import { friendlyPath } from '../../../core/format';
import { accelFromKey, accelLabel } from '../../../core/shortcuts';
import { defaultValue, getPath, isChanged, labelOf, legacyAnchor, patchFor, valueText, type SettingDef } from '../../../core/settings-schema';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { ContextMenu, Toggle } from '../../components/ui';
import { useStore, type Route } from '../../state';
import { PANELS } from './panels';

/** Records a key combination: click, press the keys, done (Esc cancels). */
export function KeyRecorder({ value, onChange, label }: { value: string; onChange: (acc: string) => void; label: string }) {
  const { info } = useStore();
  const platform = info?.platform ?? '';
  const [rec, setRec] = useState(false);
  return (
    <button
      type="button"
      className={`keyrec ${rec ? 'rec' : ''}`}
      aria-label={`${label}: ${accelLabel(value, platform) || 'none'}. Press to change`}
      onClick={() => setRec(true)}
      onBlur={() => setRec(false)}
      onKeyDown={(e) => {
        if (!rec) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') { setRec(false); return; }
        const acc = accelFromKey(e, platform);
        if (acc) { onChange(acc); setRec(false); }
      }}
    >
      {rec ? <span className="muted">Press the keys…</span> : <kbd className="keycaps">{accelLabel(value, platform) || 'None'}</kbd>}
    </button>
  );
}

function Control({ def }: { def: SettingDef }) {
  const { settings: s, updateSettings, toast, go, info } = useStore();
  if (!s) return null;
  const v = def.path ? getPath(s, def.path) ?? defaultValue(def) : undefined;
  const set = (x: unknown) => def.path && void updateSettings(patchFor(s, def.path, x));
  const label = labelOf(def, info?.platform ?? '');
  switch (def.kind) {
    case 'toggle':
      return <Toggle on={def.invert ? !v : v === undefined ? true : !!v} label={label} onChange={(x) => set(def.invert ? !x : x)} />;
    case 'choice':
      return def.choices!.length <= 3 ? (
        <div className="seg" role="radiogroup" aria-label={label}>
          {def.choices!.map((c) => <button key={String(c.value)} role="radio" aria-checked={v === c.value} className={v === c.value ? 'on' : ''} onClick={() => set(c.value)}>{c.label}</button>)}
        </div>
      ) : (
        <select className="input" aria-label={label} value={String(v ?? '')} onChange={(e) => set(typeof def.choices![0].value === 'number' ? Number(e.target.value) : e.target.value)}>
          {def.choices!.map((c) => <option key={String(c.value)} value={String(c.value)}>{c.label}</option>)}
        </select>
      );
    case 'number':
      return <span className="setting-num"><input className="input" type="number" aria-label={label} min={def.min} defaultValue={Number(v)} key={String(v)} onBlur={(e) => set(Math.max(def.min ?? 0, Number(e.target.value) || def.min || 0))} />{def.unit ? <span className="muted">{def.unit}</span> : null}</span>;
    case 'text':
      return <input className="input" aria-label={label} defaultValue={String(v ?? '')} key={String(v)} onBlur={(e) => e.target.value !== v && set(e.target.value.trim())} />;
    case 'shortcut':
      return <KeyRecorder label={label} value={String(v ?? '')} onChange={set} />;
    case 'list': {
      const list = (Array.isArray(v) ? v : []) as string[];
      return (
        <div className="setting-list">
          <div className="list-box">
            {list.map((f) => (
              <div key={f} className="li"><Icon name={def.id === 'excluded' ? 'lock' : 'folder'} size={13} /><span className="grow ellipsis" title={f}>{friendlyPath(f, info?.home)}</span>
                <button className="btn ghost sm icon" title="Remove" aria-label={`Remove ${f}`} onClick={() => set(list.filter((x) => x !== f))}><Icon name="close" size={12} /></button></div>
            ))}
          </div>
          <button className="btn sm" onClick={() => void api.settings.pickFolder().then((p) => p && !list.includes(p) && set([...list, p]))}><Icon name="plus" size={12} /> Add folder</button>
        </div>
      );
    }
    case 'action':
      return <button className="btn" onClick={() => void api.library.rescan().then(() => toast('Searching everything again'))}><Icon name="refresh" size={13} /> Start</button>;
    case 'link':
      return <button className="btn" onClick={() => def.to && go(def.to as Route)}>Open <Icon name="chevronRight" size={12} /></button>;
    case 'panel':
      return <>{PANELS[def.panel!]?.render()}</>;
  }
}

export function SettingRow({ def }: { def: SettingDef }) {
  const { settings: s, updateSettings, toast, info } = useStore();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (!s) return null;
  const platform = info?.platform ?? '';
  const changed = isChanged(s, def);
  const label = labelOf(def, platform);
  const reset = () => {
    if (!def.path) return;
    const was = getPath(s, def.path);
    void updateSettings(patchFor(s, def.path, defaultValue(def))).then(() => toast(`Reset ‘${label}’`, { label: 'Undo', run: () => void updateSettings(patchFor(s, def.path!, was)) }));
  };
  const panel = def.kind === 'panel' ? PANELS[def.panel!] : undefined;
  const tags = (
    <>
      {def.level === 'advanced' ? <span className="adv-tag">Advanced</span> : null}
      {def.restart ? <span className="adv-tag">Applies after restart</span> : null}
      {def.network ? <span className="adv-tag">Uses the internet</span> : null}
    </>
  );
  const resetBtn = changed ? <button className="btn ghost sm icon setting-reset" title={`Reset to default (${valueText(def, defaultValue(def), platform)})`} aria-label={`Reset ${label} to default`} onClick={reset}><Icon name="refresh" size={12} /></button> : null;
  const common = {
    'data-setting-id': def.id,
    // Old links and scripts still find a row by its old anchor (#locked, #platform, #ashforde).
    id: legacyAnchor(def.id),
    'data-changed': changed ? '' : undefined,
    onContextMenu: changed ? (e: React.MouseEvent) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); } : undefined,
  };
  const ctx = menu ? <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[{ label: `Reset to default (${valueText(def, defaultValue(def), platform)})`, icon: 'refresh', run: reset }]} /> : null;
  if (panel?.own) {
    return <div className={`srow srow-own ${panel.wide ? 'wide' : ''}`} {...common}>{def.level === 'advanced' || def.restart || def.network ? <div className="srow-tags">{tags}</div> : null}{panel.render()}{ctx}</div>;
  }
  if (panel?.wide || def.kind === 'list') {
    return (
      <div className="srow wide" {...common}>
        <div className="srow-text"><div className="srow-label">{label}{tags}</div>{def.help ? <div className="srow-help">{def.help}</div> : null}</div>
        <div className="srow-block"><Control def={def} /></div>
        {ctx}
      </div>
    );
  }
  return (
    <div className="srow" {...common}>
      <div className="srow-text"><div className="srow-label">{label}{tags}</div>{def.help ? <div className="srow-help">{def.help}</div> : null}</div>
      <div className="srow-ctl">{resetBtn}<Control def={def} /></div>
      {ctx}
    </div>
  );
}
