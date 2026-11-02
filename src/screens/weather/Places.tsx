// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Saved places as small cards (drag, or Alt+arrow keys, to reorder) and the
// "Add a place" search with suggestions from Open-Meteo's place search.

import { useEffect, useId, useRef, useState } from 'react';
import type { Place, Weather } from '../../../core/weather';
import { localTimeIfDifferent } from '../../../core/weather-view';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { WxGlyph } from './WxGlyph';

export const placeKey = (p: Place) => `${p.lat},${p.lon}`;

export function PlaceCards({ places, sel, onSelect, onRemove, onMove, weather, now = Date.now() }: {
  places: Place[];
  sel: number;
  onSelect: (i: number) => void;
  onRemove: (i: number) => void;
  onMove: (from: number, to: number) => void;
  weather: Record<string, Weather | undefined>;
  now?: number;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return (
    <ul className="wx-pcards" aria-label="Saved places">
      {places.map((p, i) => {
        const w = weather[placeKey(p)];
        const local = localTimeIfDifferent(w?.tz, now);
        const name = p.name.split(',')[0];
        return (
          <li key={placeKey(p)} className={`wx-pcard ${i === sel ? 'on' : ''} ${drag === i ? 'dragging' : ''} ${over === i && drag !== null && drag !== i ? 'over' : ''}`}
            draggable={places.length > 1}
            onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
            onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOver(i); } }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) onMove(drag, i); setDrag(null); setOver(null); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}>
            <button className="wx-pcard-main" aria-pressed={i === sel} onClick={() => onSelect(i)}
              title={places.length > 1 ? `${p.name}. Drag to reorder, or Alt+arrow keys.` : p.name}
              onKeyDown={(e) => {
                if (!e.altKey) return;
                if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); onMove(i, i - 1); }
                if (e.key === 'ArrowRight' && i < places.length - 1) { e.preventDefault(); onMove(i, i + 1); }
              }}
              aria-label={`${p.name}${w ? `, ${Math.round(w.current.temp)}°` : ''}${local ? `, local time ${local}` : ''}${i === 0 ? ', shown in the Island' : ''}`}>
              <span className="wx-pcard-name">{name}</span>
              <span className="wx-pcard-bottom">
                {w ? <WxGlyph code={w.current.code} isDay={w.current.isDay} size={22} label={false} /> : null}
                <span className="wx-pcard-temp num">{w ? `${Math.round(w.current.temp)}°` : '—'}</span>
                {local ? <span className="wx-pcard-time num">{local}</span> : null}
              </span>
            </button>
            <button className="wx-pcard-x" title={`Remove ${name}`} aria-label={`Remove ${p.name}`} onClick={() => onRemove(i)}><Icon name="close" size={10} /></button>
          </li>
        );
      })}
    </ul>
  );
}

export function PlaceSearch({ onPick, placeholder }: { onPick: (p: Place) => void; placeholder: string }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const list = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setFound([]); setSearching(false); return; }
    setSearching(true);
    let live = true;
    const h = setTimeout(() => void api.weather.search(term).then((r) => { if (live) { setFound(r); setActive(0); setOpen(true); } }).catch(() => live && setFound([])).finally(() => live && setSearching(false)), 300);
    return () => { live = false; clearTimeout(h); };
  }, [q]);
  const pick = (p: Place) => { onPick(p); setQ(''); setFound([]); setOpen(false); };
  const shown = open && q.trim().length >= 2;
  return (
    <div className="wx-search">
      <Icon name="search" size={15} />
      <input ref={input} className="wx-search-input" value={q} placeholder={placeholder}
        role="combobox" aria-expanded={shown && found.length > 0} aria-controls={shown ? list : undefined} aria-autocomplete="list" aria-label={placeholder}
        aria-activedescendant={shown && found[active] ? `${list}-${active}` : undefined}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(found.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && found[active]) { e.preventDefault(); pick(found[active]); }
          else if (e.key === 'Escape') { setQ(''); setOpen(false); }
        }} />
      {searching ? <span className="spinner sm" aria-hidden /> : null}
      {shown ? (
        <ul id={list} role="listbox" className="wx-suggest" aria-label="Places found">
          {found.length ? found.map((p, i) => (
            <li key={placeKey(p)} id={`${list}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setActive(i)}>
              <Icon name="map" size={13} /><span className="grow">{p.name}</span><span className="muted small">{p.country}</span>
            </li>
          )) : !searching ? <li className="wx-suggest-none" role="option" aria-selected={false} aria-disabled>No places found for “{q.trim()}”</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
