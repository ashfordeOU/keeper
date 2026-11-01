// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Plain data shapes shared by the remote-access service, its interface and the demo.

export interface HelpOfferView {
  code: string;
  password: string;
  expires: number;
  /** keeper://help?code=… for "Ask for help" */
  link: string;
  reach: ('lan' | 'relay' | 'tunnel')[];
  /** the address a helper's web browser can open */
  webUrl?: string;
}

export interface HelpStatusView {
  offer?: HelpOfferView;
  guests: { id: string; name: string; role: 'host' | 'helper'; since: number; via: string }[];
}

export interface ExecResultView {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

export interface UnattendedStatus {
  platform: string;
  supported: boolean;
  installed: boolean;
  /** can it be turned on now (one of your devices has control and "Let it in without asking") */
  can: { ok: boolean; reason?: string };
  /** what works and what does not, in plain words */
  limits: string[];
  /** the generated unit / plist / service source, for the curious */
  preview?: string;
}
