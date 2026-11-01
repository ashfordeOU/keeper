// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The right-click menu in Keeper's text fields: spelling suggestions, cut,
// copy, paste, and writing help from whichever AI the person set up
// (Claude, OpenAI, a local model, or Apple's on-device model where there is
// one): proofread, rewrite, friendlier, more professional, shorter, summarize.
// macOS's own Writing Tools appear in native text fields; Electron apps get
// none, so Keeper brings its own. The selection is replaced in place.

import { app, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron';
import { featureOn } from './features';

export type WritingKind = 'proofread' | 'rewrite' | 'friendly' | 'professional' | 'shorter' | 'summarize';

const PROMPTS: Record<WritingKind, string> = {
  proofread: 'Fix spelling, grammar and punctuation. Change nothing else: keep the wording, tone, language and line breaks.',
  rewrite: 'Rewrite this to read more clearly, keeping its meaning, language and roughly its length.',
  friendly: 'Rewrite this in a warmer, friendlier tone, keeping its meaning and language.',
  professional: 'Rewrite this in a clear, professional tone, keeping its meaning and language.',
  shorter: 'Make this shorter while keeping everything important. Same language.',
  summarize: 'Summarize this in a few short sentences, in the same language.',
};

export const WRITING_LABELS: [WritingKind, string][] = [
  ['proofread', 'Proofread'], ['rewrite', 'Rewrite'], ['friendly', 'Make Friendlier'], ['professional', 'Make More Professional'], ['shorter', 'Make Shorter'], ['summarize', 'Summarize'],
];

/** The instruction sent with the text: only the result comes back, no preamble. */
export function writingPrompt(kind: WritingKind, text: string): string {
  return `${PROMPTS[kind]}\n\nReply with the resulting text only — no introduction, quotes or notes.\n\n<text>\n${text}\n</text>`;
}

/** Strips what models sometimes add around the answer. */
export function cleanWritingReply(reply: string): string {
  return reply.replace(/^\s*<text>\s*|\s*<\/text>\s*$/g, '').replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1').trim();
}

async function runWriting(kind: WritingKind, text: string): Promise<string> {
  const { brainSettings, providerForConnection } = await import('./brain');
  const p = await providerForConnection(brainSettings().active);
  const r = await p.chat([{ role: 'user', content: writingPrompt(kind, text) }], [], { maxTokens: 4000, signal: AbortSignal.timeout(120_000) });
  return cleanWritingReply(r.text);
}

function attach(wc: WebContents, onError: (message: string) => void) {
  wc.on('context-menu', (_e, params) => {
    if (!params.isEditable) return;
    const items: MenuItemConstructorOptions[] = [];
    for (const s of params.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    if (params.misspelledWord) items.push({ label: 'Add to Dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' });
    const text = params.selectionText.trim();
    // Settings → Features → Writing help off: only the plain edit menu.
    if (text && featureOn('writingHelp')) {
      items.push({
        label: 'Writing Help',
        submenu: WRITING_LABELS.map(([kind, label]) => ({
          label,
          click: () => void runWriting(kind, params.selectionText).then((out) => { if (out && !wc.isDestroyed()) wc.insertText(out); }).catch((e) => onError(e instanceof Error ? e.message : String(e))),
        })),
      }, { type: 'separator' });
    }
    items.push({ role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy }, { role: 'paste', enabled: params.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' });
    Menu.buildFromTemplate(items).popup();
  });
}

/** Adds the menu to every Keeper window's text fields. */
export function initWritingMenu(onError: (message: string) => void) {
  app.on('web-contents-created', (_e, wc) => attach(wc, onError));
}
