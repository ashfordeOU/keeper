// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// WireGuard (.conf) and OpenVPN (.ovpn) files: read them, check them, and show
// them with every secret blanked. Keeper never keeps a copy of the secrets in
// plain text; the system's own VPN manager gets the file and stores it.

import { parseCidr } from './addr';

export interface VpnConfigIssue {
  level: 'error' | 'warning' | 'info';
  text: string;
}

export interface VpnConfigSummary {
  kind: 'wireguard' | 'openvpn';
  /** a name suggested from the file name or the config */
  name: string;
  servers: string[];
  /** addresses given to this computer inside the tunnel */
  addresses: string[];
  dns: string[];
  /** every internet address goes through the tunnel */
  fullTunnel: boolean;
  /** IPv6 is covered too (or the tunnel has no IPv6 at all and the check can't apply) */
  coversV6: boolean;
  /** the text with private keys, pre-shared keys and inline key blocks replaced */
  redacted: string;
  issues: VpnConfigIssue[];
  /** OpenVPN: asks for a user name and password when connecting */
  needsLogin?: boolean;
}

const B64_32 = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/;

/** A WireGuard key is 32 bytes of base64 (44 characters, ending in '='). */
export function isWgKey(k: string): boolean {
  return B64_32.test(k.trim());
}

export function parseWireGuard(text: string, fileName = 'tunnel.conf'): VpnConfigSummary {
  const issues: VpnConfigIssue[] = [];
  const sections: { name: string; kv: [string, string][] }[] = [];
  const redactedLines: string[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s*#.*$/, '');
    const sec = line.match(/^\s*\[(\w+)\]\s*$/);
    if (sec) { sections.push({ name: sec[1].toLowerCase(), kv: [] }); redactedLines.push(raw); continue; }
    const kv = line.match(/^\s*([A-Za-z]+)\s*=\s*(.*?)\s*$/);
    if (kv && sections.length) {
      sections[sections.length - 1].kv.push([kv[1].toLowerCase(), kv[2]]);
      redactedLines.push(/^(privatekey|presharedkey)$/i.test(kv[1]) ? `${kv[1]} = (hidden)` : raw);
    } else redactedLines.push(raw);
  }
  const iface = sections.filter((s) => s.name === 'interface');
  const peers = sections.filter((s) => s.name === 'peer');
  if (iface.length !== 1) issues.push({ level: 'error', text: iface.length ? 'More than one [Interface] section.' : 'There is no [Interface] section.' });
  if (!peers.length) issues.push({ level: 'error', text: 'There is no [Peer] section: the tunnel has nothing to connect to.' });
  const get = (s: { kv: [string, string][] } | undefined, k: string) => s?.kv.filter(([a]) => a === k).map(([, v]) => v) ?? [];
  const list = (vals: string[]) => vals.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
  const pk = get(iface[0], 'privatekey')[0];
  if (!pk) issues.push({ level: 'error', text: 'The [Interface] has no PrivateKey.' });
  else if (!isWgKey(pk)) issues.push({ level: 'error', text: 'The PrivateKey is not a valid WireGuard key (32 bytes of base64).' });
  const addresses = list(get(iface[0], 'address'));
  if (!addresses.length) issues.push({ level: 'error', text: 'The [Interface] has no Address.' });
  for (const a of addresses) if (!parseCidr(a)) issues.push({ level: 'error', text: `"${a}" is not an address.` });
  const dns = list(get(iface[0], 'dns'));
  const servers: string[] = [];
  const allowed: string[] = [];
  peers.forEach((p, i) => {
    const pub = get(p, 'publickey')[0];
    if (!pub) issues.push({ level: 'error', text: `Peer ${i + 1} has no PublicKey.` });
    else if (!isWgKey(pub)) issues.push({ level: 'error', text: `Peer ${i + 1}'s PublicKey is not a valid WireGuard key.` });
    const psk = get(p, 'presharedkey')[0];
    if (psk && !isWgKey(psk)) issues.push({ level: 'error', text: `Peer ${i + 1}'s PresharedKey is not a valid key.` });
    const ep = get(p, 'endpoint')[0];
    if (ep) {
      if (!/^(\[[^\]]+\]|[^\s:]+):\d{1,5}$/.test(ep)) issues.push({ level: 'error', text: `Peer ${i + 1}'s Endpoint "${ep}" should be host:port.` });
      servers.push(ep);
    }
    const ips = list(get(p, 'allowedips'));
    for (const a of ips) if (!parseCidr(a)) issues.push({ level: 'error', text: `"${a}" in AllowedIPs is not an address range.` });
    allowed.push(...ips);
  });
  const fullV4 = allowed.some((a) => a === '0.0.0.0/0') || (allowed.includes('0.0.0.0/1') && allowed.includes('128.0.0.0/1'));
  const fullV6 = allowed.some((a) => a === '::/0') || (allowed.includes('::/1') && allowed.includes('8000::/1'));
  const hasV6Addr = addresses.some((a) => a.includes(':'));
  if (fullV4 && !fullV6) issues.push({ level: 'warning', text: 'IPv4 goes through the tunnel but IPv6 does not: on networks with IPv6, some traffic can leave outside the VPN. Add ::/0 to AllowedIPs to cover it.' });
  if (fullV4 && !dns.length) issues.push({ level: 'warning', text: 'No DNS server is set, so names may still be looked up through your normal network (a DNS leak).' });
  if (!fullV4 && allowed.length) issues.push({ level: 'info', text: `Split tunnel: only ${allowed.slice(0, 4).join(', ')}${allowed.length > 4 ? '…' : ''} go through the VPN.` });
  if (fullV6 && !hasV6Addr) issues.push({ level: 'info', text: 'IPv6 is routed into the tunnel without an IPv6 address, which blocks IPv6 while connected — fine, and it prevents IPv6 leaks.' });
  const name = (get(iface[0], 'name')[0] ?? fileName.replace(/\.(conf|wg)$/i, '')).replace(/[^\w.-]/g, '-').slice(0, 15) || 'wg0';
  return { kind: 'wireguard', name, servers, addresses, dns, fullTunnel: fullV4, coversV6: fullV6, redacted: redactedLines.join('\n'), issues };
}

