// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Weather page's condition icons: one set for every WMO code, drawn as
// small inline SVGs on a 32-unit grid so they stay crisp from a list row to
// the hero. Colours come from CSS variables (src/styles/weather.css), so the
// clouds read on light and dark backgrounds alike.

import { condition, type WxIcon } from '../../../core/weather-view';

const CLOUD = 'M10.5 25h12.2a5.3 5.3 0 0 0 .9-10.52A7.2 7.2 0 0 0 9.86 16.1 4.47 4.47 0 0 0 10.5 25z';

function Sun({ x = 16, y = 16, r = 5.6 }: { x?: number; y?: number; r?: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const r1 = r + 2.2;
    const r2 = r + 4.4;
    return <line key={i} x1={x + r1 * Math.cos(a)} y1={y + r1 * Math.sin(a)} x2={x + r2 * Math.cos(a)} y2={y + r2 * Math.sin(a)} />;
  });
  return (
    <g className="wxg-sun">
      <g stroke="var(--wx-sun)" strokeWidth={1.8} strokeLinecap="round">{rays}</g>
      <circle cx={x} cy={y} r={r} fill="var(--wx-sun)" />
    </g>
  );
}

function Moon({ x = 16, y = 16, r = 7 }: { x?: number; y?: number; r?: number }) {
  // A crescent: a disc with a second disc cut out of its upper right.
  return <path fill="var(--wx-moon)" d={`M${x + r * 0.35} ${y - r} A${r} ${r} 0 1 0 ${x + r} ${y + r * 0.35} A${r * 0.8} ${r * 0.8} 0 0 1 ${x + r * 0.35} ${y - r}z`} />;
}

function Cloud({ dark, dx = 0, dy = 0, s = 1, back }: { dark?: boolean; dx?: number; dy?: number; s?: number; back?: boolean }) {
  return (
    <path
      d={CLOUD}
      transform={`translate(${dx} ${dy}) scale(${s})`}
      fill={dark ? 'var(--wx-cloud-dark)' : back ? 'var(--wx-cloud-back)' : 'var(--wx-cloud)'}
      stroke={dark ? 'var(--wx-cloud-dark-edge)' : 'var(--wx-cloud-edge)'}
      strokeWidth={0.9}
      strokeLinejoin="round"
    />
  );
}

const Drops = ({ n = 3, heavy, y = 26.5 }: { n?: number; heavy?: boolean; y?: number }) => (
  <g stroke="var(--wx-rain)" strokeWidth={heavy ? 2 : 1.7} strokeLinecap="round">
    {Array.from({ length: n }, (_, i) => {
      const x = 12 + i * (n > 3 ? 3.4 : 4.6);
      return <line key={i} x1={x} y1={y} x2={x - 1.4} y2={y + (heavy ? 4 : 3.2)} />;
    })}
  </g>
);

const Dots = ({ y = 28 }: { y?: number }) => (
  <g fill="var(--wx-rain)">{[11.5, 16, 20.5].map((x, i) => <circle key={x} cx={x - (i % 2) * 0.6} cy={y + (i % 2) * 1.6} r={1.1} />)}</g>
);

const Flake = ({ x, y, r = 1.9 }: { x: number; y: number; r?: number }) => (
  <g stroke="var(--wx-snow)" strokeWidth={1.2} strokeLinecap="round">
    <line x1={x - r} y1={y} x2={x + r} y2={y} />
    <line x1={x - r / 2} y1={y - r * 0.87} x2={x + r / 2} y2={y + r * 0.87} />
    <line x1={x - r / 2} y1={y + r * 0.87} x2={x + r / 2} y2={y - r * 0.87} />
  </g>
);

const Bolt = () => <path d="M17.6 21.5h-3.2l-1.6 5h2.4l-1.2 4.5 4.6-6.2h-2.5z" fill="var(--wx-bolt)" stroke="var(--wx-bolt-edge)" strokeWidth={0.6} strokeLinejoin="round" />;

function Body({ icon, isDay }: { icon: WxIcon; isDay: boolean }) {
  const Light = isDay ? <Sun x={11} y={11} r={4.6} /> : <Moon x={11.5} y={11.5} r={6} />;
  switch (icon) {
    case 'clear':
      return isDay ? <Sun /> : <Moon x={15} y={17} r={8.5} />;
    case 'mostly-clear':
      return <>{isDay ? <Sun x={13} y={13} r={5.2} /> : <Moon x={13} y={14} r={7.5} />}<Cloud s={0.62} dx={10.5} dy={10.5} /></>;
    case 'partly':
      return <>{Light}<Cloud dy={-1.5} /></>;
    case 'cloudy':
      return <><Cloud back s={0.78} dx={-1.2} dy={-3.6} /><Cloud dx={1.2} dy={-0.5} /></>;
    case 'fog':
      return (
        <>
          <Cloud dy={-5} />
          <g stroke="var(--wx-fog)" strokeWidth={1.7} strokeLinecap="round"><line x1={7} y1={24} x2={25} y2={24} /><line x1={9} y1={27.5} x2={23} y2={27.5} /><line x1={11} y1={31} x2={21} y2={31} /></g>
        </>
      );
    case 'drizzle':
      return <><Cloud dy={-5} /><Dots y={25} /></>;
    case 'freezing':
      return <><Cloud dy={-5} /><Drops n={2} y={23.5} /><Flake x={21} y={27} /></>;
    case 'rain':
      return <><Cloud dy={-5} /><Drops y={23.5} /></>;
    case 'heavy-rain':
      return <><Cloud dark dy={-5} /><Drops n={4} heavy y={23} /></>;
    case 'showers':
      return <>{Light}<Cloud dy={-4} /><Drops n={2} y={24.5} /></>;
    case 'snow':
      return <><Cloud dy={-5} /><Flake x={11.5} y={25.5} /><Flake x={17} y={28.5} /><Flake x={22} y={25} /></>;
    case 'snow-showers':
      return <>{Light}<Cloud dy={-4} /><Flake x={13} y={27} /><Flake x={19.5} y={28.5} /></>;
    case 'storm':
      return <><Cloud dark dy={-6} /><Bolt /><Drops n={2} y={22.5} /></>;
    case 'hail':
      return <><Cloud dark dy={-6} /><Bolt /><g fill="var(--wx-snow)" stroke="var(--wx-cloud-edge)" strokeWidth={0.5}><circle cx={10.5} cy={26} r={1.5} /><circle cx={22} cy={25.5} r={1.5} /><circle cx={21} cy={30} r={1.3} /></g></>;
  }
}

/** A condition icon for a WMO code. Decorative unless given a label. */
export function WxGlyph({ code, isDay = true, size = 24, label, className }: { code: number; isDay?: boolean; size?: number; label?: string | false; className?: string }) {
  const c = condition(code);
  const name = label === false ? undefined : label ?? c.label;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={`wxg ${className ?? ''}`} role={name ? 'img' : undefined} aria-label={name} aria-hidden={name ? undefined : true} focusable="false" data-icon={c.icon}>
      {name ? <title>{name}</title> : null}
      <Body icon={c.icon} isDay={isDay} />
    </svg>
  );
}
