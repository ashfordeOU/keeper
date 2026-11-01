// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Read-only probes: every macOS entry of the settings catalogue is read (and
// the ones whose command fails on this macOS version are listed), the
// Security center, quick controls and per-app controls. Nothing is changed.

import { fail, pass, verdict, type Ctx } from '../context';

export async function runCatalog(ctx: Ctx) {
  const { rec } = ctx;
  let ids: string[] = [];
  await rec.check('catalog.list', 'Settings catalogue: the macOS entries', 'auto', async (h) => {
    const app = await ctx.app();
    const l = await app.call<any>('catalog.list');
    ids = (l?.entries ?? []).map((e: any) => e.id);
    h.artifact(ctx.saveData('catalog-list.json', { os: l?.os, count: ids.length, counts: l?.counts }));
    return verdict(ids.length > 0, `${ids.length} entries for ${l?.os}`);
  });

  await rec.check('catalog.read', 'Settings catalogue: every macOS entry reads (read only)', 'auto', async (h) => {
    if (!ids.length) return fail('No entries to read');
    const app = await ctx.app();
    const wanted = ctx.args.quick ? ids.slice(0, 40) : ids;
    const out: any[] = [];
    for (let i = 0; i < wanted.length; i += 25) out.push(...((await app.call<any[]>('catalog.read', wanted.slice(i, i + 25))) ?? []));
    const bad = out.filter((r) => r.error);
    const missing = wanted.filter((id) => !out.some((r) => r.id === id));
    h.artifact(ctx.saveData('catalog-read.json', { read: out.length, failed: bad.map((r) => ({ id: r.id, error: String(r.error).slice(0, 300) })), missing, defaults: out.filter((r) => r.isDefault).length }));
    return verdict(!bad.length && !missing.length, `${out.length - bad.length} of ${wanted.length} read${bad.length ? `; failed on this macOS: ${bad.slice(0, 12).map((r) => r.id).join(', ')}${bad.length > 12 ? '…' : ''}` : ''}${missing.length ? `; no answer for ${missing.length}` : ''}`, { failed: bad.length, missing: missing.length });
  });
}

export async function runSecurity(ctx: Ctx) {
  const { rec } = ctx;
  const probes: [string, string, unknown[], (r: any) => string][] = [
    ['security.overview', 'Security center overview', [], (r) => JSON.stringify(r).slice(0, 180)],
    ['security.permissions', 'Apps and their privacy permissions', [], (r) => `${Array.isArray(r) ? r.length : (r?.apps ?? r?.list ?? []).length} entries${r?.note ? `; ${r.note}` : ''}`],
    ['security.persistence', 'Things that start by themselves (launch agents, login items)', [], (r) => `${Array.isArray(r) ? r.length : (r?.items ?? []).length} entries`],
    ['security.browsers', 'Browsers and extensions', [], (r) => `${Array.isArray(r) ? r.length : (r?.browsers ?? []).length} browsers`],
    ['controls.list', 'Quick controls and their state', [true], (r) => `${(Array.isArray(r) ? r : r?.controls ?? []).length} controls`],
    ['appctl.controls', 'Per-app controls supported here', [], (r) => `${(r ?? []).length} controls: ${(r ?? []).map((c: any) => `${c.id}=${c.support}`).join(', ').slice(0, 160)}`],
    ['appctl.running', 'Per-app controls: running apps', [], (r) => `${(r ?? []).length} apps`],
    ['protection.check', 'Protection check', [], (r) => JSON.stringify(r).slice(0, 160)],
    ['startup.list', 'Startup items', [], (r) => `${(r ?? []).length} items`],
  ];
  for (const [api, title, args, show] of probes) {
    await rec.check(`security.${api.replace('.', '-')}`, `${title} (read only)`, 'auto', async (h) => {
      const app = await ctx.app();
      const t0 = Date.now();
      const r = await app.call<any>(api, ...args);
      h.artifact(ctx.saveData(`${api}.json`, r));
      if (r?.error) return fail(`${api}: ${r.error}`);
      return pass(`${show(r)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    });
  }
}