const SECRET_BLOCKS = ['key', 'tls-auth', 'tls-crypt', 'tls-crypt-v2', 'secret', 'pkcs12', 'auth-user-pass', 'http-proxy-user-pass'];

export function parseOpenVpn(text: string, fileName = 'client.ovpn'): VpnConfigSummary {
  const issues: VpnConfigIssue[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  const red: string[] = [];
  const directives: string[][] = [];
  const blocks = new Set<string>();
  let inBlock: string | null = null;
  for (const raw of lines) {
    const t = raw.trim();
    const open = t.match(/^<([\w-]+)>$/);
    const close = t.match(/^<\/([\w-]+)>$/);
    if (open && !inBlock) { inBlock = open[1].toLowerCase(); blocks.add(inBlock); red.push(raw); continue; }
    if (close && inBlock) { inBlock = null; red.push(raw); continue; }
    if (inBlock) {
      if (SECRET_BLOCKS.includes(inBlock)) { if (red[red.length - 1] !== '(hidden)') red.push('(hidden)'); }
      else red.push(raw);
      continue;
    }
    if (!t || /^[#;]/.test(t)) { red.push(raw); continue; }
    const words = t.split(/\s+/);
    directives.push(words);
    // An auth-user-pass pointing at a file can't leak anything here, but a password typed inline in some clients' exports can.
    red.push(/^(auth-user-pass|askpass)$/.test(words[0]) && words[1] ? `${words[0]} (file)` : raw);
  }
  const all = (k: string) => directives.filter((d) => d[0] === k);
  const one = (k: string) => all(k)[0];
  if (!one('client') && !one('tls-client') && !one('pull')) issues.push({ level: 'warning', text: 'This does not look like a client configuration ("client" is missing).' });
  const remotes = all('remote');
  if (!remotes.length) issues.push({ level: 'error', text: 'There is no "remote" line: the VPN server is not named.' });
  const proto = one('proto')?.[1] ?? 'udp';
  const servers = remotes.map((r) => `${r[1]}:${r[2] ?? '1194'}${r[3] ? `/${r[3]}` : proto ? `/${proto}` : ''}`);
  const dev = one('dev')?.[1] ?? '';
  if (!dev) issues.push({ level: 'error', text: 'There is no "dev" line (tun or tap).' });
  if (!blocks.has('ca') && !one('ca')) issues.push({ level: 'error', text: 'There is no CA certificate, so the server can\'t be checked.' });
  const fullTunnel = !!one('redirect-gateway') || all('route').some((r) => (r[1] === '0.0.0.0' && r[2] === '0.0.0.0') || (r[1] === '0.0.0.0' && r[2] === '128.0.0.0'));
  const v6 = all('redirect-gateway').some((r) => r.includes('ipv6')) || all('route-ipv6').some((r) => r[1] === '::/0' || r[1] === '2000::/3');
  const dns = all('dhcp-option').filter((d) => d[1] === 'DNS' || d[1] === 'DNS6').map((d) => d[2]).concat(all('dns').filter((d) => d[1] === 'server').map((d) => d[3] ?? d[2]).filter(Boolean));
  const cipher = one('cipher')?.[1] ?? one('data-ciphers')?.[1];
  if (cipher && /^(BF-|DES|RC2|CAST|DES-EDE)/i.test(cipher)) issues.push({ level: 'warning', text: `The cipher ${cipher} is old and weak; ask the provider for an AES-GCM or ChaCha20 profile.` });
  if (one('auth')?.[1] && /^(MD5|SHA1)$/i.test(one('auth')[1])) issues.push({ level: 'warning', text: `The ${one('auth')[1]} message check is weak.` });
  if (one('comp-lzo') || one('compress')) issues.push({ level: 'warning', text: 'Compression is on, which some attacks on encrypted traffic exploit; newer clients turn it off.' });
  if (fullTunnel && !v6) issues.push({ level: 'warning', text: 'IPv4 is redirected but IPv6 is not: on networks with IPv6, some traffic can leave outside the VPN.' });
  if (fullTunnel && !dns.length) issues.push({ level: 'info', text: 'The server may push its DNS servers when connecting; none are set in the file.' });
  if (!fullTunnel) issues.push({ level: 'info', text: 'The file does not redirect all traffic; the server may still push that when connecting.' });
  const needsLogin = !!one('auth-user-pass') && !one('auth-user-pass')?.[1];
  const name = fileName.replace(/\.(ovpn|conf)$/i, '').replace(/[^\w .-]/g, '-').slice(0, 40) || 'OpenVPN';
  return { kind: 'openvpn', name, servers, addresses: [], dns, fullTunnel, coversV6: v6, redacted: red.join('\n'), issues, needsLogin };
}

/** Reads either kind, deciding by content more than by file name. */
export function parseVpnConfig(text: string, fileName: string): VpnConfigSummary {
  if (/^\s*\[Interface\]/im.test(text)) return parseWireGuard(text, fileName);
  if (/^\s*(client|remote|dev)\b/m.test(text) || /\.ovpn$/i.test(fileName)) return parseOpenVpn(text, fileName);
  return { kind: /\.ovpn$/i.test(fileName) ? 'openvpn' : 'wireguard', name: fileName, servers: [], addresses: [], dns: [], fullTunnel: false, coversV6: false, redacted: '', issues: [{ level: 'error', text: 'This is neither a WireGuard nor an OpenVPN configuration.' }] };
}
