// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The kind of a remote file, from its name, for icons and thumbnails.

import { extOf, kindOf } from '../classify';
import type { FileKind } from '../types';

export function classifyKind(name: string): { kind: FileKind; ext: string } {
  return { kind: kindOf(name), ext: extOf(name) };
}
