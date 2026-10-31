// SPDX-License-Identifier: AGPL-3.0-or-later
// The Terminal's words in the person's language. Missing ones fall back to
// English. Programs inside a terminal choose their language from the profile's
// locale setting.

import { resolveLanguage } from '../i18n';
import { useStore } from '../state';
import { termText } from './dict';

export { PROGRAM_LOCALES, TERM_KEYS, TERM_LANGS, termDictionary, termText } from './dict';

export function useTT(): (key: string) => string {
  const { settings } = useStore();
  const lang = resolveLanguage(settings?.language);
  return (key: string) => termText(lang, key);
}

