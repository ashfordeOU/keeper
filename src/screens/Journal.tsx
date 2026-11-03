// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Journal: one entry a day in a notes vault. A month calendar with the days
// written, the streak, On this day from earlier years, and the day's entry:
// mood, the weather and place (when switched on), photos, and the text, saved
// as you type into an ordinary Markdown note (core/notes/journal.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VaultInfo } from '../../core/api-notes';
import { entryDates, entryPath, excerpt, isPhoto, MOODS, normalizeJournalSettings, onThisDay, readEntry, streak, writeEntry, type JournalEntry, type JournalSettings, type Mood } from '../../core/notes/journal';
import { describeCode } from '../../core/weather';
import type { FileEntry } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, PageHead } from '../components/ui';
import { useFeature } from '../features';
import { useStore } from '../state';
import '../styles/journal.css';

const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayKey = () => keyOf(new Date());
const asDate = (day: string) => new Date(`${day}T12:00:00`);
const longDay = (day: string) => asDate(day).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const blank = (date: string): JournalEntry => ({ date, photos: [], body: '' });

export function Journal({ initialDay }: { initialDay?: string }) {
  const { settings, updateSettings, toast, go } = useStore();
  const js: JournalSettings = normalizeJournalSettings(settings?.journal);
  const [vaults, setVaults] = useState<VaultInfo[] | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [day, setDay] = useState(initialDay && /^\d{4}-\d{2}-\d{2}$/.test(initialDay) ? initialDay : todayKey());
  const [month, setMonth] = useState(() => { const d = asDate(day); d.setDate(1); return d; });
  const [past, setPast] = useState<{ date: string; text: string; photo?: string; mood?: Mood }[]>([]);

  useEffect(() => { void api.notes.vaults().then(setVaults).catch(() => setVaults([])); }, []);
  const vault = vaults?.find((v) => v.id === js.vault && !v.missing);

  // Only the newest look counts (an older, slower one must not overwrite it).
  const asked = useRef(0);
  const loadDates = useCallback(async () => {
    if (!vault) return;
    const n = ++asked.current;
    // Opening a vault the Notes page or the entry is opening at the same moment can fail once: look again.
    const open = await api.notes.open(vault.id).catch(() => new Promise((r) => setTimeout(r, 700)).then(() => api.notes.open(vault.id)));
    if (n === asked.current) setDates(entryDates(open.files.map((f) => f.path), js.folder));
  }, [vault, js.folder]);
  useEffect(() => { void loadDates().catch(() => undefined); }, [loadDates]);
  useEffect(() => {
    if (!vault) return undefined;
    return api.on('notes-changed', (e) => { if (e.vault === vault.id) void loadDates(); });
  }, [vault, loadDates]);

  // On this day: earlier years' entries for the chosen day.
  const today = todayKey();
  const earlier = useMemo(() => onThisDay(dates, day), [dates, day]);
  useEffect(() => {
    if (!vault) return;
    let live = true;
    void Promise.all(earlier.slice(0, 5).map(async (d) => {
      const e = readEntry(await api.notes.read(vault.id, entryPath(js.folder, d)).catch(() => ''), d);
      const photo = e.photos[0] ? await api.notes.fileUrl(vault.id, e.photos[0]).catch(() => undefined) : undefined;
      return { date: d, text: excerpt(e.body), photo, mood: e.mood };
    })).then((x) => { if (live) setPast(x); });
    return () => { live = false; };
  }, [vault, earlier, js.folder]);

  if (!vaults) return <div className="page"><PageHead title="Journal" /></div>;
  const s = streak(dates, today);

  const start = async (v?: VaultInfo) => {
    try {
      const target = v ?? (await api.journal.makeVault());
      // A vault made for the journal holds it at its top; in another vault it gets a folder of its own.
      await updateSettings({ journal: { ...js, vault: target.id, folder: v ? js.folder || 'Journal' : '' } });
      setVaults(await api.notes.vaults());
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };

  if (!vault) {
    return (
      <div className="page jr-page" data-testid="journal-page">
        <PageHead title="Journal" sub="A few lines a day: your mood, photos, and what happened, kept as Markdown notes you own." />
        <div className="card pad jr-start">
          <Empty icon="book" title="Start your journal" action={<button className="btn primary" data-testid="jr-start" onClick={() => void start()}>Start in Documents › Journal</button>}>
            Each day becomes one note in a vault, in a folder per year. Any notes app can open them.
          </Empty>
          {vaults.filter((v) => !v.missing).length ? (
            <div className="jr-pick">
              <span className="muted small">Or keep it in one of your vaults:</span>
              {vaults.filter((v) => !v.missing).map((v) => <button key={v.id} className="btn sm" onClick={() => void start(v)}>{v.name}</button>)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="page jr-page" data-testid="journal-page">
      <PageHead title="Journal" sub={`In ${vault.name}${js.folder ? ` › ${js.folder}` : ''}`}>
        <button className="btn" onClick={() => go({ name: 'notes' })}>Open in Notes</button>
      </PageHead>
      <div className="jr-layout">
        <aside className="jr-side">
          <Calendar month={month} setMonth={setMonth} day={day} setDay={setDay} dates={dates} today={today} />
          <section className="card jr-streak" aria-label="Streak" data-testid="jr-streak">
            <div><b className="jr-big">{s.current}</b> <span className="muted">day{s.current === 1 ? '' : 's'} in a row</span></div>
            <div className="muted small">Longest: {s.longest} · {dates.length} entr{dates.length === 1 ? 'y' : 'ies'}</div>
          </section>
          <section className="card jr-otd" aria-labelledby="jr-otd-title" data-testid="jr-otd">
            <h3 id="jr-otd-title">On this day</h3>
            {past.length ? past.map((p) => (
              <button key={p.date} className="jr-otd-item" onClick={() => { setDay(p.date); const m = asDate(p.date); m.setDate(1); setMonth(m); }}>
                {p.photo ? <img src={p.photo} alt="" /> : null}
                <span><b>{asDate(p.date).getFullYear()}</b>{p.mood ? ` · ${MOODS.find((m) => m.id === p.mood)?.label}` : ''}<br /><span className="muted small">{p.text || 'No words that day'}</span></span>
              </button>
            )) : <p className="muted small">Nothing from earlier years on {asDate(day).toLocaleDateString([], { day: 'numeric', month: 'long' })} yet.</p>}
          </section>
        </aside>
        <Entry key={`${vault.id}:${day}`} vault={vault} js={js} day={day} today={today} onSaved={loadDates} />
      </div>
    </div>
  );
}

function Calendar({ month, setMonth, day, setDay, dates, today }: { month: Date; setMonth: (d: Date) => void; day: string; setDay: (d: string) => void; dates: string[]; today: string }) {
  const have = new Set(dates);
  const first = new Date(month);
  const lead = (first.getDay() + 6) % 7;
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => keyOf(new Date(first.getFullYear(), first.getMonth(), i + 1)))];
  const shift = (n: number) => { const d = new Date(month); d.setMonth(d.getMonth() + n); setMonth(d); };
  const names = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 2 + i).toLocaleDateString([], { weekday: 'narrow' }));
  return (
    <section className="card jr-cal" aria-label="Calendar">
      <div className="jr-cal-head">
        <button className="btn sm ghost" aria-label="Month before" onClick={() => shift(-1)}><Icon name="chevronLeft" size={14} /></button>
        <b>{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
        <button className="btn sm ghost" aria-label="Month after" onClick={() => shift(1)}><Icon name="chevronRight" size={14} /></button>
      </div>
      <div className="jr-grid" role="grid">
        {names.map((n, i) => <span key={i} className="jr-dow" aria-hidden>{n}</span>)}
        {cells.map((c, i) => c ? (
          <button key={c} className={`jr-day${c === day ? ' on' : ''}${have.has(c) ? ' has' : ''}${c === today ? ' today' : ''}`} disabled={c > today} aria-pressed={c === day}
            aria-label={`${longDay(c)}${have.has(c) ? ', written' : ''}`} onClick={() => setDay(c)}>{Number(c.slice(8))}</button>
        ) : <span key={`e${i}`} />)}
      </div>
    </section>
  );
}

function Entry({ vault, js, day, today, onSaved }: { vault: VaultInfo; js: JournalSettings; day: string; today: string; onSaved: () => void }) {
  const { toast } = useStore();
  const tracksOn = useFeature('tracks');
  const weatherOn = useFeature('weather');
  const path = entryPath(js.folder, day);
  const [e, setE] = useState<JournalEntry | null>(null);
  const rawRef = useRef('');
  const pending = useRef(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<'saved' | 'saving' | ''>('');
  const [ideas, setIdeas] = useState<FileEntry[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<JournalEntry | null>(null);

  useEffect(() => {
    let live = true;
    void api.notes.read(vault.id, path).then((t) => { if (live) { rawRef.current = t; setE(readEntry(t, day)); } }, () => { if (live) { rawRef.current = ''; setE(blank(day)); } });
    return () => { live = false; };
  }, [vault.id, path, day]);

  const save = useCallback(async (next: JournalEntry) => {
    setSaved('saving');
    pending.current = false;
    const text = writeEntry(next, longDay(day), rawRef.current);
    await api.notes.write(vault.id, path, text);
    rawRef.current = text;
    setSaved('saved');
    onSaved();
  }, [vault.id, path, day, onSaved]);

  const change = (patch: Partial<JournalEntry>, now = false) => {
    if (!e) return;
    const next = { ...e, ...patch };
    setE(next);
    latest.current = next;
    pending.current = true;
    clearTimeout(timer.current);
    if (now) void save(next);
    else timer.current = setTimeout(() => void save(next), 700);
  };
  // Unsaved words are written when the day changes or the page closes.
  useEffect(() => () => { clearTimeout(timer.current); if (pending.current && latest.current) void api.notes.write(vault.id, path, writeEntry(latest.current, longDay(day), rawRef.current)); }, [vault.id, path, day]);

  // Photos already in the entry, as images.
  useEffect(() => {
    if (!e) return;
    for (const p of e.photos) if (!urls[p]) void api.notes.fileUrl(vault.id, p).then((u) => setUrls((x) => ({ ...x, [p]: u })));
  }, [e, vault.id, urls]);

  // Photos from this day in the library (nothing is added until chosen).
  useEffect(() => {
    if (!js.photos) { setIdeas([]); return; }
    let live = true;
    void api.library.list({ kind: 'image', sort: 'date', desc: true, limit: 3000 }).then(async (files) => {
      const hits = files.filter((f) => !f.screenshot && keyOf(new Date(f.btime || f.mtime)) === day && isPhoto(f.name)).slice(0, 12);
      if (!live) return;
      setIdeas(hits);
      for (const f of hits) void api.files.thumbnail(f.path, 160).then((t) => { if (t && live) setThumbs((x) => ({ ...x, [f.path]: t })); });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [day, js.photos]);

  if (!e) return <section className="card jr-entry" />;

  const addPhotos = async (paths?: string[]) => {
    try {
      const added = await api.journal.addPhotos(vault.id, path, paths);
      if (added.length) change({ photos: [...e.photos, ...added] }, true);
    } catch (err) { toast(err instanceof Error ? err.message : String(err)); }
  };
  const addWeather = async () => {
    const w = await api.weather.get().catch(() => null);
    if (!w) { toast('No weather yet: add a place in Weather first.'); return; }
    change({ weather: describeCode(w.current.code).label, temperature: `${Math.round(w.current.temp)} °${w.units === 'imperial' ? 'F' : 'C'}` }, true);
  };
  const addPlace = async () => {
    const start = asDate(day); start.setHours(0, 0, 0, 0);
    const t = await api.tracks.timeline(start.getTime(), start.getTime() + 86_400_000).catch(() => null);
    const places = t?.days.flatMap((d) => d.places) ?? [];
    if (!places.length) { toast('Places & Tracks has nothing for this day.'); return; }
    change({ place: [...new Set(places)].slice(0, 3).join(', ') }, true);
  };
  const isToday = day === today;
  const unused = ideas.filter((f) => !e.photos.some((p) => (p.split('/').pop() ?? '') === f.name));

  return (
    <section className="card jr-entry" aria-labelledby="jr-day-title" data-testid="jr-entry">
      <header className="jr-entry-head">
        <h2 id="jr-day-title">{longDay(day)}</h2>
        <span className="muted small" role="status">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : ''}</span>
      </header>
      <div className="jr-moods" role="radiogroup" aria-label="Mood">
        {MOODS.map((m) => (
          <button key={m.id} role="radio" aria-checked={e.mood === m.id} className={`jr-mood m-${m.id}${e.mood === m.id ? ' on' : ''}`} data-testid={`jr-mood-${m.id}`} onClick={() => change({ mood: e.mood === m.id ? undefined : m.id }, true)}>
            <span className="jr-mood-dot" aria-hidden /> {m.label}
          </button>
        ))}
      </div>
      <div className="jr-context">
        {e.weather ? <span className="chip" data-testid="jr-weather"><Icon name="sun" size={12} /> {e.temperature ? `${e.temperature} · ` : ''}{e.weather}<button aria-label="Remove the weather" onClick={() => change({ weather: undefined, temperature: undefined }, true)}><Icon name="close" size={11} /></button></span>
          : js.weather && weatherOn && isToday ? <button className="btn sm ghost" data-testid="jr-add-weather" onClick={() => void addWeather()}><Icon name="sun" size={13} /> Add the weather</button> : null}
        {e.place ? <span className="chip" data-testid="jr-place"><Icon name="map" size={12} /> {e.place}<button aria-label="Remove the place" onClick={() => change({ place: undefined }, true)}><Icon name="close" size={11} /></button></span>
          : js.place && tracksOn ? <button className="btn sm ghost" onClick={() => void addPlace()}><Icon name="map" size={13} /> Add where I was</button> : null}
      </div>
      {e.photos.length ? (
        <div className="jr-photos" data-testid="jr-photos">
          {e.photos.map((p) => (
            <figure key={p} className="jr-photo">
              {urls[p] ? <img src={urls[p]} alt={p.split('/').pop()} /> : null}
              <button className="jr-photo-x" aria-label={`Take ${p.split('/').pop()} out of this entry`} onClick={() => change({ photos: e.photos.filter((x) => x !== p) }, true)}><Icon name="close" size={11} /></button>
            </figure>
          ))}
        </div>
      ) : null}
      <textarea className="jr-text" value={e.body} placeholder={isToday ? 'How was today?' : 'What happened that day?'} aria-label="Entry" data-testid="jr-text" onChange={(ev) => change({ body: ev.target.value })} />
      <div className="jr-foot">
        <button className="btn sm" onClick={() => void addPhotos()}><Icon name="image" size={13} /> Add photos</button>
        {unused.length ? (
          <div className="jr-ideas" aria-label="Photos from this day" data-testid="jr-ideas">
            <span className="muted small">From this day:</span>
            {unused.map((f) => <button key={f.path} className="jr-idea" aria-label={`Add ${f.name}`} title={f.name} onClick={() => void addPhotos([f.path])}>{thumbs[f.path] ? <img src={thumbs[f.path]} alt="" /> : <Icon name="image" size={14} />}</button>)}
          </div>
        ) : null}
      </div>
    </section>
  );
}
