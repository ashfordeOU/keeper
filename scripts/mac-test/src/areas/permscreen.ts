// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's own Permissions screen (Settings → Permissions), guided: Keeper
// opens it, the owner presses "Allow all" and answers macOS's questions, and
// the run records which permissions became allowed, which still need a
// restart and which were left. Nothing is changed by the test itself.

import { fail, pass, skip, verdict, type Ctx } from '../context';

export interface PermRow { id: string; name: string; state: string; restartNeeded?: boolean }

/** What changed between two reads of the screen. */
export function permissionChanges(before: PermRow[], after: PermRow[]) {
  const was = new Map(before.map((r) => [r.id, r.state]));
  return {
    allowed: after.filter((r) => r.state === 'allowed' && was.get(r.id) !== 'allowed').map((r) => r.id),
    restart: after.filter((r) => r.restartNeeded).map((r) => r.id),
    left: after.filter((r) => r.state === 'missing' || r.state === 'denied').map((r) => r.id),
    unknown: after.filter((r) => r.state === 'unknown').map((r) => r.id),
  };
}

const rows = (r: any): PermRow[] => (Array.isArray(r?.items) ? r.items.map((i: any) => ({ id: String(i.id), name: String(i.name), state: String(i.state), restartNeeded: !!i.restartNeeded })) : []);

export async function runPermScreen(ctx: Ctx) {
  const { rec } = ctx;
  let before: PermRow[] = [];
  await rec.check('permscreen.list', 'Permissions screen: every macOS permission with a status', 'auto', async (h) => {
    const app = await ctx.app();
    const r = await app.call<any>('permissions.list');
    before = rows(r);
    h.artifact(ctx.saveData('permissions-before.json', r));
    const counts = before.reduce<Record<string, number>>((m, x) => ({ ...m, [x.state]: (m[x.state] ?? 0) + 1 }), {});
    return verdict(before.length >= 14, `${before.length} permissions (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}); helper ${r?.helper ? 'answered' : 'missing'}`, { counts, helper: r?.helper });
  });

  await rec.check('permscreen.allowall', 'Permissions screen: Allow all, guided', 'guided', async (h) => {
    if (!before.length) return fail('The screen did not list anything');
    const todo = before.filter((r) => r.state === 'missing' || r.state === 'denied');
    if (!todo.length) return pass('Nothing left to allow');
    if (!ctx.args.guided) return skip('Needs the owner (--no-guided)');
    const app = await ctx.app();
    await app.page('open-permissions', () => { window.dispatchEvent(new CustomEvent('keeper-open-permissions', { detail: null })); });
    const shot = await ctx.shotWindow('permissions-before');
    if (shot) h.artifact(shot);
    const a = await ctx.prompt.ask({
      key: 'permscreen-allowall', title: 'Keeper: Settings → Permissions',
      lines: [
        `Keeper is open at Settings → Permissions with ${todo.length} to do: ${todo.map((r) => r.name).join(', ')}.`,
        'Press “Allow all” and follow each step: answer macOS’s questions, switch Keeper on where System Settings opens.',
        'Use “Skip this one” for anything you would rather not allow. If Keeper offers “Restart Keeper now”, do not restart yet.',
      ],
      question: 'Press Enter when Allow all says it is done (or s to skip).', kind: 'enter', timeoutSec: 900, note: true,
    });
    h.answered(a.answer, a.note);
    if (a.answer !== 'y') return skip(`Skipped by the owner (${a.answer})`);
    const after = rows(await app.call<any>('permissions.list'));
    h.artifact(ctx.saveData('permissions-after.json', after));
    const shot2 = await ctx.shotWindow('permissions-after');
    if (shot2) h.artifact(shot2);
    const c = permissionChanges(before, after);
    const name = (id: string) => after.find((r) => r.id === id)?.name ?? id;
    return pass(`Allowed now: ${c.allowed.map(name).join(', ') || 'none'}; restart to finish: ${c.restart.map(name).join(', ') || 'none'}; still to do: ${c.left.map(name).join(', ') || 'none'}${c.unknown.length ? `; can't be checked: ${c.unknown.map(name).join(', ')}` : ''}`, c);
  });
}
