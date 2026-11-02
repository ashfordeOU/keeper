// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What this build was made with (scripts/build-main.mjs fills these in from
// the release workflow's environment). Outside a bundled build (tests, ts-node)
// they are absent and read as empty.

declare const __KEEPER_GOOGLE_CLIENT_ID__: string | undefined;
declare const __KEEPER_GOOGLE_CLIENT_SECRET__: string | undefined;
declare const __KEEPER_MS_CLIENT_ID__: string | undefined;
declare const __KEEPER_DEVELOPER_ID__: boolean | undefined;

export const BUILT_GOOGLE_CLIENT_ID = typeof __KEEPER_GOOGLE_CLIENT_ID__ === 'string' ? __KEEPER_GOOGLE_CLIENT_ID__ : '';
export const BUILT_GOOGLE_CLIENT_SECRET = typeof __KEEPER_GOOGLE_CLIENT_SECRET__ === 'string' ? __KEEPER_GOOGLE_CLIENT_SECRET__ : '';
export const BUILT_MS_CLIENT_ID = typeof __KEEPER_MS_CLIENT_ID__ === 'string' ? __KEEPER_MS_CLIENT_ID__ : '';
/** signed with an Apple Developer ID: macOS keeps the keychain approval across updates */
export const DEVELOPER_ID = typeof __KEEPER_DEVELOPER_ID__ === 'boolean' && __KEEPER_DEVELOPER_ID__;
