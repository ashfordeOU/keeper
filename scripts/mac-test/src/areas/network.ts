// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Link, the mesh and the firewall on a real Mac. Link starts on the
// local network and is seen by macOS's own Bonjour browser (dns-sd); the mesh
// plan for macOS is built and every program it names is checked to exist; the
// mesh helper is only installed if the owner says yes. The firewall's pf rules
// are only parsed (`pfctl -n`): nothing is loaded and nothing is blocked.

import fs from 'node:fs';
import path from 'node:path';
import { pfRules } from '../../../../core/fw/enforce';
import type { RuleGroup } from '../../../../core/fw/rules';
import { dnsUp, ifaceUp, routesUp, type Step } from '../../../../core/mesh/os-plan';
import { fail, pass, skip, verdict, type Ctx } from '../context';
import { until } from '../sys';

const MESH_LABEL = 'org.ashforde.keeper.meshd';

export async function runLink(ctx: Ctx) {
  const { rec } = ctx;

  await rec.check('link.start', 'Keeper Link starts on the local network', 'auto', async (h) => {
    const app = await ctx.app();
    await app.call('link.setSettings', { mode: 'lan', localOnly: true });
    const st = await until(async () => { const s = await app.call<any>('link.state'); return s?.me?.listening ? s : null; }, 15_000, 1000) ?? (await app.call<any>('link.state'));
    const me = st?.me ?? {};
    h.artifact(ctx.saveData('link-state.json', { mode: st?.settings?.mode, port: me.port, listening: me.listening, keyProtected: me.keyProtected, os: me.os, addresses: (me.addresses ?? []).length }));
    return verdict(!!me.listening, `Link is ${me.listening ? 'listening' : 'NOT listening'} on port ${me.port ?? '?'}; key in the keychain: ${me.keyProtected}`);
  });

  await rec.check('link.mdns', 'Bonjour (dns-sd) sees this Keeper as _keeper._tcp', 'auto', async (h) => {
    const bg = ctx.sys.background('/usr/bin/dns-sd', ['-B', '_keeper._tcp', 'local.']);
    await new Promise((r) => setTimeout(r, ctx.dry ? 10 : 6000));
    const out = await bg.stop('SIGINT');
    h.artifact(ctx.saveData('link-dns-sd.txt', out.stdout));
    const adds = out.stdout.split('\n').filter((l) => /\bAdd\b.*_keeper\._tcp/.test(l));
    const app = await ctx.app();
    const found = await app.call<any>('link.discover').catch((e: Error) => ({ error: e.message }));
    h.artifact(ctx.saveData('link-discover.json', Array.isArray(found) ? { devices: found.length } : found));
    return verdict(adds.length > 0, `${adds.length} Keeper service(s) announced on the local network${adds.length ? '' : ' (macOS may have asked to allow local network access: allow it, then run again)'}`, { announced: adds.length });
  });

  await rec.check('link.mesh-plan', 'The mesh plan for macOS names programs that exist here', 'auto', async (h) => {
    const steps: Step[] = [
      ...ifaceUp({ os: 'darwin', iface: 'utun9', impl: 'wireguard-go', a6: 'fd7a:115c:a1e0::2', a4: '100.96.0.2', prefix6: 'fd7a:115c:a1e0::/48', prefix4: '100.96.0.0/12', mtu: 1280, conf: 'private_key=…', bin: '/usr/local/bin/wireguard-go' }),
      ...routesUp('darwin', 'utun9', ['100.96.0.0/12', 'fd7a:115c:a1e0::/48']),
      ...dnsUp({ os: 'darwin', iface: 'utun9', server: '100.96.0.2', port: 5353, suffix: 'keeper' }),
    ];
    const files = [...new Set(steps.map((s) => s.file))];
    const found: Record<string, string> = {};
    for (const f of files) {
      if (f.startsWith('/')) { found[f] = fs.existsSync(f) || ctx.dry ? f : ''; continue; }
      const r = await ctx.sys.sh(`command -v ${f}`);
      found[f] = r.ok ? r.stdout.trim() : '';
    }
    h.artifact(ctx.saveData('mesh-plan-darwin.json', { steps: steps.map((s) => ({ ...s, stdin: s.stdin ? '<stdin>' : undefined })), found }));
    const missing = Object.entries(found).filter(([f, p]) => !p && !/wireguard-go/.test(f)).map(([f]) => f);
    return verdict(!missing.length, `${steps.length} steps using ${files.join(', ')}${missing.length ? `; not found here: ${missing.join(', ')}` : ''}`, found);
  });

  await rec.check('link.mesh-state', 'Keeper Mesh state on this Mac', 'auto', async (h) => {
    const app = await ctx.app();
    await app.call('features.set', 'keeperMesh', true).catch(() => undefined);
    const st = await app.call<any>('mesh.state');
    h.artifact(ctx.saveData('mesh-state.json', { on: st?.on, iface: st?.iface, port: st?.port, networks: st?.networks?.length, feature: st?.feature }));
    return verdict(!!st, `mesh is ${st?.on ? 'on' : 'off'}; interface ${JSON.stringify(st?.iface)}`);
  });

  if (!ctx.args.quick && ctx.args.guided) {
    await rec.check('link.mesh-helper', 'The mesh helper (LaunchDaemon) and wireguard-go, only if the owner agrees', 'guided', async (h) => {
      const existed = !ctx.dry && fs.existsSync(`/Library/LaunchDaemons/${MESH_LABEL}.plist`);
      ctx.facts.before.meshDaemon = existed;
      if (existed) return skip('A Keeper mesh helper is already installed on this Mac; not touching it');
      const yes = await ctx.prompt.consent('mesh-helper', 'Install the mesh helper (optional, heavy, needs your password)', [
        `A LaunchDaemon (${MESH_LABEL}) and a root-owned helper in /Library/PrivilegedHelperTools; Keeper downloads wireguard-go (pinned by SHA-256) and makes a utun interface.`,
        'From a source checkout Keeper is expected to refuse (it must be in /Applications, owned by an administrator): that refusal is what this checks.',
      ], [
        `launchctl bootout system/${MESH_LABEL}; the plist and the helper file are removed (sudo; asks for your password here).`,
      ]);
      if (!yes) return skip('The owner said no');
      ctx.undo.add({
        id: 'mesh-helper', admin: true, what: `Mesh helper LaunchDaemon ${MESH_LABEL}`, restore: `launchctl bootout system/${MESH_LABEL}; remove its plist and helper`,
        cmd: `/bin/launchctl bootout system/${MESH_LABEL} 2>/dev/null; /bin/rm -f /Library/LaunchDaemons/${MESH_LABEL}.plist /Library/PrivilegedHelperTools/${MESH_LABEL}.cjs`,
        verify: async () => {
          const loaded = (await ctx.sys.run('/bin/launchctl', ['print', `system/${MESH_LABEL}`])).ok;
          const file = fs.existsSync(`/Library/LaunchDaemons/${MESH_LABEL}.plist`);
          return { ok: !loaded && !file, detail: `${loaded ? 'still loaded' : 'not loaded'}, plist ${file ? 'still there' : 'gone'}` };
        },
      });
      const app = await ctx.app();
      const r = await app.call<any>('mesh.setOn', true).catch((e: Error) => ({ error: e.message }));
      await new Promise((res) => setTimeout(res, 3000));
      const st = await app.call<any>('mesh.state').catch(() => null);
      h.artifact(ctx.saveData('mesh-helper.json', { result: r, iface: st?.iface }));
      await app.call('mesh.setOn', false).catch(() => undefined);
      const installed = fs.existsSync(`/Library/LaunchDaemons/${MESH_LABEL}.plist`);
      if (!installed) ctx.undo.forget('mesh-helper');
      if (r?.error) return /Applications/.test(r.error) ? pass(`Refused as expected from a source checkout: ${r.error}`) : fail(`mesh.setOn failed: ${r.error}`);
      return pass(`Installed (${installed ? 'LaunchDaemon present' : 'no LaunchDaemon'}); interface ${JSON.stringify(st?.iface)}`);
    });
  }

  await rec.check('link.stop', 'Keeper Link stops', 'auto', async () => {
    const app = await ctx.app();
    await app.call('link.setSettings', { mode: 'off' });
    const st = await app.call<any>('link.state');
    return verdict(!st?.me?.listening, `Link is ${st?.me?.listening ? 'still listening' : 'off'}`);
  });
}

