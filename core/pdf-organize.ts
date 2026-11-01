// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The plan behind the visual page organizer: which page of which PDF goes
// where, and how far it is turned. Built by dragging thumbnails around.

export interface OrganizePage {
  /** the PDF the page comes from */
  file: string;
  /** 0-based page number in that file */
  page: number;
  /** extra turn, clockwise, in degrees */
  rotate: number;
}

export const normRotate = (deg: number) => ((Math.round(deg / 90) * 90) % 360 + 360) % 360;

/** Checks a plan against the page counts of its files; throws a plain-language error. */
export function checkOrganize(pages: OrganizePage[], counts: Record<string, number>): OrganizePage[] {
  if (!Array.isArray(pages) || !pages.length) throw new Error('Keep at least one page');
  if (pages.length > 5000) throw new Error('Too many pages');
  return pages.map((p, i) => {
    const n = counts[p.file];
    if (n === undefined) throw new Error(`Page ${i + 1} comes from a file that is not open`);
    if (!Number.isInteger(p.page) || p.page < 0 || p.page >= n) throw new Error(`Page ${i + 1} does not exist in its file`);
    return { file: p.file, page: p.page, rotate: normRotate(p.rotate || 0) };
  });
}

/** Moves the item at `from` to `to` (as a drag and drop does). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}

/** A short summary of what changed, for the result message. */
export function describeOrganize(pages: OrganizePage[], original: number): string {
  const files = new Set(pages.map((p) => p.file)).size;
  const turned = pages.filter((p) => p.rotate).length;
  const parts = [`${pages.length} page${pages.length === 1 ? '' : 's'}`];
  if (pages.length < original) parts.push(`${original - pages.length} removed`);
  if (turned) parts.push(`${turned} turned`);
  if (files > 1) parts.push(`from ${files} files`);
  return parts.join(', ');
}
