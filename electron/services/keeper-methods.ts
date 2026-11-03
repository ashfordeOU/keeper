// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The methods other parts of Keeper answer for the `keeper` command and AI apps,
// through the brain's socket (electron/services/brain.ts serves them). Kept apart
// from the brain so that a part can register its methods without loading the brain
// (a light app such as Keeper Notes never starts it: docs/SOLO.md).

export type KeeperMethod = (params: Record<string, unknown>, notify: (method: string, params: unknown) => void) => Promise<unknown> | unknown;

export const keeperMethods = new Map<string, KeeperMethod>();

/** Lets other parts of Keeper answer the keeper command through the same socket (e.g. "keeper/sync.status"). */
export function registerKeeperMethod(method: string, fn: (params: Record<string, unknown>) => Promise<unknown> | unknown) {
  keeperMethods.set(method, fn);
}

/** Like registerKeeperMethod, for long-running calls that send notifications back to the caller (e.g. the browser extension's link). */
export function registerKeeperStream(method: string, fn: KeeperMethod) {
  keeperMethods.set(method, fn);
}
