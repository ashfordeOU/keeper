// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Song details and cover art from ID3v2 tags (MP3) and the "covr"/"©nam"
// atoms of MPEG-4 audio (M4A). Only the start of the file is needed.

export interface AudioTags {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  track?: string;
  cover?: { mime: string; data: Uint8Array };
}

const syncsafe = (b: Uint8Array, p: number) => (b[p] << 21) | (b[p + 1] << 14) | (b[p + 2] << 7) | b[p + 3];
const u32 = (b: Uint8Array, p: number) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;

function decodeString(enc: number, data: Uint8Array): string {
  let text: string;
  if (enc === 1 || enc === 2) {
    let d = data;
    let le = enc === 1;
    if (d[0] === 0xff && d[1] === 0xfe) { le = true; d = d.subarray(2); }
    else if (d[0] === 0xfe && d[1] === 0xff) { le = false; d = d.subarray(2); }
    text = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(d);
  } else if (enc === 3) text = new TextDecoder('utf-8').decode(data);
  else text = new TextDecoder('latin1').decode(data);
  return text.replace(/\0+$/, '').split('\0')[0].trim();
}

/** Index after a NUL terminator for the given text encoding. */
function afterTerminator(d: Uint8Array, from: number, enc: number): number {
  if (enc === 1 || enc === 2) {
    for (let i = from; i < d.length - 1; i += 2) if (d[i] === 0 && d[i + 1] === 0) return i + 2;
    return d.length;
  }
  for (let i = from; i < d.length; i++) if (d[i] === 0) return i + 1;
  return d.length;
}

export function readId3(b: Uint8Array): AudioTags | undefined {
  if (!(b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33)) return undefined;
  const major = b[3];
  const flags = b[5];
  const size = syncsafe(b, 6);
  let p = 10;
  if (flags & 0x40) p += major === 4 ? syncsafe(b, 10) : u32(b, 10) + 4;
  const end = Math.min(b.length, 10 + size);
  const tags: AudioTags = {};
  const idLen = major === 2 ? 3 : 4;
  while (p + idLen * 2 < end) {
    const id = String.fromCharCode(...b.subarray(p, p + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const len = major === 2 ? (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5] : major === 4 ? syncsafe(b, p + 4) : u32(b, p + 4);
    const hdr = major === 2 ? 6 : 10;
    const data = b.subarray(p + hdr, Math.min(end, p + hdr + len));
    p += hdr + len;
    if (!len) continue;
    const enc = data[0];
    const text = () => decodeString(enc, data.subarray(1));
    switch (id) {
      case 'TIT2': case 'TT2': tags.title = text(); break;
      case 'TPE1': case 'TP1': tags.artist = text(); break;
      case 'TALB': case 'TAL': tags.album = text(); break;
      case 'TYER': case 'TDRC': case 'TYE': tags.year = text().slice(0, 4); break;
      case 'TCON': case 'TCO': tags.genre = text().replace(/^\((\d+)\)/, ''); break;
      case 'TRCK': case 'TRK': tags.track = text(); break;
      case 'APIC': {
        const mimeEnd = afterTerminator(data, 1, 0);
        const mime = new TextDecoder('latin1').decode(data.subarray(1, mimeEnd - 1)) || 'image/jpeg';
        const descEnd = afterTerminator(data, mimeEnd + 1, enc);
        if (!tags.cover) tags.cover = { mime: mime.includes('/') ? mime : `image/${mime.toLowerCase()}`, data: data.slice(descEnd) };
        break;
      }
      case 'PIC': {
        const fmt = new TextDecoder('latin1').decode(data.subarray(1, 4));
        const descEnd = afterTerminator(data, 5, enc);
        if (!tags.cover) tags.cover = { mime: fmt.toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg', data: data.slice(descEnd) };
        break;
      }
    }
  }
  return tags;
}

/** MPEG-4 audio metadata (moov/udta/meta/ilst). */
export function readMp4Tags(b: Uint8Array): AudioTags | undefined {
  const find = (start: number, end: number, path: string[]): [number, number] | undefined => {
    let p = start;
    while (p + 8 <= end) {
      let size = u32(b, p);
      const type = String.fromCharCode(...b.subarray(p + 4, p + 8));
      if (size === 1) size = Number(new DataView(b.buffer, b.byteOffset + p + 8, 8).getBigUint64(0));
      if (size === 0) size = end - p;
      if (size < 8) return undefined;
      if (type === path[0]) {
        const bodyStart = p + 8 + (type === 'meta' ? 4 : 0);
        return path.length === 1 ? [bodyStart, p + size] : find(bodyStart, Math.min(end, p + size), path.slice(1));
      }
      p += size;
    }
    return undefined;
  };
  const ilst = find(0, b.length, ['moov', 'udta', 'meta', 'ilst']);
  if (!ilst) return undefined;
  const tags: AudioTags = {};
  let p = ilst[0];
  while (p + 8 <= ilst[1]) {
    const size = u32(b, p);
    if (size < 8) break;
    const key = String.fromCharCode(...b.subarray(p + 4, p + 8));
    const data = find(p + 8, p + size, ['data']);
    if (data) {
      const type = u32(b, data[0]) & 0xffffff;
      const value = b.subarray(data[0] + 8, data[1]);
      const str = () => new TextDecoder('utf-8').decode(value);
      if (key === '©nam') tags.title = str();
      else if (key === '©ART' || key === 'aART') tags.artist ??= str();
      else if (key === '©alb') tags.album = str();
      else if (key === '©day') tags.year = str().slice(0, 4);
      else if (key === '©gen') tags.genre = str();
      else if (key === 'trkn' && value.length >= 4) tags.track = String((value[2] << 8) | value[3]);
      else if (key === 'covr') tags.cover = { mime: type === 14 ? 'image/png' : 'image/jpeg', data: value.slice() };
    }
    p += size;
  }
  return tags;
}
