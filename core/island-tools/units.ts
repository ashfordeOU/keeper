// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Unit conversion for the Island's converter: length, mass, temperature,
// volume, speed, area, data, time and (with rates) currency, as you type,
// including plain input such as "5 ft in cm" or "72f to c".

export type Dimension = 'length' | 'mass' | 'temperature' | 'volume' | 'speed' | 'area' | 'data' | 'time' | 'currency';

interface Unit {
  id: string;
  dim: Dimension;
  label: string;
  /** factor to the dimension's base unit (temperature uses toBase/fromBase) */
  f?: number;
  toBase?: (v: number) => number;
  fromBase?: (v: number) => number;
  aliases: string[];
}

const U = (id: string, dim: Dimension, label: string, f: number, aliases: string[] = []): Unit => ({ id, dim, label, f, aliases: [id, ...aliases] });

/** Base units: metre, kilogram, kelvin, litre, metre/second, square metre, byte, second. */
export const UNITS: Unit[] = [
  U('mm', 'length', 'millimetres', 0.001, ['millimeter', 'millimeters', 'millimetre', 'millimetres']),
  U('cm', 'length', 'centimetres', 0.01, ['centimeter', 'centimeters', 'centimetre', 'centimetres']),
  U('m', 'length', 'metres', 1, ['meter', 'meters', 'metre', 'metres']),
  U('km', 'length', 'kilometres', 1000, ['kilometer', 'kilometers', 'kilometre', 'kilometres', 'kms']),
  U('in', 'length', 'inches', 0.0254, ['inch', 'inches', '"', '″']),
  U('ft', 'length', 'feet', 0.3048, ['foot', 'feet', "'", '′']),
  U('yd', 'length', 'yards', 0.9144, ['yard', 'yards']),
  U('mi', 'length', 'miles', 1609.344, ['mile', 'miles']),
  U('nmi', 'length', 'nautical miles', 1852, ['nautical mile', 'nautical miles']),
  U('mg', 'mass', 'milligrams', 1e-6, ['milligram', 'milligrams']),
  U('g', 'mass', 'grams', 0.001, ['gram', 'grams', 'gr']),
  U('kg', 'mass', 'kilograms', 1, ['kilogram', 'kilograms', 'kilo', 'kilos', 'kgs']),
  U('t', 'mass', 'tonnes', 1000, ['tonne', 'tonnes', 'metric ton']),
  U('oz', 'mass', 'ounces', 0.028349523125, ['ounce', 'ounces']),
  U('lb', 'mass', 'pounds', 0.45359237, ['pound', 'pounds', 'lbs']),
  U('st', 'mass', 'stone', 6.35029318, ['stone', 'stones']),
  { id: 'c', dim: 'temperature', label: '°C', toBase: (v) => v + 273.15, fromBase: (v) => v - 273.15, aliases: ['c', '°c', 'celsius', 'centigrade', 'degc'] },
  { id: 'f', dim: 'temperature', label: '°F', toBase: (v) => (v - 32) * (5 / 9) + 273.15, fromBase: (v) => (v - 273.15) * (9 / 5) + 32, aliases: ['f', '°f', 'fahrenheit', 'degf'] },
  { id: 'k', dim: 'temperature', label: 'K', toBase: (v) => v, fromBase: (v) => v, aliases: ['k', 'kelvin'] },
  U('ml', 'volume', 'millilitres', 0.001, ['milliliter', 'milliliters', 'millilitre', 'millilitres']),
  U('l', 'volume', 'litres', 1, ['liter', 'liters', 'litre', 'litres', 'ltr']),
  U('tsp', 'volume', 'teaspoons', 0.00492892159375, ['teaspoon', 'teaspoons']),
  U('tbsp', 'volume', 'tablespoons', 0.01478676478125, ['tablespoon', 'tablespoons']),
  U('floz', 'volume', 'US fluid ounces', 0.0295735295625, ['fl oz', 'fluid ounce', 'fluid ounces']),
  U('cup', 'volume', 'US cups', 0.2365882365, ['cups']),
  U('pt', 'volume', 'US pints', 0.473176473, ['pint', 'pints']),
  U('qt', 'volume', 'US quarts', 0.946352946, ['quart', 'quarts']),
  U('gal', 'volume', 'US gallons', 3.785411784, ['gallon', 'gallons']),
  U('m3', 'volume', 'cubic metres', 1000, ['m³', 'cubic meter', 'cubic metre', 'cubic meters', 'cubic metres']),
  U('mps', 'speed', 'metres per second', 1, ['m/s', 'meters per second', 'metres per second']),
  U('kmh', 'speed', 'km per hour', 1000 / 3600, ['km/h', 'kph', 'kmph']),
  U('mph', 'speed', 'miles per hour', 1609.344 / 3600, ['mi/h', 'miles per hour']),
  U('kn', 'speed', 'knots', 1852 / 3600, ['knot', 'knots', 'kt']),
  U('fps', 'speed', 'feet per second', 0.3048, ['ft/s']),
  U('m2', 'area', 'square metres', 1, ['m²', 'sq m', 'square meter', 'square meters', 'square metre', 'square metres', 'sqm']),
  U('km2', 'area', 'square km', 1e6, ['km²', 'sq km', 'square kilometers', 'square kilometres']),
  U('ft2', 'area', 'square feet', 0.09290304, ['ft²', 'sq ft', 'sqft', 'square foot', 'square feet']),
  U('mi2', 'area', 'square miles', 2589988.110336, ['mi²', 'sq mi', 'square miles']),
  U('ha', 'area', 'hectares', 10000, ['hectare', 'hectares']),
  U('acre', 'area', 'acres', 4046.8564224, ['acres', 'ac']),
  U('b', 'data', 'bytes', 1, ['byte', 'bytes']),
  U('kb', 'data', 'kilobytes', 1000, ['kilobyte', 'kilobytes']),
  U('mb', 'data', 'megabytes', 1e6, ['megabyte', 'megabytes']),
  U('gb', 'data', 'gigabytes', 1e9, ['gigabyte', 'gigabytes']),
  U('tb', 'data', 'terabytes', 1e12, ['terabyte', 'terabytes']),
  U('kib', 'data', 'kibibytes', 1024, ['kibibyte', 'kibibytes']),
  U('mib', 'data', 'mebibytes', 1024 ** 2, ['mebibyte', 'mebibytes']),
  U('gib', 'data', 'gibibytes', 1024 ** 3, ['gibibyte', 'gibibytes']),
  U('tib', 'data', 'tebibytes', 1024 ** 4, ['tebibyte', 'tebibytes']),
  U('bit', 'data', 'bits', 1 / 8, ['bits']),
  U('ms', 'time', 'milliseconds', 0.001, ['millisecond', 'milliseconds']),
  U('s', 'time', 'seconds', 1, ['sec', 'secs', 'second', 'seconds']),
  U('min', 'time', 'minutes', 60, ['mins', 'minute', 'minutes']),
  U('h', 'time', 'hours', 3600, ['hr', 'hrs', 'hour', 'hours']),
  U('d', 'time', 'days', 86400, ['day', 'days']),
  U('wk', 'time', 'weeks', 604800, ['week', 'weeks', 'w']),
  U('yr', 'time', 'years', 31557600, ['year', 'years', 'y']),
];

