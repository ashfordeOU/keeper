// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Pieces shared by every place a cue shows: the card (dashboard, Island,
// the popup beside an app) and the composer (Island, popup, palette, shortcut).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CueState } from '../../core/cues/api';
import { whenText } from '../../core/cues/dashboard';
import { describeAnchor, progressOf, statusOf, type Cue, type CueAnchor, type CueDraft, type CueTemplate, type SnoozeChoice } from '../../core/cues/model';
import { api } from '../api';
import { Icon } from '../components/Icon';
import '../styles/cues.css';

export const TYPE_ICON: Record<Cue['type'], string> = { note: 'note', checklist: 'listCheck', link: 'link', file: 'paperclip' };
const ANCHOR_ICON: Record<CueAnchor['kind'], string> = { app: 'app', site: 'globe', page: 'link', title: 'columns', file: 'document' };
export const SNOOZES: { id: SnoozeChoice; label: string }[] = [
  { id: '10m', label: '10 minutes' }, { id: '1h', label: '1 hour' }, { id: '3h', label: '3 hours' }, { id: 'tonight', label: 'This evening' },
  { id: 'tomorrow', label: 'Tomorrow morning' }, { id: 'nextweek', label: 'Next week' }, { id: 'nextvisit', label: 'Next time I’m here' },
];

/** Live cues state for any window: reloads on change. */
export function useCues(): [CueState | null, () => void] {
  const [st, setSt] = useState<CueState | null>(null);
  const load = () => void api.cues?.state().then(setSt).catch(() => setSt(null));
  useEffect(() => {
    load();
    return api.on('cues-changed', load);
  }, []);
  return [st, load];
}

export function AnchorChip({ a, onRemove }: { a: CueAnchor; onRemove?: () => void }) {
  return (
    <span className="cue-chip" title={a.value}>
      <Icon name={ANCHOR_ICON[a.kind]} size={11} />
      <span className="ellipsis">{describeAnchor(a)}</span>
      {onRemove ? <button className="cue-chip-x" aria-label="Remove place" onClick={onRemove}><Icon name="close" size={9} /></button> : null}
    </span>
  );
}

function SnoozeMenu({ onPick, onClose }: { onPick: (s: SnoozeChoice) => void; onClose: () => void }) {
  return (
    <div className="cue-menu" role="menu" onMouseLeave={onClose}>
      {SNOOZES.map((s) => <button key={s.id} role="menuitem" onClick={() => { onPick(s.id); onClose(); }}>{s.label}</button>)}
    </div>
  );
}

