// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Selected text in any app: a shortcut shows a small bar beside the pointer
// with Copy, Search, Translate, Rewrite, Define and Open link. Translating,
// rewriting and defining use the AI the person chose in Keeper (on this
// computer when that is a local or on-device model); nothing is sent until
// they press a button. Pure parts: which actions fit the text, the requests
// and tidying what comes back.

export type SelectionActionId = 'copy' | 'plain' | 'search' | 'translate' | 'rewrite' | 'shorter' | 'define' | 'open' | 'mail';

export interface SelectionSettings {
  /** the shortcut that shows the bar ('' for none) */
  shortcut: string;
  /** translate into this language ('' = the computer's language) */
  language: string;
  /** web search address with {query} */
  searchUrl: string;
  /** actions shown, in order */
  actions: SelectionActionId[];
}

export const SELECTION_ACTIONS: { id: SelectionActionId; label: string; ai?: boolean }[] = [
  { id: 'copy', label: 'Copy' },
  { id: 'plain', label: 'Copy as plain text' },
  { id: 'search', label: 'Search' },
  { id: 'translate', label: 'Translate', ai: true },
  { id: 'rewrite', label: 'Rewrite', ai: true },
  { id: 'shorter', label: 'Shorter', ai: true },
  { id: 'define', label: 'Define', ai: true },
  { id: 'open', label: 'Open link' },
  { id: 'mail', label: 'Write to' },
];

/** What the bar shows for the text selected now. */
export interface SelectionView {
  text: string;
  app?: string;
  actions: SelectionActionId[];
  /** the AI that answers, and whether it runs on this computer */
  ai?: { label: string; local: boolean };
  language: string;
  /** how the text was read */
  how: 'accessibility' | 'primary' | 'copy' | 'none';
}

export function defaultSelection(): SelectionSettings {
  return { shortcut: 'CommandOrControl+Shift+1', language: '', searchUrl: 'https://duckduckgo.com/?q={query}', actions: ['copy', 'search', 'translate', 'rewrite', 'define', 'open', 'mail'] };
}

export function normalizeSelection(raw: unknown): SelectionSettings {
  const d = defaultSelection();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SelectionSettings>;
  const known = new Set(SELECTION_ACTIONS.map((a) => a.id));
  const actions = Array.isArray(r.actions) ? r.actions.filter((a): a is SelectionActionId => known.has(a as SelectionActionId)) : d.actions;
  return {
    shortcut: typeof r.shortcut === 'string' ? r.shortcut : d.shortcut,
    language: typeof r.language === 'string' ? r.language.slice(0, 60) : '',
    searchUrl: typeof r.searchUrl === 'string' && /^https?:\/\/.*\{query\}/.test(r.searchUrl) ? r.searchUrl : d.searchUrl,
    actions: [...new Set(actions)],
  };
}

/** A web or mail address in the selection, if it is one (leading and trailing punctuation dropped). */
export function linkIn(text: string): string | undefined {
  const t = text.trim().replace(/^[<("'“‘]+|[>)"'”’.,;:!?]+$/g, '');
  if (/\s/.test(t) || t.length > 2000) return undefined;
  if (/^https?:\/\/[^\s]+$/i.test(t)) return t;
  if (/^www\.[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t)) return `https://${t}`;
  return undefined;
}

export function mailIn(text: string): string | undefined {
  const t = text.trim().replace(/^mailto:/i, '').replace(/[.,;:!?]+$/, '');
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(t) ? t : undefined;
}

/** The actions that make sense for this text, from the chosen ones (Open link only for a link, Define for a few words). */
export function actionsFor(text: string, chosen: SelectionActionId[], aiReady: boolean): SelectionActionId[] {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return chosen.filter((a) => {
    if (a === 'open') return !!linkIn(text);
    if (a === 'mail') return !!mailIn(text);
    if (a === 'define') return aiReady && words > 0 && words <= 4;
    if (a === 'translate' || a === 'rewrite' || a === 'shorter') return aiReady && words > 0;
    return words > 0;
  });
}

/** The language name to translate into: the chosen one, or the computer's (en-GB → English). */
export function targetLanguage(chosen: string, locale: string): string {
  if (chosen.trim()) return chosen.trim();
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(locale.split(/[-_]/)[0]);
    if (name) return name;
  } catch { /* old runtime */ }
  return 'English';
}

/** The request for an AI action. */
export function selectionPrompt(action: 'translate' | 'rewrite' | 'shorter' | 'define', text: string, language: string): string {
  const ask =
    action === 'translate' ? `Translate this into ${language}. If it is already in ${language}, translate it into English instead. Keep the meaning, tone, line breaks and any names.`
      : action === 'rewrite' ? 'Rewrite this to read more clearly, keeping its meaning, language and roughly its length.'
        : action === 'shorter' ? 'Make this shorter while keeping everything important. Same language.'
          : `Explain what this means in one to three short sentences in ${language}, like a dictionary entry: the word's kind (noun, verb…) first when it is a single word.`;
  return `${ask}\n\nReply with the result only — no introduction, quotes or notes.\n\n<text>\n${text}\n</text>`;
}

/** Strips what models sometimes add around the answer. */
export function cleanReply(reply: string): string {
  return reply.replace(/^\s*<text>\s*|\s*<\/text>\s*$/g, '').replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1').replace(/^(?:here(?:'s| is) (?:the|a) [^:\n]{0,40}:\s*)/i, '').trim();
}

/** The search address with the text in it. */
export function searchLink(template: string, text: string): string {
  return template.replace(/\{query\}/g, encodeURIComponent(text.trim().slice(0, 500)));
}

/** At most this much selected text is used (a page or two). */
export const SELECTION_MAX = 8000;
