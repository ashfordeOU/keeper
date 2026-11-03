// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Pro's owner tools (docs/PRO.md). Nothing here runs in a normal build.
//
//   node scripts/pro.mjs status          what .github/release.json says now
//   node scripts/pro.mjs on              switch Pro on for the next release; records "freeThrough"
//                                        (this version) the first time, and never changes it after
//   node scripts/pro.mjs off             leave Pro out of the next release ("freeThrough" stays)
//   node scripts/pro.mjs keys            make a signing key pair; prints both halves, saves neither
//   node scripts/pro.mjs sign-config <config.json>
//                                        prints the signed pro.json for keeper.ashforde.org;
//                                        the private key comes from KEEPER_PRO_PRIVATE_KEY
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const REL = new URL('../.github/release.json', import.meta.url);
const PKG = new URL('../package.json', import.meta.url);
const KEYS = new URL('../core/pro/keys.ts', import.meta.url);
const [cmd, arg] = process.argv.slice(2);

const b64url = (b) => Buffer.from(b).toString('base64url');
const readRel = () => JSON.parse(readFileSync(REL, 'utf8'));
// Keeps the file's own layout: only the two values change.
const writeRel = (pro, freeThrough) => {
  let text = readFileSync(REL, 'utf8');
  text = text.replace(/"proEnabled":\s*(true|false)/, `"proEnabled": ${pro}`).replace(/"freeThrough":\s*(null|"[^"]*")/, `"freeThrough": ${freeThrough ? JSON.stringify(freeThrough) : 'null'}`);
  JSON.parse(text);
  writeFileSync(REL, text);
};

switch (cmd) {
  case 'status': {
    const r = readRel();
    console.log(`Pro: ${r.proEnabled ? 'on' : 'off'}\nFree for everyone through: ${r.freeThrough ?? '(not set: everything is free)'}`);
    break;
  }
  case 'on': {
    const r = readRel();
    const version = JSON.parse(readFileSync(PKG, 'utf8')).version;
    if (!/PRO_PUBLIC_KEYS: readonly string\[\] = \[\s*'/.test(readFileSync(KEYS, 'utf8'))) {
      console.error('Add the public key to core/pro/keys.ts first (node scripts/pro.mjs keys).');
      process.exit(1);
    }
    const freeThrough = r.freeThrough ?? version;
    writeRel(true, freeThrough);
    console.log(`Pro is on for the next release. Every feature up to ${freeThrough} stays free for everyone, forever.`);
    break;
  }
  case 'off': {
    const r = readRel();
    writeRel(false, r.freeThrough ?? null);
    console.log('Pro is left out of the next release.');
    break;
  }
  case 'keys': {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    console.log('Public key (goes in core/pro/keys.ts):');
    console.log(`  ${raw.toString('base64')}`);
    console.log('\nPrivate key (a secret: the license server\'s LICENSE_PRIVATE_KEY and the KEEPER_PRO_PRIVATE_KEY repository secret; never commit it):');
    console.log(`  ${privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')}`);
    break;
  }
  case 'sign-config': {
    const pk = process.env.KEEPER_PRO_PRIVATE_KEY;
    if (!pk || !arg) {
      console.error('Usage: KEEPER_PRO_PRIVATE_KEY=… node scripts/pro.mjs sign-config config.json > pro.json');
      process.exit(1);
    }
    const config = { v: 1, issued: Date.now(), ...JSON.parse(readFileSync(arg, 'utf8')) };
    config.issued = Date.now();
    const body = b64url(JSON.stringify(config));
    const key = createPrivateKey({ key: Buffer.from(pk, 'base64'), format: 'der', type: 'pkcs8' });
    const sig = sign(null, Buffer.from(`keeper-pro-config-v1\n${body}`), key);
    console.log(JSON.stringify({ config: body, sig: b64url(sig) }));
    break;
  }
  default:
    console.log('node scripts/pro.mjs status | on | off | keys | sign-config <config.json>   (docs/PRO.md)');
}
