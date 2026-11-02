// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { clickPress, cursorOpacity, movementTimes, rawAt, ripplesAt, smoothPath, springStep, trackAt } from '../core/studio/cursor';
import { atempo, audioGraph, avcCodec, exportPlan, finishArgs, normalizeExport } from '../core/studio/export';
import { derive, frameAt } from '../core/studio/frame';
import { canRedo, canUndo, push, redo, start, undo, undoLabel } from '../core/studio/history';
import { bubbleMoves, frameLayout, outputSize, toFrame } from '../core/studio/layout';
import { blursFromSamples, captionsFrom, captionsOnOutput, chapterList, chaptersFrom, chaptersOnOutput, ffmetadata, findSensitive, keyBadges, sampleTimes, sensitiveBoxes, toSrt } from '../core/studio/overlays';
import { avcCodecFromAnnexB, ivfFrameHeader, ivfHeader, parseFramecrc, seekIndex } from '../core/studio/packets';
import { clipsWithoutPauses, EventRecorder } from '../core/studio/record';
import { applyRanges, cut, idleRanges, intersect, mergeTouching, nextKept, outputDuration, outToSrc, restoreGap, setSpeed, silentRanges, split, srcToOut, trim } from '../core/studio/timeline';
import { defaultStyle, emptyEvents, normalizeEvents, normalizeProject, normalizeStyle, normalizeTimeline, type EventLog, type StudioProject } from '../core/studio/types';
import { autoZooms, cameraPath, ease, viewAt, zoomLevel } from '../core/studio/zoom';

const clip = (start: number, end: number, speed = 1) => ({ id: `c${start}`, start, end, speed });

/** A pointer that glides from (100,100) to (900,500) over the first second, then rests. */
function glide(): EventLog {
  const ev = emptyEvents();
  for (let t = 0; t <= 1000; t += 16) ev.moves.push(t, 100 + (800 * t) / 1000, 100 + (400 * t) / 1000);
  ev.moves.push(1016, 900, 500);
  return ev;
}

describe('studio timeline', () => {
  const clips = [clip(0, 4000), clip(6000, 10000, 2)];
  it('maps between the recording and the finished video', () => {
    expect(outputDuration(clips)).toBe(6000);
    expect(srcToOut(clips, 1000)).toBe(1000);
    expect(srcToOut(clips, 5000)).toBeNull();
    expect(srcToOut(clips, 8000)).toBe(5000);
    expect(outToSrc(clips, 5000)).toBe(8000);
    expect(outToSrc(clips, 99999)).toBe(10000);
    expect(nextKept(clips, 5000)).toBe(6000);
    expect(nextKept(clips, 11000)).toBeNull();
  });
  it('splits, cuts, trims and changes speed', () => {
    const one = [clip(0, 10000)];
    expect(split(one, 4000).map((c) => [c.start, c.end])).toEqual([[0, 4000], [4000, 10000]]);
    expect(split(one, 10).length).toBe(1);
    expect(cut(one, 3000, 5000).map((c) => [c.start, c.end])).toEqual([[0, 3000], [5000, 10000]]);
    expect(cut(one, 0, 2000).map((c) => [c.start, c.end])).toEqual([[2000, 10000]]);
    expect(trim(one, 1000, 9000).map((c) => [c.start, c.end])).toEqual([[1000, 9000]]);
    const sp = setSpeed(one, 2000, 6000, 4);
    expect(sp.map((c) => [c.start, c.end, c.speed])).toEqual([[0, 2000, 1], [2000, 6000, 4], [6000, 10000, 1]]);
    expect(outputDuration(sp)).toBe(7000);
    expect(mergeTouching(setSpeed(sp, 2000, 6000, 1)).length).toBe(1);
    expect(restoreGap(cut(one, 3000, 5000), 0).map((c) => [c.start, c.end])).toEqual([[0, 10000]]);
  });
  it('finds idle and silent stretches and applies them', () => {
    const ev = emptyEvents();
    ev.moves.push(0, 10, 10, 500, 50, 50, 600, 60, 60);
    ev.clicks.push({ t: 9000, x: 60, y: 60 });
    const idle = idleRanges(ev, 12000, { minMs: 3000, margin: 500 });
    expect(idle).toEqual([{ start: 1100, end: 8500 }, { start: 9500, end: 12000 }]);
    const levels = new Float32Array(120).fill(0.2);
    levels.fill(0.001, 20, 90); // 2 s .. 9 s quiet (100 ms steps)
    const quiet = silentRanges(levels, 100, { minMs: 1500, margin: 250 });
    expect(quiet).toEqual([{ start: 2250, end: 8750 }]);
    const both = intersect(idle, quiet);
    expect(both).toEqual([{ start: 2250, end: 8500 }]);
    const sped = applyRanges([clip(0, 12000)], both, 'speed', 8);
    expect(outputDuration(sped)).toBeCloseTo(12000 - 6250 + 6250 / 8, 5);
    expect(outputDuration(applyRanges([clip(0, 12000)], both, 'cut'))).toBe(12000 - 6250);
  });
});

