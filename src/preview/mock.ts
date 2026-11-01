// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Previews in the browser demo: sample contents for text-based files, the
// demo thumbnails for pictures. Nothing touches a disk.

import { extOf } from '../../core/classify';
import { detectMagic } from '../../core/magic';
import { previewKindOf } from '../../core/previewKind';
import type { PreviewApi, PreviewInfo } from '../../core/previewTypes';
import type { FileEntry } from '../../core/types';

const SAMPLES: Record<string, string> = {
  md: `# Launch plan\n\nEverything we need for **Friday**.\n\n- [x] Final screenshots\n- [x] Release notes\n- [ ] Tell the newsletter\n\n| Task | Owner | Due |\n|---|---|---|\n| Website | Ana | Thu |\n| Press kit | Jo | Fri |\n\n> Keep what you love, let the rest of it go.\n\n\`\`\`ts\nexport const launch = new Date('2026-11-06');\n\`\`\`\n`,
  json: JSON.stringify({ name: 'keeper-demo', version: '1.4.0', private: true, scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '^19.0.0' }, contributors: [{ name: 'Ana Sol', email: 'ana@example.com' }], features: { search: true, island: true, previews: ['images', 'video', 'pdf', 'code'] } }, null, 2),
  csv: 'Month,Visitors,Signups,Conversion\nJanuary,12400,310,2.5%\nFebruary,13900,402,2.9%\nMarch,15200,488,3.2%\nApril,16850,575,3.4%\nMay,18100,640,3.5%\n',
  txt: 'Ideas\n\n- A shelf that follows you from screen to screen\n- Search that understands “last week”\n- Photos that sort themselves by trip\n',
  ts: `// The tiny app this folder belongs to.\nimport { createServer } from 'node:http';\n\nconst port = Number(process.env.PORT ?? 3000);\n\nexport function start(): void {\n  createServer((req, res) => {\n    res.writeHead(200, { 'content-type': 'text/plain' });\n    res.end(\`Hello from \${req.url}\`);\n  }).listen(port, () => console.log(\`Listening on \${port}\`));\n}\n`,
  html: '<!doctype html><html><head><title>Site</title><script>alert("never runs")</script></head><body><h1>Welcome</h1><p>This page is shown with scripts switched off.</p><ul><li>Fast</li><li>Private</li></ul></body></html>',
  log: '2026-10-30 09:00:01 INFO  Server started on port 3000\n2026-10-30 09:00:02 DEBUG Loaded 42 routes\n2026-10-30 09:14:55 WARN  Slow response: /api/search took 1.8s\n2026-10-30 09:15:10 ERROR Database connection lost, retrying\n2026-10-30 09:15:12 INFO  Reconnected\n',
};

export function mockPreview(files: () => FileEntry[], thumb: (f: FileEntry) => string | null): PreviewApi {
  const find = (p: string) => files().find((f) => f.path === p);
  const sample = (p: string) => SAMPLES[extOf(p.split('/').pop()!)] ?? SAMPLES.txt;
  return {
    info: async (p) => {
      const f = find(p);
      const name = p.split('/').pop()!;
      const ext = extOf(name);
      const text = SAMPLES[ext];
      const magic = text ? detectMagic(new TextEncoder().encode(text)) : undefined;
      const kind = previewKindOf(name, ext, !f && !ext, magic);
      const info: PreviewInfo = {
        path: p, name, ext, size: f?.size ?? (text?.length ?? 0), mtime: f?.mtime ?? Date.now(), btime: f?.btime ?? Date.now(), isDir: !f && !ext, kind,
        format: magic?.label ?? (ext ? `${ext.toUpperCase()} file` : 'Folder'), mime: magic?.mime ?? 'application/octet-stream', url: thumb(f ?? ({ path: p, name, ext, kind: 'other' } as FileEntry)) ?? '',
        playable: false,
      };
      if (f?.meta?.camera) info.exif = { model: f.meta.camera, width: f.meta.width, height: f.meta.height, exposure: '1/250 s', fNumber: 1.8, iso: 64, focalLength: 6.9, gps: { lat: 38.7139, lon: -9.1394 } };
      if (f?.kind === 'audio') info.audio = { title: f.name.replace(/\.[^.]+$/, ''), artist: f.meta?.artist, album: f.meta?.album };
      if (info.isDir) info.folder = { files: files().filter((x) => x.path.startsWith(p + '/')).length, folders: 2, size: files().filter((x) => x.path.startsWith(p + '/')).reduce((n, x) => n + x.size, 0), kinds: {}, images: [], truncated: false };
      return info;
    },
    text: async (p) => {
      const t = sample(p);
      return { text: t, encoding: 'UTF-8', truncated: false, size: t.length };
    },
    bytes: async (p) => btoa(sample(p).slice(0, 4096)),
    archive: async () => ({
      entries: [
        { name: 'brand-kit/', size: 0, dir: true },
        { name: 'brand-kit/logo.svg', size: 4120, packed: 1800, dir: false, mtime: Date.now() - 86400000 },
        { name: 'brand-kit/logo@2x.png', size: 182_000, packed: 180_000, dir: false, mtime: Date.now() - 86400000 },
        { name: 'brand-kit/colours.pdf', size: 840_000, packed: 790_000, dir: false, mtime: Date.now() - 86400000 },
        { name: 'brand-kit/fonts/Display-Bold.otf', size: 96_000, packed: 60_000, dir: false, mtime: Date.now() - 86400000 },
        { name: 'README.txt', size: 1200, packed: 600, dir: false, mtime: Date.now() - 86400000 },
      ],
    }),
    extract: async () => { throw new Error('Opening files inside archives works in the desktop app.'); },
    transcode: async () => { throw new Error('Playing media works in the desktop app.'); },
    filmstrip: async () => [],
    image: async (p) => { const f = find(p); const u = f ? thumb(f) : null; return u ? { path: p, url: u, via: 'demo' } : null; },
    storeThumb: async () => false,
    url: (p) => { const f = find(p); return (f && thumb(f)) || ''; },
  };
}
