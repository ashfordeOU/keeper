// SPDX-License-Identifier: AGPL-3.0-or-later
// A hover preview: rest the pointer on a file for a moment to see inside it.

import { useEffect, useRef, useState } from 'react';
import { FilePreview } from './Preview';

export function usePeek(delay = 450) {
  const [path, setPath] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const bind = (p: string) => ({
    onMouseEnter: (e: React.MouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { setAnchor(r); setPath(p); }, delay);
    },
    onMouseLeave: () => {
      window.clearTimeout(timer.current);
      setPath(null);
    },
  });
  let node: React.ReactNode = null;
  if (path && anchor) {
    const w = Math.min(340, window.innerWidth - 16);
    const h = Math.min(230, window.innerHeight - 16);
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - w / 2, window.innerWidth - w - 8));
    const below = anchor.bottom + h + 8 <= window.innerHeight;
    const top = below ? anchor.bottom + 6 : Math.max(8, anchor.top - h - 6);
    node = (
      <div className="pv-peek" style={{ left, top, width: w, height: h }}>
        <FilePreview path={path} mode="inline" />
      </div>
    );
  }
  return { bind, node };
}