describe('studio cursor', () => {
  it('interpolates raw samples', () => {
    const ev = glide();
    expect(rawAt(ev.moves, 500)[0]).toBeCloseTo(500, 0);
    expect(rawAt(ev.moves, -10)).toEqual([100, 100]);
    expect(rawAt(ev.moves, 5000)).toEqual([900, 500]);
  });
  it('a critically damped spring settles without overshoot', () => {
    let x = 0, v = 0, max = 0;
    for (let i = 0; i < 400; i++) { [x, v] = springStep(x, v, 100, 20, 1 / 120); max = Math.max(max, x); }
    expect(max).toBeLessThanOrEqual(100.0001);
    expect(x).toBeCloseTo(100, 3);
  });
  it('smooths the path, keeps up with it and lands where it stopped', () => {
    const ev = glide();
    const tr = smoothPath(ev, 3000, 0.6);
    const mid = trackAt(tr, 500);
    expect(Math.abs(mid.x - 500)).toBeLessThan(60);
    const end = trackAt(tr, 2500);
    expect(end.x).toBeCloseTo(900, 0);
    expect(end.y).toBeCloseTo(500, 0);
    // no smoothing: exactly the raw path
    const raw = smoothPath(ev, 3000, 0);
    expect(trackAt(raw, 500).x).toBeCloseTo(500, 0);
    // the same input always gives the same path
    expect(smoothPath(ev, 3000, 0.6).xy).toEqual(tr.xy);
  });
  it('is pinned to the spot of a click', () => {
    const ev = glide();
    ev.clicks.push({ t: 400, x: 420, y: 260 });
    const tr = smoothPath(ev, 2000, 1);
    const at = trackAt(tr, 400);
    expect(at.x).toBeCloseTo(rawAt(ev.moves, 400)[0], 0);
  });
  it('fades out while resting, comes back just before moving', () => {
    const ev = glide();
    ev.moves.push(8000, 950, 500);
    const moved = movementTimes(ev);
    const style = { hideIdle: true, idleMs: 2000 };
    expect(cursorOpacity(moved, 1500, style)).toBe(1);
    expect(cursorOpacity(moved, 5000, style)).toBe(0);
    expect(cursorOpacity(moved, 7950, style)).toBeGreaterThan(0);
    expect(cursorOpacity(moved, 5000, { hideIdle: false, idleMs: 2000 })).toBe(1);
  });
  it('ripples and presses on clicks', () => {
    const ev = emptyEvents();
    ev.clicks.push({ t: 1000, x: 5, y: 6 });
    expect(ripplesAt(ev, 1100)).toHaveLength(1);
    expect(ripplesAt(ev, 1100)[0].k).toBeCloseTo(100 / 450);
    expect(ripplesAt(ev, 2000)).toHaveLength(0);
    expect(clickPress(ev, 1000)).toBeCloseTo(0.82);
    expect(clickPress(ev, 3000)).toBe(1);
  });
});

