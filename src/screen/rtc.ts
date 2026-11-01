// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// WebRTC pieces shared by the host banner and the viewer window: which ICE
// servers to use, waiting for candidates, and checking that the certificate
// DTLS actually used is the one stated over Keeper Link.

import { iceServers, remoteCertificateMatches } from '../../core/screen/sdp';
import { api } from '../api';

/** LAN-only when Link is set to this network or "never leaves my network". */
export async function rtcConfig(): Promise<{ config: RTCConfiguration; scope: 'lan' | 'internet' }> {
  try {
    const s = (await api.link.state()).settings;
    const scope = s.mode !== 'internet' || s.localOnly ? 'lan' : 'internet';
    return { scope, config: { iceServers: scope === 'lan' ? [] : iceServers(s.stun ?? []), bundlePolicy: 'max-bundle' } };
  } catch {
    return { scope: 'lan', config: { iceServers: [] } };
  }
}

/** Waits until ICE gathering is complete (or a short time has passed); the description then carries every candidate. */
export function gathered(pc: RTCPeerConnection, ms = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    }
    function check() {
      if (pc.iceGatheringState === 'complete') done();
    }
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export function connected(pc: RTCPeerConnection, ms: number): Promise<boolean> {
  if (pc.connectionState === 'connected') return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => finish(false), ms);
    function finish(ok: boolean) {
      clearTimeout(t);
      pc.removeEventListener('connectionstatechange', check);
      resolve(ok);
    }
    function check() {
      if (pc.connectionState === 'connected') finish(true);
      else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') finish(false);
    }
    pc.addEventListener('connectionstatechange', check);
  });
}

export async function certificateOk(pc: RTCPeerConnection, stated: string): Promise<boolean> {
  const report = await pc.getStats();
  return remoteCertificateMatches([...report.values()] as Array<Record<string, unknown>>, stated);
}

/** "Direct (this network)", "Direct (internet)" or "Through a relay" from the selected candidate pair. */
export async function pathLabel(pc: RTCPeerConnection): Promise<string> {
  const stats = [...(await pc.getStats()).values()] as Array<Record<string, unknown>>;
  const pair = stats.find((s) => s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded');
  const local = stats.find((s) => s.id === pair?.localCandidateId);
  const t = String(local?.candidateType ?? '');
  return t === 'relay' ? 'Through a relay' : t === 'host' ? 'Direct (this network)' : 'Direct (internet)';
}
