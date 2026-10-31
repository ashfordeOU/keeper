// SPDX-License-Identifier: AGPL-3.0-or-later
// Colour schemes for terminals. 'keeper' follows the app's own theme; the rest
// are Keeper's own palettes, each checked for readable text on its background.

export interface Scheme {
  id: string;
  name: string;
  dark: boolean;
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  /** black, red, green, yellow, blue, magenta, cyan, white, then the bright eight */
  ansi: string[];
}

export const SCHEMES: Scheme[] = [
  { id: 'night', name: 'Night', dark: true, background: '#14151b', foreground: '#d7dae0', cursor: '#7c8cff', selection: '#7c8cff44',
    ansi: ['#1d1f27', '#ff6b7a', '#7bd88f', '#ffd166', '#6ea8fe', '#c792ea', '#5ccfe6', '#c8ccd4', '#4b5060', '#ff8d99', '#9be7a9', '#ffe08a', '#8fbaff', '#d7aefb', '#7fe0f0', '#ffffff'] },
  { id: 'day', name: 'Day', dark: false, background: '#fbfaf7', foreground: '#2b2d33', cursor: '#4f5bd5', selection: '#4f5bd533',
    ansi: ['#2b2d33', '#c8323e', '#2c8a43', '#9a6a00', '#2f5fd0', '#8a3fb8', '#11808f', '#d9d6cf', '#6b6f78', '#e0505b', '#3aa457', '#b88200', '#4a78e6', '#a35ad0', '#1d9aab', '#ffffff'] },
  { id: 'phosphor', name: 'Phosphor', dark: true, background: '#050805', foreground: '#7dff8a', cursor: '#7dff8a', selection: '#2a5a2e',
    ansi: ['#0b120b', '#ff5f56', '#5af06a', '#d8f05a', '#4fc1ff', '#c38cff', '#5ef0d2', '#b6f5bc', '#2b442d', '#ff8a82', '#8dff99', '#eaff8a', '#86d6ff', '#d8b2ff', '#8ffbe6', '#e6ffe8'] },
  { id: 'amber', name: 'Amber', dark: true, background: '#120c03', foreground: '#ffb641', cursor: '#ffb641', selection: '#5a3d0e',
    ansi: ['#1c1406', '#ff6a3d', '#c2c74a', '#ffb641', '#d79b4a', '#e08a6b', '#d5b86b', '#f5d9a8', '#4a3618', '#ff8f6a', '#dbe070', '#ffd27a', '#ecb878', '#f2a990', '#ecd298', '#fff0d6'] },
  { id: 'harbor', name: 'Harbor', dark: true, background: '#0f1b24', foreground: '#cfe3ee', cursor: '#5fd4c8', selection: '#2a4a5c',
    ansi: ['#16262f', '#ef6f6c', '#69d3a4', '#f3c969', '#5aa9e6', '#b48ead', '#5fd4c8', '#c7d6de', '#3b5563', '#ff8e8b', '#8ae8bd', '#ffdc8c', '#82c3f4', '#cfa8c8', '#87e8de', '#f2fbff'] },
  { id: 'meadow', name: 'Meadow', dark: false, background: '#f5f8f1', foreground: '#26312a', cursor: '#3e8e5a', selection: '#3e8e5a33',
    ansi: ['#26312a', '#b8403a', '#2f7d45', '#8a6a12', '#2e63a8', '#7f4c9e', '#1f7f7a', '#d6ddd2', '#5c6b61', '#d0574f', '#3d9958', '#a8841c', '#4279c2', '#9764b8', '#2a9993', '#ffffff'] },
  { id: 'dusk', name: 'Dusk', dark: true, background: '#1e1626', foreground: '#eadcf3', cursor: '#ff7eb6', selection: '#5a3d6e',
    ansi: ['#2a2033', '#ff6e8a', '#9ce5a0', '#ffd27f', '#8fb4ff', '#ff7eb6', '#7fe0e6', '#d9cce2', '#5a4a66', '#ff93a8', '#b9f2bc', '#ffe2a6', '#b0caff', '#ffa3cc', '#a6eef2', '#ffffff'] },
  { id: 'paper', name: 'Paper', dark: false, background: '#f6efe2', foreground: '#3a3128', cursor: '#8a5a2b', selection: '#8a5a2b33',
    ansi: ['#3a3128', '#a8432f', '#5c7a2a', '#946b14', '#3e5f8a', '#7f4f7a', '#3f7a72', '#e4dccb', '#7a6d5d', '#c45a43', '#73963a', '#b2861f', '#5479a8', '#996794', '#52968c', '#fffaf0'] },
  { id: 'slate', name: 'Slate', dark: true, background: '#1b1e23', foreground: '#c9d1d9', cursor: '#9da5b4', selection: '#3a414c',
    ansi: ['#24282f', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf', '#4d5562', '#f0858d', '#b2d899', '#f0d39b', '#82c0f4', '#d699e8', '#7ccdd8', '#ffffff'] },
  { id: 'contrast', name: 'High Contrast', dark: true, background: '#000000', foreground: '#ffffff', cursor: '#ffff00', selection: '#0050ff',
    ansi: ['#000000', '#ff5555', '#55ff55', '#ffff55', '#5c9cff', '#ff55ff', '#55ffff', '#e6e6e6', '#808080', '#ff8080', '#80ff80', '#ffff80', '#8cb8ff', '#ff80ff', '#80ffff', '#ffffff'] },
  { id: 'blossom', name: 'Blossom', dark: false, background: '#fff6fa', foreground: '#3b2733', cursor: '#d6457f', selection: '#d6457f2e',
    ansi: ['#3b2733', '#c2334f', '#3c8a5a', '#9a6b10', '#4b62c4', '#b03f8a', '#1f8591', '#eadbe3', '#7a6170', '#d84d68', '#4aa16b', '#b8851a', '#6178d8', '#c85aa2', '#2a9eab', '#ffffff'] },
  { id: 'steel', name: 'Steel', dark: true, background: '#181b1f', foreground: '#d6dbe0', cursor: '#ff7a1a', selection: '#3d454f',
    ansi: ['#23272d', '#ff5a4f', '#8fce6a', '#ffb02e', '#5c9ded', '#b98ae6', '#4fc4cf', '#bfc6cd', '#4c545e', '#ff7f75', '#a9df8a', '#ffc65c', '#80b5f2', '#cca6ee', '#77d6df', '#ffffff'] },
];

export function schemeById(id: string | undefined): Scheme | undefined {
  return SCHEMES.find((s) => s.id === id);
}

/** An xterm.js theme object for a scheme. */
export function xtermTheme(s: Scheme): Record<string, string> {
  const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  const t: Record<string, string> = { background: s.background, foreground: s.foreground, cursor: s.cursor, cursorAccent: s.background, selectionBackground: s.selection };
  names.forEach((n, i) => {
    t[n] = s.ansi[i];
    t[`bright${n[0].toUpperCase()}${n.slice(1)}`] = s.ansi[i + 8];
  });
  return t;
}
