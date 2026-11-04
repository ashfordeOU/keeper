// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What a page's head (PageHead in ui.tsx) needs from around it:
// - a merged page's title and tabs, so a tab's own head becomes the page's head
//   with the tabs right under it;
// - "embedded": a page shown inside another, whose head becomes a section heading;
// - the hint cards for this page, shown under the title rather than above it.

import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';

export interface HubFrame {
  title: string;
  tabs: ReactNode;
}

export const HubContext = createContext<HubFrame | null>(null);
export const EmbeddedContext = createContext(false);

/** The merged page this page is a tab of (its title shows instead of the page's own), if any. */
export const useHubTitle = (): string | undefined => useContext(HubContext)?.title;

export interface HintsFrame {
  /** the hints for the page on screen */
  render(): ReactNode;
  /** a page head is showing them (the window shows them itself while none is) */
  claim(): () => void;
}

export const HintsContext = createContext<HintsFrame | null>(null);

/** For PageHead: the hints under the title, and the window told not to show them above the page. */
export function usePageHints(enabled: boolean): ReactNode {
  const h = useContext(HintsContext);
  useLayoutEffect(() => (enabled && h ? h.claim() : undefined), [enabled, h]);
  return enabled && h ? h.render() : null;
}

/** Shows a page inside another: its PageHead turns into a section heading. */
export function Embedded({ children }: { children: ReactNode }) {
  return <EmbeddedContext.Provider value={true}><HubContext.Provider value={null}>{children}</HubContext.Provider></EmbeddedContext.Provider>;
}
