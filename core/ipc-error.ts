// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Errors from the main process arrive as "Error invoking remote method 'x.y': Error: what happened".
// The preload turns every one into just "what happened" (a named error keeps its name:
// VaultError, KeychainLockedError…), so no screen shows the wrapper.

export function cleanIpcError(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e);
  const m = /^Error invoking remote method '[^']+': (?:(\w*Error): )?([\s\S]*)$/.exec(raw);
  if (!m) return e instanceof Error ? e : new Error(raw);
  const out = new Error(m[2]);
  if (m[1] && m[1] !== 'Error') out.name = m[1];
  return out;
}

/** A caught error as words for a toast (never "Error: …"). */
export function errorText(e: unknown): string {
  return cleanIpcError(e).message;
}
