// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Telling mesh addresses apart in the network and firewall views (no Node
// modules, so the window can use it too).

import { familyOf, inPrefix, parseCidr } from '../net/addr';

/** Whether an address is inside one of the mesh's prefixes. */
export function looksLikeMeshAddr(ip: string, prefixes: string[]): boolean {
  const a = ip.replace(/^::ffff:/, '').replace(/%.*$/, '');
  return prefixes.some((p) => {
    const c = parseCidr(p);
    return !!c && familyOf(a) === c.family && inPrefix(a, c.net, c.prefix);
  });
}
