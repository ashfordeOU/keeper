// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Types for render-packaging.mjs, so the tests can import it.

export type Sums = Record<string, string>;
export function parseSums(text: string): Sums;
export function renderTemplate(text: string, o: { version: string; sums: Sums; date: string; allowMissing?: boolean }): string;
export function loadSums(o: { sumsFile?: string; assetsDir?: string }): Sums;
export function renderAll(o: {
  version: string;
  sums: Sums;
  date: string;
  out: string;
  only?: string[];
  cli?: string;
  allowMissing?: boolean;
  source?: string;
}): string[];
