// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading a recording's picture for the export, frame by exact frame: the
// bundled ffmpeg copies the coded frames out as they are (no decoding, so it
// is quick) together with a list of their times and sizes, and the page's own
// video decoder turns them into pictures. Also writes IVF, the simple
// container the page's VP8/VP9 encoder output goes into.

export interface Packet { pts: number; dur: number; size: number; offset: number; key: boolean }

export interface PacketIndex {
  codec: string;
  width: number;
  height: number;
  packets: Packet[];
  /** WebCodecs codec string */
  webcodec: string;
}

/** Reads ffmpeg's `-f framecrc` listing: times in milliseconds from the first frame, sizes, byte offsets, key frames. */
export function parseFramecrc(text: string): { codec: string; width: number; height: number; packets: Packet[] } {
  let tb = 1 / 1000, codec = '', width = 0, height = 0;
  const raw: Omit<Packet, 'offset'>[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) {
      const t = line.match(/^#tb 0: (\d+)\/(\d+)/);
      if (t) tb = +t[1] / +t[2];
      const c = line.match(/^#codec_id 0: (\S+)/);
      if (c) codec = c[1];
      const d = line.match(/^#dimensions 0: (\d+)x(\d+)/);
      if (d) { width = +d[1]; height = +d[2]; }
      continue;
    }
    const p = line.split(',').map((x) => x.trim());
    if (p.length < 6 || p[0] !== '0') continue;
    const pts = +p[2], dur = +p[3], size = +p[4];
    if (!Number.isFinite(pts) || !Number.isFinite(size)) continue;
    const flags = p.slice(6).find((x) => x.startsWith('F='));
    // framecrc prints flags only when they differ from "key frame"
    const key = flags ? (parseInt(flags.slice(2), 16) & 1) === 1 : true;
    raw.push({ pts: pts * tb * 1000, dur: dur * tb * 1000, size, key });
  }
  const min = raw.reduce((m, r) => Math.min(m, r.pts), Infinity);
  let offset = 0;
  const packets = raw.map((r) => { const q = { ...r, pts: r.pts - (Number.isFinite(min) ? min : 0), offset }; offset += r.size; return q; });
  return { codec, width, height, packets };
}

const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();

/** "avc1.64002A" from the first sequence parameter set in an Annex B stream. */
export function avcCodecFromAnnexB(b: Uint8Array): string | null {
  for (let i = 0; i + 4 < b.length && i < 4096; i++) {
    const three = b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1;
    if (!three) continue;
    const nal = b[i + 3];
    if ((nal & 0x1f) === 7 && i + 6 < b.length) return `avc1.${hex(b[i + 4])}${hex(b[i + 5])}${hex(b[i + 6])}`;
  }
  return null;
}

/** The WebCodecs codec string for a stream ffmpeg named (first bytes needed for H.264). */
export function webCodecFor(codec: string, first?: Uint8Array): string | null {
  if (codec === 'h264') return (first && avcCodecFromAnnexB(first)) ?? 'avc1.640033';
  if (codec === 'vp8') return 'vp8';
  if (codec === 'vp9') return 'vp09.00.41.08';
  if (codec === 'av1') return 'av01.0.08M.08';
  if (codec === 'hevc') return 'hev1.1.6.L153.B0';
  return null;
}

/** ffmpeg arguments that copy the coded picture of track `stream` into `bin` and list its packets on stdout. */
export function extractArgs(input: string, bin: string, codec: string): string[] {
  const bsf = codec === 'h264' ? ['-bsf:v', 'h264_mp4toannexb'] : codec === 'hevc' ? ['-bsf:v', 'hevc_mp4toannexb'] : [];
  return ['-i', input, '-map', '0:v:0', '-c', 'copy', ...bsf, '-f', 'data', bin, '-map', '0:v:0', '-c', 'copy', ...bsf, '-f', 'framecrc', 'pipe:1'];
}

/** The packets to decode to show the frame at `t`: from the key frame at or before it. */
export function seekIndex(packets: Packet[], t: number): number {
  let best = 0;
  for (let i = 0; i < packets.length; i++) {
    if (packets[i].key && packets[i].pts <= t) best = i;
    if (packets[i].pts > t && packets[i].key) break;
  }
  return best;
}

// ------------------------------------------------------------------ IVF

export function ivfHeader(fourcc: 'VP80' | 'VP90' | 'AV01', width: number, height: number, fps: number, frames: number): Uint8Array {
  const b = new Uint8Array(32);
  const v = new DataView(b.buffer);
  b.set([0x44, 0x4b, 0x49, 0x46]); // DKIF
  v.setUint16(4, 0, true);
  v.setUint16(6, 32, true);
  for (let i = 0; i < 4; i++) b[8 + i] = fourcc.charCodeAt(i);
  v.setUint16(12, width, true);
  v.setUint16(14, height, true);
  v.setUint32(16, fps, true);
  v.setUint32(20, 1, true);
  v.setUint32(24, frames, true);
  return b;
}

export function ivfFrameHeader(size: number, pts: number): Uint8Array {
  const b = new Uint8Array(12);
  const v = new DataView(b.buffer);
  v.setUint32(0, size, true);
  v.setUint32(4, pts >>> 0, true);
  v.setUint32(8, Math.floor(pts / 2 ** 32), true);
  return b;
}
