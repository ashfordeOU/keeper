// SPDX-License-Identifier: AGPL-3.0-or-later
// Parts of locked folders the interface needs too (no Node modules here).

/** 0 (very weak) … 4 (strong): length and variety, with common patterns marked down. */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
  let bits = pw.length * Math.log2(Math.max(pool, 1));
  if (/^(password|qwerty|letmein|123456|abc123|iloveyou|admin|welcome)/i.test(pw)) bits = Math.min(bits, 10);
  if (/(.)\1{3,}/.test(pw)) bits *= 0.6;
  if (new Set(pw).size <= 3) bits = Math.min(bits, 15);
  const score = (bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4) as 0 | 1 | 2 | 3 | 4;
  return { score, label: ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][score] };
}
