// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One way for every page to hand a place, forecast, event, address or number
// to the person's own apps, so they all follow Settings → Open with.

import type { NativeKind, NativeParams } from '../../core/native-apps';
import { api } from '../api';

export async function openNative(kind: NativeKind, params: NativeParams = {}, toast?: (text: string) => void): Promise<void> {
  const r = await api.native.open(kind, params).catch(() => ({ ok: false, copy: undefined as string | undefined }));
  if (r.ok) return;
  if (r.copy) {
    // No app here can call or write to it, so it goes to the clipboard to use elsewhere.
    await navigator.clipboard.writeText(r.copy).catch(() => undefined);
    toast?.(`Nothing on this computer opens it, so ${r.copy} was copied`);
    return;
  }
  toast?.('Could not open it in another app');
}
