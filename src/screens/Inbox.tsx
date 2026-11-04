// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Inbox: everything caught with the shortcut (or typed here), sorted one
// at a time. The item fills the page; five big choices sit under it, with the
// keys 1 to 5: Task, Note (today's daily note), Event (Calendar's plain words),
// Snippet (asks for its abbreviation) or Delete. Every choice can be undone.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { actionForKey, eventText, itemTitle, KIND_LABEL, noteLine, snippetAbbr, SORT_ACTIONS, sortNudge, taskFrom, type InboxItem, type SortAction } from '../../core/inbox';
import { relativeTime } from '../../core/format';
import { accelLabel } from '../../core/shortcuts';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading, PageHead } from '../components/ui';
import { useFeature } from '../features';
import { clock } from '../pim/mail-today';
import { addTaskFromText, MicButton } from '../pim/tasks-ui';
import { useStore } from '../state';
import '../styles/today.css';

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** The words "Catch something" box, here and on Hello. */
export function CatchBox({ source, autoFocus }: { source: string; autoFocus?: boolean }) {
  const { toast } = useStore();
  const [text, setText] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const add = async () => {
    if (!text.trim()) return;
    const it = await api.inbox.add({ text, source }).catch(() => null);
    if (it) { setText(''); toast('Caught'); }
  };
  return (
    <div className="ib-catch">
      <Icon name="plus" size={14} />
      <input ref={field} data-testid="inbox-catch" aria-label="Catch something" placeholder="Catch a thought, a link…" value={text} autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} />
      <MicButton target={field} />
    </div>
  );
}

function Preview({ item }: { item: InboxItem }) {
  return (
    <div className="ib-body">
      {item.text ? <p className="ib-text">{item.text}</p> : null}
      {item.url ? <button className="ib-link ellipsis" title={item.url} onClick={() => void api.system.openExternal(item.url!)}><Icon name="link" size={13} /> {item.url}</button> : null}
      {item.kind === 'shot' && item.path ? <img className="ib-shot" src={api.preview.url(item.path)} alt={`Screenshot: ${itemTitle(item)}`} /> : null}
      {item.kind === 'file' && item.path ? <button className="ib-link ellipsis" title={item.path} onClick={() => void api.files.reveal(item.path!)}><Icon name="paperclip" size={13} /> {itemTitle(item)}</button> : null}
    </div>
  );
}