describe('studio zooms', () => {
  const size = { width: 1920, height: 1080 };
  it('makes one zoom per burst of clicks and typing', () => {
    const ev = emptyEvents();
    ev.clicks.push({ t: 2000, x: 300, y: 300 }, { t: 3000, x: 350, y: 320 }, { t: 15000, x: 1500, y: 900 });
    for (let t = 20000; t < 22000; t += 150) ev.keys.push({ t, key: 'a', mods: [] });
    ev.keys.push({ t: 30000, key: 'c', mods: ['ctrl'] });
    const z = autoZooms(ev, 40000, size, { depth: 2 }, () => [800, 600]);
    expect(z).toHaveLength(3);
    expect(z[0].start).toBe(1300);
    expect(z[0].end).toBe(4600);
    expect(z[0].scale).toBe(2);
    expect(z.every((x) => x.auto && x.follow)).toBe(true);
    // typing zooms a little less
    expect(z[2].scale).toBeLessThan(2);
    // right clicks and single shortcuts do not zoom
    const ev2 = emptyEvents();
    ev2.clicks.push({ t: 1000, x: 1, y: 1, right: true });
    expect(autoZooms(ev2, 5000, size, { depth: 2 })).toHaveLength(0);
  });
  it('zooms less when the clicks are spread out, and merges close zooms', () => {
    const ev = emptyEvents();
    ev.clicks.push({ t: 1000, x: 100, y: 100 }, { t: 2000, x: 1800, y: 1000 });
    expect(autoZooms(ev, 9000, size, { depth: 2.5 })[0].scale).toBeLessThan(1.4);
    const ev2 = emptyEvents();
    ev2.clicks.push({ t: 1000, x: 100, y: 100 }, { t: 4000, x: 120, y: 100 });
    expect(autoZooms(ev2, 9000, size, { depth: 2, gap: 2000 })).toHaveLength(1);
  });
  it('eases in and out of a zoom', () => {
    const z = [{ id: 'z', start: 1000, end: 5000, scale: 2, follow: true }];
    expect(zoomLevel(z, 500, 600).scale).toBe(1);
    expect(zoomLevel(z, 1300, 600).scale).toBeCloseTo(1.5, 5);
    expect(zoomLevel(z, 3000, 600).scale).toBe(2);
    expect(zoomLevel(z, 4700, 600).scale).toBeCloseTo(1.5, 5);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });
  it('the camera stays inside the picture and follows the pointer while zoomed', () => {
    const ev = glide();
    const cur = smoothPath(ev, 6000, 0.5);
    const c = { zooms: [{ id: 'z', start: 0, end: 6000, scale: 2, follow: true }], easeMs: 300, width: 1920, height: 1080, baseW: 1920, baseH: 1080, reframe: false };
    const cam = cameraPath(cur, 6000, c);
    for (const t of [0, 500, 1500, 3000, 5900]) {
      const v = viewAt(cam, t, c);
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.y).toBeGreaterThanOrEqual(0);
      expect(v.x + v.w).toBeLessThanOrEqual(1920.001);
      expect(v.y + v.h).toBeLessThanOrEqual(1080.001);
    }
    const v = viewAt(cam, 4000, c);
    expect(v.w).toBeCloseTo(960, 0);
    // the pointer at (900,500) is in view
    expect(900).toBeGreaterThan(v.x);
    expect(900).toBeLessThan(v.x + v.w);
    // a fixed-spot zoom looks at its spot
    const fixed = { ...c, zooms: [{ id: 'f', start: 0, end: 6000, scale: 2, follow: false, x: 0.75, y: 0.75 }] };
    const fv = viewAt(cameraPath(cur, 6000, fixed), 5000, fixed);
    expect(fv.x + fv.w / 2).toBeCloseTo(1440, -1);
  });
});

