// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Before anything from a file is sent to an AI on the internet, secrets are
// blanked out: API keys and tokens, private keys, password lines, card numbers
// and bank account numbers. Local models see the text as it is, unless the
// person asks for redaction everywhere.

export interface Redaction {
  text: string;
  /** how many things were blanked, by kind */
  found: Record<string, number>;
}

/** Luhn check, used to tell real card numbers from other long numbers. */
export function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** IBAN check digits (mod 97). */
export function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

const RULES: [kind: string, re: RegExp][] = [
  ['private key', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY(?: BLOCK)?-----|$)/g],
  ['api key', /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}\b/g],
  ['api key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['api key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['token', /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g],
  ['token', /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g],
  ['token', /\b(?:glpat|npm|pypi)-[A-Za-z0-9_-]{20,}\b/g],
  ['token', /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ['token', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['token', /\b(?:bearer|token)\s+[A-Za-z0-9._~+/-]{20,}=*/gi],
  ['connection string', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@[^\s]+/gi],
];

// "password: hunter2", "PASSWORD=...", "api_key = '...'", "secret": "..."
const SECRET_LINE = /\b(pass(?:word|wd|phrase)?|pwd|pin|secret|api[_ -]?key|access[_ -]?key|client[_ -]?secret|token|auth|credentials?|wachtwoord|passwort|mot de passe|contraseña|senha|пароль)\b(["']?\s*[:=]\s*|\s+(?:is|=)\s+)(["']?)([^\s"',;]{3,})\3/giu;

const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g;

export function redact(text: string): Redaction {
  const found: Record<string, number> = {};
  const hit = (kind: string) => { found[kind] = (found[kind] ?? 0) + 1; };
  let t = text;
  for (const [kind, re] of RULES) t = t.replace(re, () => { hit(kind); return `[${kind} removed]`; });
  t = t.replace(SECRET_LINE, (_m, label: string, sep: string, q: string) => { hit('password'); return `${label}${sep}${q}[removed]${q}`; });
  t = t.replace(CARD, (m) => {
    const d = m.replace(/\D/g, '');
    if (d.length < 13 || d.length > 19 || !luhn(d) || /^(\d)\1+$/.test(d)) return m;
    hit('card number');
    return `[card ending ${d.slice(-4)}]`;
  });
  t = t.replace(IBAN, (m) => {
    if (!ibanValid(m)) return m;
    hit('bank account');
    return '[bank account removed]';
  });
  return { text: t, found };
}
