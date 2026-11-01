// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Bookings in confirmation mails: airlines, hotels, ticket sellers and car
// hire firms put schema.org reservations in a <script type="application/ld+json">
// block. This reads FlightReservation, LodgingReservation, EventReservation,
// RentalCarReservation, TrainReservation, BusReservation and
// FoodEstablishmentReservation. Read-only; nothing is fetched.

import type { Reservation, ReservationKind, SourceKind } from './types';
import { hashId, parseTime } from './util';
import { decodeEntities } from './xml';

type J = Record<string, unknown>;

const KIND: Record<string, ReservationKind> = {
  FlightReservation: 'flight', LodgingReservation: 'lodging', EventReservation: 'event', RentalCarReservation: 'rental',
  TrainReservation: 'train', BusReservation: 'bus', FoodEstablishmentReservation: 'restaurant',
};

/** The JSON-LD blocks in an HTML document (or an e-mail's HTML part). */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let body = m[1].trim().replace(/^<!--/, '').replace(/-->$/, '').trim();
    // Some mailers HTML-escape the JSON inside the script.
    if (/^&quot;|&quot;/.test(body) && !body.includes('"')) body = decodeEntities(body);
    try {
      out.push(JSON.parse(body));
    } catch {
      try { out.push(JSON.parse(decodeEntities(body))); } catch { /* not JSON */ }
    }
  }
  return out;
}

const typeOf = (o: J): string[] => {
  const t = o['@type'];
  return (Array.isArray(t) ? t : [t]).map((x) => String(x ?? '').replace(/^https?:\/\/schema\.org\//, ''));
};

function flatten(v: unknown, out: J[] = []): J[] {
  if (Array.isArray(v)) for (const x of v) flatten(x, out);
  else if (v && typeof v === 'object') {
    const o = v as J;
    if (Array.isArray(o['@graph'])) flatten(o['@graph'], out);
    else out.push(o);
  }
  return out;
}

function addressText(a: unknown): string | undefined {
  if (!a) return undefined;
  if (typeof a === 'string') return a;
  const o = a as J;
  const parts = [o.streetAddress, o.addressLocality, o.postalCode, typeof o.addressCountry === 'object' ? (o.addressCountry as J)?.name : o.addressCountry].filter((x) => typeof x === 'string' && x);
  return parts.length ? parts.join(', ') : undefined;
}

function geo(o: J | undefined): { lat?: number; lon?: number } {
  const g = o?.geo as J | undefined;
  const lat = Number(g?.latitude), lon = Number(g?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && g ? { lat, lon } : {};
}

const t = (v: unknown) => {
  const x = parseTime(v as string);
  return Number.isFinite(x) ? x : undefined;
};

const place = (p: unknown) => {
  const o = (p ?? {}) as J;
  return String(o.iataCode ?? o.name ?? '') || undefined;
};

/** Reservations from parsed JSON-LD values. */
export function reservationsFrom(values: unknown[], source: SourceKind = 'mail'): Reservation[] {
  const out: Reservation[] = [];
  for (const o of flatten(values)) {
    const kind = typeOf(o).map((x) => KIND[x]).find(Boolean);
    if (!kind) continue;
    const f = (o.reservationFor ?? {}) as J;
    const conf = o.reservationNumber ? String(o.reservationNumber) : undefined;
    const provider = ((o.provider ?? o.broker ?? f.airline ?? f.provider) as J | undefined)?.name as string | undefined;
    let r: Reservation;
    if (kind === 'flight' || kind === 'train' || kind === 'bus') {
      const from = (f.departureAirport ?? f.departureStation ?? f.departureBusStop) as J | undefined;
      const to = (f.arrivalAirport ?? f.arrivalStation ?? f.arrivalBusStop) as J | undefined;
      const airline = (f.airline ?? {}) as J;
      const num = f.flightNumber ? `${airline.iataCode ?? ''}${f.flightNumber}` : String(f.trainNumber ?? f.busNumber ?? f.name ?? '');
      r = { id: '', kind, name: [num, `${place(from) ?? '?'} → ${place(to) ?? '?'}`].filter(Boolean).join(' '), start: t(f.departureTime), end: t(f.arrivalTime), from: place(from), to: place(to), ...geo(to), confirmation: conf, provider, source };
    } else if (kind === 'lodging') {
      r = { id: '', kind, name: String(f.name ?? 'Hotel'), start: t(o.checkinTime ?? o.checkinDate), end: t(o.checkoutTime ?? o.checkoutDate), address: addressText(f.address), ...geo(f), confirmation: conf, provider, source };
    } else if (kind === 'rental') {
      const loc = (o.pickupLocation ?? {}) as J;
      r = { id: '', kind, name: String(((f.brand ?? {}) as J).name ?? f.name ?? 'Car hire'), start: t(o.pickupTime), end: t(o.dropoffTime), address: addressText(loc.address) ?? (loc.name as string | undefined), ...geo(loc), confirmation: conf, provider, source };
    } else {
      const loc = (f.location ?? f) as J;
      r = { id: '', kind, name: String(f.name ?? (kind === 'restaurant' ? 'Table' : 'Event')), start: t(f.startDate ?? o.startTime), end: t(f.endDate ?? o.endTime), address: addressText(loc.address) ?? (typeof loc.name === 'string' && loc !== f ? loc.name : undefined), ...geo(loc), confirmation: conf, provider, source };
    }
    r.id = hashId(`res:${kind}:${conf ?? ''}:${r.name}:${r.start ?? ''}`);
    if (!out.some((x) => x.id === r.id)) out.push(r);
  }
  return out;
}

export const reservationsInHtml = (html: string, source: SourceKind = 'mail') => reservationsFrom(jsonLdBlocks(html), source);

/** Reservations from raw JSON-LD script bodies (as the mail service's structuredData gives them). */
export function reservationsFromBlocks(blocks: string[], source: SourceKind = 'mail'): Reservation[] {
  const values: unknown[] = [];
  for (const b of blocks) {
    try { values.push(JSON.parse(b)); } catch {
      try { values.push(JSON.parse(decodeEntities(b))); } catch { /* not JSON */ }
    }
  }
  return reservationsFrom(values, source);
}

export interface MailReader {
  accounts(): Promise<{ mail?: boolean }[]>;
  messages(v: { folder: string; query: string }): Promise<{ messages: { id: string }[] }>;
  structuredData(id: string): Promise<string[]>;
}

/** Bookings in the mailbox: a few searches, then each message's JSON-LD. Read-only; nothing when no mail account is set up. */
export async function bookingsFromMail(m: MailReader, pause: () => Promise<void> = async () => undefined, perQuery = 40): Promise<Reservation[]> {
  const accounts = await m.accounts().catch(() => []);
  if (!accounts.some((a) => a.mail !== false)) return [];
  const out: Reservation[] = [];
  const seen = new Set<string>();
  for (const q of ['reservation', 'booking', 'confirmation', 'itinerary', 'boarding']) {
    const { messages } = await m.messages({ folder: 'unified', query: q }).catch(() => ({ messages: [] as { id: string }[] }));
    for (const msg of messages.slice(0, perQuery)) {
      if (seen.has(msg.id)) continue;
      seen.add(msg.id);
      await pause();
      const blocks = await m.structuredData(msg.id).catch(() => [] as string[]);
      for (const r of reservationsFromBlocks(blocks)) if (!out.some((x) => x.id === r.id)) out.push(r);
    }
  }
  return out;
}
