// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's mark, the Keyhole Owl: an owl whose body is a keyhole. One drawing
// serves as the app logo (on its gradient tile) and as the Island buddy, whose
// eyes and brows change with its mood.

import { useId } from 'react';

export type OwlMood = 'idle' | 'calm' | 'happy' | 'done' | 'needs' | 'thinking' | 'listening' | 'napping' | 'sleeping' | 'broken' | 'recording';

const BODY = 'M512 250 C560 250 600 262 632 286 L700 236 Q712 300 690 352 C708 382 716 414 716 446 C716 528 660 588 584 606 L640 812 H384 L440 606 C364 588 308 528 308 446 C308 414 316 382 334 352 Q312 300 324 236 L392 286 C424 262 464 250 512 250 Z';
const FACE = 'M512 330 C470 300 380 300 362 372 C344 446 400 520 470 520 Q512 520 512 488 Q512 520 554 520 C624 520 680 446 662 372 C644 300 554 300 512 330 Z';

const IRIS: Partial<Record<OwlMood, string>> = { needs: '#fbbf24', broken: '#f87171', recording: '#f87171', done: '#34d399', listening: '#f472b6', thinking: '#60a5fa' };

function Eyes({ mood }: { mood: OwlMood }) {
  const iris = IRIS[mood] ?? '#ff9a3d';
  if (mood === 'napping' || mood === 'sleeping') {
    return <path d="M392 428 Q438 446 484 428 M540 428 Q586 446 632 428" stroke="#2b1580" strokeWidth="18" strokeLinecap="round" fill="none" />;
  }
  if (mood === 'happy' || mood === 'done') {
    return <path d="M396 436 Q438 392 480 436 M544 436 Q586 392 628 436" stroke="#2b1580" strokeWidth="20" strokeLinecap="round" fill="none" />;
  }
  if (mood === 'broken') {
    return <path d="M414 396 l48 48 M462 396 l-48 48 M562 396 l48 48 M610 396 l-48 48" stroke="#2b1580" strokeWidth="18" strokeLinecap="round" />;
  }
  // Thinking looks up and to the side; everything else looks at you.
  const dx = mood === 'thinking' ? 10 : 6;
  const dy = mood === 'thinking' ? -8 : 4;
  return (
    <>
      <circle cx="438" cy="420" r="56" fill="#fff" /><circle cx="586" cy="420" r="56" fill="#fff" />
      <circle cx={438 + dx} cy={420 + dy} r={mood === 'needs' ? 42 : 36} fill={iris} />
      <circle cx={586 - (mood === 'thinking' ? -10 : 6)} cy={420 + dy} r={mood === 'needs' ? 42 : 36} fill={iris} />
      <circle cx={438 + dx + 2} cy={422 + dy} r="21" fill="#2b1580" /><circle cx={586 - (mood === 'thinking' ? -12 : 8)} cy={422 + dy} r="21" fill="#2b1580" />
      <circle cx={430 + dx} cy={410 + dy} r="8" fill="#fff" /><circle cx={578 - (mood === 'thinking' ? -10 : 6)} cy={410 + dy} r="8" fill="#fff" />
    </>
  );
}

/**
 * tile: draw the full app icon (gradient rounded square). Without it, only the
 * owl is drawn, for use on coloured or dark backgrounds.
 */
export function OwlMark({ size = 24, mood = 'idle', tile = false, className, title }: { size?: number; mood?: OwlMood; tile?: boolean; className?: string; title?: string }) {
  const id = useId().replace(/:/g, '');
  const brows = mood === 'needs' ? 'M372 340 Q440 320 500 380 M652 340 Q584 320 524 380' : mood === 'broken' ? 'M380 360 Q440 380 500 392 M644 360 Q584 380 524 392' : 'M372 352 Q440 352 506 404 M652 352 Q584 352 518 404';
  const owl = (
    <g>
      <path d={BODY} fill={tile ? `url(#m${id})` : '#fff'} />
      <path d={FACE} fill="#ffe7f0" />
      <Eyes mood={mood} />
      <path d={brows} stroke="#6b3dff" strokeWidth="18" strokeLinecap="round" fill="none" />
      <path d="M496 452 Q512 440 528 452 L514 492 Q512 498 510 492 Z" fill="#ff8a3d" />
      {mood === 'napping' || mood === 'sleeping' ? <text x="700" y="300" fontSize="150" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">z</text> : null}
      {mood === 'recording' ? <circle cx="720" cy="260" r="60" fill="#ff453a" stroke="#fff" strokeWidth="16" /> : null}
    </g>
  );
  if (!tile) {
    return (
      <svg className={className} width={size} height={size} viewBox="270 200 500 640" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
        {owl}
      </svg>
    );
  }
  return (
    <svg className={className} width={size} height={size} viewBox="80 80 864 864" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffb45e" style={{ stopColor: 'var(--owl-a, #ffb45e)' }} /><stop offset=".45" stopColor="#ff5f8f" style={{ stopColor: 'var(--owl-b, #ff5f8f)' }} /><stop offset="1" stopColor="#6b3dff" style={{ stopColor: 'var(--owl-c, #6b3dff)' }} /></linearGradient>
        <linearGradient id={`m${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#f1eaff" /></linearGradient>
      </defs>
      <rect x="80" y="80" width="864" height="864" rx="196" fill={`url(#b${id})`} />
      {owl}
    </svg>
  );
}
