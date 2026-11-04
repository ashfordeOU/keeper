// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { CONVERT_PRESETS, mainKind, presetOp } from '../core/convert-presets';
import { TOOL_INFO } from '../core/convert-types';

describe('Convert presets', () => {
  it('pick a real tool for each kind of file', () => {
    for (const p of CONVERT_PRESETS) for (const k of ['image', 'video', 'pdf', 'audio', 'other'] as const) {
      const op = presetOp(p.id, [k]);
      if (op) expect(TOOL_INFO[op.tool], `${p.id} ${k}`).toBeTruthy();
    }
  });
  it('Email-friendly makes things small enough to send', () => {
    expect(presetOp('email', ['image', 'image'])).toEqual({ tool: 'image.resize', maxSide: 1600 });
    expect(presetOp('email', ['video'])).toMatchObject({ tool: 'video.compress', targetMb: 20 });
    expect(presetOp('email', ['pdf'])).toMatchObject({ tool: 'pdf.compress' });
  });
  it('For the web makes pictures WebP and videos MP4; One archive packs anything', () => {
    expect(presetOp('web', ['image'])).toMatchObject({ tool: 'image.convert', format: 'webp' });
    expect(presetOp('web', ['video'])).toMatchObject({ tool: 'video.convert', format: 'mp4' });
    expect(presetOp('web', ['other'])).toBeUndefined();
    expect(presetOp('archive', ['image', 'pdf', 'other'])).toEqual({ tool: 'file.zip' });
  });
  it('follow the kind most of the files are', () => {
    expect(mainKind(['image', 'image', 'pdf'])).toBe('image');
    expect(mainKind([])).toBe('other');
  });
});
