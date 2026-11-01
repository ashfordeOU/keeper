// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Setup profiles: a list of catalogue settings and values you can export from
// one computer and apply to another, always previewed first.

import { settingById } from './index';
import { validateValue } from './ops';
import type { Os, ProfilePreviewItem, ReadResult, SetupProfile } from './types';

export function exportProfile(name: string, os: Os, values: { id: string; value: string }[]): SetupProfile {
  return { format: 'keeper-setup-profile', version: 1, name: name.slice(0, 120) || 'My setup', created: Date.now(), os, settings: values.filter((v) => settingById(v.id)) };
}

/** Parses a profile file. Throws with a plain message when it is not one. */
export function parseProfile(text: string): SetupProfile {
  let p: SetupProfile;
  try {
    p = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Keeper setup profile');
  }
  if (p?.format !== 'keeper-setup-profile' || p.version !== 1 || !Array.isArray(p.settings)) throw new Error('This file is not a Keeper setup profile');
  if (p.settings.length > 2000) throw new Error('This profile is too large');
  for (const s of p.settings) if (typeof s?.id !== 'string' || typeof s?.value !== 'string') throw new Error('This profile has a damaged entry');
  return p;
}

/** What applying a profile would change on this computer. Nothing runs. */
export function previewProfile(p: SetupProfile, os: Os, current: Map<string, ReadResult>): ProfilePreviewItem[] {
  return p.settings.map(({ id, value }) => {
    const def = settingById(id);
    if (!def) return { id, title: id, to: value, admin: false, after: 'none', risk: 'low', status: 'unknown-setting' };
    const base = { id, title: def.title, to: value, admin: def.admin, after: def.after, risk: def.risk };
    if (def.os !== os) return { ...base, status: 'other-os' };
    if (validateValue(def, value)) return { ...base, status: 'invalid-value' };
    const now = current.get(id);
    return { ...base, from: now?.value, status: now && now.value === value ? 'same' : 'change' };
  });
}
