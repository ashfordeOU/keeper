// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Small pieces the photo editor's panels share: a labelled slider, a folding
// section, colour swatches and the tone curve.

import { useRef, useState, type ReactNode } from 'react';
import { curveLut } from '../../../core/photo-pixels';

export function Slider({ label, value, onChange, onCommit, min = -100, max = 100, step = 1, unit = '', testid, help }: { label: string; value: number; onChange: (v: number) => void; onCommit: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; testid?: string; help?: string }) {
  const id = `ph-s-${label.replace(/\W+/g, '-')}-${testid ?? ''}`;
  const zero = min < 0 ? 0 : min;
  return (
    <div className="insp-row" title={help}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} data-testid={testid}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => { if (/^(Arrow|Page|Home|End)/.test(e.key)) onCommit(Number((e.target as HTMLInputElement).value)); }}
        onDoubleClick={() => onCommit(zero)} />
      <output htmlFor={id}>{value > 0 && min < 0 ? '+' : ''}{value}{unit}</output>
    </div>
  );
}

/** A section that folds away; closed unless it already holds a change. */
export function Fold({ title, open, children, testid }: { title: string; open?: boolean; children: ReactNode; testid?: string }) {
  return (
    <details className="ph-fold" open={open} data-testid={testid}>
      <summary className="insp-title">{title}</summary>
      <div className="insp-sec ph-fold-body">{children}</div>
    </details>
  );
}

export const SWATCHES = ['#ffffff', '#f4f1ea', '#d9e4f5', '#f6d9c7', '#cfe8d5', '#1d1d1f', '#3e63dd'];

export function Swatches({ value, onPick, label, allowClear }: { value: string; onPick: (c: string) => void; label: string; allowClear?: boolean }) {
  return (
    <div className="ph-swatches" role="radiogroup" aria-label={label}>
      {allowClear ? <button type="button" role="radio" aria-checked={value === 'clear'} className="ph-swatch clear" title="See-through" aria-label="See-through" onClick={() => onPick('clear')} /> : null}
      {SWATCHES.map((c) => <button key={c} type="button" role="radio" aria-checked={value === c} className="ph-swatch" style={{ background: c }} title={c} aria-label={`Colour ${c}`} onClick={() => onPick(c)} />)}
      <label className="ph-swatch any" title="Any colour">
        <input type="color" aria-label={`${label}: any colour`} value={/^#/.test(value) ? value : '#ffffff'} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  );
}

/**
 * The tone curve: three handles (dark, middle, light tones) moved up or down
 * along a straight line; the curve through them is drawn as the editor uses it.
 */
export function Curve({ value, onCommit }: { value: [number, number][]; onCommit: (v: [number, number][]) => void }) {
  const xs = [64, 128, 192];
  const base: [number, number][] = value.length ? value : [[0, 0], [255, 255]];
  const yAt = (x: number) => curveLut(base)[x];
  const [live, setLive] = useState<number[] | null>(null);
  const ys = live ?? xs.map(yAt);
  const box = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const points = (y: number[]): [number, number][] => [[0, 0], ...xs.map((x, i) => [x, Math.round(y[i])] as [number, number]), [255, 255]];
  const lut = curveLut(points(ys));
  const path = Array.from({ length: 33 }, (_, i) => { const x = Math.min(255, i * 8); return `${i ? 'L' : 'M'}${x} ${255 - lut[x]}`; }).join(' ');
  const move = (e: React.PointerEvent) => {
    if (drag.current === null || !box.current) return;
    const b = box.current.getBoundingClientRect();
    const y = Math.max(0, Math.min(255, 255 - ((e.clientY - b.top) / b.height) * 255));
    const next = [...ys];
    next[drag.current] = y;
    setLive(next);
  };
  const end = () => { if (drag.current !== null && live) onCommit(points(live)); drag.current = null; setLive(null); };
  const nudge = (i: number, d: number) => { const next = xs.map(yAt); next[i] = Math.max(0, Math.min(255, next[i] + d)); onCommit(points(next)); };
  return (
    <div className="ph-curve">
      <svg ref={box} viewBox="0 0 255 255" role="group" aria-label="Tone curve" onPointerMove={move} onPointerUp={end} onPointerLeave={end}>
        <path d="M0 255 L255 0" className="ph-curve-base" />
        <path d={path} className="ph-curve-line" />
        {xs.map((x, i) => (
          <circle key={x} cx={x} cy={255 - ys[i]} r={9} className="ph-curve-dot" tabIndex={0} role="slider" aria-label={['Dark tones', 'Middle tones', 'Light tones'][i]} aria-valuemin={0} aria-valuemax={255} aria-valuenow={Math.round(ys[i])}
            onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = i; }}
            onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); nudge(i, 4); } else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(i, -4); } }} />
        ))}
      </svg>
    </div>
  );
}
