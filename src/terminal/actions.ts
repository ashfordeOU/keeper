// SPDX-License-Identifier: AGPL-3.0-or-later
// Names of the Terminal's keyboard actions, for menus and the shortcut editor.

export const ACTION_NAMES: Record<string, string> = {
  'tab.new': 'New tab', 'tab.close': 'Close tab', 'tab.next': 'Next tab', 'tab.prev': 'Previous tab', 'pane.splitRight': 'Split right', 'pane.splitDown': 'Split down',
  'pane.close': 'Close pane', 'pane.zoom': 'Zoom pane', 'pane.next': 'Next pane', 'pane.prev': 'Previous pane', 'pane.left': 'Pane to the left', 'pane.right': 'Pane to the right',
  'pane.up': 'Pane above', 'pane.down': 'Pane below', 'broadcast.toggle': 'Type in every pane', 'search.open': 'Find in scrollback', 'prompt.prev': 'Previous command',
  'prompt.next': 'Next command', 'font.bigger': 'Bigger text', 'font.smaller': 'Smaller text', 'font.reset': 'Normal text size', clear: 'Clear', palette: 'Command palette', copyMode: 'Select text with the keyboard',
};
