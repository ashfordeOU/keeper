// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A failed promise nobody caught in this window, or a failure the main process
// reports: written to the session log (Settings → Keeper's processes) and shown
// once as a quiet toast. See core/quiet-errors.ts.

import { errorText, ignorable, throttle } from '../../core/quiet-errors';
import { api } from '../api';

const once = throttle(5000);

/** Shows the toast this window uses: the Island's line, or the app's toasts. */
function say(text: string, view: string) {
  if (view === 'island') window.dispatchEvent(new CustomEvent('island-toast', { detail: text }));
  else window.dispatchEvent(new CustomEvent('keeper-toast', { detail: { text, action: view === 'app' ? { label: 'Details', route: 'settings:processes' } : undefined } }));
}

export function installQuietErrors(view: string) {
  window.addEventListener('unhandledrejection', (ev) => {
    const e = ev.reason;
    if (ignorable(e)) return;
    const text = errorText(e);
    void api.session?.rendererError?.(view, text, e instanceof Error ? (e.stack ?? '').slice(0, 2000) : '').catch(() => undefined);
    if (once(text)) say(`Something didn’t work: ${text}`, view);
  });
  // The main process's own uncaught failures, shown in the main window.
  if (view === 'app') api.on?.('app-error', (t: unknown) => { const text = String(t ?? ''); if (text && once(`main:${text}`)) say(`Something didn’t work in the background: ${text}`, view); });
}
