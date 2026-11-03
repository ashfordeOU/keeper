// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notes' pictures for first runs and empty pages, drawn in the theme's own colours.

/** Three note cards, one with a link to another, in the theme's own colours. */
export function NotesArt({ kind = 'notes' }: { kind?: 'notes' | 'import' }) {
  return (
    <svg className="nt-art" viewBox="0 0 220 104" role="img" aria-label={kind === 'import' ? 'Notes from other apps arriving as files' : 'Notes linked to each other'}>
      <rect x="18" y="22" width="70" height="68" rx="12" className="art-card back" />
      <rect x="132" y="14" width="70" height="68" rx="12" className="art-card back" />
      <path d="M78 58 C 100 40, 116 40, 142 46" className="art-link" />
      <rect x="70" y="8" width="80" height="88" rx="14" className="art-card" />
      <rect x="84" y="24" width="44" height="8" rx="4" className="art-line strong" />
      <rect x="84" y="40" width="52" height="6" rx="3" className="art-line" />
      <rect x="84" y="52" width="38" height="6" rx="3" className="art-line accent" />
      <rect x="84" y="64" width="48" height="6" rx="3" className="art-line" />
      {kind === 'import' ? <path d="M110 74 v12 M104 81 l6 6 l6 -6" className="art-arrow" /> : <circle cx="128" cy="80" r="5" className="art-dot" />}
    </svg>
  );
}