export function CueCard({ cue, now = Date.now(), compact, onOpen, onDismiss, textSize }: { cue: Cue; now?: number; compact?: boolean; onOpen?: () => void; onDismiss?: () => void; textSize?: number }) {
  const [snooze, setSnooze] = useState(false);
  const st = statusOf(cue, now);
  const prog = progressOf(cue);
  const act = (p: Promise<unknown>) => void p.catch(() => undefined);
  return (
    <div className={`cue-card ${st} ${compact ? 'compact' : ''}`} data-testid="cue-card" data-cue={cue.id} style={textSize ? ({ '--cue-size': `${textSize}px` } as React.CSSProperties) : undefined}>
      <div className="cue-head">
        <span className={`cue-type t-${cue.type}`}><Icon name={TYPE_ICON[cue.type]} size={13} /></span>
        <button className="cue-title ellipsis" onClick={onOpen} title={cue.title}>{cue.pinned ? '★ ' : ''}{cue.title}</button>
        {cue.due !== undefined && !cue.done ? <span className={`cue-due ${st === 'overdue' ? 'late' : ''}`}><Icon name={cue.repeat ? 'repeat' : 'clock'} size={11} /> {whenText(cue.due, now)}</span> : null}
        {cue.snoozedUntil && cue.snoozedUntil > now ? <span className="cue-due"><Icon name="alarm" size={11} /> {whenText(cue.snoozedUntil, now)}</span> : null}
        {cue.snoozeNextVisit ? <span className="cue-due">next visit</span> : null}
      </div>
      {cue.body ? <div className="cue-body">{compact ? cue.body.split('\n').slice(0, 3).join('\n') : cue.body}</div> : null}
      {cue.url ? <button className="cue-link ellipsis" onClick={() => void api.system.openExternal(cue.url!)}><Icon name="external" size={11} /> {cue.url}</button> : null}
      {cue.files?.length ? <div className="cue-files">{cue.files.map((f) => <button key={f} className="cue-chip" onClick={() => void api.files.open(f)}><Icon name="document" size={11} /> {f.split(/[\\/]/).pop()}</button>)}</div> : null}
      {cue.items?.length ? (
        <div className="cue-items">
          {(compact ? cue.items.slice(0, 6) : cue.items).map((i) => (
            <div key={i.id} className={`cue-item ${i.done ? 'done' : ''} ${i.skipped ? 'skipped' : ''}`}>
              <button className="cue-tick" role="checkbox" aria-checked={i.done} aria-label={i.text} onClick={() => act(api.cues.toggleItem(cue.id, i.id))}>{i.done ? <Icon name="check" size={11} /> : null}</button>
              <span className="grow">{i.text}</span>
              {!compact ? <button className="btn ghost sm" title={i.skipped ? 'Include this step' : 'Skip this step this time'} onClick={() => act(api.cues.skipItem(cue.id, i.id))}>{i.skipped ? 'Include' : 'Skip'}</button> : null}
            </div>
          ))}
          {compact && cue.items.length > 6 ? <div className="muted small">+{cue.items.length - 6} more</div> : null}
          <div className="cue-progress"><i style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} /></div>
        </div>
      ) : null}
      {!compact && cue.anchors.length ? <div className="cue-anchors">{cue.anchors.map((a, i) => <AnchorChip key={i} a={a} />)}</div> : null}
      <div className="cue-actions">
        {st === 'deleted' ? (
          <>
            <button className="btn sm" onClick={() => act(api.cues.restore(cue.id))}><Icon name="undo" size={11} /> Put back</button>
            <button className="btn sm ghost" onClick={() => act(api.cues.purge(cue.id))}>Delete now</button>
          </>
        ) : cue.done ? (
          <button className="btn sm" onClick={() => act(api.cues.reopen(cue.id))}><Icon name="undo" size={11} /> Not done</button>
        ) : (
          <>
            <button className="btn sm primary" data-testid="cue-done" onClick={() => act(api.cues.complete(cue.id))}><Icon name="check" size={11} /> {cue.repeat ? 'Done for now' : 'Done'}</button>
            <span className="cue-snooze-wrap">
              <button className="btn sm" onClick={() => setSnooze(!snooze)} aria-haspopup="menu"><Icon name="alarm" size={11} /> Later</button>
              {snooze ? <SnoozeMenu onPick={(s) => act(api.cues.snooze(cue.id, s))} onClose={() => setSnooze(false)} /> : null}
            </span>
            {onDismiss ? <button className="btn sm ghost" onClick={onDismiss}>Hide</button> : null}
          </>
        )}
        <span className="grow" />
        {!compact && cue.type === 'checklist' && !cue.templateId && cue.items?.length ? <button className="btn sm ghost" title="Keep these steps as a reusable checklist" onClick={() => act(api.cues.saveTemplate({ name: cue.title, items: cue.items!.map((i) => i.text), anchors: cue.anchors }))}>Save as checklist</button> : null}
        {!compact && st !== 'deleted' ? <button className="btn sm ghost icon" title="Move to Recently deleted" aria-label="Delete" onClick={() => act(api.cues.remove(cue.id))}><Icon name="trash" size={12} /></button> : null}
      </div>
    </div>
  );
}

/** Words for a draft's time ("tomorrow 09:00 · every weekday"). */
function draftSummary(d: CueDraft | null): string {
  if (!d) return '';
  const parts: string[] = [];
  if (d.due) parts.push(whenText(d.due));
  if (d.repeat) parts.push(`every ${d.repeat === 'weekdays' ? 'weekday' : d.repeat.replace(/ly$/, '').replace('dai', 'day')}`);
  if (d.items?.length) parts.push(`${d.items.length} steps`);
  if (d.url) parts.push('link');
  return parts.join(' · ');
}

export interface ComposerProps {
  st: CueState | null;
  initial?: string;
  attach?: CueAnchor['kind'][];
  onSaved?: (c: Cue) => void;
  onCancel?: () => void;
  compact?: boolean;
  autoFocus?: boolean;
}