describe('studio layout', () => {
  const src = { width: 2880, height: 1800 };
  it('sizes the output for an aspect and resolution', () => {
    expect(outputSize('16:9', src, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize('9:16', src, 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('1:1', src, 720)).toEqual({ width: 720, height: 720 });
    expect(outputSize('4:5', src, 1080)).toEqual({ width: 1080, height: 1350 });
    expect(outputSize('source', src, 1080)).toEqual({ width: 1728, height: 1080 });
  });
  it('fits the picture in the padding, or reframes a tall frame', () => {
    const st = { ...defaultStyle().frame, padding: 0.1 };
    const wide = frameLayout(st, src, { width: 1920, height: 1080 });
    expect(wide.reframe).toBe(false);
    expect(wide.box.h).toBeCloseTo(864);
    expect(wide.box.w / wide.box.h).toBeCloseTo(1.6, 3);
    const tall = frameLayout(st, src, { width: 1080, height: 1920 });
    expect(tall.reframe).toBe(true);
    expect(tall.baseH).toBe(1800);
    expect(tall.baseW / tall.baseH).toBeCloseTo(tall.box.w / tall.box.h, 5);
    const noRe = frameLayout({ ...st, reframe: false }, src, { width: 1080, height: 1920 });
    expect(noRe.reframe).toBe(false);
    expect(noRe.box.w).toBeCloseTo(1080 - 216);
    expect(toFrame({ x: 0, y: 0 }, { x: 0, y: 0, w: 2880, h: 1800 }, wide.box)).toEqual({ x: wide.box.x, y: wide.box.y });
  });
  it('moves the camera bubble out of the pointer’s way', () => {
    const ev = emptyEvents();
    ev.moves.push(0, 100, 100, 3000, 2800, 1750, 4000, 100, 1750, 9000, 100, 100, 9500, 100, 1750);
    const m = bubbleMoves(ev, src, { ...defaultStyle().camera, corner: 'br', autoMove: true });
    expect(m.map((x) => x.corner)).toEqual(['br', 'bl', 'br']);
    expect(bubbleMoves(ev, src, { ...defaultStyle().camera, autoMove: false })).toHaveLength(1);
  });
});

describe('studio export plan', () => {
  const src = { width: 1920, height: 1080 };
  const clips = [clip(0, 4000), clip(6000, 10000, 2)];
  it('plans frames, size and encoder', () => {
    const p = exportPlan(src, '16:9', clips, { format: 'mp4', lines: 1080, fps: 60 }, { h264: true, vp9: true });
    expect(p.out).toEqual({ width: 1920, height: 1080 });
    expect(p.frames).toBe(360);
    expect(p.intermediate).toBe('h264');
    expect(p.copyVideo).toBe(true);
    expect(p.codec).toBe('avc1.640032');
    const g = exportPlan(src, '16:9', clips, { format: 'gif', lines: 1080, fps: 60 }, { h264: true, vp9: true });
    expect(g.out.height).toBe(720);
    expect(g.fps).toBe(24);
    expect(g.copyVideo).toBe(false);
    const noH264 = exportPlan(src, '16:9', clips, { format: 'mp4' }, { h264: false, vp9: true });
    expect(noH264.intermediate).toBe('vp9');
    expect(noH264.copyVideo).toBe(false);
    expect(avcCodec({ width: 3840, height: 2160 }, 60)).toBe('avc1.640034');
    expect(avcCodec({ width: 1280, height: 720 }, 30)).toBe('avc1.640028');
    expect(normalizeExport({ format: 'gif', lines: 2160, fps: 60 }).lines).toBe(720);
  });
  it('builds the audio graph that matches the timeline', () => {
    expect(atempo(1)).toBe('');
    expect(atempo(2)).toBe('atempo=2');
    expect(atempo(0.25)).toBe('atempo=0.5,atempo=0.5');
    const g = audioGraph([{ path: 'mic.webm', offset: 120, volume: 1, denoise: true }, { path: 'sys.webm', offset: -40, volume: 0.8, denoise: false }], clips, 10000, { normalize: true }, 1)!;
    expect(g.label).toBe('[aout]');
    expect(g.graph).toContain('[1:a]');
    expect(g.graph).toContain('adelay=120:all=1');
    expect(g.graph).toContain('atrim=start=0.040');
    expect(g.graph).toContain('asplit=2');
    expect(g.graph).toContain('atrim=start=6.000:end=10.000,asetpts=PTS-STARTPTS,atempo=2');
    expect(g.graph).toContain('afftdn');
    expect(g.graph).toContain('amix=inputs=2');
    expect(g.graph).toContain('loudnorm');
    expect(audioGraph([], clips, 10000, { normalize: true }, 1)).toBeNull();
  });
  it('builds ffmpeg arguments for each format', () => {
    const plan = exportPlan(src, '16:9', clips, { format: 'mp4', lines: 720, fps: 30 }, { h264: true, vp9: true });
    const a = finishArgs(plan, { video: 'v.h264', audio: [{ path: 'm.webm', offset: 0, volume: 1, denoise: false }], meta: 'meta.txt' }, clips, 10000, { normalize: false }, 'out.mp4');
    expect(a.slice(0, 6)).toEqual(['-framerate', '30', '-f', 'h264', '-i', 'v.h264']);
    expect(a).toContain('-map_chapters');
    expect(a.join(' ')).toContain('-c:v copy');
    expect(a.at(-1)).toBe('out.mp4');
    const gif = finishArgs(exportPlan(src, '16:9', clips, { format: 'gif' }, { h264: true, vp9: true }), { video: 'v.h264', audio: [{ path: 'm.webm', offset: 0, volume: 1, denoise: false }] }, clips, 10000, { normalize: false }, 'out.gif');
    expect(gif.join(' ')).toContain('palettegen');
    expect(gif).not.toContain('m.webm');
    const hevc = finishArgs(exportPlan(src, '16:9', clips, { format: 'hevc' }, { h264: true, vp9: true }), { video: 'v.h264', audio: [] }, clips, 10000, { normalize: false }, 'o.mp4', { hevc: 'hevc_videotoolbox' });
    expect(hevc.join(' ')).toContain('hevc_videotoolbox');
    expect(hevc).toContain('hvc1');
  });
});

describe('studio overlays', () => {
  it('captions from speech, cut to the timeline, as .srt', () => {
    const caps = captionsFrom([{ start: 1, end: 3, text: ' Hello there, this is a longer sentence that will need to be split into parts ' }], 500, 30);
    expect(caps.length).toBeGreaterThan(1);
    expect(caps[0].start).toBe(1500);
    expect(caps.at(-1)!.end).toBe(3500);
    const out = captionsOnOutput([{ start: 1000, end: 3000, text: 'a' }, { start: 5000, end: 6000, text: 'gone' }], [clip(0, 2000), clip(7000, 9000)]);
    expect(out).toEqual([{ start: 1000, end: 2000, text: 'a' }]);
    expect(toSrt([{ start: 61001, end: 3723004, text: 'Hi' }])).toBe('1\n00:01:01,001 --> 01:02:03,004\nHi\n');
  });
  it('chapters from the apps used', () => {
    const ev = emptyEvents();
    ev.focus.push({ t: 0, app: 'Terminal' }, { t: 2000, app: 'Browser' }, { t: 2500, app: 'Editor' }, { t: 12000, app: 'Editor' }, { t: 20000, app: 'Browser' });
    const ch = chaptersFrom(ev, 30000);
    expect(ch.map((c) => c.title)).toEqual(['Editor', 'Browser']);
    expect(ch[0].t).toBe(0);
    const out = chaptersOnOutput(ch, [clip(0, 10000), clip(15000, 30000)]);
    expect(out.map((c) => c.t)).toEqual([0, 15000]);
    expect(chapterList(out)).toBe('0:00 Editor\n0:15 Browser');
    expect(ffmetadata(out, 25000)).toContain('START=15000\nEND=25000\ntitle=Browser');
  });
  it('shortcut badges', () => {
    const ev = emptyEvents();
    ev.keys.push({ t: 0, key: 'a', mods: [] }, { t: 100, key: 'k', mods: ['cmd'] }, { t: 400, key: 'k', mods: ['cmd'] }, { t: 5000, key: 's', mods: ['ctrl', 'shift'] });
    const b = keyBadges(ev, true, true);
    expect(b.map((x) => [x.label, x.count])).toEqual([['⌘K', 2], ['⌃⇧S', 1]]);
    expect(keyBadges(ev, false, false)[0].label).toBe('A');
    expect(keyBadges(ev, false, true)[1].label).toBe('Ctrl+Shift+S');
  });
  it('finds things to blur', () => {
    const kinds = (s: string) => findSensitive(s).map((h) => h.kind);
    expect(kinds('mail jane.doe@example.com now')).toEqual(['email']);
    expect(kinds('export AWS_KEY=AKIAABCDEFGHIJKLMNOP')).toEqual(['key']);
    expect(kinds('token ghp_' + 'a'.repeat(36))).toEqual(['key']);
    expect(kinds('sk-' + 'Ab1'.repeat(10))).toEqual(['key']);
    expect(kinds('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')).toEqual(['token']);
    expect(kinds('card 4111 1111 1111 1111')).toEqual(['card']);
    expect(kinds('not a card 1234 5678 9012 3456')).toEqual([]);
    expect(kinds('just some ordinary words and a version 1.2.3')).toEqual([]);
    const boxes = sensitiveBoxes([{ text: 'to: a@b.co', x0: 0, y0: 0, x1: 100, y1: 10 }], { width: 1000, height: 100 });
    expect(boxes).toHaveLength(1);
    expect(boxes[0].x).toBeCloseTo((40 - 2.5) / 1000, 4);
    const blurs = blursFromSamples([
      { t: 1000, boxes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.05, kind: 'email' }] },
      { t: 2000, boxes: [{ x: 0.1, y: 0.1, w: 0.21, h: 0.05, kind: 'email' }] },
      { t: 6000, boxes: [{ x: 0.5, y: 0.5, w: 0.1, h: 0.05, kind: 'key' }] },
    ], 1000, 10000);
    expect(blurs).toHaveLength(2);
    expect(blurs[0].start).toBe(0);
    expect(blurs[0].end).toBe(3000);
    expect(sampleTimes([clip(0, 3000)], 1000)).toEqual([200, 1200, 2200]);
  });
});

