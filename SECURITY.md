# Security policy

Keeper deletes caches and moves files to the Trash, so safety bugs matter to us as much as security bugs.

## Reporting

Please **do not open a public issue** for a vulnerability. Use GitHub's *Report a vulnerability* button on the repository's Security tab (private advisory). Include the version, OS, steps to reproduce and the impact you see. We aim to reply within a week.

Examples of what we want to hear about:

- Any way to make Keeper delete, move or overwrite something outside the documented cleanup locations, or delete user files instead of moving them to the Trash.
- Path tricks that get past `core/safety.ts` (links, junctions, short names, network paths, race conditions).
- Ways for web content, a downloaded file's metadata, clipboard content or an AI reply to run code or trigger file actions.
- Leaks of API keys or file contents off the computer.

## Verify your download

Every release file is built by GitHub Actions from this repository and comes with:

- `SHA256SUMS.txt`, signed with [Sigstore](https://www.sigstore.dev) (`SHA256SUMS.txt.sigstore.json`, keyless and recorded in the public transparency log);
- a GitHub build attestation for each file: `gh attestation verify <file> --repo ashfordeOU/keeper`;
- once the release key in [KEYS/keeper-release.asc](KEYS/keeper-release.asc) is published, GPG signatures (`.asc`) for the checksums and the AppImages.

The commands are in [docs/INSTALL.md → Verifying a download](docs/INSTALL.md#verifying-a-download). If a file does not verify, do not run it, and please tell us.

## Supported versions

Security fixes go into the latest release.
