// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A page's first run and empty state, in Keeper's design language: a small
// kicker, a big tight headline with at most one highlighted word, one line,
// the one useful next action, a quiet second one, and a trust line of short
// dot-separated facts, beside a drawing in Keeper's style. Drawings use only
// the theme's colours, so they work in light and dark.

import type { ReactNode } from 'react';
import '../styles/extras.css';

export function FirstRun({ kicker, title, mark, line, art, action, more, trust, testid }: {
  kicker: string;
  title: string;
  /** one word of the title to highlight */
  mark?: string;
  line: ReactNode;
  art: ReactNode;
  /** the one main button */
  action: ReactNode;
  /** a quiet second action (import, a shortcut) */
  more?: ReactNode;
  /** short facts, joined with dots */
  trust?: string[];
  testid?: string;
}) {
  const at = mark ? title.indexOf(mark) : -1;
  return (
    <section className="fr" data-testid={testid} aria-labelledby={testid ? `${testid}-title` : undefined}>
      <div className="fr-text">
        <div className="fr-kicker">{kicker}</div>
        <h2 className="fr-title" id={testid ? `${testid}-title` : undefined}>
          {at >= 0 ? <>{title.slice(0, at)}<span className="fr-mark">{mark}</span>{title.slice(at + mark!.length)}</> : title}
        </h2>
        <p className="fr-line">{line}</p>
        <div className="fr-actions">{action}{more}</div>
        {trust?.length ? <p className="trust-line">{trust.join(' · ')}</p> : null}
      </div>
      <div className="fr-art" aria-hidden>{art}</div>
    </section>
  );
}

/** A phone with an alert arriving. */
export function PhoneArt() {
  return (
    <svg viewBox="0 0 240 200" className="art">
      <circle cx="120" cy="100" r="86" className="art-halo" />
      <rect x="82" y="26" width="76" height="150" rx="16" className="art-card" />
      <rect x="90" y="42" width="60" height="112" rx="6" className="art-sunk" />
      <rect x="110" y="32" width="20" height="4" rx="2" className="art-line" />
      <g className="art-pop">
        <rect x="40" y="62" width="128" height="40" rx="12" className="art-card art-shadow" />
        <circle cx="60" cy="82" r="10" className="art-accent" />
        <path d="M57 82l2.5 2.5L64 79" className="art-tick" />
        <rect x="76" y="74" width="72" height="6" rx="3" className="art-line strong" />
        <rect x="76" y="86" width="50" height="5" rx="2.5" className="art-line" />
      </g>
      <rect x="98" y="116" width="44" height="6" rx="3" className="art-line" />
      <rect x="98" y="128" width="30" height="6" rx="3" className="art-line" />
      <path d="M176 48a20 20 0 0 1 12 12M182 38a32 32 0 0 1 16 18" className="art-wave" />
    </svg>
  );
}

/** Two servers and a heartbeat line. */
export function PulseArt() {
  return (
    <svg viewBox="0 0 240 200" className="art">
      <circle cx="120" cy="100" r="86" className="art-halo" />
      <rect x="54" y="46" width="132" height="40" rx="10" className="art-card art-shadow" />
      <rect x="54" y="96" width="132" height="40" rx="10" className="art-card art-shadow" />
      <circle cx="72" cy="66" r="5" className="art-ok" />
      <circle cx="72" cy="116" r="5" className="art-ok" />
      <rect x="86" y="62" width="60" height="7" rx="3.5" className="art-line strong" />
      <rect x="86" y="112" width="44" height="7" rx="3.5" className="art-line strong" />
      <path d="M30 160h46l10-22 14 40 12-30 8 12h90" className="art-pulse" />
    </svg>
  );
}

/** A tall web page coming out of a browser frame. */
export function PageArt() {
  return (
    <svg viewBox="0 0 240 200" className="art">
      <circle cx="120" cy="100" r="86" className="art-halo" />
      <rect x="40" y="30" width="160" height="104" rx="12" className="art-card art-shadow" />
      <rect x="40" y="30" width="160" height="18" rx="9" className="art-sunk" />
      <circle cx="52" cy="39" r="3" className="art-line strong" />
      <circle cx="62" cy="39" r="3" className="art-line strong" />
      <rect x="84" y="58" width="102" height="150" rx="8" className="art-card art-shadow art-page" />
      <rect x="94" y="70" width="60" height="8" rx="4" className="art-accent" />
      <rect x="94" y="86" width="80" height="5" rx="2.5" className="art-line" />
      <rect x="94" y="96" width="70" height="5" rx="2.5" className="art-line" />
      <rect x="94" y="110" width="80" height="34" rx="6" className="art-sunk" />
      <rect x="94" y="152" width="74" height="5" rx="2.5" className="art-line" />
      <path d="M58 110v40m-8-8 8 8 8-8" className="art-tick" />
    </svg>
  );
}

/** A photo with a crop frame and a slider. */
export function PhotoArt() {
  return (
    <svg viewBox="0 0 240 200" className="art">
      <circle cx="120" cy="100" r="86" className="art-halo" />
      <rect x="46" y="40" width="148" height="104" rx="12" className="art-card art-shadow" />
      <path d="M58 132l36-38 26 26 18-16 44 28z" className="art-accent" />
      <circle cx="160" cy="66" r="10" className="art-sun" />
      <path d="M38 52V32h20M202 52V32h-20M38 132v20h20M202 132v20h-20" className="art-tick" />
      <rect x="64" y="166" width="112" height="6" rx="3" className="art-line" />
      <circle cx="132" cy="169" r="8" className="art-card art-shadow" />
    </svg>
  );
}
