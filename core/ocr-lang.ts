// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Working out which language a picture's text is in, so the right reader runs.
// First the writing system (from the reader's script detection), then for
// Latin text the language itself, from its most common short words.

/** Writing system (as the script detector names it) → reader languages to use. */
export const SCRIPT_LANGS: Record<string, string[]> = {
  Latin: ['eng'],
  Cyrillic: ['rus', 'ukr'],
  Greek: ['ell'],
  Arabic: ['ara', 'fas'],
  Hebrew: ['heb'],
  Han: ['chi_sim', 'chi_tra'],
  HanS: ['chi_sim'],
  HanT: ['chi_tra'],
  Japanese: ['jpn'],
  Katakana: ['jpn'],
  Hiragana: ['jpn'],
  Hangul: ['kor'],
  Korean: ['kor'],
  Devanagari: ['hin', 'mar'],
  Bengali: ['ben'],
  Thai: ['tha'],
  Tamil: ['tam'],
  Telugu: ['tel'],
  Kannada: ['kan'],
  Malayalam: ['mal'],
  Gujarati: ['guj'],
  Gurmukhi: ['pan'],
  Armenian: ['hye'],
  Georgian: ['kat'],
  Ethiopic: ['amh'],
  Khmer: ['khm'],
  Lao: ['lao'],
  Myanmar: ['mya'],
  Sinhala: ['sin'],
};

/**
 * The reader languages for a detected writing system. Languages the person
 * already chose for that writing system come first; otherwise the defaults.
 */
export function languagesForScript(script: string | null | undefined, chosen: string[]): string[] {
  const forScript = SCRIPT_LANGS[script ?? ''];
  if (!forScript) return chosen.length ? chosen : ['eng'];
  const mine = chosen.filter((c) => scriptOfLanguage(c) === (script === 'HanS' || script === 'HanT' ? 'Han' : script));
  return mine.length ? mine : forScript.slice(0, 1);
}

export function scriptOfLanguage(code: string): string {
  for (const [script, langs] of Object.entries(SCRIPT_LANGS)) if (langs.includes(code)) return script === 'HanS' || script === 'HanT' ? 'Han' : script;
  return 'Latin';
}

const STOPWORDS: Record<string, string[]> = {
  eng: ['the', 'and', 'of', 'to', 'is', 'in', 'that', 'it', 'for', 'with', 'you', 'this', 'are', 'was', 'on'],
  deu: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'ein', 'eine', 'zu', 'mit', 'den', 'ich', 'sie', 'auf', 'für'],
  fra: ['le', 'la', 'les', 'et', 'des', 'est', 'une', 'un', 'pas', 'que', 'pour', 'dans', 'qui', 'sur', 'avec'],
  spa: ['el', 'la', 'los', 'las', 'y', 'que', 'es', 'en', 'un', 'una', 'por', 'con', 'para', 'del', 'no'],
  ita: ['il', 'la', 'di', 'che', 'e', 'un', 'una', 'per', 'non', 'sono', 'con', 'gli', 'del', 'della', 'è'],
  por: ['o', 'a', 'os', 'as', 'que', 'não', 'um', 'uma', 'para', 'com', 'do', 'da', 'em', 'é', 'por'],
  nld: ['de', 'het', 'een', 'en', 'van', 'is', 'niet', 'dat', 'op', 'te', 'voor', 'met', 'zijn', 'ik', 'je'],
  swe: ['och', 'det', 'att', 'är', 'en', 'som', 'på', 'för', 'med', 'inte', 'jag', 'har', 'av', 'till', 'den'],
  dan: ['og', 'det', 'at', 'er', 'en', 'som', 'på', 'for', 'med', 'ikke', 'jeg', 'har', 'af', 'til', 'den'],
  nor: ['og', 'det', 'at', 'er', 'en', 'som', 'på', 'for', 'med', 'ikke', 'jeg', 'har', 'av', 'til', 'den'],
  fin: ['ja', 'on', 'ei', 'että', 'se', 'oli', 'ovat', 'mutta', 'kuin', 'myös', 'tai', 'sen', 'hän', 'minä', 'olla'],
  pol: ['i', 'w', 'na', 'nie', 'się', 'jest', 'to', 'że', 'z', 'do', 'jak', 'od', 'po', 'ale', 'dla'],
  ces: ['a', 'je', 'se', 'na', 'v', 'že', 'to', 's', 'z', 'do', 'jsem', 'ale', 'jak', 'pro', 'není'],
  tur: ['ve', 'bir', 'bu', 'da', 'de', 'için', 'ile', 'çok', 'ne', 'değil', 'gibi', 'daha', 'olarak', 'var', 'ben'],
  ron: ['și', 'de', 'la', 'în', 'cu', 'nu', 'este', 'pe', 'un', 'o', 'că', 'din', 'pentru', 'mai', 'sunt'],
  hun: ['a', 'az', 'és', 'hogy', 'nem', 'is', 'egy', 'van', 'meg', 'de', 'csak', 'már', 'mint', 'ez', 'volt'],
  vie: ['và', 'của', 'là', 'có', 'không', 'được', 'các', 'cho', 'những', 'một', 'người', 'trong', 'này', 'với', 'đã'],
  ind: ['dan', 'yang', 'di', 'ini', 'itu', 'dengan', 'untuk', 'tidak', 'dari', 'dalam', 'akan', 'pada', 'juga', 'saya', 'ada'],
};

/** The likeliest Latin-script language of some text, or null when there is too little to tell. */
export function guessLatinLanguage(text: string): string | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 6) return null;
  let best: string | null = null;
  let bestScore = 0;
  let second = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length / words.length;
    if (score > bestScore) { second = bestScore; bestScore = score; best = lang; } else if (score > second) second = score;
  }
  return bestScore >= 0.08 && bestScore > second * 1.3 ? best : null;
}
