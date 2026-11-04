// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo pictures for the photo editor's end-to-end tests and screenshots, all
// drawn here (no real photos, no real places): a lakeside landscape with a
// camera's details and a place in its EXIF, a vase on a table for cutting out,
// a beach to put behind it, a see-through sticker, a 24-megapixel picture, a
// moving GIF, an icon, a drawing, a BMP, a flattened Photoshop file and a
// camera RAW file holding its full-size preview (as cameras save them).
// Usage: node test/e2e/photo-samples.cjs <folder>   (or require it and call make(folder))

const fs = require('fs');
const path = require('path');
const sharp = require(path.resolve(__dirname, '../../node_modules/sharp'));

const LAKE = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1200 800">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d9bd1"/><stop offset=".6" stop-color="#bcd3e8"/><stop offset="1" stop-color="#f1d9b5"/></linearGradient>
<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5f86a8"/><stop offset="1" stop-color="#2d4a63"/></linearGradient>
<filter id="soft"><feGaussianBlur stdDeviation="6"/></filter></defs>
<rect width="1200" height="800" fill="url(#sky)"/>
<circle cx="860" cy="230" r="70" fill="#fff3cf" opacity=".9" filter="url(#soft)"/>
<path d="M0 470 160 330 300 420 470 260 640 410 820 300 1000 400 1200 330V520H0z" fill="#6f7f95"/>
<path d="M0 500 200 410 380 470 560 380 760 460 960 400 1200 450V540H0z" fill="#46604a"/>
<rect y="530" width="1200" height="270" fill="url(#water)"/>
<path d="M0 530h1200v14H0z" fill="#9db7cc" opacity=".5"/>
<g fill="#29402c"><path d="M90 560 120 470 150 560z"/><path d="M140 575 175 455 210 575z"/><path d="M1040 565 1075 470 1110 565z"/></g>
<path d="M520 640c40-10 120-10 160 0-40 6-120 6-160 0z" fill="#d9e6ef" opacity=".6"/>
</svg>`;

const VASE = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200" viewBox="0 0 1800 1200">
<defs>
<linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9b8a2"/><stop offset="1" stop-color="#9f8f7d"/></linearGradient>
<linearGradient id="table" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5a3b"/><stop offset="1" stop-color="#5e3a24"/></linearGradient>
<radialGradient id="glaze" cx=".35" cy=".35" r=".8"><stop offset="0" stop-color="#7fd0c9"/><stop offset=".55" stop-color="#2a8f8a"/><stop offset="1" stop-color="#155652"/></radialGradient>
<filter id="blur"><feGaussianBlur stdDeviation="18"/></filter>
</defs>
<rect width="1800" height="1200" fill="url(#wall)"/>
<g opacity=".18" fill="#fff"><rect x="120" y="80" width="300" height="520" rx="8"/><rect x="1360" y="120" width="260" height="420" rx="8"/></g>
<rect y="860" width="1800" height="340" fill="url(#table)"/>
<path d="M0 860h1800v10H0z" fill="#b07a55"/>
<ellipse cx="930" cy="905" rx="240" ry="34" fill="#000" opacity=".35" filter="url(#blur)"/>
<path d="M800 420c-30 70-120 150-120 290 0 120 90 190 220 190s220-70 220-190c0-140-90-220-120-290 20-30 30-60 10-80H790c-20 20-10 50 10 80z" fill="url(#glaze)"/>
<ellipse cx="900" cy="342" rx="110" ry="22" fill="#1d6f6a"/>
<ellipse cx="900" cy="340" rx="86" ry="14" fill="#0e3b38"/>
<path d="M760 560c-30 60-40 160 0 230" stroke="#c8f1ec" stroke-width="18" fill="none" opacity=".55" stroke-linecap="round"/>
<g stroke="#3f6b2f" stroke-width="10" fill="none" stroke-linecap="round"><path d="M880 340C860 250 820 180 760 130"/><path d="M910 340c10-110 40-190 100-250"/><path d="M895 340c0-90-10-160-30-220"/></g>
<g><circle cx="760" cy="125" r="48" fill="#f2c14e"/><circle cx="760" cy="125" r="18" fill="#a8641c"/><circle cx="1012" cy="88" r="56" fill="#e9785f"/><circle cx="1012" cy="88" r="20" fill="#8c3324"/><circle cx="865" cy="112" r="40" fill="#f6efe2"/><circle cx="865" cy="112" r="14" fill="#d6a23b"/></g>
</svg>`;