const BY_ALIAS = new Map<string, Unit>();
for (const u of UNITS) for (const a of u.aliases) BY_ALIAS.set(a.toLowerCase(), u);

export function findUnit(token: string): Unit | undefined {
  return BY_ALIAS.get(token.trim().toLowerCase().replace(/\.$/, ''));
}

export function unitsOf(dim: Dimension): Unit[] {
  return UNITS.filter((u) => u.dim === dim);
}

function toBase(u: Unit, v: number) {
  return u.toBase ? u.toBase(v) : v * (u.f ?? 1);
}
function fromBase(u: Unit, v: number) {
  return u.fromBase ? u.fromBase(v) : v / (u.f ?? 1);
}

/** Converts between two units of the same kind; undefined when they do not match. */
export function convert(value: number, from: string, to: string): number | undefined {
  const a = findUnit(from);
  const b = findUnit(to);
  if (!a || !b || a.dim !== b.dim) return undefined;
  return fromBase(b, toBase(a, value));
}

/** Rates per 1 unit of `base` (e.g. { USD: 1, EUR: 0.92 }), from an opt-in source. */
export interface Rates {
  base: string;
  rates: Record<string, number>;
  date?: string;
}

export function convertCurrency(value: number, from: string, to: string, r: Rates): number | undefined {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  const rf = f === r.base ? 1 : r.rates[f];
  const rt = t === r.base ? 1 : r.rates[t];
  if (!rf || !rt) return undefined;
  return (value / rf) * rt;
}

/** Up to 6 significant digits, no trailing zeros, thousands separators for large numbers. */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v !== 0 && Math.abs(v) < 1e-6) return v.toExponential(3);
  if (Math.abs(v) >= 1e15) return v.toExponential(4);
  const s = Number(v.toPrecision(6));
  return s.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

const CURRENCY = /^[a-z]{3}$/i;
const SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₩': 'KRW', '₽': 'RUB', '₺': 'TRY', '₪': 'ILS', '₫': 'VND', 'zł': 'PLN' };

export interface Parsed {
  value: number;
  from: string;
  to?: string;
  dim: Dimension;
}

