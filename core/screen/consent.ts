// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Who may see or control this screen, and when Keeper asks first.
//
// - A paired computer needs "See this screen" (and "Control this computer" to
//   use the mouse and keyboard) in its Link permissions.
// - Even then the person here is asked every time, with the other device's
//   name, unless they turned on "Let it in without asking" for that device —
//   meant for their own computers, and only offered when both permissions are set.
// - Phones (through the companion page) are always asked.
// - A visible banner and the Island show while anyone is watching, with one
//   click to stop. Sessions end after a stretch with no activity.

export interface ScreenPolicy {
  /** per paired device: let it in without asking (own devices only) */
  unattended: Record<string, boolean>;
  /** minutes without any viewer activity before the session ends (0 = never) */
  idleMinutes: number;
  /** phones may ask to see the screen at all */
  phones: boolean;
}

export const DEFAULT_POLICY: ScreenPolicy = { unattended: {}, idleMinutes: 15, phones: true };

export type Decision = { do: 'allow'; control: boolean } | { do: 'ask'; control: boolean } | { do: 'deny'; reason: string };

export function decide(
  req: { from: 'device' | 'phone'; id: string; wantsControl: boolean; perms?: { screenView?: boolean; screenControl?: boolean } },
  policy: ScreenPolicy,
): Decision {
  if (req.from === 'phone') {
    if (!policy.phones) return { do: 'deny', reason: 'This computer does not let phones see its screen' };
    return { do: 'ask', control: req.wantsControl };
  }
  if (!req.perms?.screenView) return { do: 'deny', reason: 'This computer does not let that device see its screen. Turn on “See this screen” for it under Devices.' };
  const control = req.wantsControl && !!req.perms.screenControl;
  if (policy.unattended[req.id] && req.perms.screenControl) return { do: 'allow', control };
  return { do: 'ask', control };
}

/** The session should end: nobody has done anything for the idle limit. */
export function idleExpired(now: number, lastActivity: number, policy: ScreenPolicy): boolean {
  return policy.idleMinutes > 0 && now - lastActivity > policy.idleMinutes * 60_000;
}

/** What History says about a session (newest first in the list). */
export function auditTitle(s: { role: 'host' | 'viewer'; peerName: string; control: boolean; started: number; ended?: { at: number; reason: string } }): string {
  const mins = s.ended ? Math.max(1, Math.round((s.ended.at - s.started) / 60_000)) : 0;
  const what = s.control ? 'controlled' : 'viewed';
  const span = mins ? ` for ${mins} min` : '';
  return s.role === 'host' ? `${s.peerName} ${what} this screen${span}` : `You ${what} ${s.peerName}${span}`;
}
