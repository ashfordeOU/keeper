// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Terminal palettes for the themes that need their own: the ten newer main
// themes, the five seasonal ones and the five unique showpieces. When a
// terminal follows Keeper's theme ("Follow Keeper's theme"), these give it the
// theme's own ANSI colours instead of the generic Night/Day sets.
//
// Each palette is the theme's background (its deepest panel when dark, its
// brightest when light), its text as the foreground, its accent as the cursor
// and a tint of the accent as the selection. The ANSI colours come from the
// theme's danger/ok/warn colours and shelf colours, nudged lighter (dark) or
// darker (light) until they read on the background. test/terminal.test.ts
// checks every palette: foreground ≥ 4.5:1, the coloured ANSI entries ≥ 3:1.

import type { Scheme } from './schemes';

export type ThemePalette = Omit<Scheme, 'id' | 'name' | 'dark'>;

export const THEME_TERMINALS: Record<string, { light?: ThemePalette; dark?: ThemePalette }> = {
  fjord: {
    light: { background: '#fafbfc', foreground: '#18212b', cursor: '#3a6a8c', selection: '#3a6a8c38',
      ansi: ['#18212b', '#b3364a', '#2f7d5b', '#8a6100', '#4a7ea5', '#776db5', '#37827b', '#e2e7ec', '#66717d', '#b42b41', '#267c56', '#805a00', '#3e7aa7', '#6a5dbb', '#2d827a', '#ffffff'] },
    dark: { background: '#161c22', foreground: '#e6edf3', cursor: '#8fc3db', selection: '#8fc3db4d',
      ansi: ['#242d37', '#ef8a96', '#8fd1a6', '#ebc77a', '#8fbcdc', '#aaa3dc', '#7fc4bc', '#aab6c2', '#8b97a3', '#f8aab3', '#a7e2bc', '#f5d899', '#aacfea', '#c3bdeb', '#95d7cf', '#e6edf3'] },
  },
  terracotta: {
    light: { background: '#fffaf5', foreground: '#2c1a11', cursor: '#a8492a', selection: '#a8492a38',
      ansi: ['#2c1a11', '#a62a2a', '#4f7a3a', '#8a5a00', '#4f7aa8', '#876cae', '#3c837b', '#efe3d6', '#7e6152', '#a62020', '#487a30', '#805300', '#4275ab', '#805cb4', '#32837a', '#ffffff'] },
    dark: { background: '#180f0a', foreground: '#f6e8de', cursor: '#ec8a62', selection: '#ec8a624d',
      ansi: ['#2c1d15', '#f08e86', '#a6cf86', '#edc06a', '#8fb0d9', '#b9a1d9', '#7fc0b6', '#d2b5a4', '#a88d7d', '#f8ada6', '#bbe09e', '#f6d189', '#a9c5e8', '#cebae8', '#94d3ca', '#f6e8de'] },
  },
  sage: {
    light: { background: '#fbfcf8', foreground: '#1c271f', cursor: '#4a7556', selection: '#4a755638',
      ansi: ['#1c271f', '#ac3a36', '#3f7a4a', '#866000', '#517ca2', '#7d6fb3', '#46837a', '#e5e9df', '#69766c', '#ad2f2b', '#357a42', '#7c5900', '#4477a5', '#725fb9', '#3b8479', '#ffffff'] },
    dark: { background: '#121713', foreground: '#e8f0e5', cursor: '#9fcf9c', selection: '#9fcf9c4d',
      ansi: ['#1f2721', '#ef8d86', '#9fcf9c', '#e3c574', '#93b6d6', '#b3a8dc', '#86c4ba', '#b2c0b0', '#8f9d8f', '#f8aca6', '#b6e1b3', '#efd591', '#accae6', '#cbc2eb', '#9cd7cd', '#e8f0e5'] },
  },
  deepsea: {
    light: { background: '#fbfefe', foreground: '#082427', cursor: '#0d7272', selection: '#0d727238',
      ansi: ['#082427', '#b8303e', '#1d7a55', '#8a5c00', '#2c80b9', '#6671d4', '#0f887e', '#dfeeee', '#557779', '#b92534', '#157750', '#805500', '#217cba', '#5663da', '#08847a', '#ffffff'] },
    dark: { background: '#031114', foreground: '#d9f4f2', cursor: '#3fd0c2', selection: '#3fd0c24d',
      ansi: ['#0b2327', '#ff7f93', '#5be0a0', '#f5c75a', '#6cc3ff', '#a3abff', '#3fd0c2', '#94c3c2', '#759f9f', '#ffa8b5', '#77edb4', '#fdd67b', '#95d4ff', '#ccd0ff', '#58e0d3', '#d9f4f2'] },
  },
  dusk: {
    light: { background: '#fdfbff', foreground: '#221a36', cursor: '#6649b5', selection: '#6649b538',
      ansi: ['#221a36', '#b8364f', '#2f7d5f', '#8a5a00', '#4f76ce', '#8163d3', '#398581', '#ebe6f4', '#73698c', '#b92b46', '#267c5b', '#805300', '#3e6cd5', '#7753d9', '#2f8581', '#ffffff'] },
    dark: { background: '#130f20', foreground: '#eee9ff', cursor: '#b9a0ff', selection: '#b9a0ff4d',
      ansi: ['#221d37', '#ff8aa3', '#79d9b0', '#f2c86b', '#94b0ff', '#b9a0ff', '#7fd1c8', '#bdb3d9', '#968cb2', '#ffb3c3', '#94e7c4', '#fad88c', '#bdceff', '#d7c9ff', '#98e1d9', '#eee9ff'] },
  },
  dune: {
    light: { background: '#fdf9f1', foreground: '#2d2113', cursor: '#955a26', selection: '#955a2638',
      ansi: ['#2d2113', '#a8352a', '#557a33', '#8a5800', '#547a9c', '#826aa7', '#418077', '#ede2cf', '#7c6950', '#a82c20', '#507929', '#805100', '#47759f', '#7b5aad', '#368176', '#ffffff'] },
    dark: { background: '#17120d', foreground: '#f5ead6', cursor: '#e6b066', selection: '#e6b0664d',
      ansi: ['#2a2219', '#ef8f80', '#b0cf86', '#f0c85e', '#93b2d1', '#b8a6d6', '#86c2b8', '#cdbb9d', '#a59378', '#f8aca0', '#c4e09e', '#f9d77e', '#abc6e2', '#cdbee6', '#9bd5cc', '#f5ead6'] },
  },
  editorial: {
    light: { background: '#ffffff', foreground: '#111111', cursor: '#cc2e1f', selection: '#cc2e1f38',
      ansi: ['#111111', '#cc2e1f', '#2e7d32', '#8a5a00', '#2a5db0', '#8a3a8a', '#1f7a80', '#f0f0ec', '#6b6b6b', '#cc2515', '#257c29', '#805300', '#2057b0', '#8a308a', '#17777e', '#ffffff'] },
    dark: { background: '#0c0c0c', foreground: '#f2f2f2', cursor: '#ff5a47', selection: '#ff5a474d',
      ansi: ['#1b1b1b', '#ff5a47', '#6fcf7a', '#f0c060', '#7aa8ff', '#d68ad6', '#6fc8cf', '#b8b8b8', '#8c8c8c', '#ff7f70', '#88df92', '#f9d180', '#a3c3ff', '#e5a4e5', '#88d9df', '#f2f2f2'] },
  },
  solarpunk: {
    light: { background: '#fcfef7', foreground: '#172b14', cursor: '#3b761d', selection: '#3b761d38',
      ansi: ['#172b14', '#b0362c', '#2f7d1f', '#8a6400', '#377ec1', '#7a6bcf', '#1c8976', '#e7efda', '#637a5a', '#b02c22', '#287b17', '#805d00', '#2b79c3', '#6d5bd5', '#148773', '#ffffff'] },
    dark: { background: '#0a120a', foreground: '#ecf8dc', cursor: '#c7e85a', selection: '#c7e85a4d',
      ansi: ['#172517', '#ff8a7a', '#8fe06a', '#ffd84a', '#7ec0ff', '#b3a8ff', '#5ed6c0', '#b7cfa3', '#90ab7e', '#ffaea3', '#a6ed86', '#ffe173', '#a7d4ff', '#d7d1ff', '#78e5d1', '#ecf8dc'] },
  },
  circuit: {
    light: { background: '#fbfbfc', foreground: '#15181d', cursor: '#1f5bf0', selection: '#1f5bf038',
      ansi: ['#15181d', '#c42f3f', '#1d7f4f', '#8a5b00', '#1f5bf0', '#7a5cf0', '#008491', '#e4e6ea', '#686e78', '#c52435', '#157d4a', '#805400', '#0b50f9', '#6e4bf7', '#007b87', '#ffffff'] },
    dark: { background: '#0f1114', foreground: '#e8ecf2', cursor: '#4d8cff', selection: '#4d8cff4d',
      ansi: ['#1d2025', '#ff7586', '#4fd18a', '#f5c45a', '#4d8cff', '#a68cff', '#3fd0e0', '#aab1bd', '#868e9a', '#ff9eaa', '#68e19f', '#fdd47b', '#76a6ff', '#c6b5ff', '#5bdeed', '#e8ecf2'] },
  },
  champagne: {
    light: { background: '#fffdfb', foreground: '#2e1a1a', cursor: '#a3425a', selection: '#a3425a38',
      ansi: ['#2e1a1a', '#a82a2a', '#3f7a4f', '#8a5c00', '#5178bd', '#9164bf', '#4c837c', '#f3e8e1', '#826262', '#a82020', '#357a47', '#805500', '#406fc4', '#8c54c5', '#40847c', '#ffffff'] },
    dark: { background: '#171113', foreground: '#f8ebe7', cursor: '#f0a8b6', selection: '#f0a8b64d',
      ansi: ['#2a1f22', '#f28d86', '#9fd0a6', '#f0cf86', '#a3b8e6', '#c4a8e6', '#8fcbc2', '#d4b8b2', '#ac918b', '#faaca7', '#b6e1bc', '#f8dfa6', '#c0d0f2', '#d9c5f2', '#a6ddd5', '#f8ebe7'] },
  },
  frost: {
    light: { background: '#ffffff', foreground: '#0f2234', cursor: '#2a6aa8', selection: '#2a6aa838',
      ansi: ['#0f2234', '#b8344a', '#1f7a5f', '#8a5c00', '#2a7cc7', '#6b70d1', '#348686', '#e4eef6', '#5f7589', '#b92941', '#17785b', '#805500', '#1f77c8', '#5b61d7', '#2a8686', '#ffffff'] },
    dark: { background: '#09121b', foreground: '#e6f1fb', cursor: '#8cc8ff', selection: '#8cc8ff4d',
      ansi: ['#142231', '#ff8a9c', '#6fd6b0', '#f2c96a', '#8cc8ff', '#aab0ff', '#6fd6d0', '#a8bfd3', '#859db3', '#ffb3bf', '#89e5c3', '#fad98b', '#b5dcff', '#d3d6ff', '#89e5df', '#e6f1fb'] },
  },
  meadow: {
    light: { background: '#ffffff', foreground: '#1a2b17', cursor: '#b83a72', selection: '#b83a7238',
      ansi: ['#1a2b17', '#b3332f', '#3f8a2f', '#8a6200', '#257ed2', '#8862da', '#2f867a', '#ebf2e1', '#66785c', '#b42924', '#378925', '#805b00', '#1a79d3', '#7f52e0', '#268578', '#ffffff'] },
    dark: { background: '#0f150d', foreground: '#eef7e6', cursor: '#ff8fbf', selection: '#ff8fbf4d',
      ansi: ['#1c2619', '#ff8a80', '#8fd96a', '#ffd36a', '#8fc4ff', '#c0a8ff', '#6fd6c4', '#bccdb0', '#97a98c', '#ffb0a9', '#a5e785', '#ffdf93', '#b8d9ff', '#ded1ff', '#89e5d5', '#eef7e6'] },
  },
  summer: {
    light: { background: '#ffffff', foreground: '#2a1d05', cursor: '#08707f', selection: '#08707f38',
      ansi: ['#2a1d05', '#c2372f', '#2a8a3f', '#9a5f00', '#1a80b2', '#8367de', '#10887b', '#fff0d1', '#7a6740', '#c32c24', '#218938', '#905900', '#117cb1', '#7857e4', '#098577', '#ffffff'] },
    dark: { background: '#0b1820', foreground: '#fdf3df', cursor: '#ffc94a', selection: '#ffc94a4d',
      ansi: ['#182b36', '#ff8a7a', '#6fdc8f', '#ffc94a', '#6fc6ff', '#b9a3ff', '#4fe0d0', '#d6c7a6', '#ac9e80', '#ffaea3', '#8aeaa6', '#ffd573', '#98d6ff', '#d8ccff', '#6bedde', '#fdf3df'] },
  },
  autumn: {
    light: { background: '#fffbf5', foreground: '#2e160a', cursor: '#a8431a', selection: '#a8431a38',
      ansi: ['#2e160a', '#a8302a', '#5a7a2a', '#8a5600', '#4f6f9a', '#8a5a9a', '#3c8374', '#f1e3d1', '#835f45', '#a82620', '#567921', '#805000', '#43699c', '#894d9d', '#328372', '#ffffff'] },
    dark: { background: '#160d07', foreground: '#f8e7d6', cursor: '#f29a4a', selection: '#f29a4a4d',
      ansi: ['#2a1a10', '#f08a7a', '#b8cf6a', '#f2c45a', '#93acd6', '#c09ad0', '#7fc2b2', '#d4b394', '#ab8e73', '#f8a79a', '#cadf83', '#fad47a', '#acc2e6', '#d3b2e1', '#95d5c6', '#f8e7d6'] },
  },
  festive: {
    light: { background: '#ffffff', foreground: '#1e1e2a', cursor: '#1f7a4f', selection: '#1f7a4f38',
      ansi: ['#1e1e2a', '#c02a3a', '#1f7a4f', '#8a5c00', '#2f7ad6', '#7a5ad6', '#1c897b', '#f2ebe1', '#6a6a7c', '#c11f30', '#17784a', '#805500', '#1f74dc', '#6f49dd', '#148778', '#ffffff'] },
    dark: { background: '#0d0f17', foreground: '#f6eee2', cursor: '#ffd34a', selection: '#ffd34a4d',
      ansi: ['#1a1d2b', '#ff7a8a', '#5fd68f', '#ffd34a', '#7ab3ff', '#b3a0ff', '#4fd6c4', '#c8bfb0', '#a19a8c', '#ffa3ae', '#79e5a4', '#ffdd73', '#a3caff', '#d4c9ff', '#69e5d4', '#f6eee2'] },
  },
  blueprint: {
    light: { background: '#ffffff', foreground: '#0b2a4f', cursor: '#1a56b8', selection: '#1a56b838',
      ansi: ['#0b2a4f', '#b8304a', '#1f7a5a', '#8a5c00', '#1a56b8', '#7a5ad6', '#1e8696', '#e6eff9', '#4f73a0', '#b92541', '#177856', '#805500', '#1150b7', '#6f49dd', '#168394', '#ffffff'] },
    dark: { background: '#0b2f58', foreground: '#f2f8ff', cursor: '#ffe14a', selection: '#ffe14a4d',
      ansi: ['#13457f', '#ffb0b0', '#9af0c0', '#ffe14a', '#9ad0ff', '#c9b3ff', '#8ff0e0', '#c9def5', '#a8c6e6', '#ffd9d9', '#bbf8d6', '#ffe873', '#c3e3ff', '#e6dcff', '#b0f8ec', '#f2f8ff'] },
  },
  aurora: {
    dark: { background: '#04070d', foreground: '#eaf4ff', cursor: '#5cf2b5', selection: '#5cf2b54d',
      ansi: ['#0f1524', '#ff7a9a', '#5cf2b5', '#ffd166', '#6cc8ff', '#a98bff', '#5cf2d5', '#b0c4dc', '#8a9cb6', '#ffa3b9', '#7cfac7', '#ffdd8f', '#95d7ff', '#c7b4ff', '#7cfae2', '#eaf4ff'] },
  },
  glass: {
    light: { background: '#ffffff', foreground: '#121a26', cursor: '#2a66d6', selection: '#2a66d638',
      ansi: ['#121a26', '#c0304a', '#1d7f56', '#8a5c00', '#1978ed', '#7f61ef', '#178883', '#e2e8f1', '#5c697e', '#c12541', '#157d51', '#805500', '#0872f4', '#7350f5', '#108580', '#ffffff'] },
    dark: { background: '#090c12', foreground: '#eef2fa', cursor: '#7fa8ff', selection: '#7fa8ff4d',
      ansi: ['#171d2a', '#ff7f95', '#5fd99f', '#f5c860', '#7fa8ff', '#b3a0ff', '#5fd6d0', '#b3bdd0', '#8f99ae', '#ffa8b7', '#7ae7b3', '#fdd781', '#a8c4ff', '#d4c9ff', '#79e5df', '#eef2fa'] },
  },
  inkwash: {
    light: { background: '#fbf9f4', foreground: '#141414', cursor: '#b0251d', selection: '#b0251d38',
      ansi: ['#141414', '#b0251d', '#3f6b3a', '#7a5600', '#2f4f73', '#7a3f6a', '#2f6a64', '#ebe6da', '#666360', '#af1c14', '#366b30', '#704f00', '#264a72', '#7a3567', '#266962', '#ffffff'] },
    dark: { background: '#100f0e', foreground: '#efe9de', cursor: '#ff6a5c', selection: '#ff6a5c4d',
      ansi: ['#1e1d1b', '#ff6a5c', '#94c08a', '#e6c26a', '#9ab4d6', '#c8a0c0', '#8ab8b0', '#bdb6aa', '#99928a', '#ff8f85', '#a9d49f', '#f1d388', '#b3c9e6', '#dbb5d4', '#9ecdc5', '#efe9de'] },
  },
  amber: {
    dark: { background: '#080400', foreground: '#ffc966', cursor: '#ffb000', selection: '#ffb0004d',
      ansi: ['#160c02', '#ff6a3d', '#d6e05a', '#ffd36b', '#e0a246', '#ff8c2a', '#ffc966', '#e0a246', '#b8843a', '#ff8966', '#e4ed76', '#ffdf94', '#edb562', '#ffa253', '#ffd78f', '#ffc966'] },
  },
};

/**
 * The terminal scheme for a Keeper theme in a mode, or undefined when the theme
 * has no palette of its own (the caller then falls back to Night or Day).
 */
export function themeTerminalScheme(themeId: string | undefined, mode: 'light' | 'dark'): Scheme | undefined {
  const t = themeId ? THEME_TERMINALS[themeId] : undefined;
  if (!t) return undefined;
  const p = t[mode] ?? t.dark ?? t.light;
  if (!p) return undefined;
  return { id: `theme:${themeId}`, name: themeId!, dark: p === t.dark, ...p };
}
