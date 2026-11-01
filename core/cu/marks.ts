// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Numbered marks over the things an AI can act on — links, buttons, fields,
// menus — taken from a web page's DOM or an app's accessibility tree. The AI
// reads a short list ("[12] button "Place order"") and acts by number instead
// of guessing pixels; the same numbers can be drawn over a screenshot.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Mark {
  ref: number;
  role: string;
  name: string;
  /** current value of a field, checked state, selected option */
  value?: string;
  box: Box;
  /** an input that holds a password: Keeper fills it, never the AI */
  secret?: boolean;
  disabled?: boolean;
  /** where it points (links) */
  href?: string;
  /** the page's own number for it (data-keeper-ref), to find it again */
  key?: number;
}

/** What the page script returns for each element (see BROWSER_SNAPSHOT_SCRIPT). */
export interface RawElement {
  key?: number;
  role: string;
  name: string;
  value?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type?: string;
  disabled?: boolean;
  href?: string;
}

const clean = (s: string, max = 80) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** Turns raw elements into numbered marks: visible, de-duplicated, in reading order. */
export function marksFrom(raw: RawElement[], viewport: { width: number; height: number }): Mark[] {
  const seen = new Set<string>();
  const out: Mark[] = [];
  const visible = raw.filter((e) => e.w >= 2 && e.h >= 2 && e.x + e.w > 0 && e.y + e.h > 0 && e.x < viewport.width && e.y < viewport.height);
  // Reading order: rows of 12 px, then left to right.
  visible.sort((a, b) => Math.round(a.y / 12) - Math.round(b.y / 12) || a.x - b.x);
  for (const e of visible) {
    const key = `${e.role}|${clean(e.name)}|${Math.round(e.x / 4)}|${Math.round(e.y / 4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ref: out.length + 1,
      role: e.role,
      name: clean(e.name),
      value: e.type === 'password' ? undefined : e.value === undefined ? undefined : clean(e.value, 60),
      box: { x: Math.round(e.x), y: Math.round(e.y), width: Math.round(e.w), height: Math.round(e.h) },
      secret: e.type === 'password' || undefined,
      disabled: e.disabled || undefined,
      href: e.href ? clean(e.href, 120) : undefined,
      key: e.key,
    });
  }
  return out;
}

/** Desktop apps: marks from an accessibility tree (the shape computer-os returns). */
export interface AxNode {
  id?: string;
  role?: string;
  name?: string;
  value?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: AxNode[];
}

const ACTIONABLE = /button|link|text ?field|text ?area|edit|combo|check|radio|menu ?item|tab|slider|switch|list ?item|cell|search|input|entry|push|toggle/i;

export function marksFromAx(root: AxNode | undefined, viewport: { width: number; height: number }): { marks: Mark[]; ids: Map<number, string> } {
  const raw: (RawElement & { id?: string })[] = [];
  const walk = (n: AxNode | undefined, depth: number) => {
    if (!n || depth > 40) return;
    if (n.role && ACTIONABLE.test(n.role) && n.width && n.height) raw.push({ role: n.role.toLowerCase(), name: n.name ?? '', value: n.value, x: n.x ?? 0, y: n.y ?? 0, w: n.width, h: n.height, id: n.id });
    for (const c of n.children ?? []) walk(c, depth + 1);
  };
  walk(root, 0);
  const marks = marksFrom(raw, viewport);
  // Map refs back to the accessibility ids for clicking by element.
  const ids = new Map<number, string>();
  for (const m of marks) {
    const r = raw.find((e) => Math.round(e.x) === m.box.x && Math.round(e.y) === m.box.y && e.role === m.role);
    if (r?.id) ids.set(m.ref, r.id);
  }
  return { marks, ids };
}

/** Accessibility boxes come in screen points; marks are in screenshot pixels. */
export function axInShot(root: AxNode | undefined, map: (x: number, y: number) => { x: number; y: number }): AxNode | undefined {
  if (!root) return undefined;
  const conv = (n: AxNode): AxNode => {
    let box = {};
    if (n.x !== undefined && n.y !== undefined && n.width !== undefined && n.height !== undefined) {
      const a = map(n.x, n.y);
      const b = map(n.x + n.width, n.y + n.height);
      box = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
    }
    return { ...n, ...box, children: n.children?.map(conv) };
  };
  return conv(root);
}

/** A line of text read off the screen (system text recognition or Tesseract), in screenshot pixels. */
export interface OcrLine {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0–100 */
  confidence?: number;
}

/**
 * When an app tells the accessibility layer nothing (games, remote screens,
 * custom-drawn apps), the words on screen become the marks: each readable
 * line is something to click by number.
 */
export function marksFromOcr(lines: OcrLine[], viewport: { width: number; height: number }): Mark[] {
  const raw: RawElement[] = lines
    .filter((l) => (l.confidence ?? 100) >= 45 && /[\p{L}\p{N}]{2,}/u.test(l.text))
    .map((l) => ({ role: 'text', name: l.text, x: l.x0, y: l.y0, w: l.x1 - l.x0, h: l.y1 - l.y0 }));
  return marksFrom(raw, viewport);
}

/** The desktop list: like marksText, with each mark's centre in screenshot pixels for a plain click. */
export function desktopMarksText(marks: Mark[], maxLines = 300): string {
  const lines = marksText(marks, maxLines).split('\n');
  return lines.map((l, i) => (marks[i] && i < maxLines ? `${l} @${centre(marks[i].box).x},${centre(marks[i].box).y}` : l)).join('\n');
}

/** The list the AI reads. Page text is untrusted: it is labelled, never obeyed. */
export function marksText(marks: Mark[], maxLines = 300): string {
  const lines = marks.slice(0, maxLines).map((m) => {
    const bits = [`[${m.ref}]`, m.role, m.name ? JSON.stringify(m.name) : '(no name)'];
    if (m.value !== undefined && m.value !== '') bits.push(`value=${JSON.stringify(m.value)}`);
    if (m.secret) bits.push('(password field: use a saved secret)');
    if (m.disabled) bits.push('(disabled)');
    if (m.href) bits.push(`→ ${m.href}`);
    return bits.join(' ');
  });
  if (marks.length > maxLines) lines.push(`… and ${marks.length - maxLines} more (scroll to see them)`);
  return lines.join('\n');
}

export function centre(b: Box): { x: number; y: number } {
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}

/** A fingerprint of what is on screen, to tell whether an action changed anything. */
export function fingerprint(marks: Mark[], extra = ''): string {
  let h = 2166136261;
  const s = marks.map((m) => `${m.role}:${m.name}:${m.value ?? ''}:${m.disabled ? 1 : 0}`).join('|') + '#' + extra;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

/**
 * Runs inside the page (in an isolated world, so page scripts cannot change it):
 * every element a person could act on, with its role, accessible name and box.
 */
export const BROWSER_SNAPSHOT_SCRIPT = `(() => {
  const SEL = 'a[href],button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=combobox],[role=textbox],[contenteditable=""],[contenteditable=true],summary';
  const roleOf = (el) => el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button', LABEL: 'label' })[el.tagName] ||
    (el.tagName === 'INPUT' ? ({ checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', reset: 'button', file: 'file', range: 'slider' })[el.type] || 'textbox' : 'textbox');
  const nameOf = (el) => {
    const l = el.getAttribute('aria-label'); if (l) return l;
    const by = el.getAttribute('aria-labelledby'); if (by) { const t = by.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim(); if (t) return t; }
    if (el.id) { const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (lab) return lab.textContent || ''; }
    const p = el.closest('label'); if (p && p !== el) return p.textContent || '';
    return el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || (el.tagName === 'INPUT' && /submit|button/.test(el.type) ? el.value : '') || el.textContent || el.getAttribute('name') || '';
  };
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
    el.setAttribute('data-keeper-ref', String(++i));
    out.push({ key: i, role: roleOf(el), name: nameOf(el), value: 'value' in el && el.tagName !== 'BUTTON' ? (el.type === 'checkbox' || el.type === 'radio' ? String(el.checked) : String(el.value ?? '')) : undefined,
      x: r.left, y: r.top, w: r.width, h: r.height, type: el.type, disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', href: el.tagName === 'A' ? el.href : undefined });
  }
  return { url: location.href, title: document.title, width: innerWidth, height: innerHeight, elements: out };
})()`;
