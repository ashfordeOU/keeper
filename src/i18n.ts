// SPDX-License-Identifier: AGPL-3.0-or-later
// Interface translations. Only Keeper's own words are translated — never file
// names or anything the user wrote. Missing keys fall back to English.

import { resolveLanguage, translate } from './i18n-strings';
import { useStore } from './state';

export { DICTIONARIES, LANGUAGES, TRANSLATION_KEYS, resolveLanguage, translate } from './i18n-strings';

/** `const t = useT(); t('nav.home')` — re-renders when the language setting changes. */
export function useT(): (key: string) => string {
  const { settings } = useStore();
  const lang = resolveLanguage(settings?.language);
  return (key: string) => translate(lang, key);
}

