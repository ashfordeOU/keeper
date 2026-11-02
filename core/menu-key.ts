// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What a menu template shows (labels, ids, checks, submenus), as one string:
// two templates with the same key look and behave the same, so a menu that is
// rebuilt often need only be handed to the system when its key changes.

export function menuKey(template: unknown): string {
  return JSON.stringify(template, (_k, v: unknown) => {
    if (typeof v === 'function') return undefined;
    // Images and other native objects: only that one is there.
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) return `[${(v as object).constructor?.name ?? 'object'}]`;
    return v;
  });
}
