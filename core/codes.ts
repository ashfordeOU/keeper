// SPDX-License-Identifier: AGPL-3.0-or-later
// Reads QR codes and barcodes (EAN, UPC, Code 128/39/93, ITF, Codabar,
// Data Matrix, Aztec, PDF417) from raw pixels.

import jsQR from 'jsqr';
import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from '@zxing/library';

export interface DecodedCode {
  value: string;
  /** QR_CODE, EAN_13, CODE_128, … */
  format: string;
}

const FORMATS = [
  BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.DATA_MATRIX, BarcodeFormat.AZTEC, BarcodeFormat.PDF_417,
];

/**
 * Decodes the first code in an image. `pixels` are 4 bytes per pixel in RGBA
 * order, or BGRA when `bgra` is set (Electron's native bitmaps).
 */
export function decodeCode(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, bgra = false): DecodedCode | undefined {
  if (!width || !height || pixels.length < width * height * 4) return undefined;
  const rgba = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, width * height * 4);
  // jsQR only looks at brightness, so channel order does not matter; it is fast and very tolerant.
  try {
    const qr = jsQR(rgba, width, height);
    if (qr?.data) return { value: qr.data, format: 'QR_CODE' };
  } catch {
    /* not a QR code */
  }
  const lum = new Uint8ClampedArray(width * height);
  const [r, b] = bgra ? [2, 0] : [0, 2];
  for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = (rgba[i + r] * 77 + rgba[i + 1] * 150 + rgba[i + b] * 29) >> 8;
  try {
    const reader = new MultiFormatReader();
    reader.setHints(new Map<DecodeHintType, unknown>([[DecodeHintType.TRY_HARDER, true], [DecodeHintType.POSSIBLE_FORMATS, FORMATS]]));
    const res = reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, width, height))));
    return { value: res.getText(), format: BarcodeFormat[res.getBarcodeFormat()] };
  } catch {
    return undefined;
  }
}
