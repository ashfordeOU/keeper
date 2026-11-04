// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The "?" on every page: a side sheet with what the page is (one line), three
// things you can do there, and the page's own guide, rendered from the docs
// bundled with Keeper, so it works with no internet. Links to other guides open
// in the sheet; web links open in the browser. F1 opens and closes it.

import { marked } from 'marked';
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { cleanDoc, helpFor } from '../../core/help';
import { api } from '../api';
import { sanitize } from '../preview/util';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Modal } from './ui';
import '../styles/attention.css';

// Each guide is its own small chunk, loaded the first time it is opened. Notes for Keeper's makers are left out.
const DOCS = import.meta.glob([
  '../../docs/*.md',
  '!../../docs/ARCHITECTURE.md', '!../../docs/BETA*.md', '!../../docs/MAS-EDITION.md', '!../../docs/SECURITY-REVIEW.md', '!../../docs/TERMINAL-RESEARCH.md',
  '!../../docs/WEBSITE.md', '!../../docs/ROADMAP-DEVICES.md', '!../../docs/STORES.md', '!../../docs/PLATFORM-TESTING.md', '!../../docs/MAC-TESTING.md',
], { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const docLoader = (name: string) => DOCS[`../../docs/${name}`];

/** Opens the help sheet for the page that is showing (the palette, the Help menu). */
export function openHelp() {
  window.dispatchEvent(new CustomEvent('keeper-help'));
}

/** The "?" in the top bar, and the sheet it opens. */
export function HelpButton() {
  const { settings } = useStore();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    const key = (e: KeyboardEvent) => { if (e.key === 'F1') { e.preventDefault(); toggle(); } };
    window.addEventListener('keeper-help', toggle);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keeper-help', toggle); window.removeEventListener('keydown', key); };
  }, []);
  const shown = settings?.helpButton !== false;
  return (
    <>
      {shown ? <button className="btn ghost icon" data-testid="help-button" title="Help for this page (F1)" aria-label="Help for this page" aria-haspopup="dialog" onClick={() => setOpen(true)}><Icon name="help" size={16} /></button> : null}
      {open ? <HelpSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function HelpSheet({ onClose }: { onClose: () => void }) {
  const { route } = useStore();
  const h = useMemo(() => helpFor(route), [route]);
  // Another guide followed from a link inside this one.
  const [doc, setDoc] = useState(h.doc);
  const [md, setMd] = useState<string | null>(null);
  useEffect(() => setDoc(h.doc), [h.doc]);
  useEffect(() => {
    let alive = true;
    setMd(null);
    const load = docLoader(doc);
    if (!load) { setMd(''); return; }
    void load().then((t) => alive && setMd(t)).catch(() => alive && setMd(''));
    return () => { alive = false; };
  }, [doc]);
  const html = useMemo(() => (md ? sanitize(marked.parse(cleanDoc(md), { async: false, gfm: true }) as string).html : ''), [md]);
  const onLink = (e: ReactMouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href) return;
    e.preventDefault();
    const file = href.split('#')[0].split('/').pop() ?? '';
    if (/^[A-Z0-9-]+\.md$/i.test(file) && docLoader(file)) setDoc(file);
    else if (/^https?:/i.test(href)) void api.system.openExternal(href);
  };
  const other = doc !== h.doc;
  return (
    <Modal sheet label={`Help: ${h.title}`} onClose={onClose} testId="help-sheet">
      <div className="help-head">
        <div className="help-kicker small muted">Help</div>
        <button aria-label="Close" title="Close" className="btn ghost sm icon" onClick={onClose}><Icon name="close" size={14} /></button>
      </div>
      <h2 className="help-title" data-testid="help-title">{h.title}</h2>
      <p className="help-what" data-testid="help-what">{h.what}</p>
      <h3 className="help-sub">Here you can</h3>
      <ul className="help-can" data-testid="help-can">{h.can.map((c) => <li key={c}><Icon name="check" size={13} /> {c}</li>)}</ul>
      <div className="help-docbar">
        <h3 className="help-sub">{other ? doc.replace(/\.md$/, '').replace(/-/g, ' ').toLowerCase().replace(/^\w/, (x) => x.toUpperCase()) : 'The guide'}</h3>
        {other ? <button className="btn sm ghost" data-testid="help-back" onClick={() => setDoc(h.doc)}><Icon name="chevronLeft" size={12} /> Back</button> : null}
        <span className="grow" />
        <span className="small muted">On this computer · Works offline</span>
      </div>
      <article className="help-doc pv-markdown" data-testid="help-doc" onClick={onLink} dangerouslySetInnerHTML={{ __html: md === null ? '' : html || '<p>This guide is not included in this copy of Keeper.</p>' }} />
    </Modal>
  );
}
