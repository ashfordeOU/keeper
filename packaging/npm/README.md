# keeper-cli

The command-line side of [Keeper](https://github.com/ashfordeOU/keeper): the same engine as the app, for terminals, servers and scripts. It only reads unless you pass `--yes`.

```bash
npm install -g keeper-cli
keeper --help
```

Needs Node.js 22 or newer. The package is a single bundled file with no dependencies, published from GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), so `npm audit signatures` can confirm it was built from this repository.

```text
keeper search <words>      Plain-English search: keeper search "screenshots with wifi password"
keeper scan                What can be freed: caches, old installers, forgotten downloads, big files
keeper clean [group…]      Clear rebuildable caches (preview unless --yes)
keeper dupes               Exact duplicates and HEIC/JPEG pairs (--trash --yes to remove extras)
keeper stats               Files per shelf and where downloads came from (--sources)
```

The desktop app installs the same `keeper` command, so you only need this package on machines without the app. See [docs/INSTALL.md](https://github.com/ashfordeOU/keeper/blob/main/docs/INSTALL.md) for every way to install Keeper.

Licensed under the GNU AGPL v3 or later.
