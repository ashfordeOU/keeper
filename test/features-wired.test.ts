// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every switch in Settings → Features does something: its id is read by the
// code that runs it (featureOn, onFeature, useFeature, a poll's features, a
// shown-in rule) or it owns pages or commands. A switch nothing reads would
// say it stops a feature while it does not.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURES, PRESETS } from '../core/features';

const ROOT = path.resolve(__dirname, '..');
function* files(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.ts$/.test(n)) yield p;
  }
}

describe('feature switches', () => {
  it('every switch is read by the code it switches', () => {
    let code = '';
    for (const d of ['electron', 'src', 'core', 'cli']) for (const f of files(path.join(ROOT, d))) if (!f.endsWith(path.join('core', 'features.ts'))) code += readFileSync(f, 'utf8') + '\n';
    const presets = new Set(PRESETS.map((p) => p.id));
    // Families read with a template: featureOn(`quickControls${Group}`).
    const families = [...code.matchAll(/featureOn\(`(\w+)\$\{/g)].map((m) => m[1]);
    const unread = FEATURES.filter((f) => !f.always && !presets.has(f.id as never) && !f.routes?.length && !f.commands?.length && !f.bridge)
      .filter((f) => !new RegExp(`(featureOn|onFeature|useFeature|isOn\\(\\w+,)\\s*\\(?\\s*'${f.id}'|feature:\\s*'${f.id}'|features:\\s*\\[[^\\]]*'${f.id}'|requires:\\s*\\[[^\\]]*'${f.id}'|push\\('${f.id}'\\)|const FEATURE = '${f.id}'`).test(code) && !families.some((x) => f.id.startsWith(x) && f.id !== x))
      .map((f) => f.id);
    expect(unread).toEqual([]);
  });
});

describe('conversions follow their switches', () => {
  it('names the switches a job needs', async () => {
    const { featuresForOp } = await import('../core/convert-types');
    const { isKitTool } = await import('../core/filekit/tools');
    expect(featuresForOp({ tool: 'image.faces' }, isKitTool)).toEqual(['convert', 'faces']);
    expect(featuresForOp({ tool: 'audio.transcribe' }, isKitTool)).toEqual(['convert', 'speechModel']);
    expect(featuresForOp({ tool: 'audio.transcribe', engine: 'service' }, isKitTool)).toEqual(['convert']);
    expect(featuresForOp({ tool: 'convert.to' }, isKitTool)).toContain('fileKit');
  });
});
