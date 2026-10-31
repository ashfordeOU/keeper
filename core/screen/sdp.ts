// SPDX-License-Identifier: AGPL-3.0-or-later
// Binding WebRTC to Keeper Link. The offer and answer only ever travel inside an
// authenticated Link channel (keys pinned at pairing), and each side also states
// its DTLS certificate fingerprint there. Before the picture is trusted, both
// sides check that the fingerprint in the description they apply, and the
// certificate the peer actually used in the DTLS handshake (from getStats), are
// that same fingerprint. A relay or TURN server in the middle sees only DTLS.

export interface Fingerprint {
  algorithm: string;
  /** upper-case hex pairs joined by colons, as SDP writes them */
  value: string;
}

/** Every a=fingerprint line, session-level and per media section. */
export function sdpFingerprints(sdp: string): Fingerprint[] {
  const out: Fingerprint[] = [];
  for (const line of sdp.split(/\r?\n/)) {
    const m = line.match(/^a=fingerprint:(\S+)\s+([0-9A-Fa-f:]+)\s*$/);
    if (m) out.push({ algorithm: m[1].toLowerCase(), value: normalize(m[2]) });
  }
  return out;
}

export function normalize(fp: string): string {
  return fp.trim().toUpperCase().replace(/[^0-9A-F]/g, '').replace(/(..)(?!$)/g, '$1:');
}

/** The one fingerprint a description uses ("sha-256 AB:CD:…"); throws when it has none or several different ones. */
export function soleFingerprint(sdp: string): string {
  const all = sdpFingerprints(sdp);
  if (!all.length) throw new Error('The connection offer has no certificate fingerprint');
  const set = new Set(all.map((f) => `${f.algorithm} ${f.value}`));
  if (set.size > 1) throw new Error('The connection offer names more than one certificate');
  return [...set][0];
}

/** Checks a description against the fingerprint stated over the Link channel. */
export function checkBinding(sdp: string, stated: string): void {
  const got = soleFingerprint(sdp);
  const [alg, value] = stated.trim().split(/\s+/);
  if (!alg || !value) throw new Error('No certificate fingerprint was stated');
  if (got !== `${alg.toLowerCase()} ${normalize(value)}`) throw new Error('The certificate in the connection offer is not the one the other device stated');
}

/**
 * After DTLS: the certificate the peer really used, from an RTCStatsReport turned
 * into a plain array (`[...report.values()]`). It must equal the stated one.
 */
export function remoteCertificateMatches(stats: Array<Record<string, unknown>>, stated: string): boolean {
  const transport = stats.find((s) => s.type === 'transport' && typeof s.remoteCertificateId === 'string');
  if (!transport) return false;
  const cert = stats.find((s) => s.type === 'certificate' && s.id === transport.remoteCertificateId);
  if (!cert || typeof cert.fingerprint !== 'string') return false;
  const [alg, value] = stated.trim().split(/\s+/);
  return String(cert.fingerprintAlgorithm ?? '').toLowerCase() === alg.toLowerCase() && normalize(String(cert.fingerprint)) === normalize(value);
}

/** Keeps only the candidate types the person allows: 'lan' strips everything but host candidates. */
export function filterCandidate(candidate: string, scope: 'lan' | 'internet'): boolean {
  if (!candidate) return true;
  const typ = candidate.match(/\btyp\s+(\w+)/)?.[1];
  if (scope === 'lan') return typ === 'host';
  return true;
}

/** ICE server list from Link's STUN setting (and TURN entries written as turn:user:pass@host:port). */
export function iceServers(entries: string[]): { urls: string; username?: string; credential?: string }[] {
  const out: { urls: string; username?: string; credential?: string }[] = [];
  for (const raw of entries) {
    const e = raw.trim();
    if (!e) continue;
    const turn = e.match(/^(turns?):([^:@]+):([^@]+)@(.+)$/);
    if (turn) out.push({ urls: `${turn[1]}:${turn[4]}`, username: decodeURIComponent(turn[2]), credential: decodeURIComponent(turn[3]) });
    else if (/^stuns?:/.test(e) || /^turns?:/.test(e)) out.push({ urls: e });
    else out.push({ urls: `stun:${e}` });
  }
  return out;
}

/** Removes candidates the scope does not allow from a whole description (non-trickle ICE). */
export function stripCandidates(sdp: string, scope: 'lan' | 'internet'): string {
  if (scope === 'internet') return sdp;
  return sdp.split(/\r\n/).filter((l) => !l.startsWith('a=candidate:') || filterCandidate(l.slice(2), scope)).join('\r\n');
}
