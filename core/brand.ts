// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// How Keeper is named wherever it introduces itself.

export const APP_NAME = 'Keeper';
export const BRAND = 'Keeper by Ashforde®';
export const COMPANY = 'Ashforde OÜ';
export const TRADEMARK = 'Ashforde® is a registered trademark of Ashforde OÜ.';
export const COPYRIGHT = `© ${new Date().getFullYear()} Ashforde OÜ`;
export const WEBSITE = 'https://github.com/ashfordeOU/keeper';
/** Where "Report a problem" goes: a new issue, ready to fill in. */
export const REPORT_URL = 'https://github.com/ashfordeOU/keeper/issues/new';
/** Keeper's documentation, read on GitHub (the same files as docs/ in the source). */
export const DOCS_BASE = `${WEBSITE}/blob/main/docs/`;

/** One page of the documentation by its file name (without .md), with an optional heading anchor. */
export function docUrl(doc: string, anchor?: string): string {
  return `${DOCS_BASE}${doc.replace(/\.md$/i, '')}.md${anchor ? `#${anchor}` : ''}`;
}
