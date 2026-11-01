// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's small plugin model for notes. A plugin is a manifest and one
// script that runs in a sandboxed worker with no Node, no DOM and no network:
// it can only call the methods below, and only those its manifest asks for
// and the person allowed. Community plugins written for other note apps are
// not run (they expect full access to the computer); see docs/NOTES.md.

export type PluginPermission = 'read' | 'write' | 'commands' | 'ui';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  permissions: PluginPermission[];
}

/** What a plugin may call, and which permission each call needs. */
export const PLUGIN_METHODS: Record<string, PluginPermission> = {
  'vault.list': 'read',
  'vault.read': 'read',
  'vault.search': 'read',
  'vault.write': 'write',
  'vault.create': 'write',
  'commands.add': 'commands',
  'ui.notice': 'ui',
  'editor.getSelection': 'read',
  'editor.replaceSelection': 'write',
};

export function validateManifest(m: unknown): { ok: true; manifest: PluginManifest } | { ok: false; error: string } {
  const x = m as Partial<PluginManifest>;
  if (!x || typeof x !== 'object') return { ok: false, error: 'manifest is not an object' };
  if (typeof x.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(x.id)) return { ok: false, error: 'id must be lowercase letters, numbers and dashes' };
  if (typeof x.name !== 'string' || !x.name.trim()) return { ok: false, error: 'name is missing' };
  if (typeof x.version !== 'string') return { ok: false, error: 'version is missing' };
  const perms = Array.isArray(x.permissions) ? x.permissions : [];
  const bad = perms.find((p) => !['read', 'write', 'commands', 'ui'].includes(p));
  if (bad) return { ok: false, error: `unknown permission “${bad}”` };
  return { ok: true, manifest: { id: x.id, name: x.name, version: x.version, description: x.description, permissions: perms } };
}

/** Whether a call is allowed for this plugin (asked for in the manifest and granted by the person). */
export function allowed(method: string, manifest: PluginManifest, granted: PluginPermission[]): boolean {
  const need = PLUGIN_METHODS[method];
  return !!need && manifest.permissions.includes(need) && granted.includes(need);
}

/** True for a folder that holds a plugin written for another app (manifest.json + main.js). */
export function isForeignPlugin(manifest: Record<string, unknown>): boolean {
  return typeof manifest.minAppVersion === 'string' || (typeof manifest.id === 'string' && !Array.isArray(manifest.permissions));
}
