// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { conformanceDoc, CRITERIA, tally } from '../core/a11y-conformance';
import { jargonIn } from '../core/settings-schema';

/** WCAG 2.2, levels A and AA (4.1.1 Parsing was removed in 2.2). */
const WCAG22_A_AA = '1.1.1 1.2.1 1.2.2 1.2.3 1.2.4 1.2.5 1.3.1 1.3.2 1.3.3 1.3.4 1.3.5 1.4.1 1.4.2 1.4.3 1.4.4 1.4.5 1.4.10 1.4.11 1.4.12 1.4.13 2.1.1 2.1.2 2.1.4 2.2.1 2.2.2 2.3.1 2.4.1 2.4.2 2.4.3 2.4.4 2.4.5 2.4.6 2.4.7 2.4.11 2.5.1 2.5.2 2.5.3 2.5.4 2.5.7 2.5.8 3.1.1 3.1.2 3.2.1 3.2.2 3.2.3 3.2.4 3.2.6 3.3.1 3.3.2 3.3.3 3.3.4 3.3.7 3.3.8 4.1.2 4.1.3'.split(' ');
const AA = new Set('1.2.4 1.2.5 1.3.4 1.3.5 1.4.3 1.4.4 1.4.5 1.4.10 1.4.11 1.4.12 1.4.13 2.4.5 2.4.6 2.4.7 2.4.11 2.5.7 2.5.8 3.1.2 3.2.3 3.2.4 3.3.3 3.3.4 3.3.8 4.1.3'.split(' '));

describe('the accessibility conformance report', () => {
  it('lists every WCAG 2.2 A and AA criterion once, at its level, with remarks', () => {
    expect(CRITERIA.map((c) => c.id)).toEqual(WCAG22_A_AA);
    for (const c of CRITERIA) {
      expect(c.level, c.id).toBe(AA.has(c.id) ? 'AA' : 'A');
      expect(c.remarks.length, c.id).toBeGreaterThan(20);
      expect(jargonIn(c.remarks).filter((w) => !/^(API|MCP)$/.test(w)), c.id).toEqual([]);
    }
    const t = tally();
    expect(t.Supports + t['Partially supports'] + t['Does not support'] + t['Not applicable']).toBe(55);
  });

  it('docs/ACCESSIBILITY-CONFORMANCE.md is made from the list', () => {
    const file = path.resolve(__dirname, '../docs/ACCESSIBILITY-CONFORMANCE.md');
    const text = readFileSync(file, 'utf8');
    const block = `<!-- conformance:start -->\n${conformanceDoc()}<!-- conformance:end -->`;
    if (process.env.CONFORMANCE_DOC === 'write') writeFileSync(file, text.replace(/<!-- conformance:start -->[\s\S]*<!-- conformance:end -->/, block));
    expect(readFileSync(file, 'utf8')).toContain(block);
  });
});
