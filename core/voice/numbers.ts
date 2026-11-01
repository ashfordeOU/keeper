// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Spoken numbers, times, money, dates, emails and links written the usual way
// ("twenty five percent" → "25%", "three thirty pm" → "3:30 PM",
// "john dot smith at gmail dot com" → "john.smith@gmail.com"). English rules,
// fixed and predictable: no model decides anything here.

const UNITS: Record<string, number> = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS: Record<string, number> = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000 };
const ORD: Record<string, string> = {
  first: 'one', second: 'two', third: 'three', fourth: 'four', fifth: 'five', sixth: 'six', seventh: 'seven', eighth: 'eight', ninth: 'nine', tenth: 'ten',
  eleventh: 'eleven', twelfth: 'twelve', thirteenth: 'thirteen', fourteenth: 'fourteen', fifteenth: 'fifteen', sixteenth: 'sixteen', seventeenth: 'seventeen',
  eighteenth: 'eighteen', nineteenth: 'nineteen', twentieth: 'twenty', thirtieth: 'thirty', fortieth: 'forty', fiftieth: 'fifty', sixtieth: 'sixty',
  seventieth: 'seventy', eightieth: 'eighty', ninetieth: 'ninety', hundredth: 'hundred', thousandth: 'thousand', millionth: 'million',
};
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TLDS = 'com|org|net|io|app|dev|co|uk|de|fr|es|it|nl|eu|edu|gov|ai|me|info|xyz|ca|au|us|ee|ch|se|no|fi|dk|be|at|pl|jp|in|tv|ly|so|sh|gg|fm';

const isNumWord = (w: string) => w in UNITS || w in TEENS || w in TENS || w in SCALES || w in ORD || w === 'a' || w === 'and' || w === 'point';

export const ordinalSuffix = (n: number) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
};

/** A plain run of number words as a value, or null when it isn't one number ("five five five" is a digit string instead). */
export function parseCardinal(words: string[]): number | null {
  if (!words.length) return null;
  let total = 0;
  let cur = 0;
  let last: 'none' | 'unit' | 'teen' | 'tens' | 'scale' = 'none';
  let seen = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'and') { if (last !== 'scale') return null; continue; }
    if (w === 'a') { if (i !== 0 || !(words[1] in SCALES)) return null; cur = 1; last = 'unit'; continue; }
    if (w in UNITS) {
      if (last === 'unit' || last === 'teen') return null;
      cur += UNITS[w]; last = 'unit'; seen = true;
    } else if (w in TEENS) {
      if (last === 'unit' || last === 'teen' || last === 'tens') return null;
      cur += TEENS[w]; last = 'teen'; seen = true;
    } else if (w in TENS) {
      if (last === 'unit' || last === 'teen' || last === 'tens') return null;
      cur += TENS[w]; last = 'tens'; seen = true;
    } else if (w in SCALES) {
      const s = SCALES[w];
      if (s === 100) { cur = (cur || 1) * 100; }
      else { total += (cur || 1) * s; cur = 0; }
      last = 'scale'; seen = true;
    } else return null;
  }
  return seen ? total + cur : null;
}

/** "twenty twenty six" → 2026, "nineteen eighty four" → 1984, "two thousand and five" is handled by parseCardinal. */
function parseYear(words: string[]): number | null {
  for (let cut = 1; cut < words.length; cut++) {
    const a = parseCardinal(words.slice(0, cut));
    const restWords = words.slice(cut);
    const b = restWords[0] === 'oh' ? (restWords.length === 2 ? UNITS[restWords[1]] ?? null : null) : restWords.length === 1 && restWords[0] === 'hundred' ? 0 : parseCardinal(restWords);
    if (a !== null && b !== null && a >= 10 && a <= 99 && b >= 0 && b <= 99 && (restWords[0] === 'oh' || restWords[0] === 'hundred' || b >= 10)) return a * 100 + b;
  }
  return null;
}

const group = (n: number) => (Math.abs(n) >= 10_000 ? n.toLocaleString('en-US', { maximumFractionDigits: 6 }) : String(n));

interface Tok { w: string; raw: string; trail: string }

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(/(\S+)(\s*)/g)) {
    const raw = m[1];
    out.push({ raw, w: raw.toLowerCase().replace(/^[^\p{L}\p{N}'$€£]+|[^\p{L}\p{N}'%]+$/gu, ''), trail: m[2] });
  }
  return out;
}

