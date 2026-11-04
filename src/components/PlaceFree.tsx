// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A disk's or cloud's free space in its sidebar row (styles in places.css).

/**
 * How full a disk is, in its row: the free space as quiet text on hover or focus. Nearly full
 * (under a tenth free), a small amber dot stays in view, with the words for screen readers.
 */
export function PlaceFree({ freeText, low }: { freeText: string; low: boolean }) {
  return (
    <span className={`place-free ${low ? 'low' : ''}`} data-testid="place-free">
      {low ? <i className="place-low-dot" aria-hidden /> : null}
      <span className="place-free-text">{freeText}</span>
      {low ? <span className="sr-only">, nearly full</span> : null}
    </span>
  );
}
