// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { bannerScript, captureFileName, defaultWebCapture, DEVICES, fitHeight, normalizeCaptureUrl, pdfLayout, pickConsentButton, scrollScript } from '../core/web-capture';

describe('the address', () => {
  it('adds https:// and keeps only web pages', () => {
    expect(normalizeCaptureUrl(' example.com/a?b=1 ')).toBe('https://example.com/a?b=1');
    expect(normalizeCaptureUrl('localhost:3000')).toBe('https://localhost:3000/');
    expect(normalizeCaptureUrl('http://127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/x');
    expect(() => normalizeCaptureUrl('javascript:alert(1)')).toThrow(/Only web pages/);
    expect(() => normalizeCaptureUrl('file:///etc/passwd')).toThrow(/Only web pages/);
    expect(() => normalizeCaptureUrl('')).toThrow(/Paste/);
    expect(() => normalizeCaptureUrl('https://')).toThrow(/web address/);
  });
});

describe('presets', () => {
  it('desktop, phone and the social preview size', () => {
    expect(DEVICES.desktop).toMatchObject({ width: 1440, mobile: false, frameOnly: false });
    expect(DEVICES.phone).toMatchObject({ width: 390, scale: 2, mobile: true });
    expect(DEVICES.phone.userAgent).toMatch(/Mobile/);
    expect(DEVICES.social).toMatchObject({ width: 1200, height: 630, frameOnly: true });
    expect(defaultWebCapture()).toEqual({ device: 'desktop', format: 'png', banners: true, scroll: true, sharp: false });
  });
  it('names files by site, kind and time', () => {
    const at = new Date(2026, 10, 3, 14, 5, 9);
    expect(captureFileName('https://www.example.com/x', 'png', at)).toBe('Web page example.com 2026-11-03 at 14.05.09.png');
    expect(captureFileName('https://shop.example.org/', 'pdf', at, 'phone')).toBe('Web page shop.example.org (phone) 2026-11-03 at 14.05.09.pdf');
    expect(captureFileName('not a url', 'png', at, 'social')).toBe('Web page page (social) 2026-11-03 at 14.05.09.png');
  });
  it('cuts pages taller than one picture can be', () => {
    expect(fitHeight(5000.4, 1)).toEqual({ height: 5001, cut: false });
    expect(fitHeight(30_000, 1)).toEqual({ height: 16_000, cut: true });
    expect(fitHeight(9000, 2)).toEqual({ height: 8000, cut: true });
  });
  it('makes one tall PDF page when it fits, else A4 pages', () => {
    expect(pdfLayout(1440, 4800)).toEqual({ single: true, width: 15, height: 50 });
    expect(pdfLayout(1440, 30_000)).toEqual({ single: false });
  });
});

describe('cookie banners', () => {
  it('prefers refusing what is not needed', () => {
    expect(pickConsentButton(['Accept all', 'Reject all', 'Settings'])).toBe(1);
    expect(pickConsentButton(['Manage options', 'Only necessary cookies', 'Accept'])).toBe(1);
    expect(pickConsentButton(['Alle akzeptieren', 'Alle ablehnen'])).toBe(1);
    expect(pickConsentButton(['Tout accepter', 'Paramètres'])).toBe(0);
  });
  it('accepts when that is the only way out, and leaves other buttons alone', () => {
    expect(pickConsentButton(['Learn more', 'Got it'])).toBe(1);
    expect(pickConsentButton(['OK'])).toBe(0);
    expect(pickConsentButton(['Subscribe', 'Read more', 'Privacy policy'])).toBe(-1);
    expect(pickConsentButton(['', 'x'.repeat(100)])).toBe(-1);
  });
  it('the scripts are self-contained JavaScript for the page', () => {
    const b = bannerScript();
    expect(() => new Function(`return ${b}`)).not.toThrow();
    expect(b).toContain('pickConsentButton');
    expect(() => new Function(`return ${scrollScript(5, 10)}`)).not.toThrow();
    // The picker carries everything it needs inside its own body.
    const pick = new Function(`return (${pickConsentButton.toString()})`)() as typeof pickConsentButton;
    expect(pick(['Decline', 'Accept'])).toBe(0);
  });
});
