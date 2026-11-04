// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The pseudo language's pass over the page (src/i18n-strings.ts has pseudo()).

import { pseudo } from './i18n-strings';

/**
 * The pseudo language for testing: every word on screen (not only the translated ones) is
 * shown accented and longer, so words that cannot be translated yet, and words that get cut
 * off, stand out. What people type is left alone.
 */
export function applyPseudo(on: boolean, root: HTMLElement = document.body): () => void {
  if (!on || typeof MutationObserver === 'undefined') return () => undefined;
  const skip = (n: Node) => !!n.parentElement?.closest('input, textarea, [contenteditable="true"], .cm-content, .xterm, script, style, code, pre');
  const pass = (node: Node) => {
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) if (!skip(t) && /\p{L}{2,}/u.test(t.nodeValue ?? '')) { const v = pseudo(t.nodeValue!); if (v !== t.nodeValue) t.nodeValue = v; }
  };
  pass(root);
  const mo = new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) pass(n); });
  mo.observe(root, { childList: true, subtree: true });
  return () => mo.disconnect();
}
