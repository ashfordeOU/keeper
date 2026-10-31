// SPDX-License-Identifier: AGPL-3.0-or-later
// The kind of a remote file, from its name, for icons and thumbnails.

import { extOf, kindOf } from '../classify';
import type { FileKind } from '../types';

export function classifyKind(name: string): { kind: FileKind; ext: string } {
  return { kind: kindOf(name), ext: extOf(name) };
}
