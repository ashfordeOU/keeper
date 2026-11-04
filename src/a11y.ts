// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Accessibility helpers shared by every window: applying the Accessibility
// settings to the page, keeping focus inside dialogs (and putting it back
// afterwards), arrow keys in menus and lists, type-to-select, and a polite
// announcer for screen readers.

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Progress } from '../core/types';
import { api } from './api';
import { reduceMotion, type A11ySettings, type ReadingFont } from '../core/a11y';

// ------------------------------------------------------------------ settings on the page

const systemReduces = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True when animations should be cut short (the setting, or the system's own when following it). */
export function motionReduced(): boolean {
  if (typeof document === 'undefined') return false;
  const m = document.documentElement.dataset.motion;
  return m === 'reduce' || (m !== 'full' && systemReduces());
}

/**
 * Writes the Accessibility settings onto <html>: data-motion (reduce / full),
 * data-focus-always and --ui-scale (the main window's text size). Stylesheets
 * key off these (src/styles/a11y.css), so every window follows along.
 */
export function applyA11y(a: Partial<A11ySettings> | undefined, root: HTMLElement = document.documentElement): () => void {
  installKeyboardHelpers();
  const set = () => {
    root.dataset.motion = reduceMotion(a?.motion, systemReduces()) ? 'reduce' : a?.motion === 'full' ? 'full' : 'system';
  };
  set();
  if (a?.focusAlways) root.dataset.focusAlways = 'true';
  else delete root.dataset.focusAlways;
  const scale = a?.textScale && a.textScale > 1 ? a.textScale : 1;
  if (scale > 1) root.style.setProperty('--ui-scale', String(scale));
  else root.style.removeProperty('--ui-scale');
  // Reflow: larger text wraps to the window (the type scale grows); otherwise the window zooms as a whole.
  root.dataset.scaled = scale > 1 && !a?.reflow ? 'true' : 'false';
  root.dataset.reflow = scale > 1 && a?.reflow ? 'true' : 'false';
  if (a?.lineSpacing) root.style.setProperty('--reading-line', String(a.lineSpacing));
  else root.style.removeProperty('--reading-line');
  if (a?.letterSpacing) root.style.setProperty('--reading-letter', `${a.letterSpacing}em`);
  else root.style.removeProperty('--reading-letter');
  root.dataset.readingSpace = a?.lineSpacing || a?.letterSpacing ? 'true' : 'false';
  root.dataset.bigTargets = a?.bigTargets ? 'true' : 'false';
  void loadReadingFont(a?.readingFont ?? 'theme', root);
  if (typeof matchMedia !== 'function') return () => undefined;
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', set);
  return () => mq.removeEventListener('change', set);
}

// ------------------------------------------------------------------ reading fonts

const loadedFonts = new Set<string>();

/** Loads a reading font once (the main process fetches and checks it), then switches the window to it. */
async function loadReadingFont(id: ReadingFont, root: HTMLElement) {
  if (id === 'theme') { delete root.dataset.readingFont; root.style.removeProperty('--reading-font'); return; }
  try {
    const f = await api.reading?.font(id);
    if (!f) return;
    if (!loadedFonts.has(f.family)) {
      for (const face of f.faces) {
        const bytes = Uint8Array.from(atob(face.data), (c) => c.charCodeAt(0));
        const ff = new FontFace(f.family, bytes, { weight: String(face.weight) });
        await ff.load();
        document.fonts.add(ff);
      }
      loadedFonts.add(f.family);
    }
    root.style.setProperty('--reading-font', `'${f.family}'`);
    root.dataset.readingFont = id;
  } catch (e) {
    console.warn('reading font', e);
    delete root.dataset.readingFont;
  }
}

// ------------------------------------------------------------------ keys everywhere

let installed = false;

/**
 * One listener for the whole window gives every tab strip, radio group,
 * segmented control and pop-up menu arrow keys (Left/Right or Up/Down, Home,
 * End), without each screen wiring it up.
 */
export function installKeyboardHelpers() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  installAutoLabels();
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (!t?.closest || t.matches('input, textarea, select, [contenteditable="true"]')) return;
    const tabs = t.closest<HTMLElement>('[role="tablist"]');
    if (tabs && t.matches('[role="tab"]')) {
      if (arrowNav(e, tabs, '[role="tab"]', tabs.getAttribute('aria-orientation') === 'vertical' ? 'vertical' : 'both')) (document.activeElement as HTMLElement | null)?.click();
      return;
    }
    const radios = t.closest<HTMLElement>('[role="radiogroup"]');
    if (radios && t.matches('[role="radio"]')) {
      if (arrowNav(e, radios, '[role="radio"]', 'both')) (document.activeElement as HTMLElement | null)?.click();
      return;
    }
    const seg = t.closest<HTMLElement>('.seg');
    if (seg && t.tagName === 'BUTTON' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      arrowNav(e, seg, ':scope > button', 'horizontal');
      return;
    }
    // Tables: Up and Down move to the same control in the row above or below (or to the row itself).
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const row = t.closest<HTMLElement>('[role="row"], tr');
      const table = row?.closest<HTMLElement>('[role="table"], [role="grid"], table');
      if (row && table && !table.matches('.file-list')) {
        const rows = [...table.querySelectorAll<HTMLElement>('[role="row"], tr')].filter((r) => r.closest('[role="table"], [role="grid"], table') === table && !r.closest('thead'));
        const next = rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) {
          const here = focusables(row);
          const there = focusables(next);
          const target = there[Math.max(0, Math.min(there.length - 1, here.indexOf(t)))] ?? next;
          if (target === next && !next.hasAttribute('tabindex')) next.tabIndex = -1;
          e.preventDefault();
          target.focus();
        }
        return;
      }
    }
    const menu = t.closest<HTMLElement>('.menu, [role="menu"], [role="listbox"]:not(.file-grid)');
    if (menu) {
      const sel = menu.matches('[role="listbox"]') ? '[role="option"]' : 'button, [role="menuitem"]';
      arrowNav(e, menu, sel, 'vertical');
    }
  });
}

