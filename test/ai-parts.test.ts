// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One table of every place Keeper uses AI.
import { describe, expect, it } from 'vitest';
import { AI_PARTS, aiPartsShown } from '../core/ai-parts';
import { featureDef } from '../core/features';
import { jargonIn } from '../core/settings-schema';

describe('where AI is used', () => {
  it('names real parts, once each, in plain short words', () => {
    for (const p of AI_PARTS) {
      expect(featureDef(p.feature), p.id).toBeTruthy();
      expect(p.what.split(' ').length, p.id).toBeLessThanOrEqual(7);
      expect(jargonIn(`${p.name} ${p.what}`), p.id).toEqual([]);
    }
    expect(new Set(AI_PARTS.map((p) => p.id)).size).toBe(AI_PARTS.length);
  });
  it('never offers to switch off a part that does more than AI (Mail, Meetings)', () => {
    expect(AI_PARTS.filter((p) => !p.switchable).map((p) => p.feature)).toEqual(['mail', 'meetings']);
  });
  it('covers the entry points people asked about: Assistant, the Island, selected text, Mail, Meetings and Agents', () => {
    expect(AI_PARTS.map((p) => p.feature)).toEqual(expect.arrayContaining(['assistant', 'islandAsk', 'selectionBar', 'mail', 'meetings', 'aiAgents']));
  });
  it('leaves out parts this system does not have', () => {
    expect(aiPartsShown((f) => f !== 'islandAsk').map((p) => p.id)).not.toContain('island');
  });
});
