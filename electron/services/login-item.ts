// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Open at login on every system: the login item (macOS, Windows) or an
// autostart entry (Linux, where Electron has none).

import { app } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const autostartFile = () => path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'autostart', 'keeper.desktop');

export function loginItemOn(): boolean {
  if (process.platform === 'linux') return existsSync(autostartFile());
  try { return app.getLoginItemSettings().openAtLogin; } catch { return false; }
}

export async function setLoginItem(on: boolean): Promise<boolean> {
  if (process.platform === 'linux') {
    if (!on) await fsp.rm(autostartFile(), { force: true });
    else {
      const exec = process.env.APPIMAGE ?? process.execPath;
      await fsp.mkdir(path.dirname(autostartFile()), { recursive: true });
      await fsp.writeFile(autostartFile(), `[Desktop Entry]\nType=Application\nName=Keeper\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\nNoDisplay=false\n`);
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  }
  return loginItemOn();
}
