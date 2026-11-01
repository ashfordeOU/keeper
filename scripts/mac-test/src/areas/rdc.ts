// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote desktops on a real Mac: which clients Keeper finds, the command it
// would run for an .rdp file (macOS has no mstsc: `open` with the file),
// opening it for real if the owner wants, and the Mac's own Screen Sharing
// (VNC) when it is switched on (only the greeting is read; no sign-in).

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fail, pass, skip, verdict, type Ctx } from '../context';

const RDP = 'full address:s:192.0.2.10:3389\r\nusername:s:mactest\r\nscreen mode id:i:1\r\ndesktopwidth:i:1280\r\ndesktopheight:i:800\r\n';

/** Reads the first bytes a VNC server sends ("RFB 003.008\n"). */
function rfbHello(host: string, port: number, ms = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => { s.destroy(); resolve(null); }, ms);
    s.once('data', (d) => { clearTimeout(t); s.destroy(); resolve(d.toString('latin1').slice(0, 12)); });
    s.once('error', () => { clearTimeout(t); resolve(null); });
  });
}

export async function runRdc(ctx: Ctx) {
  const { rec } = ctx;
  let connId: string | undefined;

  await rec.check('rdc.engines', 'Remote desktop clients Keeper finds on this Mac', 'auto', async (h) => {
    const app = await ctx.app();
    const e = await app.call<any>('rdc.engines', true);
    h.artifact(ctx.saveData('rdc-engines.json', e));
    return pass(`Found: ${JSON.stringify(e).slice(0, 200)}`);
  });

  await rec.check('rdc.rdp-command', 'An .rdp connection: the command Keeper runs (no mstsc on macOS)', 'auto', async (h) => {
    const app = await ctx.app();
    const imp = await app.call<any>('rdc.importText', RDP, 'rdp', 'mactest.rdp');
    const st = await app.call<any>('rdc.state');
    const conns: any[] = st?.connections ?? st?.list ?? [];
    connId = imp?.added?.[0]?.id ?? imp?.added?.[0] ?? conns.find((c) => c.host === '192.0.2.10')?.id;
    if (!connId) return fail('The .rdp text did not become a connection', undefined, { imp });
    const cmd = await app.call<any>('rdc.command', connId);
    h.artifact(ctx.saveData('rdc-command.json', { imported: imp, command: cmd }));
    if (cmd?.error) return fail(`No command: ${cmd.error}`);
    const line = [cmd.file, ...(cmd.args ?? [])].join(' ');
    const usesOpen = /(^|\/)open$/.test(cmd.file ?? '') || /\.rdp\b/.test(line);
    return verdict(!/mstsc/i.test(line) && !!cmd.file, `${cmd.engine ?? '?'}: ${line.slice(0, 200)}${cmd.note ? ` (${cmd.note})` : ''}`, { usesOpen });
  });

  if (!ctx.args.quick && ctx.args.guided) {
    await rec.check('rdc.open-rdp', 'Opening the .rdp file in the Mac\'s Remote Desktop app', 'guided', async (h) => {
      if (!connId) return skip('No test connection');
      const yes = await ctx.prompt.consent('rdc-open', 'Open a test Remote Desktop connection', ['Your Remote Desktop app (Windows App or Microsoft Remote Desktop), if you have one, opens a connection to 192.0.2.10, an address reserved for tests: it will fail to connect.'], ['Nothing to put back: close the app\'s window afterwards.']);
      if (!yes) return skip('The owner said no');
      const app = await ctx.app();
      const r = await app.call<any>('rdc.connect', connId, { external: true }).catch((e: Error) => ({ error: e.message }));
      h.artifact(ctx.saveData('rdc-open.json', r));
      const a = await ctx.prompt.ask({ key: 'rdc-open-visual', title: 'Did a Remote Desktop app open?', lines: ['It should show a connection to 192.0.2.10 (it will not connect). Close it afterwards.'], question: 'Did it open?', timeoutSec: 120, note: true });
      h.answered(a.answer, a.note);
      if (r?.error && a.answer !== 'y') return fail(`Keeper could not open it: ${r.error}`);
      return a.answer === 'y' ? pass('Opened in the Remote Desktop app') : a.answer === 'n' ? fail('Nothing opened', a.note) : skip('No answer');
    });
  }

  await rec.check('rdc.vnc-self', 'This Mac\'s own Screen Sharing (VNC), when it is on', 'auto', async (h) => {
    const hello = ctx.dry ? 'RFB 003.889\n' : await rfbHello('127.0.0.1', 5900);
    if (!hello) return skip('Screen Sharing is off on this Mac (nothing on port 5900)');
    const app = await ctx.app();
    const probe = await app.call<any>('rdc.probe', '127.0.0.1', [5900]).catch((e: Error) => ({ error: e.message }));
    const host = await app.call<any>('rdc.hostStatus').catch((e: Error) => ({ error: e.message }));
    h.artifact(ctx.saveData('rdc-vnc-self.json', { hello, probe, host }));
    return verdict(/^RFB \d{3}\.\d{3}/.test(hello) && !probe?.error, `Greeting "${hello.trim()}"; Keeper's probe: ${JSON.stringify(probe).slice(0, 160)}`);
  });

  await rec.check('rdc.host-status', 'Sharing this Mac: Screen Sharing and Remote Login state as Keeper reads it', 'auto', async (h) => {
    const app = await ctx.app();
    let host: any;
    try { host = await app.call<any>('rdc.hostStatus'); } catch (e) {
      const m = (e as Error).message.replace(/^.*Error: /s, '');
      // switched off in Keeper's settings: the page says so, which is not a failure
      if (/Turn on/i.test(m)) return skip(m);
      throw e;
    }
    h.artifact(ctx.saveData('rdc-host-status.json', host));
    return verdict(!!host && !host.error, JSON.stringify(host).slice(0, 200));
  });

  // a .vnc file, the way a double-click hands it over
  await rec.check('rdc.vnc-file', 'A .vnc file imports', 'auto', async (h) => {
    const f = path.join(ctx.paths.home, 'mactest.vnc');
    fs.writeFileSync(f, '[Connection]\nHost=127.0.0.1\nPort=5900\n');
    const app = await ctx.app();
    const r = await app.call<any>('rdc.importText', fs.readFileSync(f, 'utf8'), 'vnc', 'mactest.vnc').catch((e: Error) => ({ error: e.message }));
    h.artifact(ctx.saveData('rdc-vnc-import.json', r));
    return verdict(!r?.error, r?.error ? `Failed: ${r.error}` : 'Imported');
  });
}
