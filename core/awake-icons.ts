// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Pictures for Keep Awake's own menu-bar / tray item, drawn at run time (and
// shown as previews in Settings). The default is Keeper's owl, the same
// keyhole-owl silhouette as the app icon (build/icon.svg) and Keeper's own
// menu-bar icon (build/tray.svg): eyes open while the computer is kept awake,
// closed when it may sleep. The other styles stay to choose from.
//
// macOS gets one-colour template images (black; the system tints them for
// light and dark menu bars). Linux and Windows get colour: the owl wears the
// app icon's gradient while awake and is grey while asleep.

import type { IconStyle } from './awake-engine';

/** The keyhole owl from build/tray.svg, in its 1024 × 1024 drawing space. */
const OWL_BODY = 'M512 150 C580 150 636 167 682 201 L790 110 Q808 214 768 290 C793 332 805 377 805 422 C805 538 726 623 618 648 L694 930 H330 L406 648 C298 623 219 538 219 422 C219 377 231 332 256 290 Q216 214 234 110 L342 201 C388 167 444 150 512 150 Z';
const OWL_BROWS = 'M262 300 Q400 290 512 380 Q624 290 762 300';
/** Scales the owl (820 units tall) to fit the 22 × 22 icon, centred. */
const OWL_FIT = 'translate(-0.86 -1.05) scale(0.02317)';

function owl(on: boolean, paint: string, id: string): string {
  const eyes = on
    // Open: two round holes with the pupils inside, looking slightly forward.
    ? '<circle cx="404" cy="420" r="100" fill="#000"/><circle cx="620" cy="420" r="100" fill="#000"/>'
    // Closed: two sleepy lids.
    : '<path d="M334 452 Q404 510 474 452 M550 452 Q620 510 690 452" stroke="#000" stroke-width="50" stroke-linecap="round" fill="none"/>';
  const pupils = on ? `<circle cx="412" cy="430" r="46" fill="${paint}"/><circle cx="612" cy="430" r="46" fill="${paint}"/>` : '';
  return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/>${eyes}`
    + `<path d="${OWL_BROWS}" stroke="#000" stroke-width="58" stroke-linecap="round" stroke-linejoin="round" fill="none"/></mask></defs>`
    + `<g transform="${OWL_FIT}"><path d="${OWL_BODY}" fill="${paint}" mask="url(#${id})"/>${pupils}</g>`;
}

const GLYPHS: Record<Exclude<IconStyle, 'owl'>, string> = {
  cup: '<path d="M4 8h11v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" {F}/><path d="M15 9.5h1.5a2.5 2.5 0 0 1 0 5H15" fill="none" {S}/><path d="M7 3.5c0 1 1 1 1 2M10.5 3.5c0 1 1 1 1 2" fill="none" {S}/>',
  eye: '<path d="M2 11s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" fill="none" {S}/><circle cx="11" cy="11" r="3" {F}/>',
  bolt: '<path d="M12.5 2 5 12.5h5.5L9.5 20 17 9.5h-5.5z" {F}/>',
  moon: '<path d="M17.5 14A7.5 7.5 0 0 1 8 4.5a7.5 7.5 0 1 0 9.5 9.5z" {F}/>',
};

/** The app icon's gradient (build/icon.svg), for the colour owl while awake. */
const OWL_GRADIENT = (id: string) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb45e"/><stop offset=".45" stop-color="#ff5f8f"/><stop offset="1" stop-color="#6b3dff"/></linearGradient>`;

export interface IconOptions {
  /** colour icons (Linux, Windows): the owl uses Keeper's gradient while awake */
  colour?: boolean;
  /** unique ids when several icons share one page (Settings previews) */
  id?: string;
}

/** A 22 × 22 SVG of the icon. `color` is the template colour (macOS: black) or the colour for the simple styles. */
export function svgFor(style: IconStyle, on: boolean, color: string, o: IconOptions = {}): string {
  const id = o.id ?? 'k';
  let body: string;
  if (style === 'owl') {
    const grad = o.colour && on;
    const paint = grad ? `url(#${id}-g)` : color;
    body = (grad ? `<defs>${OWL_GRADIENT(`${id}-g`)}</defs>` : '') + owl(on, paint, `${id}-m`);
  } else {
    const stroke = `stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`;
    const fill = on ? `fill="${color}" ${stroke}` : `fill="none" ${stroke}`;
    body = GLYPHS[style].replaceAll('{F}', fill).replaceAll('{S}', stroke);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">${body}</svg>`;
}

/** The colour for the simple styles off macOS. */
export function trayColor(on: boolean): string {
  return on ? '#f5a524' : '#9aa0a6';
}