/** Write a cue: plain words with times, "@app", "on site.com", "- steps"; attach it to what is in front with one click. */
export function Composer({ st, initial = '', attach, onSaved, onCancel, compact, autoFocus }: ComposerProps) {
  const [text, setText] = useState(initial);
  const [hint, setHint] = useState('');
  const [draft, setDraft] = useState<CueDraft | null>(null);
  const offered = st?.offered ?? [];
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(offered.filter((a) => (attach ?? ['page', 'app']).includes(a.kind)).slice(0, 1).map((a) => `${a.kind}:${a.value}`)));
  const [tplOpen, setTplOpen] = useState(false);
  const [err, setErr] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  // Drafts survive closing the composer (per window).
  useEffect(() => {
    if (initial) return;
    try { const d = sessionStorage.getItem('cue-draft'); if (d) setText(d); } catch { /* storage off */ }
  }, [initial]);
  useEffect(() => {
    try { sessionStorage.setItem('cue-draft', text); } catch { /* storage off */ }
    const t = setTimeout(() => {
      if (!text.trim()) { setDraft(null); setHint(''); return; }
      void api.cues.parse(text).then(setDraft).catch(() => undefined);
      void api.cues.suggest(text.split('\n').pop() ?? '').then(setHint).catch(() => setHint(''));
    }, 140);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    // The first offer is preselected when the place becomes known after opening.
    if (!chosen.size && offered.length && attach) setChosen(new Set(offered.filter((a) => attach.includes(a.kind)).slice(0, 1).map((a) => `${a.kind}:${a.value}`)));
  }, [offered.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const anchors = useMemo(() => offered.filter((a) => chosen.has(`${a.kind}:${a.value}`)), [offered, chosen]);
  const save = async () => {
    if (!text.trim()) return;
    try {
      const c = await api.cues.create({ text, anchors });
      setText('');
      try { sessionStorage.removeItem('cue-draft'); } catch { /* storage off */ }
      onSaved?.(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const runTemplate = async (t: CueTemplate) => {
    const c = await api.cues.startTemplate(t.id, { attach: anchors.map((a) => a.kind) });
    setTplOpen(false);
    onSaved?.(c);
  };
  return (
    <div className={`cue-composer ${compact ? 'compact' : ''}`} data-testid="cue-composer">
      <div className="cue-input-wrap">
        <textarea
          ref={ta} className="cue-input" autoFocus={autoFocus} rows={compact ? 2 : 3} value={text} aria-label="New cue"
          placeholder={compact ? 'A note, a time, @app — or - steps' : 'Check the comments @figma · Send invoice tomorrow 9am · - steps on new lines'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && hint) { e.preventDefault(); setText(text + hint); setHint(''); }
            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
            else if (e.key === 'Escape') onCancel?.();
          }}
          onPaste={(e) => {
            // Several pasted lines become checklist steps.
            const t = e.clipboardData.getData('text');
            if (t.includes('\n') && !text.trim()) { e.preventDefault(); const [first, ...rest] = t.split(/\r?\n/).filter((l) => l.trim()); setText(`${first}\n${rest.map((l) => `- ${l.replace(/^[-*•]\s*/, '')}`).join('\n')}`); }
          }}
        />
        {hint ? <div className="cue-ghost" aria-live="polite"><span className="cue-ghost-hint">{hint}</span> <kbd>Tab</kbd></div> : null}
      </div>
      {draft && draftSummary(draft) ? <div className="cue-draft muted small"><Icon name="clock" size={11} /> {draftSummary(draft)}</div> : null}
      {offered.length ? (
        <div className="cue-attach" role="group" aria-label="Attach to">
          <span className="muted small">Comes back</span>
          {offered.map((a) => {
            const k = `${a.kind}:${a.value}`;
            const on = chosen.has(k);
            return <button key={k} className={`cue-chip pick ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => { const n = new Set(chosen); if (on) n.delete(k); else n.add(k); setChosen(n); }}><Icon name={ANCHOR_ICON[a.kind]} size={11} /> <span className="ellipsis">{describeAnchor(a)}</span></button>;
          })}
        </div>
      ) : <div className="muted small">Add “@app” or “on site.com”, or a time — or keep it as a note.</div>}
      {err ? <div className="cue-err small">{err}</div> : null}
      <div className="cue-actions">
        <button className="btn sm primary" data-testid="cue-save" disabled={!text.trim()} onClick={() => void save()}>Save cue</button>
        {st?.templates.length ? (
          <span className="cue-snooze-wrap">
            <button className="btn sm" onClick={() => setTplOpen(!tplOpen)}><Icon name="listCheck" size={11} /> Checklist</button>
            {tplOpen ? <div className="cue-menu" onMouseLeave={() => setTplOpen(false)}>{st.templates.map((t) => <button key={t.id} onClick={() => void runTemplate(t)}>{t.name} <span className="muted">· {t.items.length}</span></button>)}</div> : null}
          </span>
        ) : null}
        {onCancel ? <button className="btn sm ghost" onClick={onCancel}>Cancel</button> : null}
        <span className="grow" />
        <span className="muted small">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}↩ save</span>
      </div>
    </div>
  );
}
