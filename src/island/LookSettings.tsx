// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Island → Look: the Island's colours (Match theme, Dark, Colourful), how strong they are, the
// gradient and an accent, with a live preview drawn from the same palette the Island uses (src/island/look.ts).

import { useState } from 'react';
import type { IslandSettings as IS } from '../../core/api';
import { ISLAND_INTENSITIES, ISLAND_LOOKS, ISLAND_PRESETS, cleanLook, islandVars, readableTint, surfaceSamples } from '../../core/island-look';
import { Icon } from '../components/Icon';
import { useStore } from '../state';
import { Row } from '../screens/IslandSettings';
import { useIslandPalette } from './look';
import '../styles/island-look.css';

/** Accents to pick from (the theme's own comes first). */
const ACCENTS: [string, string][] = [
  ['#ff375f', 'Pink'], ['#ff9f0a', 'Orange'], ['#ffd60a', 'Yellow'], ['#30d158', 'Green'], ['#40c8e0', 'Teal'], ['#0a84ff', 'Blue'], ['#bf5af2', 'Purple'],
];

/** What the preview can show going on, and its colour (as the Island would be tinted). */
const SAMPLES: { id: string; label: string; color?: string; icon: string; title: string; trail: string }[] = [
  { id: 'none', label: 'Nothing', icon: 'clock', title: 'All quiet', trail: '' },
  { id: 'music', label: 'Music', color: '#ff375f', icon: 'audio', title: 'Now playing', trail: '2:14' },
  { id: 'meeting', label: 'Meeting', color: '#5e5ce6', icon: 'calendar', title: 'Design review', trail: 'in 5 min' },
  { id: 'timer', label: 'Timer', color: '#ff9f0a', icon: 'timer', title: 'Focus', trail: '24:12' },
  { id: 'charging', label: 'Charging', color: '#30d158', icon: 'bolt', title: 'Charging', trail: '84%' },
];

/** The Island in these colours: the closed pill, and the open Island with a title, its lines and two buttons. */
export function IslandLookPreview({ isl, line }: { isl: Partial<IS>; line?: string }) {
  const { settings } = useStore();
  const [sample, setSample] = useState('none');
  const s = SAMPLES.find((x) => x.id === sample) ?? SAMPLES[0];
  const palette = useIslandPalette(settings, isl, isl.monochrome ? undefined : s.color);
  const vars = { ...islandVars(palette), colorScheme: palette.scheme } as React.CSSProperties;
  // What is going on keeps its colour, made readable on the Island (as the Island itself does).
  const glyph = s.color ? { color: readableTint(s.color, surfaceSamples(palette)) } : undefined;
  return (
    <div className="ilp-wrap" data-testid="island-look-preview" data-scheme={palette.scheme}>
      <div className={`ilp ${isl.monochrome ? 'mono' : ''}`} style={vars} role="img" aria-label={`Preview of the Island: ${ISLAND_LOOKS.find((l) => l.id === cleanLook(isl).look)?.label}${s.color ? `, while showing ${s.label.toLowerCase()}` : ''}`}>
        <div className="ilp-pill" aria-hidden>
          <span className="ilp-glyph" style={glyph}><Icon name={s.icon} size={13} /></span>
          <span className="ilp-line">{s.id === 'none' ? line || s.title : s.title}</span>
          {s.trail ? <b className="ilp-trail" style={glyph}>{s.trail}</b> : null}
        </div>
        <div className="ilp-panel" aria-hidden>
          <div className="ilp-tabs"><span className="on">Home</span><span>Shelf</span><span>Week</span></div>
          <div className="ilp-body">
            <div className="ilp-kicker">Next up</div>
            <div className="ilp-title">Design review</div>
            <div className="ilp-sub">Room 4 · with Sam and Alex</div>
            <div className="ilp-actions"><span className="ilp-btn primary">Join</span><span className="ilp-btn">Snooze</span></div>
          </div>
        </div>
      </div>
      <div className="seg ilp-samples" role="radiogroup" aria-label="Show the preview with">
        {SAMPLES.map((x) => <button key={x.id} role="radio" aria-checked={sample === x.id} className={sample === x.id ? 'on' : ''} onClick={() => setSample(x.id)}>{x.label}</button>)}
      </div>
    </div>
  );
}