const BEACH = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb37a"/><stop offset=".5" stop-color="#ffd7a8"/><stop offset="1" stop-color="#fff1d9"/></linearGradient></defs>
<rect width="1600" height="1000" fill="url(#s)"/><circle cx="1150" cy="420" r="110" fill="#fff6e5"/>
<rect y="520" width="1600" height="200" fill="#3f8fb5"/><rect y="700" width="1600" height="300" fill="#e8cf9e"/></svg>`;

/** A minimal camera RAW file: a TIFF header whose first directory says "turned left" (orientation 8), the camera's full-size JPEG preview, and a small thumbnail. */
async function rawFile(file, jpeg, thumb) {
  const head = Buffer.alloc(64);
  head.write('II', 0, 'latin1');
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(8, 4);
  head.writeUInt16LE(2, 8);
  // Make (inline "Demo") and Orientation 8.
  head.writeUInt16LE(0x010f, 10); head.writeUInt16LE(2, 12); head.writeUInt32LE(4, 14); head.write('Demo', 18, 'latin1');
  head.writeUInt16LE(0x0112, 22); head.writeUInt16LE(3, 24); head.writeUInt32LE(1, 26); head.writeUInt16LE(8, 30);
  head.writeUInt32LE(0, 34);
  // Sensor data stands in as noise, then the previews.
  const sensor = Buffer.alloc(200_000);
  for (let i = 0; i < sensor.length; i++) sensor[i] = (i * 2654435761) >>> 24 & 0x7f;
  fs.writeFileSync(file, Buffer.concat([head, thumb, sensor, jpeg]));
}

function bmp24(w, h, rgb) {
  const stride = Math.ceil((w * 3) / 4) * 4;
  const b = Buffer.alloc(54 + stride * h);
  b.write('BM', 0, 'latin1'); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(stride * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, bl] = rgb(x, h - 1 - y); const o = 54 + y * stride + x * 3; b[o] = bl; b[o + 1] = g; b[o + 2] = r; }
  return b;
}

function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach((p, i) => { const at = 6 + i * 16; head[at] = p.size >= 256 ? 0 : p.size; head[at + 1] = p.size >= 256 ? 0 : p.size; head.writeUInt16LE(1, at + 4); head.writeUInt16LE(32, at + 6); head.writeUInt32LE(p.png.length, at + 8); head.writeUInt32LE(off, at + 12); off += p.png.length; });
  return Buffer.concat([head, ...pngs.map((p) => p.png)]);
}

async function make(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = {};
  const put = (name) => (out[name] = path.join(dir, name));
  // A landscape photo: stored sideways with orientation 6, a wide-gamut profile, a camera and a place.
  await sharp(Buffer.from(LAKE(2400, 1600))).rotate(-90).jpeg({ quality: 90 })
    .withMetadata({ orientation: 6, icc: 'p3', exif: { IFD0: { Make: 'Demo', Model: 'Camera One' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '46/1 30/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '8/1 0/1 0/1' } } })
    .toFile(put('Lake.jpg'));
  // Grain on the vase photo, so it reads as a photo to the cut-out model.
  const vase = await sharp(Buffer.from(VASE)).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < vase.data.length; i++) vase.data[i] = Math.max(0, Math.min(255, vase.data[i] + (((i * 2654435761) >>> 27) - 16) / 3));
  await sharp(vase.data, { raw: vase.info }).jpeg({ quality: 92 }).toFile(put('Vase.jpg'));
  await sharp(Buffer.from(BEACH)).jpeg({ quality: 88 }).toFile(put('Beach.jpg'));
  await sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><circle cx="300" cy="200" r="150" fill="#2b7bd9" fill-opacity=".85"/><path d="M230 200l50 50 100-110" stroke="#fff" stroke-width="28" fill="none" stroke-linecap="round"/></svg>') }])
    .png().toFile(put('Sticker.png'));
  await sharp(Buffer.from(LAKE(6000, 4000))).jpeg({ quality: 85 }).toFile(put('Big 24MP.jpg'));
  const frames = await Promise.all(['#e5484d', '#f2c14e', '#46a758', '#3e63dd'].map((c, i) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#fff"/><circle cx="${30 + i * 33}" cy="60" r="24" fill="${c}"/></svg>`)).png().toBuffer()));
  await sharp(frames, { join: { animated: true } }).gif({ delay: [150, 150, 150, 150], loop: 0 }).toFile(put('Moving.gif'));
  const logo = (s) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><rect width="${s}" height="${s}" rx="${s / 5}" fill="#3e63dd"/><circle cx="${s / 2}" cy="${s / 2}" r="${s / 4}" fill="#fff"/></svg>`)).png().toBuffer();
  fs.writeFileSync(put('App.ico'), ico([{ size: 32, png: await logo(32) }, { size: 256, png: await logo(256) }]));
  fs.writeFileSync(put('Drawing.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#f4f1ea"/><path d="M20 180 120 40 200 140 280 60" stroke="#e5484d" stroke-width="12" fill="none"/></svg>');
  fs.writeFileSync(put('Old.bmp'), bmp24(200, 120, (x, y) => [x < 100 ? 220 : 30, 90, y < 60 ? 200 : 40]));
  // A flattened Photoshop file (as saved with "Maximize compatibility").
  const psdPic = await sharp(Buffer.from(LAKE(400, 300))).ensureAlpha().raw().toBuffer();
  const { writePsd } = require(path.resolve(__dirname, '../../node_modules/ag-psd'));
  fs.writeFileSync(put('Poster.psd'), Buffer.from(writePsd({ width: 400, height: 300, imageData: { width: 400, height: 300, data: new Uint8ClampedArray(psdPic) } }, {})));
  // A camera RAW file: the full-size preview is stored the way the sensor saw it (sideways); its EXIF says to turn it back.
  const preview = await sharp(Buffer.from(LAKE(3000, 2000))).rotate(90).jpeg({ quality: 90 }).toBuffer();
  const thumb = await sharp(Buffer.from(LAKE(160, 120))).jpeg({ quality: 70 }).toBuffer();
  await rawFile(put('Camera.nef'), preview, thumb);
  return out;
}

module.exports = { make };
if (require.main === module) make(path.resolve(process.argv[2] || 'photo-samples')).then((o) => console.log(Object.keys(o).join('\n')));