describe('studio event recording', () => {
  it('stamps events from the first frame, in picture pixels, leaving pauses out', () => {
    let now = 10_000;
    const r = new EventRecorder({ x: 100, y: 50, w: 800, h: 600, scale: 2 }, () => now);
    r.move({ x: 110, y: 60 });
    now = 10_050;
    r.setStart(10_040);
    r.move({ x: 120, y: 70 });
    now = 10_500;
    r.click({ x: 120, y: 70 });
    r.pause();
    now = 11_000;
    r.click({ x: 1, y: 1 });
    r.resume();
    now = 11_200;
    r.key('a', ['cmd']);
    r.focus('Editor');
    const log = r.finish(5000);
    expect(log.moves).toEqual([0, 20, 20, 10, 40, 40]);
    expect(log.clicks).toEqual([{ t: 460, x: 40, y: 40, right: undefined }]);
    expect(log.keys).toEqual([{ t: 1160, key: 'a', mods: ['cmd'] }]);
    expect(r.pauses).toEqual([{ start: 460, end: 960 }]);
    expect(clipsWithoutPauses(5000, r.pauses)).toEqual([{ start: 0, end: 460 }, { start: 960, end: 5000 }]);
  });
});

describe('studio packets', () => {
  it('reads ffmpeg’s packet listing', () => {
    const txt = '#tb 0: 1/1000\n#media_type 0: video\n#codec_id 0: h264\n#dimensions 0: 640x360\n0,          0,          0,       33,    1000, 0x1\n0,         33,         33,       33,      200, 0x2, F=0x0\n0,         66,         66,       33,      300, 0x3\n';
    const p = parseFramecrc(txt);
    expect(p.codec).toBe('h264');
    expect(p.width).toBe(640);
    expect(p.packets.map((x) => [x.pts, x.size, x.offset, x.key])).toEqual([[0, 1000, 0, true], [33, 200, 1000, false], [66, 300, 1200, true]]);
    expect(seekIndex(p.packets, 50)).toBe(0);
    expect(seekIndex(p.packets, 70)).toBe(2);
    const sps = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x2a, 0xac]);
    expect(avcCodecFromAnnexB(sps)).toBe('avc1.64002A');
    expect(ivfHeader('VP80', 640, 360, 30, 10).length).toBe(32);
    expect(Array.from(ivfFrameHeader(5, 7).slice(0, 5))).toEqual([5, 0, 0, 0, 7]);
  });
});

