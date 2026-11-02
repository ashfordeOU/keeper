// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Show in Enclosing Folder": opens Keeper's own view of the folder a file is
// in, with that file selected and scrolled into view.

import { parentOf } from '../core/folder-view';
import type { Route } from './state';

let pending: string | null = null;

export function showInFolder(go: (r: Route) => void, path: string) {
  pending = path;
  go({ name: 'browse', arg: parentOf(path) });
}

/** The file to select once this folder's contents show (asked for once). */
export function takeShowInFolder(dir: string): string | null {
  if (!pending || parentOf(pending) !== dir) return null;
  const p = pending;
  pending = null;
  return p;
}