export function InboxPage() {
  const { toast, settings, info } = useStore();
  const tasksOn = useFeature('calendars');
  const notesOn = useFeature('notes');
  const snippetsOn = useFeature('textSnippets');
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [at, setAt] = useState(0);
  const [abbr, setAbbr] = useState<string | null>(null);
  const [vault, setVault] = useState<string | null>(null);
  const load = useCallback(() => void api.inbox.list().then(setItems, () => setItems([])), []);
  useEffect(() => { load(); return api.on('inbox-changed', load); }, [load]);
  useEffect(() => { if (notesOn) void api.notes.vaults().then((v) => setVault(v[0]?.id ?? null), () => setVault(null)); }, [notesOn]);
  const list = items ?? [];
  const item = list[Math.min(at, list.length - 1)];
  const shortcut = accelLabel(settings?.today?.captureShortcut ?? '', info?.platform ?? 'linux');

  const why: Partial<Record<SortAction, string>> = useMemo(() => ({
    ...(tasksOn ? {} : { task: 'Calendar and reminders are switched off', event: 'Calendar and reminders are switched off' }),
    ...(!notesOn ? { note: 'Notes is switched off' } : !vault ? { note: 'Add a notes folder in Notes first' } : {}),
    ...(snippetsOn ? {} : { snippet: 'Typed snippets are switched off' }),
  }), [tasksOn, notesOn, vault, snippetsOn]);

  const done = (it: InboxItem, said: string, undo?: () => Promise<unknown>) => {
    void api.inbox.remove(it.id);
    setAbbr(null);
    toast(said, { label: 'Undo', run: () => void Promise.resolve(undo?.()).then(() => api.inbox.restore(it)) });
  };

  const act = async (a: SortAction) => {
    if (!item || why[a]) return;
    try {
      if (a === 'delete') return done(item, 'Deleted');
      if (a === 'task') {
        const f = taskFrom(item);
        const t = await addTaskFromText(f.title, { ...(f.notes ? { notes: f.notes } : {}), ...(f.url ? { url: f.url } : {}) });
        if (t) done(item, `Task added: ${t.title}`, () => api.pim.deleteReminder(t.id));
        return;
      }
      if (a === 'event') {
        const e = await api.pim.quickAdd(eventText(item));
        if (!e) { toast('Add a day or time to it, like “friday 3pm”, then try again'); return; }
        done(item, `In your calendar: ${e.title}`, () => api.pim.deleteEvent(e.id));
        return;
      }
      if (a === 'note' && vault) {
        await api.notes.open(vault).catch(() => undefined);
        const p = await api.notes.periodic(vault, 'day');
        const before = await api.notes.read(vault, p.path).catch(() => '');
        const text = `${before.replace(/\s*$/, '')}${before.trim() ? '\n' : ''}${noteLine(item, clock)}\n`;
        await api.notes.write(vault, p.path, text);
        done(item, 'Added to today’s note', () => api.notes.write(vault, p.path, before));
        return;
      }
      if (a === 'snippet') {
        const cfg = await api.voice.settings();
        if (abbr === null) { setAbbr(snippetAbbr(item.text || itemTitle(item), cfg.snippets.map((s) => s.abbr ?? ''))); return; }
        const s = { id: `ib-${Date.now().toString(36)}`, abbr: abbr.trim(), trigger: '', text: item.text || item.url || itemTitle(item) };
        if (!s.abbr) return;
        await api.voice.setSettings({ snippets: [...cfg.snippets, s] });
        done(item, `Type ${s.abbr} anywhere`, async () => { const now = await api.voice.settings(); await api.voice.setSettings({ snippets: now.snippets.filter((x) => x.id !== s.id) }); });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  // Keys 1 to 5 sort; ← → move between items.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || !item) return;
      const a = actionForKey(e.key);
      if (a) { e.preventDefault(); void act(a); }
      else if (e.key === 'ArrowRight') setAt((i) => Math.min(list.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="ib" data-testid="inbox-page">
      <PageHead title="Inbox" sub={list.length ? sortNudge(list.length) : `Catch anything with ${shortcut || 'the Inbox shortcut'}, sort it later`}>
        {list.length ? <button className="btn" data-testid="inbox-open-card" onClick={() => void api.inbox.card('open')}><Icon name="plus" size={13} /> Catch something</button> : null}
      </PageHead>
      {items === null ? <Loading /> : !item ? (
        <div className="ib-empty" data-testid="inbox-empty">
          <Empty icon="inbox" title="Nothing to sort" action={<button className="btn primary" onClick={() => void api.inbox.card('open')}>Catch something</button>}>
            Press {shortcut || 'the Inbox shortcut'} in any app to catch a thought, a link or a screenshot. It waits here until you sort it.
          </Empty>
        </div>
      ) : (
        <>
          <article className="ib-item" data-testid="inbox-item" aria-label={itemTitle(item)} aria-describedby="ib-meta">
            <div className="ib-meta" id="ib-meta">
              <span className="ib-kind"><Icon name={item.kind === 'link' ? 'link' : item.kind === 'voice' ? 'mic' : item.kind === 'shot' ? 'screenshot' : item.kind === 'file' ? 'paperclip' : 'text'} size={12} /> {KIND_LABEL[item.kind]}</span>
              <span>{relativeTime(item.at)}</span>
              <span className="grow" />
              <span className="ib-count" aria-live="polite">{Math.min(at, list.length - 1) + 1} of {list.length}</span>
              <button className="btn ghost sm icon" aria-label="Previous" title="Previous (←)" disabled={at <= 0} onClick={() => setAt((i) => Math.max(0, i - 1))}><Icon name="chevronLeft" size={13} /></button>
              <button className="btn ghost sm icon" aria-label="Next" title="Next (→)" disabled={at >= list.length - 1} onClick={() => setAt((i) => Math.min(list.length - 1, i + 1))}><Icon name="chevronRight" size={13} /></button>
            </div>
            <Preview item={item} />
          </article>
          {abbr !== null ? (
            <div className="ib-abbr" role="group" aria-label="Snippet">
              <label><span>Type this to insert it</span><input autoFocus data-testid="inbox-abbr" value={abbr} onChange={(e) => setAbbr(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void act('snippet'); if (e.key === 'Escape') setAbbr(null); }} /></label>
              <button className="btn primary" onClick={() => void act('snippet')}>Save snippet</button>
              <button className="btn ghost" onClick={() => setAbbr(null)}>Cancel</button>
            </div>
          ) : (
            <div className="ib-actions" role="group" aria-label="Make it a">
              {SORT_ACTIONS.map((a) => (
                <button key={a.id} className={`ib-act ${a.id}`} data-action={a.id} disabled={!!why[a.id]} title={why[a.id] ?? `${a.hint} (${a.key})`} onClick={() => void act(a.id)}>
                  <Icon name={a.icon} size={18} />
                  <span>{a.label}</span>
                  <kbd aria-hidden>{a.key}</kbd>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="ib-foot"><CatchBox source="inbox" /></div>
    </div>
  );
}