describe('studio history', () => {
  it('undoes and redoes, merging quick changes of one kind', () => {
    let h = start(1);
    h = push(h, 2, 'Zoom', 0);
    h = push(h, 3, 'Zoom', 100);
    h = push(h, 4, 'Cut', 2000);
    expect(h.past.map((p) => p.value)).toEqual([1, 3]);
    expect(undoLabel(h)).toBe('Cut');
    h = undo(h);
    expect(h.present).toBe(3);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toBe(3);
    expect(canRedo(h)).toBe(true);
    h = push(h, 9, 'Speed', 5000);
    expect(canRedo(h)).toBe(false);
  });
});

describe('studio project', () => {
  const raw = { meta: { duration: 10000, width: 1920, height: 1080, screen: { file: 'screen.mp4', offset: 0 } } };
  it('normalizes projects, styles, timelines and events', () => {
    const p = normalizeProject(raw)!;
    expect(p.timeline.clips).toEqual([{ id: 'c0', start: 0, end: 10000, speed: 1 }]);
    expect(p.style.frame.aspect).toBe('source');
    expect(normalizeProject({ meta: {} })).toBeNull();
    expect(normalizeStyle({ frame: { padding: 9, aspect: 'nope' }, cursor: { size: -1 } }).frame.padding).toBe(0.25);
    const tl = normalizeTimeline({ clips: [{ start: 0, end: 5000 }, { start: 4000, end: 8000 }, { start: 9000, end: 99999, speed: 100 }] }, 10000);
    expect(tl.clips.map((c) => [c.start, c.end, c.speed])).toEqual([[0, 5000, 1], [9000, 10000, 16]]);
    expect(normalizeEvents({ moves: [1, 2, 3, 4], clicks: [{ t: 1, x: 2, y: 3 }, { t: 'x' }] })).toEqual({ moves: [1, 2, 3], clicks: [{ t: 1, x: 2, y: 3, right: undefined }], keys: [], scrolls: [], focus: [] });
  });
  it('works out frames the same way every time', () => {
    const p = normalizeProject(raw) as StudioProject;
    p.timeline.zooms = [{ id: 'z', start: 0, end: 10000, scale: 2, follow: true }];
    p.timeline.blurs = [{ id: 'b', start: 0, end: 10000, x: 0.5, y: 0.5, w: 0.1, h: 0.1 }];
    const ev = glide();
    ev.clicks.push({ t: 2000, x: 900, y: 500 });
    const d = derive(p, ev, { width: 1280, height: 720 }, false);
    const f1 = frameAt(p, ev, d, 2100, 30, true);
    const f2 = frameAt(p, ev, derive(p, ev, { width: 1280, height: 720 }, false), 2100, 30, true);
    expect(f1).toEqual(f2);
    expect(f1.cursor).not.toBeNull();
    expect(f1.ripples).toHaveLength(1);
    expect(f1.blurs).toHaveLength(1);
    expect(f1.bubble).not.toBeNull();
    // the pointer drawn where the recording had it
    const v = f1.view;
    expect(f1.cursor!.x).toBeCloseTo(d.layout.box.x + ((900 - v.x) / v.w) * d.layout.box.w, 0);
    // a recording with the system pointer in it gets no second pointer
    const withCursor = { ...p, meta: { ...p.meta, cursorInVideo: true } };
    expect(frameAt(withCursor, ev, d, 2100).cursor).toBeNull();
  });
});

describe('studio ffmpeg output', () => {
  it('reads a file’s length, picture and sound', async () => {
    const { parseProbe, parseStart } = await import('../core/studio/probe');
    const p = parseProbe("Input #0, matroska,webm, from 'x.webm':\n  Duration: 00:01:02.50, start: 0.000000, bitrate: 1 kb/s\n  Stream #0:0: Video: vp9 (Profile 0), yuv420p(tv), 1920x1080, SAR 1:1 DAR 16:9, 60 fps, 60 tbr, 1k tbn (default)\n  Stream #0:1: Audio: opus, 48000 Hz, stereo, fltp (default)\n");
    expect(p).toEqual({ duration: 62500, start: 0, video: { codec: 'vp9', width: 1920, height: 1080, fps: 60 }, audio: true });
    expect(parseProbe('nothing').video).toBeUndefined();
    expect(parseStart("Input #0, x11grab, from ':99+0,0':\n  Duration: N/A, start: 1793643532.856465, bitrate: 1 kb/s")).toBeCloseTo(1793643532856.465, 1);
    expect(parseStart("Input #0, matroska, from 'a':\n  Duration: N/A, start: 0.0")).toBeNull();
  });
});
