// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail's connection rules: encryption is required except for a server on this
// computer (a local bridge or a test server), and a certificate problem is
// said in plain words instead of being skipped. Also the check that no
// password or sign-in token ends up in a file Keeper writes.

/** A server on this computer (loopback): the only place mail may go unencrypted. */
export function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h) || h.endsWith('.localhost');
}

/** Refuses an unencrypted connection to anywhere but this computer. */
export function assertSecure(s: { host: string; security: 'tls' | 'starttls' | 'none' }, what = 'Mail'): void {
  if (s.security === 'none' && !isLoopback(s.host)) throw new Error(`${what}: Keeper only connects without encryption to a server on this computer. Choose SSL/TLS or STARTTLS for ${s.host}.`);
}

const CERT_CODES: Record<string, string> = {
  DEPTH_ZERO_SELF_SIGNED_CERT: 'uses a certificate it made itself (self-signed)',
  SELF_SIGNED_CERT_IN_CHAIN: 'uses a certificate from an authority this computer doesn’t trust',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'uses a certificate that can’t be checked',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'uses a certificate from an authority this computer doesn’t know',
  CERT_HAS_EXPIRED: 'has a certificate that has run out',
  CERT_NOT_YET_VALID: 'has a certificate that isn’t valid yet',
  ERR_TLS_CERT_ALTNAME_INVALID: 'has a certificate for a different name',
  CERT_REVOKED: 'has a certificate that was withdrawn',
};

/**
 * A certificate problem in plain words, with what to do; undefined when the
 * error is not about the certificate.
 */
export function certificateProblem(e: unknown, host: string): string | undefined {
  const err = e as { code?: string; message?: string; cause?: { code?: string } };
  const code = err?.code ?? err?.cause?.code ?? Object.keys(CERT_CODES).find((k) => String(err?.message ?? '').includes(k)) ?? (/self[- ]signed certificate/i.test(String(err?.message ?? '')) ? 'DEPTH_ZERO_SELF_SIGNED_CERT' : /certificate has expired/i.test(String(err?.message ?? '')) ? 'CERT_HAS_EXPIRED' : /altnames|Hostname\/IP does not match/i.test(String(err?.message ?? '')) ? 'ERR_TLS_CERT_ALTNAME_INVALID' : undefined);
  const what = code ? CERT_CODES[code] : undefined;
  if (!what) return undefined;
  const fix = code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN' ? ' If it is your own server, tick “Accept a self-signed certificate” under Change servers.' : ' Check the server name, or ask your provider.';
  return `The server ${host} ${what}, so Keeper didn’t connect.${fix}`;
}

/** An error with a certificate problem said plainly (other errors as they were). */
export function explainTls(e: unknown, host: string): Error {
  const plain = certificateProblem(e, host);
  if (!plain) return e instanceof Error ? e : new Error(String(e));
  return Object.assign(new Error(plain), { code: 'TLS_CERT' });
}

/**
 * Where a secret shows up in some text, for the tests that look through every
 * file Keeper wrote after signing in. Short values are not looked for (they
 * would match by chance).
 */
export function leaksIn(text: string, secrets: string[]): string[] {
  return secrets.filter((s) => s.length >= 8 && (text.includes(s) || (/^[\x20-\x7e]+$/.test(s) && text.includes(btoa(s)))));
}