// ------------------------------------------------------------------ names from context

const UNNAMED = 'input:not([type="hidden"]):not([aria-label]):not([aria-labelledby]):not([placeholder]), select:not([aria-label]):not([aria-labelledby]), textarea:not([aria-label]):not([aria-labelledby]):not([placeholder]), [role="switch"]:not([aria-label]):not([aria-labelledby]), [role="checkbox"]:not([aria-label]):not([aria-labelledby]), [role="slider"]:not([aria-label]):not([aria-labelledby])';

const clean = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();

/** Short text that says what a control is for: its settings row's title, the text just before it, or its row's first words. */
export function labelFromContext(el: HTMLElement): string {
  const setting = el.closest('.setting');
  const title = setting?.querySelector('.txt > :first-child');
  if (title && !title.contains(el)) return clean(title.textContent);
  for (let p: Element | null = el.previousElementSibling; p; p = p.previousElementSibling) {
    const t = clean(p.textContent);
    if (t && t.length <= 60 && !p.matches('input, select, textarea, button')) return t;
    if (t) break;
  }
  // The nearest row, list item or card with some words in it (rows are often nested).
  for (let row = el.parentElement?.closest('label, .row, .set-row, .toggle-row, li, tr, .card, .field, fieldset'); row; row = row.parentElement?.closest('label, .row, .set-row, .toggle-row, li, tr, .card, .field, fieldset')) {
    const leaf = [...row.querySelectorAll<HTMLElement>('b, strong, h3, h4, .title, .name, .label, span, div')].find((x) => !x.contains(el) && x.children.length === 0 && clean(x.textContent).length > 1);
    if (leaf) return clean(leaf.textContent).slice(0, 80);
  }
  return clean(el.getAttribute('title'));
}

/** True when the control already has a name from a <label>. */
function labelled(el: HTMLElement): boolean {
  if (el.closest('label')) return !!clean(el.closest('label')!.textContent);
  return !!(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
}

let labelTimer = 0;
/** Gives every form control without a name one from its context (a safety net; named controls keep their own). */
export function labelUnnamed(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>(UNNAMED)) {
    if (labelled(el) || (el.matches('[role="switch"], [role="checkbox"], [role="slider"]') && clean(el.textContent))) continue;
    const name = labelFromContext(el);
    if (name) el.setAttribute('aria-label', name);
  }
}

function installAutoLabels() {
  if (typeof MutationObserver === 'undefined') return;
  const run = () => { labelTimer = 0; labelUnnamed(); };
  // Only added and removed elements count (not text changes), and passes are spaced out.
  new MutationObserver(() => { if (!labelTimer) labelTimer = window.setTimeout(run, 400); }).observe(document.body, { childList: true, subtree: true });
  run();
}

// ------------------------------------------------------------------ focus

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusables(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.hasAttribute('inert') && (x.offsetWidth > 0 || x.offsetHeight > 0 || x === document.activeElement));
}

