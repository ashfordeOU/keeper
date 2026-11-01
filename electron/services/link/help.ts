// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Help mode on this device: "Get help" (show a code and password, wait for one
// helper) and "Help someone" (connect with theirs). See core/link/help.ts for
// the protocol. A help connection is a guest of the Link node: it can reach
// the screen session and nothing else, it is never remembered, and when it
// ends nothing of it is kept except the line in the audit log.

import crypto from 'node:crypto';
import type { Wire } from '../../../core/link/channel';
import { helpAsHelper, helpAsHost, helpCompanionSecret, helpLink, helpTag, helpTopic, HELP_MAX_MISSES, HELP_TTL_MS, newHelpCode, newHelpPassword, normalizeCode, normalizePassword, openHelpNote, sealHelpNote, type HelpReach } from '../../../core/link/help';
import { deviceId, newIdentity, type Identity } from '../../../core/link/identity';
import { call, Mux } from '../../../core/link/mux';
import { relayDial, relayListen } from '../../../core/link/relay';
import { connectWs, type WsClientWire } from '../../../core/link/ws';
import { lanIPv4 } from './mdns-socket';
import type { LinkNode } from './node';

export interface HelpOfferView {
  code: string;
  password: string;
  expires: number;
  link: string;
  /** how a helper can reach this device right now */
  reach: ('lan' | 'relay' | 'tunnel')[];
  /** the web viewer address (a browser can help too) */
  webUrl?: string;
}

export interface HelpStatus {
  offer?: HelpOfferView;
  guests: { id: string; name: string; role: 'host' | 'helper'; since: number; via: string }[];
}

export class HelpSessions {
  private offer: { code: string; password: string; expires: number; misses: number; relay?: WsClientWire; ident?: Identity; timer?: NodeJS.Timeout } | null = null;

  constructor(private node: LinkNode) {}

  /** The mDNS tag while a code is waiting. */
  tag(): string | undefined {
    return this.offer && this.offer.expires > Date.now() ? helpTag(this.offer.code) : undefined;
  }

  status(): HelpStatus {
    const g = [...this.node.guests.values()].map((x) => ({ id: x.id, name: x.name, role: x.role, since: x.since, via: x.kind }));
    return { offer: this.offer && this.offer.expires > Date.now() ? this.view() : undefined, guests: g };
  }

  private view(): HelpOfferView {
    const o = this.offer!;
    const s = this.node.data.settings;
    const reach: HelpOfferView['reach'] = [];
    if (s.mode !== 'off' && this.node.port) reach.push('lan');
    if (o.relay) reach.push('relay');
    if (this.node.tunnelUrl && s.mode === 'internet' && !s.localOnly) reach.push('tunnel');
    const base = this.node.tunnelUrl && s.mode === 'internet' && !s.localOnly ? this.node.tunnelUrl : `http://${lanIPv4()[0] ?? '127.0.0.1'}:${this.node.port}`;
    return { code: o.code, password: o.password, expires: o.expires, link: helpLink(o.code), reach, webUrl: `${base.replace(/\/+$/, '')}/c/#help` };
  }

  /** "Get help": a fresh code and password for 10 minutes, for one helper. */
  async start(): Promise<HelpOfferView> {
    this.clearOffer();
    const s = this.node.data.settings;
    if (s.mode === 'off') throw new Error('Turn Keeper Link on first (Devices → Remote Access)');
    const code = newHelpCode();
    const password = newHelpPassword();
    const expires = Date.now() + HELP_TTL_MS;
    this.offer = { code, password, expires, misses: 0 };
    this.offer.timer = setTimeout(() => this.clearOffer(), HELP_TTL_MS);
    this.offer.timer.unref?.();
    this.node.mdnsPeer.announce();
    // Over the internet: listen on the relay under a one-time identity, and leave a sealed note saying where.
    if (s.mode === 'internet' && !s.localOnly) {
      const reach: HelpReach = { at: Date.now(), lan: lanIPv4().map((ip) => `${ip}:${this.node.port}`) };
      if (this.node.tunnelUrl) reach.tunnel = this.node.tunnelUrl;
      if (s.relayUrl) {
        const ident = newIdentity();
        try {
          const ctl = await relayListen(s.relayUrl, ident, (w) => void this.node.acceptWire(w));
          if (this.offer?.code === code) {
            this.offer.relay = ctl;
            this.offer.ident = ident;
            reach.relay = s.relayUrl;
            reach.relayId = deviceId(ident.publicKey);
          } else ctl.close('expired');
        } catch {
          /* no relay: the network and the tunnel still work */
        }
      }
      if (s.mailbox) {
        await fetch(`${s.mailbox.replace(/\/+$/, '')}/${helpTopic(code)}`, { method: 'POST', body: sealHelpNote(code, password, reach), headers: { 'X-Cache': 'yes', 'X-Firebase': 'no' }, signal: AbortSignal.timeout(8000) }).catch(() => undefined);
      }
    }
    this.node.linkHooks.helpChanged?.();
    return this.view();
  }

  private clearOffer() {
    if (!this.offer) return;
    clearTimeout(this.offer.timer);
    this.offer.relay?.close('help ended');
    this.offer = null;
    this.node.mdnsPeer.announce();
    this.node.linkHooks.helpChanged?.();
  }

  /** Stops waiting for a helper and ends any help session this device is in. */
  stop(reason = 'Help ended') {
    this.clearOffer();
    for (const g of [...this.node.guests.values()]) g.mux.close(reason);
  }

