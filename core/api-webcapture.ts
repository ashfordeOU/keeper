// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What capturing a web page gives back (electron/services/web-capture.ts makes it).

export interface WebCaptureResult {
  path: string;
  format: 'png' | 'pdf';
  /** the page's size in CSS pixels as captured */
  width: number;
  height: number;
  /** the page was taller than one picture can be and was cut */
  cut: boolean;
  /** a cookie banner was found and closed */
  banner: boolean;
  title: string;
  /** a small preview (PNG only) */
  thumb?: string;
}
