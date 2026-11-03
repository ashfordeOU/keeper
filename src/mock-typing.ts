// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo data for typed snippets and the selection bar (the interface in a browser).

import type { KeeperApi } from '../core/api';
import { actionsFor, defaultSelection } from '../core/selection';
import { renderSnippet } from '../core/typing/expand';

export function mockTyping(): Pick<KeeperApi, 'snippets' | 'selection'> {
  const text = 'Keeper keeps your files tidy and your desk calm.';
  const view = { text, app: 'Notes', how: 'accessibility' as const, ai: { label: 'Claude', local: false }, language: 'English', actions: actionsFor(text, defaultSelection().actions, true) };
  return {
    snippets: {
      status: async () => ({ on: true, how: 'keyboard device (1)', wanted: true, platform: 'linux' }),
      restart: async () => ({ on: true, how: 'keyboard device (1)' }),
      importCsv: async () => ({ added: 2, skipped: 0 }),
      exportCsv: async () => ({ saved: 2, path: 'snippets.csv' }),
      preview: async (t) => renderSnippet(t, { now: new Date(), clipboard: 'what you copied' }).text,
    },
    selection: {
      show: async () => view,
      current: async () => view,
      run: async (a) => (a === 'translate' ? { result: 'Keeper hält deine Dateien ordentlich und deinen Schreibtisch ruhig.' } : a === 'define' ? { result: 'tidy (adjective): arranged neatly and in order.' } : a === 'rewrite' || a === 'shorter' ? { result: 'Keeper keeps files tidy and your desk calm.' } : { done: true }),
      replace: async () => undefined,
      copy: async () => undefined,
      close: async () => undefined,
      resize: async () => undefined,
    },
  };
}
