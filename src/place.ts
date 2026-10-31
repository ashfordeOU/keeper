// SPDX-License-Identifier: AGPL-3.0-or-later
// Where you are in Keeper: the page, how you got there and how far you had
// scrolled. Saved as you go, so an update or a restart opens the same place.

import { useEffect } from 'react';
import { api } from './api';
import type { Route } from './state';

const KEY = 'place';
const OFF = 'place.off';
const MAX_AGE = 14 * 86_400_000;

export interface Place {
  route: Route;
  history: Route[];
  scroll: Record<string, number>;
  at: number;
}

const routeKey = (r: Route) => `${r.name}|${r.arg ?? ''}|${r.q ?? ''}`;

let current: Place = { route: { name: 'home' }, history: [], scroll: {}, at: 0 };

function read(): Place | null {
  try {
    if (localStorage.getItem(OFF) === '1') return null;
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Place | null;
    if (!p?.route?.name || Date.now() - p.at > MAX_AGE) return null;
    // Pages that only make sense for a moment are not reopened.
    if (p.route.name === 'annotate') p.route = { name: 'home' };
    return p;
  } catch {
    return null;
  }
}

function write() {
  try {
    current.at = Date.now();
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: Keeper simply opens on Home */
  }
}

/** The place to open on, read once at start. */
export const startPlace: Place | null = read();
if (startPlace) current = { ...startPlace, scroll: { ...startPlace.scroll } };

export function rememberRoute(route: Route, history: Route[]) {
  current.route = route;
  current.history = history.slice(-20);
  write();
}

/** Mirrors the "Reopen where I left off" setting where it can be read before settings load. */
export function setPlaceMemory(on: boolean) {
  try {
    if (on) localStorage.removeItem(OFF);
    else localStorage.setItem(OFF, '1');
  } catch {
    /* ignore */
  }
}

/** Keeps the scroll position of each page and puts it back when you return or after a restart. */
export function usePlaceMemory(route: Route, el: () => HTMLElement | null) {
  useEffect(() => {
    const box = el();
    if (!box) return;
    const key = routeKey(route);
    const target = current.scroll[key] ?? 0;
    // Lists fill in as they load, so try for a little while until the old position exists again.
    let tries = 0;
    let timer: number | undefined;
    const restore = () => {
      if (!target) return;
      box.scrollTop = target;
      if (Math.abs(box.scrollTop - target) > 4 && ++tries < 30) timer = window.setTimeout(restore, 100);
    };
    restore();
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        current.scroll[key] = Math.round(box.scrollTop);
      });
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      box.removeEventListener('scroll', onScroll);
      write();
    };
  }, [route, el]);

  // Save before an update restarts Keeper, and whenever the window goes away.
  useEffect(() => {
    const save = () => write();
    const off = api.on('save-place' as 'navigate', save as never);
    window.addEventListener('pagehide', save);
    const vis = () => document.visibilityState === 'hidden' && save();
    document.addEventListener('visibilitychange', vis);
    return () => {
      off();
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
}
