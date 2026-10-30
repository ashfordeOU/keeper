// SPDX-License-Identifier: AGPL-3.0-or-later
// PDF rendering in the viewer, shared by the PDF viewer, iWork previews and
// thumbnails.

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = pdfjs.PDFDocumentProxy;
export type PdfPage = pdfjs.PDFPageProxy;
export { pdfjs };

export async function openPdf(data: ArrayBuffer | Uint8Array): Promise<PdfDoc> {
  // Scripts and remote fonts inside PDFs are never run or fetched.
  return pdfjs.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data), isEvalSupported: false, enableXfa: false, disableFontFace: false, useSystemFonts: true }).promise;
}

/** Draws a page into a canvas at the given CSS width; returns the canvas. */
export async function renderPage(page: PdfPage, cssWidth: number, canvas?: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = cssWidth / base.width;
  const vp = page.getViewport({ scale: scale * dpr });
  const c = canvas ?? document.createElement('canvas');
  c.width = Math.floor(vp.width);
  c.height = Math.floor(vp.height);
  c.style.width = `${Math.floor(vp.width / dpr)}px`;
  c.style.height = `${Math.floor(vp.height / dpr)}px`;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c;
}

/** First page as a PNG data URL (for thumbnails). */
export async function pdfThumb(data: ArrayBuffer, size: number): Promise<string> {
  const doc = await openPdf(data);
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const width = base.width >= base.height ? size : (size * base.width) / base.height;
    const c = await renderPage(page, width / Math.min(window.devicePixelRatio || 1, 2));
    return c.toDataURL('image/png');
  } finally {
    void doc.destroy();
  }
}
