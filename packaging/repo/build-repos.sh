#!/bin/sh
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Builds Keeper's signed apt and dnf repositories for a release. Run by the release workflow
# when KEEPER_GPG_PRIVATE_KEY is set (the key must already be imported; KEEPER_GPG_KEY_ID names it).
#
#   packaging/repo/build-repos.sh <release-assets-dir> <pages-dir> <version>
#
# apt: a flat repository (Packages, Release, InRelease, Release.gpg) attached to the release itself,
#   so the .deb files are served straight from GitHub Releases:
#     deb [signed-by=/usr/share/keyrings/keeper.gpg] https://github.com/ashfordeOU/keeper/releases/latest/download /
# dnf: repodata/ on the gh-pages branch (GitHub Pages), pointing at the release's .rpm files:
#     baseurl=https://keeper.ashforde.org/rpm
set -eu

ASSETS="$1"
PAGES="$2"
VERSION="$3"
KEY="${KEEPER_GPG_KEY_ID:?set KEEPER_GPG_KEY_ID to the signing key}"
REPO_URL="https://github.com/ashfordeOU/keeper/releases/download/v$VERSION/"

# --- apt (flat repository next to the .deb files)
(
  cd "$ASSETS"
  # Plain file names (not ./name), so apt asks GitHub for .../download/Keeper-linux-amd64.deb.
  dpkg-scanpackages --multiversion . /dev/null 2>/dev/null | sed 's|^Filename: \./|Filename: |' > Packages
  gzip -9nc Packages > Packages.gz
  {
    echo "Origin: Keeper"
    echo "Label: Keeper"
    echo "Suite: stable"
    echo "Version: $VERSION"
    echo "Architectures: amd64 arm64"
    echo "Description: Keeper, find, understand and tidy your files"
    echo "Date: $(LC_ALL=C date -Ru)"
    echo "SHA256:"
    for f in Packages Packages.gz; do
      printf ' %s %s %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$(wc -c < "$f" | tr -d ' ')" "$f"
    done
  } > Release
  gpg --batch --yes --local-user "$KEY" --clearsign -o InRelease Release
  gpg --batch --yes --local-user "$KEY" --armor --detach-sign -o Release.gpg Release
)

# --- dnf (metadata on GitHub Pages, packages from the release)
mkdir -p "$PAGES/rpm"
STAGE="$(mktemp -d)"
cp "$ASSETS"/*.rpm "$STAGE/"
createrepo_c --quiet --baseurl "$REPO_URL" --outputdir "$STAGE" "$STAGE"
rm -rf "$PAGES/rpm/repodata"
cp -r "$STAGE/repodata" "$PAGES/rpm/repodata"
rm -rf "$STAGE"
gpg --batch --yes --local-user "$KEY" --armor --detach-sign -o "$PAGES/rpm/repodata/repomd.xml.asc" "$PAGES/rpm/repodata/repomd.xml"
gpg --batch --yes --armor --export "$KEY" > "$PAGES/keeper-release.asc"
cat > "$PAGES/rpm/keeper.repo" <<REPO
[keeper]
name=Keeper
baseurl=https://keeper.ashforde.org/rpm
enabled=1
gpgcheck=0
repo_gpgcheck=1
gpgkey=https://keeper.ashforde.org/keeper-release.asc
REPO
touch "$PAGES/.nojekyll"
echo "apt: $(grep -c '^Package:' "$ASSETS/Packages") package(s); dnf: $(find "$ASSETS" -maxdepth 1 -name "*.rpm" | wc -l) package(s)"