/**
 * Keeps Tab and Shift+Tab inside a dialog while it is open, moves focus into
 * it (unless something inside already asked for focus) and gives focus back
 * to whatever had it when the dialog closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true) {
  // What had focus just before the dialog opened (read while rendering, before autoFocus moves it).
  const before = useRef<HTMLElement | null>(null);
  const was = useRef(false);
  if (active && !was.current && typeof document !== 'undefined') before.current = document.activeElement as HTMLElement | null;
  was.current = active;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const back = before.current;
    // Let autoFocus inside win; otherwise the first control, or the dialog itself.
    const t = setTimeout(() => {
      if (el.contains(document.activeElement)) return;
      const first = focusables(el).find((x) => !x.classList.contains('modal-close'));
      (first ?? el).focus({ preventScroll: true });
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = focusables(el);
      if (!list.length) { e.preventDefault(); el.focus(); return; }
      const first = list[0];
      const last = list[list.length - 1];
      const cur = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (cur === first || !el.contains(cur))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || !el.contains(cur))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      // Give focus back, if it is still somewhere sensible.
      if (back && back.isConnected && back !== document.body && typeof back.focus === 'function') back.focus({ preventScroll: true });
    };
  }, [ref, active]);
}

/**
 * Up/Down (and Left/Right for horizontal groups), Home and End move focus
 * between the items matching `selector` inside the element.
 */
export function arrowNav(e: React.KeyboardEvent | KeyboardEvent, container: HTMLElement, selector: string, orientation: 'vertical' | 'horizontal' | 'both' = 'vertical'): boolean {
  const items = [...container.querySelectorAll<HTMLElement>(selector)].filter((x) => !(x as HTMLButtonElement).disabled && x.getAttribute('aria-disabled') !== 'true');
  if (!items.length) return false;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = orientation !== 'horizontal' && e.key === 'ArrowDown' || orientation !== 'vertical' && e.key === 'ArrowRight' ? 1
    : orientation !== 'horizontal' && e.key === 'ArrowUp' || orientation !== 'vertical' && e.key === 'ArrowLeft' ? -1 : 0;
  let to = -1;
  if (next) to = i < 0 ? (next > 0 ? 0 : items.length - 1) : (i + next + items.length) % items.length;
  else if (e.key === 'Home') to = 0;
  else if (e.key === 'End') to = items.length - 1;
  if (to < 0) return false;
  e.preventDefault();
  items[to].focus();
  return true;
}

// ------------------------------------------------------------------ type-to-select

/**
 * Typing letters finds the next item whose name starts with them (as in a
 * file manager); the typed text resets after a short pause.
 */
export function useTypeahead(timeout = 700) {
  const buf = useRef('');
  const at = useRef(0);
  return (key: string, names: string[], from: number): number => {
    const now = Date.now();
    buf.current = now - at.current > timeout ? key : buf.current + key;
    at.current = now;
    const q = buf.current.toLocaleLowerCase();
    // One letter pressed again moves on to the next match; more letters refine the current one.
    const start = q.length === 1 ? from + 1 : Math.max(0, from);
    for (let k = 0; k < names.length; k++) {
      const i = (start + k) % names.length;
      if (names[i].toLocaleLowerCase().startsWith(q)) return i;
    }
    return -1;
  };
}

/** A key press that should type-select: one printable character, no modifiers. */
export function isTypeKey(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return e.key.length === 1 && e.key !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey;
}

// ------------------------------------------------------------------ announcements

let region: HTMLElement | null = null;

/** Says something to screen readers without moving focus (a polite live region). */
export function announce(text: string, politeness: 'polite' | 'assertive' = 'polite') {
  if (typeof document === 'undefined') return;
  if (!region || !region.isConnected) {
    region = document.createElement('div');
    region.className = 'sr-only';
    region.setAttribute('aria-live', politeness);
    region.setAttribute('role', 'status');
    document.body.appendChild(region);
  }
  region.setAttribute('aria-live', politeness);
  region.textContent = '';
  // A fresh text node after a tick so the same message twice is still read.
  setTimeout(() => { if (region) region.textContent = text; }, 30);
}


// ------------------------------------------------------------------ long jobs

const JOB_NAMES: Record<string, string> = { convert: 'Converting', cleanup: 'Cleaning up', duplicates: 'Looking for duplicates', space: 'Measuring folders', trash: 'Moving to the Trash', compress: 'Compressing' };

/** Tells screen readers when a long job (convert, clean up, duplicates…) starts and finishes. */
export function useProgressAnnouncer() {
  useEffect(() => {
    const running = new Set<string>();
    return api.on('progress', (p: Progress) => {
      if (p.task === 'index') return;
      const name = JOB_NAMES[p.task] ?? p.task.charAt(0).toUpperCase() + p.task.slice(1);
      const done = p.phase === 'Done' || (p.total > 0 && p.done >= p.total);
      if (!done && !running.has(p.task)) { running.add(p.task); announce(`${name}…`); }
      else if (done && running.has(p.task)) { running.delete(p.task); announce(`${name}: done`); }
    });
  }, []);
}