  end(guest: string, reason = 'The help session ended') {
    this.node.guests.get(guest)?.mux.close(reason);
  }

  /** A helper connected (H1 already read). */
  async answer(wire: Wire, first: Uint8Array) {
    const o = this.offer;
    try {
      const peer = await helpAsHost(wire, first, o?.code ?? '000000000', {
        password: () => {
          if (!this.offer || this.offer !== o || o.expires < Date.now()) throw new Error('No help session is waiting here. Ask for a new code.');
          return o.password;
        },
        miss: () => {
          if (o && ++o.misses >= HELP_MAX_MISSES) {
            this.clearOffer();
            this.node.linkHooks.notify('Help code stopped', 'Too many wrong passwords were tried. Press Get help again if you still need help.');
          }
        },
      });
      // One helper per code: it stops working now.
      this.clearOffer();
      const id = `help:${crypto.randomBytes(6).toString('base64url')}`;
      this.node.addGuest({ id, mux: new Mux(peer.session, false), name: peer.name || 'Helper', role: 'host', kind: wire.kind, since: Date.now() });
      this.node.audit({ kind: 'help', direction: 'in', device: id, deviceName: peer.name || 'Helper', title: `${peer.name || 'A helper'} connected with your help code`, detail: `via ${wire.kind}`, ok: true });
    } catch (e) {
      if (String(e).includes('wrong-password')) this.node.audit({ kind: 'help', direction: 'in', deviceName: 'Unknown', title: 'Someone tried your help code with a wrong password', ok: false });
    }
  }

  /** "Help someone": find them by code, prove the password, return the guest id. */
  async join(codeIn: string, passwordIn: string, name: string): Promise<{ id: string; name: string }> {
    const code = normalizeCode(codeIn);
    const password = normalizePassword(passwordIn);
    if (!code) throw new Error('The session code has 9 digits');
    if (password.length < 4) throw new Error('Enter the password they read out');
    const tries: (() => Promise<Wire>)[] = [];
    // 1. On this network (mDNS).
    const tag = helpTag(code);
    this.node.mdnsPeer.query();
    for (let i = 0; i < 12; i++) {
      const near = this.node.mdnsPeer.fresh().filter((f) => f.help === tag);
      if (near.length) {
        for (const n of near) for (const a of n.addresses) tries.push(() => connectWs(`ws://${a}:${n.port}/link`, 'lan', 3000, a));
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    // 2. Over the internet: the sealed note says which relay or tunnel.
    const s = this.node.data.settings;
    if (s.mode === 'internet' && !s.localOnly && s.mailbox) {
      const note = await this.readNote(s.mailbox, code, password).catch(() => null);
      if (note) {
        if (!this.node.opts.noLanDial) for (const a of note.lan ?? []) tries.push(() => connectWs(`ws://${a}/link`, 'lan', 2500, a.split(':')[0]));
        if (note.tunnel) tries.push(() => connectWs(`${note.tunnel!.replace(/^http/, 'ws')}/link`, 'tunnel', 10_000));
        if (note.relay && note.relayId) tries.push(() => relayDial(note.relay!, note.relayId!));
      }
    }
    if (!tries.length) throw new Error(s.mode === 'internet' && !s.localOnly ? 'No one is waiting for help with that code' : 'No one on this network is waiting for help with that code. To help over the internet, set Keeper Link to “From anywhere”.');
    let lastErr = 'Could not reach them';
    for (const t of tries) {
      const wire = await t().catch(() => null);
      if (!wire) continue;
      try {
        const session = await helpAsHelper(wire, code, password, name);
        const mux = new Mux(session, true);
        const hi = await call<{ name?: string }>(mux, 'hello', {}, 8000).catch(() => ({ name: undefined }));
        const id = `help:${crypto.randomBytes(6).toString('base64url')}`;
        const who = String(hi?.name || 'Their computer').slice(0, 60);
        this.node.addGuest({ id, mux, name: who, role: 'helper', kind: wire.kind, since: Date.now() });
        this.node.audit({ kind: 'help', direction: 'out', device: id, deviceName: who, title: `You helped ${who}`, detail: `via ${wire.kind}`, ok: true });
        return { id, name: who };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        wire.close('failed');
        if (/not right/.test(lastErr)) break;
      }
    }
    throw new Error(lastErr);
  }

  private async readNote(server: string, code: string, password: string): Promise<HelpReach | null> {
    const r = await fetch(`${server.replace(/\/+$/, '')}/${helpTopic(code)}/json?poll=1&since=15m`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    let best: HelpReach | null = null;
    // Anyone can post to a topic: look at the newest few notes only.
    for (const line of (await r.text()).split('\n').filter((l) => l.trim()).slice(-50)) {
      try {
        const ev = JSON.parse(line) as { event?: string; message?: string };
        if (ev.event !== 'message' || !ev.message) continue;
        const n = openHelpNote(code, password, ev.message);
        if (n && (!best || n.at > best.at)) best = n;
      } catch {
        /* skip */
      }
    }
    return best;
  }

  /** For the browser helper (web viewer): the companion secret while a code waits, and a miss counter. */
  webSecret(tag: string): { secret: Uint8Array; miss: () => void; used: () => void } | null {
    const o = this.offer;
    if (!o || o.expires < Date.now() || helpTag(o.code) !== tag) return null;
    return {
      secret: helpCompanionSecret(o.code, o.password),
      miss: () => {
        if (++o.misses >= HELP_MAX_MISSES) this.clearOffer();
      },
      used: () => this.clearOffer(),
    };
  }
}