/** The colour, strength, gradient and accent rows. */
export function IslandLookControls({ isl, set }: { isl: Partial<IS>; set: (patch: Partial<IS>) => void }) {
  const look = cleanLook(isl);
  return (
    <>
      <Row id="island-look" title="Colours" desc="Match your theme, stay dark, or use a bright gradient.">
        <div className="seg" role="radiogroup" aria-label="Island colours" data-testid="island-look">
          {ISLAND_LOOKS.map((l) => <button key={l.id} role="radio" aria-checked={look.look === l.id} className={look.look === l.id ? 'on' : ''} onClick={() => set({ look: l.id })}>{l.label}</button>)}
        </div>
      </Row>
      {look.look === 'colorful' ? (
        <Row title="Gradient">
          <div className="ilp-swatches" role="radiogroup" aria-label="Gradient">
            {ISLAND_PRESETS.map((p) => (
              <button key={p.id} role="radio" aria-checked={look.lookPreset === p.id} className={`ilp-swatch wide ${look.lookPreset === p.id ? 'on' : ''}`} title={p.name} aria-label={p.name}
                style={{ background: `linear-gradient(135deg, ${p.stops.join(', ')})` }} onClick={() => set({ lookPreset: p.id })} />
            ))}
          </div>
        </Row>
      ) : null}
      {look.look !== 'dark' ? (
        <Row title="Strength">
          <div className="seg" role="radiogroup" aria-label="Colour strength">
            {ISLAND_INTENSITIES.map((x) => <button key={x.id} role="radio" aria-checked={look.lookIntensity === x.id} className={look.lookIntensity === x.id ? 'on' : ''} onClick={() => set({ lookIntensity: x.id })}>{x.label}</button>)}
          </div>
        </Row>
      ) : null}
      <IslandAccentRow isl={isl} set={set} />
    </>
  );
}

/** The accent: the theme's own, a few colours, or any colour. */
export function IslandAccentRow({ isl, set }: { isl: Partial<IS>; set: (patch: Partial<IS>) => void }) {
  const accent = cleanLook(isl).lookAccent;
  const custom = accent && !ACCENTS.some(([c]) => c === accent);
  return (
    <Row title="Accent" desc="Buttons, highlights and the glow. Text stays easy to read.">
      <div className="ilp-swatches" role="radiogroup" aria-label="Accent">
        <button role="radio" aria-checked={!accent} className={`ilp-swatch theme ${!accent ? 'on' : ''}`} title="The theme’s own" aria-label="The theme’s own" onClick={() => set({ lookAccent: '' })}><Icon name="sparkle" size={12} /></button>
        {ACCENTS.map(([c, name]) => <button key={c} role="radio" aria-checked={accent === c} className={`ilp-swatch ${accent === c ? 'on' : ''}`} title={name} aria-label={name} style={{ background: c }} onClick={() => set({ lookAccent: c })} />)}
        <label className={`ilp-swatch any ${custom ? 'on' : ''}`} title="Any colour">
          <input type="color" aria-label="Any colour" value={accent || '#5b5bf0'} onChange={(e) => set({ lookAccent: e.target.value })} />
        </label>
      </div>
    </Row>
  );
}

/** The accent row on its own, for the Settings search (core/settings-schema.ts panel 'islandAccent'). */
export function IslandAccentPanel() {
  const { settings, updateSettings } = useStore();
  const isl = settings?.island;
  if (!isl) return null;
  return <IslandAccentRow isl={isl} set={(p) => void updateSettings({ island: { ...isl, ...p } })} />;
}