/** Punctuation the speaker's word carried (kept around the number we write). */
const lead = (raw: string) => raw.match(/^[^\p{L}\p{N}'$€£]*/u)?.[0] ?? '';
const tail = (raw: string) => raw.match(/[^\p{L}\p{N}'%]*$/u)?.[0] ?? '';

/**
 * Number words to figures, with the context around them: percent, money,
 * clock times, ordinals in dates, years, and digit strings.
 */
export function formatNumbers(text: string): string {
  const toks = tokenize(text);
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    // the longest run of number words starting here (an "and"/"a"/"point" may not start or end it)
    let j = i;
    while (j < toks.length && isNumWord(toks[j].w) && (j === i || !/[,.;:!?]$/.test(toks[j - 1].raw))) j++;
    while (j > i && ['and', 'a', 'point'].includes(toks[j - 1].w)) j--;
    if (j === i || (j - i === 1 && toks[i].w === 'oh')) { out.push(toks[i].raw + toks[i].trail); i++; continue; }
    const run = toks.slice(i, j);
    const words = run.map((t) => t.w);
    const pre = lead(run[0].raw);
    const post = tail(run[run.length - 1].raw);
    const next = toks[j]?.w ?? '';
    const next2 = toks[j + 1]?.w ?? '';
    const prev = (toks[i - 1]?.w ?? '').toLowerCase();
    const trail = run[run.length - 1].trail;
    const emit = (s: string, consumed: number, endTrail?: string, endPost?: string) => {
      const lastTok = toks[i + consumed - 1];
      out.push(pre + s + (endPost ?? tail(lastTok.raw)) + (endTrail ?? lastTok.trail));
      i += consumed;
    };

    // ordinals: "twenty first" → 21st, but plain "first" in prose stays a word
    const lastWord = words[words.length - 1];
    if (lastWord in ORD) {
      const n = parseCardinal([...words.slice(0, -1), ORD[lastWord]]);
      const dateish = MONTHS.some((m) => m.toLowerCase() === prev) || (next === 'of' && MONTHS.some((m) => m.toLowerCase() === next2));
      if (n !== null && (n >= 10 || dateish)) { emit(`${n}${ordinalSuffix(n)}`, run.length); continue; }
      out.push(toks[i].raw + toks[i].trail); i++; continue;
    }

    // decimals: "three point five" → 3.5
    const p = words.indexOf('point');
    let value: number | null = null;
    let text0 = '';
    if (p > 0) {
      const whole = parseCardinal(words.slice(0, p));
      const frac = words.slice(p + 1);
      if (whole !== null && frac.length && frac.every((w) => w in UNITS)) { value = Number(`${whole}.${frac.map((w) => UNITS[w]).join('')}`); text0 = `${whole}.${frac.map((w) => UNITS[w]).join('')}`; }
    }

    // clock times: "three thirty pm", "ten am", "seven o'clock", "half past"-free
    const ampm = /^(am|pm|a\.m|p\.m|a\.m\.|p\.m\.)$/.test(next) ? next : next === 'a' && next2 === 'm' ? 'am' : next === 'p' && next2 === 'm' ? 'pm' : '';
    if (p < 0 && (ampm || next === "o'clock" || next === 'oclock')) {
      const h = parseCardinal([words[0]]);
      const rest = words.slice(1);
      const m = rest.length === 0 ? 0 : rest[0] === 'oh' && rest.length === 2 ? UNITS[rest[1]] : parseCardinal(rest);
      if (h !== null && h >= 1 && h <= 12 && m !== null && m >= 0 && m < 60) {
        const suffix = ampm ? ` ${ampm.startsWith('a') ? 'AM' : 'PM'}` : '';
        const t = ampm && m === 0 ? `${h}${suffix}` : `${h}:${String(m).padStart(2, '0')}${suffix}`;
        const used = run.length + (ampm ? (next === 'a' || next === 'p' ? 2 : 1) : 1);
        emit(t, used);
        continue;
      }
    }

    if (value === null) {
      value = parseCardinal(words);
      if (value === null) {
        const y = parseYear(words);
        if (y !== null) { emit(String(y), run.length); continue; }
        if (words.length >= 3 && words.every((w) => w in UNITS)) { emit(words.map((w) => UNITS[w]).join(''), run.length); continue; }
        // not one number: write the first word and try again from the next
        out.push(toks[i].raw + toks[i].trail); i++; continue;
      }
      text0 = group(value);
    }

    // context after the number
    if (next === 'percent' || (next === 'per' && next2 === 'cent')) { emit(`${text0}%`, run.length + (next === 'per' ? 2 : 1)); continue; }
    const cur = /^(dollars?|bucks|usd)$/.test(next) ? '$' : /^euros?$/.test(next) ? '€' : /^pounds?$/.test(next) && /^(sterling)?$/.test(next2) ? '£' : '';
    if (cur && post === '') {
      // "five dollars and fifty cents" → $5.50
      let used = run.length + 1;
      let money = text0;
      if (toks[j + 1]?.w === 'and') {
        let k = j + 2;
        while (k < toks.length && isNumWord(toks[k].w) && toks[k].w !== 'and') k++;
        const cents = parseCardinal(toks.slice(j + 2, k).map((t) => t.w));
        if (cents !== null && cents < 100 && /^cents?$/.test(toks[k]?.w ?? '')) { money = `${text0}.${String(cents).padStart(2, '0')}`; used = k - i + 1; }
      }
      emit(`${cur}${money}`, used);
      continue;
    }
    if (value < 10 && Number.isInteger(value) && !text0.includes('.')) {
      // small numbers stay words in prose, unless a unit follows
      if (!/^(kg|km|cm|mm|gb|mb|tb|kb|ms|px|pt|x|%|degrees?|mph|kph|v|w|kw|hz|k)$/.test(next)) { out.push(run.map((t) => t.raw + t.trail).join('')); i = j; continue; }
    }
    emit(text0, run.length, trail, post);
  }
  return out.join('');
}

/** "3.30 p.m." → "3:30 PM", "10 a.m." → "10 AM". */
export function tidyTimes(text: string): string {
  return text
    .replace(/\b(\d{1,2})[.:](\d{2})\s*([ap])\.?\s?m\b\.?/gi, (_m, h, mm, ap) => `${h}:${mm} ${ap.toUpperCase()}M`)
    .replace(/\b(\d{1,2})\s*([ap])\.?\s?m\b\.?/gi, (_m, h, ap) => `${h} ${ap.toUpperCase()}M`);
}

/** Dates: "March third" → "March 3", "the third of March" stays in that order as "3 March". */
export function formatDates(text: string): string {
  const months = MONTHS.join('|');
  return text
    .replace(new RegExp(`\\b(${months})\\s+(\\d{1,2})(?:st|nd|rd|th)\\b`, 'gi'), (_m, mo, d) => `${cap(mo)} ${d}`)
    .replace(new RegExp(`\\b(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)\\s+of\\s+(${months})\\b`, 'gi'), (_m, d, mo) => `${d} ${cap(mo)}`)
    .replace(new RegExp(`\\b(${months}|${WEEKDAYS.join('|')})\\b`, 'gi'), (m) => (m === 'may' || m === 'march' ? m : cap(m)));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/**
 * Spoken links and addresses: "keeper dot app slash docs" → "keeper.app/docs",
 * "anna dot lee at example dot com" → "anna.lee@example.com".
 */
export function formatAddresses(text: string): string {
  let t = text.replace(/\bw\s?w\s?w\s+dot\s+/gi, 'www.');
  // name dot name … dot tld
  t = t.replace(new RegExp(`\\b([\\w-]+(?:\\s+dot\\s+[\\w-]+)*\\s+dot\\s+(?:${TLDS}))\\b`, 'gi'), (m) => m.replace(/\s+dot\s+/gi, '.').toLowerCase());
  // the person/name part of an email: "john dot smith at", "j underscore doe at"
  t = t.replace(new RegExp(`\\b([\\w-]+(?:\\s+(?:dot|underscore|dash)\\s+[\\w-]+)*)\\s+at\\s+((?:[\\w-]+\\.)+(?:${TLDS}))\\b`, 'gi'), (_m, user: string, dom: string) => `${user.replace(/\s+dot\s+/gi, '.').replace(/\s+underscore\s+/gi, '_').replace(/\s+dash\s+/gi, '-').toLowerCase()}@${dom.toLowerCase()}`);
  // paths after a domain: "example.com slash docs slash start"
  t = t.replace(new RegExp(`\\b((?:[\\w-]+\\.)+(?:${TLDS}))((?:\\s+slash\\s+[\\w-]+)+)`, 'gi'), (_m, dom: string, path: string) => dom + path.replace(/\s+slash\s+/gi, '/'));
  return t;
}