export async function runFirewall(ctx: Ctx) {
  const { rec } = ctx;
  await rec.check('firewall.status', 'Firewall: how Keeper would enforce rules on this Mac (nothing applied)', 'auto', async (h) => {
    const app = await ctx.app();
    const st = await app.call<any>('fw.status');
    h.artifact(ctx.saveData('fw-status.json', { platform: st?.platform, caps: st?.caps, enforcement: st?.enforcement, mode: st?.state?.mode }));
    return verdict(!!st && st.enforcement?.active !== true, `backend: ${st?.enforcement?.backend ?? '?'}; active: ${st?.enforcement?.active ? 'YES (unexpected)' : 'no'}${st?.enforcement?.message ? `; ${st.enforcement.message}` : ''}`);
  });

  await rec.check('firewall.pf-parse', 'Firewall: Keeper\'s pf rules parse with pfctl -n (nothing loaded, nothing blocked)', 'auto', async (h) => {
    const groups: RuleGroup[] = [{
      id: 'g', name: 'Mac test', enabled: true, source: { kind: 'local' },
      rules: [
        { id: 'a', app: 'any', direction: 'out', ip: '192.0.2.0/24', port: '443', proto: 'tcp', verdict: 'deny', enabled: true, created: 0 },
        { id: 'b', app: 'any', direction: 'in', ip: '198.51.100.7', verdict: 'allow', enabled: true, created: 0 },
        { id: 'c', app: 'any', direction: 'both', ip: '2001:db8::/32', port: '8000-8080', verdict: 'deny', enabled: true, created: 0 },
      ],
    }];
    const text = pfRules(groups);
    const f = path.join(ctx.paths.run, 'keeper-test.pf');
    fs.writeFileSync(f, text);
    h.artifact(ctx.saveData('fw-rules.pf.txt', text));
    let r = await ctx.sys.run('/sbin/pfctl', ['-n', '-v', '-f', f], { timeoutMs: 20_000 });
    if (!r.ok && /Permission denied|Operation not permitted/i.test(r.stderr) && (await ctx.sudoOk('pfctl -n only reads and checks the rules file; nothing is loaded'))) {
      r = await ctx.sys.run('/usr/bin/sudo', ['-n', '/sbin/pfctl', '-n', '-v', '-f', f], { timeoutMs: 20_000 });
    }
    h.artifact(ctx.saveData('fw-pfctl-n.txt', `${r.code}\n${r.stdout}\n${r.stderr}`));
    if (!r.ok && /Permission denied|Operation not permitted|password/i.test(r.stderr)) return skip('pfctl needs administrator rights even to parse; not given');
    const parseErr = /syntax error|error/i.test(r.stderr) && !/ALTQ|No ALTQ/i.test(r.stderr);
    return verdict(r.ok && !parseErr, r.ok ? `${text.trim().split('\n').length} rules parsed` : `pfctl said: ${r.stderr.trim().slice(0, 200)}`, undefined, r.stderr);
  });
}
