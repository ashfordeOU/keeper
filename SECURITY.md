# Security policy

Keeper deletes caches and moves files to the Trash, so safety bugs matter to us as much as security bugs.

## Reporting

Please **do not open a public issue** for a vulnerability. Use GitHub's *Report a vulnerability* button on the repository's Security tab (private advisory). Include the version, OS, steps to reproduce and the impact you see. We aim to reply within a week.

Examples of what we want to hear about:

- Any way to make Keeper delete, move or overwrite something outside the documented cleanup locations, or delete user files instead of moving them to the Trash.
- Path tricks that get past `core/safety.ts` (links, junctions, short names, network paths, race conditions).
- Ways for web content, a downloaded file's metadata, clipboard content or an AI reply to run code or trigger file actions.
- Leaks of API keys or file contents off the computer.

## Security review

The latest first-party review — scope, method, every finding with its status, the risks that remain and what an outside audit should look at — is in [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md). Its regression tests are in `test/security-review.test.ts`.

Also in scope for reports: Keeper Link and Help mode (pairing, the encrypted channel, the relay), remote screens and unattended access, the mesh helper and other parts that run as the administrator, the local servers (MCP, the agents gateway, the location receiver), and anything an AI model, a web page, a mail or another agent can make Keeper do without asking.

## Verify your download

Every release file is built by GitHub Actions from this repository and comes with:

- `SHA256SUMS.txt`, signed with [Sigstore](https://www.sigstore.dev) (`SHA256SUMS.txt.sigstore.json`, keyless and recorded in the public transparency log);
- a GitHub build attestation for each file: `gh attestation verify <file> --repo ashfordeOU/keeper`;
- once the release key in [KEYS/keeper-release.asc](KEYS/keeper-release.asc) is published, GPG signatures (`.asc`) for the checksums and the AppImages.

On a Mac, Keeper is signed with its own certificate, "Keeper Self-Signed", the same for every release (an Apple Developer ID comes later): `codesign -dv --verbose=2 /Applications/Keeper.app` shows `Authority=Keeper Self-Signed`, and Keeper's updater installs only a new version signed by that same certificate. First-launch steps for this build (Open Anyway, the keychain's Always Allow) are in [README → Install](README.md#install). What Keeper sends and keeps is in [README → Privacy](README.md#privacy) and [docs/PRIVACY-USAGE-STATS.md](docs/PRIVACY-USAGE-STATS.md).

The commands are in [docs/INSTALL.md → Verifying a download](docs/INSTALL.md#verifying-a-download). If a file does not verify, do not run it, and please tell us.

## Supported versions

Security fixes go into the latest release.
