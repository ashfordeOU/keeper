// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for guided fixes.

import { ipcMain } from 'electron';
import { desktopFrom, resolveLink } from '../../core/guide/links';
import { FLOWS } from '../../core/guide/builtin';
import type { FindingState } from '../../core/guide/types';
import { apply, details, get, howTo, initGuide, list, open, PLATFORM_OF_GUIDE, preview, refresh, reveal, setState, setStates, showMini, trust, undo, untrust, verify, verifyStarted } from '../services/guide';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

export function registerGuideIpc(d: { broadcast: (channel: string, ...args: unknown[]) => void; preload: string; alert?: (title: string, detail: string) => void }) {
  initGuide(d);
  handle('guide.list', () => list());
  handle('guide.refresh', async (source?: string) => { await refresh(source); return list(); });
  handle('guide.summary', () => list().summary);
  handle('guide.setState', (id: string, patch: Partial<FindingState> | null) => setState(id, patch));
  handle('guide.setStates', (ids: string[], patch: Partial<FindingState> | null) => setStates(Array.isArray(ids) ? ids.map(String) : [], patch));
  handle('guide.trust', (ids: string[]) => trust(Array.isArray(ids) ? ids.map(String) : []));
  handle('guide.untrust', (id: string) => untrust(String(id)));
  handle('guide.details', (id: string) => details(String(id)));
  handle('guide.reveal', (id: string, how: 'file' | 'extension') => reveal(String(id), how === 'extension' ? 'extension' : 'file'));
  handle('guide.preview', (id: string) => preview(id));
  handle('guide.apply', (id: string) => apply(id));
  handle('guide.undo', (id: string) => undo(id));
  handle('guide.open', (t: { id?: string; topic?: string }) => open(t));
  handle('guide.verify', (id: string) => verify(id));
  handle('guide.mini', (id: string | null) => showMini(id));
  handle('guide.flows', () => FLOWS);
  handle('guide.get', (id: string) => get(id));
  handle('guide.howTo', (q: string) => howTo(q));
  handle('guide.explain', async (id: string, mode: 'explain' | 'walk') => {
    const f = get(id);
    if (!f) return { ok: false, text: 'Nothing to explain.' };
    const link = f.fix.kind === 'open' ? resolveLink(f.fix.link, PLATFORM_OF_GUIDE, desktopFrom(process.env)) : undefined;
    const steps = f.fix.kind === 'auto' ? [] : f.fix.steps ?? [];
    const sys = PLATFORM_OF_GUIDE === 'darwin' ? 'macOS' : PLATFORM_OF_GUIDE === 'win32' ? 'Windows' : 'Linux';
    const prompt = mode === 'explain'
      ? `In plain, friendly English (4–6 sentences, no jargon), explain this ${f.area} issue on a ${sys} computer and why fixing it matters.\nIssue: ${f.title}\nWhy: ${f.why}${f.impact ? `\nImpact: ${f.impact}` : ''}`
      : `Walk a non-technical person through fixing this on ${sys}, as short numbered steps using the exact names of the buttons. Use these steps as the base and only add what is missing.\nIssue: ${f.title}\nWhere: ${link?.label ?? 'Keeper'}\nSteps:\n${steps.map((s, i) => `${i + 1}. ${s.text}`).join('\n')}`;
    try {
      const { askBrain } = await import('../services/brain');
      const r = await askBrain(prompt, { client: 'Keeper guide' });
      return { ok: true, text: r.answer };
    } catch (e) {
      return { ok: false, text: e instanceof Error ? e.message : 'No AI is set up. The steps above work without one.' };
    }
  });
  // Started fixes are checked again when the person comes back to Keeper.
  ipcMain.on('guide.focus', () => void verifyStarted());
}
