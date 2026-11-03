// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Types for pro-flags.mjs, so vite.config.ts and the tests can import it.

export function proFlags(root?: URL): { pro: boolean; freeThrough: string | null };
