// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Send to…" from anywhere: one small sheet with the same eight verbs for a
// file, a mail, a task, an event, a note or a clip (core/send-to.ts). Keys 1 to
// 8 choose; every result keeps a line back to where it came from, and most can
// be undone from the toast.

import { useEffect, useState } from 'react';
import { aiPrompt, backLink, cueFrom, eventWords, KIND_WORD, mailDraft, noteLine, taskFrom, verbForKey, verbsFor, type SendItem, type SendVerb } from '../../core/send-to';
import { api } from '../api';
import { useFeatureStates } from '../features';
import { clock } from '../pim/mail-today';
import { addTaskFromText } from '../pim/tasks-ui';
import { sendToDevice } from '../screen/ScreenParts';
import { useStore, type Route } from '../state';
import { Icon } from './Icon';
import { Modal } from './ui';
import '../styles/send-to.css';

const EVENT = 'keeper-send';

/** Opens the Send to sheet for one thing, from any page. */
export function openSendTo(item: SendItem) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: item }));
}

/** Mounted once in the window: listens for openSendTo. */
export function SendToHost() {
  const [item, setItem] = useState<SendItem | null>(null);
  const store = useStore();
  useEffect(() => {
    const open = (e: Event) => setItem((e as CustomEvent<SendItem>).detail);
    window.addEventListener(EVENT, open);
    // keeper do send.task --title … (and the same from PowerShell, the session bus or AppleScript).
    const off = api.on('send-run', (s) => {
      const it: SendItem = { kind: s.path ? 'file' : s.url ? 'text' : 'text', title: s.title, ...(s.text ? { text: s.text } : {}), ...(s.url ? { url: s.url } : {}), ...(s.path ? { paths: [s.path], link: `keeper://open?path=${encodeURIComponent(s.path)}` } : {}) };
      void send(s.verb, it, { go: store.go, when: s.when }).then((said) => { if (said) store.toast(said.text, said.undo ? { label: 'Undo', run: () => void said.undo!() } : undefined); }, (e: unknown) => store.toast(e instanceof Error ? e.message : String(e)));
    });
    return () => { window.removeEventListener(EVENT, open); off(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return item ? <SendToSheet item={item} onClose={() => setItem(null)} /> : null;
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function SendToSheet({ item, onClose }: { item: SendItem; onClose: () => void }) {
  const store = useStore();
  const states = useFeatureStates();
  const verbs = verbsFor(item, (f) => states?.get(f)?.on ?? true);
  const [when, setWhen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (verb: SendVerb) => {
    const v = verbs.find((x) => x.id === verb);
    if (!v || v.why || busy) return;
    if (verb === 'event' && when === null) { setWhen(''); return; }
    setBusy(true);
    try {
      const said = await send(verb, item, { go: store.go, when: when ?? '' });
      if (said) store.toast(said.text, said.undo ? { label: 'Undo', run: () => void said.undo!() } : undefined);
      onClose();
    } catch (e) {
      store.toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = verbForKey(e.key);
      if (v) { e.preventDefault(); void run(v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Modal title="Send to…" onClose={onClose} width={520} testId="send-to">
      <div className="sendto-what">
        <span className="sendto-kicker">{KIND_WORD[item.kind]}</span>
        <span className="sendto-title ellipsis">{item.title}</span>
      </div>
      {when !== null ? (
        <form className="sendto-when" onSubmit={(e) => { e.preventDefault(); void run('event'); }}>
          <label><span>When?</span><input autoFocus data-testid="sendto-when" placeholder="friday 3pm" value={when} onChange={(e) => setWhen(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setWhen(null); } }} /></label>
          <button className="btn primary" type="submit" disabled={busy || !when.trim()}>Add event</button>
          <button className="btn ghost" type="button" onClick={() => setWhen(null)}>Back</button>
        </form>
      ) : (
        <div className="sendto-grid" role="group" aria-label="Send to">
          {verbs.map((v) => (
            <button key={v.id} className="sendto-verb" data-verb={v.id} disabled={!!v.why || busy} title={v.why ?? `${v.hint} (${v.key})`} onClick={() => void run(v.id)}>
              <Icon name={v.icon} size={18} />
              <span className="sendto-label">{v.label}</span>
              <span className="sendto-hint">{v.why ?? v.hint}</span>
              <kbd aria-hidden>{v.key}</kbd>
            </button>
          ))}
        </div>
      )}
      <p className="small muted sendto-foot">Each copy keeps a link back · Undo from the message</p>
    </Modal>
  );
}

interface Said { text: string; undo?: () => Promise<unknown> }

/** Runs one verb with Keeper's own parts; returns what to say, or null when it handed over to a page or sheet. */
export async function send(verb: SendVerb, item: SendItem, ctx: { go: (r: Route) => void; when?: string }): Promise<Said | null> {
  switch (verb) {
    case 'note': {
      const vault = (await api.notes.vaults())[0]?.id;
      if (!vault) throw new Error('Add a notes folder in Notes first');
      await api.notes.open(vault).catch(() => undefined);
      const p = await api.notes.periodic(vault, 'day');
      const before = await api.notes.read(vault, p.path).catch(() => '');
      await api.notes.write(vault, p.path, `${before.replace(/\s*$/, '')}${before.trim() ? '\n' : ''}${noteLine(item, clock(Date.now()))}\n`);
      return { text: 'Added to today’s note', undo: () => api.notes.write(vault, p.path, before) };
    }
    case 'task': {
      const t = taskFrom(item);
      const r = await addTaskFromText(t.title, { notes: t.notes, ...(t.url ? { url: t.url } : {}) });
      if (!r) throw new Error('That task has no words to keep');
      return { text: `Task added: ${r.title}`, undo: () => api.pim.deleteReminder(r.id) };
    }
    case 'event': {
      const e = await api.pim.quickAdd(`${eventWords(item)} ${ctx.when ?? ''}`.trim());
      if (!e) throw new Error('Add a day or time, like “friday 3pm”');
      const saved = await api.pim.saveEvent({ ...e, description: [e.description, backLink(item)].filter(Boolean).join('\n\n') }).catch(() => e);
      return { text: `In your calendar: ${saved.title}`, undo: () => api.pim.deleteEvent(saved.id) };
    }
    case 'mail':
      ctx.go({ name: 'mail', arg: `draft:${encodeURIComponent(JSON.stringify(mailDraft(item)))}` });
      return null;
    case 'device':
      sendToDevice(item.paths ?? []);
      return null;
    case 'ai':
      ctx.go({ name: 'assistant', arg: aiPrompt(item) });
      return null;
    case 'shelf':
      await api.island.addToShelf(item.paths ?? []);
      return { text: 'On the Shelf' };
    case 'cue': {
      const c = await api.cues.create(cueFrom(item));
      return { text: `Cue added: ${c.title}`, undo: () => api.cues.remove(c.id) };
    }
  }
}