/** "5 ft in cm", "72f to c", "3.5 GB", "€20 in usd", "1,200 sq ft to m2". */
export function parseConversion(input: string): Parsed | undefined {
  let s = input.trim().toLowerCase().replace(/,(?=\d{3}\b)/g, '');
  if (!s) return undefined;
  let sym: string | undefined;
  const lead = Object.keys(SYMBOLS).find((k) => s.startsWith(k.toLowerCase()));
  if (lead) {
    sym = SYMBOLS[lead];
    s = s.slice(lead.length).trim();
  }
  const m = s.match(/^(-?\d*\.?\d+(?:e-?\d+)?)\s*(.*)$/);
  if (!m) return undefined;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return undefined;
  const tokens = m[2].split(/\s+/).filter(Boolean);
  const CONNECT = new Set(['in', 'to', 'as', 'into', '→', '->', '=']);
  const target = (rest: string[]) => (rest.length && CONNECT.has(rest[0]) && rest.length > 1 ? rest.slice(1) : rest).join(' ');
  if (sym) {
    const to = target(tokens);
    if (!to) return { value, from: sym, dim: 'currency' };
    return CURRENCY.test(to) ? { value, from: sym, to: to.toUpperCase(), dim: 'currency' } : undefined;
  }
  // Try every split: "5 in cm" is inches to centimetres, "1,200 sq ft to m2" a two-word unit.
  for (let k = tokens.length; k >= 1; k--) {
    const fromTok = tokens.slice(0, k).join(' ');
    const toTok = target(tokens.slice(k));
    const u = findUnit(fromTok);
    if (u) {
      if (!toTok) return { value, from: u.id, dim: u.dim };
      const t = findUnit(toTok);
      if (t && t.dim === u.dim) return { value, from: u.id, to: t.id, dim: u.dim };
      continue;
    }
    if (CURRENCY.test(fromTok) && (!toTok || CURRENCY.test(toTok))) return { value, from: fromTok.toUpperCase(), to: toTok ? toTok.toUpperCase() : undefined, dim: 'currency' };
  }
  return undefined;
}

/** A sensible "other" unit for each unit, used when no target is given. */
const PAIRS: Record<string, string[]> = {
  mm: ['in'], cm: ['in'], m: ['ft'], km: ['mi'], in: ['cm'], ft: ['m'], yd: ['m'], mi: ['km'], nmi: ['km'],
  mg: ['oz'], g: ['oz'], kg: ['lb'], t: ['lb'], oz: ['g'], lb: ['kg'], st: ['kg'],
  c: ['f'], f: ['c'], k: ['c'],
  ml: ['floz'], l: ['gal'], tsp: ['ml'], tbsp: ['ml'], floz: ['ml'], cup: ['ml'], pt: ['l'], qt: ['l'], gal: ['l'], m3: ['l'],
  mps: ['kmh'], kmh: ['mph'], mph: ['kmh'], kn: ['kmh'], fps: ['mps'],
  m2: ['ft2'], km2: ['mi2'], ft2: ['m2'], mi2: ['km2'], ha: ['acre'], acre: ['ha'],
  b: ['kb'], kb: ['kib'], mb: ['mib'], gb: ['gib'], tb: ['tib'], kib: ['kb'], mib: ['mb'], gib: ['gb'], tib: ['tb'], bit: ['b'],
  ms: ['s'], s: ['min'], min: ['h'], h: ['min'], d: ['h'], wk: ['d'], yr: ['d'],
};

export interface Answer {
  text: string;
  value: number;
  unit: string;
}

/** Answers for a typed query: the asked target, or the most useful others. */
export function answer(input: string, rates?: Rates, homeCurrency = 'USD'): Answer[] {
  const p = parseConversion(input);
  if (!p) return [];
  if (p.dim === 'currency') {
    if (!rates) return [];
    const targets = p.to ? [p.to] : [homeCurrency, 'EUR', 'USD', 'GBP'].filter((c, i, a) => c !== p.from && a.indexOf(c) === i).slice(0, 3);
    return targets.flatMap((t) => {
      const v = convertCurrency(p.value, p.from, t, rates);
      return v === undefined ? [] : [{ text: `${formatNumber(v)} ${t}`, value: v, unit: t }];
    });
  }
  const targets = p.to ? [p.to] : PAIRS[p.from] ?? unitsOf(p.dim).filter((u) => u.id !== p.from).slice(0, 2).map((u) => u.id);
  return targets.flatMap((t) => {
    const v = convert(p.value, p.from, t);
    const u = findUnit(t)!;
    return v === undefined ? [] : [{ text: `${formatNumber(v)} ${u.dim === 'temperature' ? u.label : u.id}`, value: v, unit: u.id }];
  });
}
