// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The public halves of Keeper Pro's signing keys (raw Ed25519, base64). Licenses
// and the remote switch (pro.json) must be signed by one of these. Empty until
// the owner makes the key pair (docs/PRO.md → Keys): `node scripts/pro-keys.mjs`
// prints both halves; only the public one goes here. The private one never enters
// this repository: it lives in the license server's secrets.
//
// More than one key may be listed while moving to a new one: the newest first,
// the old one kept until every license signed by it has been renewed.

export const PRO_PUBLIC_KEYS: readonly string[] = [];

/** Purpose lines (core/pro/sign.ts): a signature for one is never valid for the other. */
export const LICENSE_PURPOSE = 'keeper-license-v1';
export const CONFIG_PURPOSE = 'keeper-pro-config-v1';
