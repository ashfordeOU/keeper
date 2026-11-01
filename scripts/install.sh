#!/bin/sh
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Installs Keeper on macOS or Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.sh | sh -s -- --appimage
#
# Options:
#   --version X    install a specific version (default: the latest release)
#   --beta         the newest release, betas included (a beta then keeps updating to betas)
#   --appimage     on Linux, use the AppImage even when a .deb/.rpm would fit
#   --cli-only     install only the `keeper` command (needs Node.js 22+ and npm)
#   --uninstall    remove Keeper (the app, the command and the menu entry; your files are untouched)
#   --yes          do not ask before using sudo
#
# Every download is checked against the release's SHA256SUMS.txt (nothing is
# installed without a match); when the GitHub CLI is installed and signed in, the
# build attestation is verified as well. On macOS a running Keeper is quit, the
# new one replaces it in /Applications and opens.
# Environment: KEEPER_VERSION, KEEPER_RELEASES_API (another releases API, for mirrors and tests).

set -eu

REPO="ashfordeOU/keeper"
API="${KEEPER_RELEASES_API:-https://api.github.com/repos/$REPO}"
VERSION="${KEEPER_VERSION:-latest}"
MODE="app"
FORCE_APPIMAGE=0
BETA=0
ASSUME_YES=0

say() { printf '%s\n' "$*"; }
step() { printf '\033[1m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version) [ $# -ge 2 ] || fail "--version needs a value, e.g. --version 0.2.0"; VERSION="${2#v}"; shift 2 ;;
    --version=*) VERSION="${1#--version=}"; VERSION="${VERSION#v}"; shift ;;
    --beta) BETA=1; shift ;;
    --appimage) FORCE_APPIMAGE=1; shift ;;
    --cli-only) MODE="cli"; shift ;;
    --uninstall) MODE="uninstall"; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help)
      if [ -f "$0" ]; then sed -n '3,20p' "$0"
      else say "Options: --version X, --beta, --appimage, --cli-only, --uninstall, --yes. See https://github.com/$REPO/blob/main/docs/INSTALL.md"; fi
      exit 0 ;;
    *) fail "unknown option: $1 (try --help)" ;;
  esac
done

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin) OS=mac ;;
  Linux) OS=linux ;;
  *) fail "this script is for macOS and Linux. On Windows run: irm https://raw.githubusercontent.com/$REPO/main/scripts/install.ps1 | iex" ;;
esac
case "$ARCH" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) fail "no Keeper build for the $ARCH processor yet" ;;
esac
# An Intel shell under Rosetta on Apple silicon still wants the native app.
if [ "$OS" = mac ] && [ "$ARCH" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then ARCH=arm64; fi

# sudo only when needed (already root, or the folder is writable, means no sudo).
SUDO=""
need_sudo() {
  [ "$(id -u)" -eq 0 ] && return 0
  command -v sudo >/dev/null 2>&1 || fail "administrator rights are needed but sudo is not available"
  if [ "$ASSUME_YES" -ne 1 ] && [ -t 0 ]; then say "This step needs your password (sudo)."; fi
  SUDO="sudo"
}

fetch() { # url dest
  if command -v curl >/dev/null 2>&1; then curl -fL --retry 3 --progress-bar -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -q --show-progress -O "$2" "$1"
  else fail "curl or wget is needed"; fi
}
fetch_text() { # url
  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 -H 'Accept: application/vnd.github+json' "$1"
  else wget -qO- --header='Accept: application/vnd.github+json' "$1"; fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

TMP="$(mktemp -d 2>/dev/null || mktemp -d -t keeper)"
MNT=""
cleanup() {
  if [ -n "$MNT" ]; then hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

BIN_DIR="$HOME/.local/bin"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"

# ---------------------------------------------------------------- uninstall

uninstall() {
  step "Removing Keeper"
  removed=0
  if [ "$OS" = mac ]; then
    for app in "/Applications/Keeper.app" "$HOME/Applications/Keeper.app"; do
      if [ -d "$app" ]; then
        if [ -w "$(dirname "$app")" ]; then rm -rf "$app"; else need_sudo; $SUDO rm -rf "$app"; fi
        say "Removed $app"; removed=1
      fi
    done
  else
    if command -v dpkg >/dev/null 2>&1 && dpkg-query -W -f='${Status}' keeper 2>/dev/null | grep -q ' installed'; then
      need_sudo; $SUDO apt-get purge -y keeper >/dev/null 2>&1 || $SUDO dpkg -P keeper; say "Removed the keeper package"; removed=1
    elif command -v rpm >/dev/null 2>&1 && rpm -q keeper >/dev/null 2>&1; then
      need_sudo
      if command -v dnf >/dev/null 2>&1; then $SUDO dnf remove -y keeper; elif command -v zypper >/dev/null 2>&1; then $SUDO zypper --non-interactive remove keeper; else $SUDO rpm -e keeper; fi
      say "Removed the keeper package"; removed=1
    fi
    for f in "$BIN_DIR/keeper.AppImage" "$DATA_DIR/applications/keeper.desktop" "$DATA_DIR"/icons/hicolor/*/apps/keeper.png "$DATA_DIR/keeper-cli"; do
      if [ -e "$f" ]; then rm -rf "$f"; say "Removed $f"; removed=1; fi
    done
  fi
  if [ -f "$BIN_DIR/keeper" ] && grep -q 'Keeper command shim' "$BIN_DIR/keeper" 2>/dev/null; then rm -f "$BIN_DIR/keeper"; say "Removed $BIN_DIR/keeper"; removed=1; fi
  [ "$removed" -eq 1 ] || say "Keeper was not installed by this script (nothing to remove)."
  say "Your settings stay in place; delete them too with:"
  if [ "$OS" = mac ]; then say "  rm -rf ~/Library/Application\\ Support/Keeper"; else say "  rm -rf ~/.config/Keeper"; fi
}

# ---------------------------------------------------------------- the command only

cli_only() {
  command -v npm >/dev/null 2>&1 || fail "the command-only install needs Node.js 22+ with npm (https://nodejs.org). Or install the full app, which includes the command."
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge 22 ] || fail "Node.js 22 or newer is needed (found $(node -v 2>/dev/null || echo none))"
  pkg="keeper-cli"
  [ "$VERSION" = latest ] || pkg="keeper-cli@$VERSION"
  step "Installing the keeper command with npm ($pkg)"
  npm install -g "$pkg"
  say "Done. Try: keeper search \"pdfs from last week\""
}

# ---------------------------------------------------------------- the release

release_json() {
  if [ "$VERSION" != latest ]; then fetch_text "$API/releases/tags/v$VERSION"
  elif [ "$BETA" -eq 1 ]; then
    # The releases list is newest first and includes pre-releases; take the first tag.
    tag="$(fetch_text "$API/releases?per_page=10" | tr ',' '\n' | sed -n 's/^[[:space:]]*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    [ -n "$tag" ] || return 1
    fetch_text "$API/releases/tags/$tag"
  else fetch_text "$API/releases/latest"; fi
}

# Picks the download URL of an asset by exact name from the release JSON (no jq needed).
asset_url() { # json name
  printf '%s' "$1" | tr ',' '\n' | grep '"browser_download_url"' | sed 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' | grep "/$2\$" | head -n 1
}

download_verified() { # json name -> path
  name="$2"
  url="$(asset_url "$1" "$name")"
  [ -n "$url" ] || fail "this release has no $name"
  sums_url="$(asset_url "$1" SHA256SUMS.txt)"
  step "Downloading $name"
  fetch "$url" "$TMP/$name"
  [ -n "$sums_url" ] || fail "this release has no SHA256SUMS.txt, so $name cannot be checked; nothing was installed"
  fetch "$sums_url" "$TMP/SHA256SUMS.txt"
  want="$(grep "[[:space:]]\**$name\$" "$TMP/SHA256SUMS.txt" | cut -d' ' -f1 | head -n 1)"
  [ -n "$want" ] || fail "$name is not listed in SHA256SUMS.txt"
  got="$(sha256 "$TMP/$name")"
  [ "$want" = "$got" ] || fail "checksum mismatch for $name (expected $want, got $got). The download is corrupt or was tampered with; nothing was installed."
  say "Checksum OK ($got)"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && [ "${KEEPER_VERIFY_ATTESTATION:-1}" != 0 ]; then
    if gh attestation verify "$TMP/$name" --repo "$REPO" >/dev/null 2>&1; then say "Build attestation verified: built by $REPO on GitHub Actions"
    else fail "the build attestation for $name could not be verified (set KEEPER_VERIFY_ATTESTATION=0 to skip)"; fi
  fi
  DOWNLOADED="$TMP/$name"
}

write_shim() { # app-binary path-to-cli.cjs how-to-open-the-app
  mkdir -p "$BIN_DIR"
  cat > "$BIN_DIR/keeper" <<EOF
#!/bin/sh
# Keeper command shim, written by Keeper's installer.
# With no arguments it opens the app; otherwise it runs the command bundled with the app.
[ \$# -eq 0 ] && exec $3
ELECTRON_RUN_AS_NODE=1 exec "$1" "$2" "\$@"
EOF
  chmod +x "$BIN_DIR/keeper"
  case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "Add $BIN_DIR to your PATH to use the keeper command." ;; esac
}

# A running Keeper is asked to quit (it saves where you are), then stopped if it does not within 10 seconds.
quit_running_mac() {
  pgrep -xq Keeper || return 0
  step "Quitting the running Keeper"
  osascript -e 'tell application id "io.github.ashfordeou.keeper" to quit' >/dev/null 2>&1 || true
  tries=0
  while pgrep -xq Keeper && [ "$tries" -lt 20 ]; do sleep 0.5; tries=$((tries + 1)); done
  pkill -x Keeper 2>/dev/null || true
}

install_mac() {
  json="$(release_json)" || fail "could not read the release information from GitHub"
  download_verified "$json" "Keeper-mac-$ARCH.dmg"
  MNT="$TMP/mnt"; mkdir -p "$MNT"
  # The disk image shows Keeper's licence before it opens; a piped install has no keyboard to
  # agree with, so say where the terms are and answer it here.
  echo "Keeper is licensed under the PolyForm Shield License 1.0.0: https://github.com/ashfordeOU/keeper/blob/main/LICENSE.md"
  yes 2>/dev/null | PAGER=true hdiutil attach "$DOWNLOADED" -nobrowse -readonly -noautoopen -mountpoint "$MNT" -quiet >/dev/null || fail "could not open the disk image"
  [ -d "$MNT/Keeper.app" ] || fail "the disk image has no Keeper.app"
  dest="/Applications"
  if [ ! -w "$dest" ]; then dest="$HOME/Applications"; mkdir -p "$dest"; fi
  quit_running_mac
  step "Installing Keeper into $dest"
  rm -rf "$dest/Keeper.app"
  ditto "$MNT/Keeper.app" "$dest/Keeper.app"
  hdiutil detach "$MNT" -quiet || true; MNT=""
  xattr -dr com.apple.quarantine "$dest/Keeper.app" 2>/dev/null || true
  write_shim "$dest/Keeper.app/Contents/MacOS/Keeper" "$dest/Keeper.app/Contents/Resources/app.asar/dist-cli/keeper.cjs" "open -a '$dest/Keeper.app'"
  if [ "${KEEPER_NO_OPEN:-0}" != 1 ]; then
    step "Opening Keeper"
    open "$dest/Keeper.app" || true
  fi
  say "Keeper is installed in $dest. It updates itself from now on (Settings → Updates)."
}

install_linux_package() { # kind
  json="$(release_json)" || fail "could not read the release information from GitHub"
  if [ "$1" = deb ]; then
    debarch=amd64; [ "$ARCH" = arm64 ] && debarch=arm64
    download_verified "$json" "Keeper-linux-$debarch.deb"
    need_sudo
    step "Installing the .deb package"
    if command -v apt-get >/dev/null 2>&1; then $SUDO apt-get install -y "$DOWNLOADED"
    else $SUDO dpkg -i "$DOWNLOADED"; fi
  else
    rpmarch=x86_64; [ "$ARCH" = arm64 ] && rpmarch=aarch64
    download_verified "$json" "Keeper-linux-$rpmarch.rpm"
    need_sudo
    step "Installing the .rpm package"
    if command -v dnf >/dev/null 2>&1; then $SUDO dnf install -y "$DOWNLOADED"
    elif command -v zypper >/dev/null 2>&1; then $SUDO zypper --non-interactive --no-gpg-checks install "$DOWNLOADED"
    elif command -v yum >/dev/null 2>&1; then $SUDO yum install -y "$DOWNLOADED"
    else $SUDO rpm -U --replacepkgs "$DOWNLOADED"; fi
  fi
  write_shim "/opt/Keeper/keeper" "/opt/Keeper/resources/app.asar/dist-cli/keeper.cjs" "/opt/Keeper/keeper"
  say "Keeper is installed. Find it in your applications menu, or run: keeper"
}

install_linux_appimage() {
  json="$(release_json)" || fail "could not read the release information from GitHub"
  aiarch=x86_64; [ "$ARCH" = arm64 ] && aiarch=arm64
  download_verified "$json" "Keeper-linux-$aiarch.AppImage"
  mkdir -p "$BIN_DIR" "$DATA_DIR/applications" "$DATA_DIR/keeper-cli"
  step "Installing the AppImage into $BIN_DIR"
  install -m 755 "$DOWNLOADED" "$BIN_DIR/keeper.AppImage"
  # The icon and the bundled command come out of the AppImage itself (no FUSE needed for this).
  ( cd "$TMP" && "$BIN_DIR/keeper.AppImage" --appimage-extract 'usr/share/icons/*' >/dev/null 2>&1 && "$BIN_DIR/keeper.AppImage" --appimage-extract 'resources/app.asar' >/dev/null 2>&1 ) || true
  for icon in "$TMP"/squashfs-root/usr/share/icons/hicolor/*/apps/keeper.png; do
    [ -f "$icon" ] || continue
    size="$(basename "$(dirname "$(dirname "$icon")")")"
    mkdir -p "$DATA_DIR/icons/hicolor/$size/apps"
    cp "$icon" "$DATA_DIR/icons/hicolor/$size/apps/keeper.png"
  done
  if [ -f "$TMP/squashfs-root/resources/app.asar" ]; then
    rm -rf "$DATA_DIR/keeper-cli/app.asar"
    cp "$TMP/squashfs-root/resources/app.asar" "$DATA_DIR/keeper-cli/app.asar"
  fi
  cat > "$DATA_DIR/applications/keeper.desktop" <<EOF
[Desktop Entry]
Name=Keeper
Comment=Find, understand and tidy your files
Exec="$BIN_DIR/keeper.AppImage" %U
Icon=keeper
Type=Application
Categories=Utility;FileManager;
MimeType=x-scheme-handler/keeper;
StartupWMClass=keeper
Terminal=false
EOF
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DATA_DIR/applications" >/dev/null 2>&1 || true
  fi
  write_shim "$BIN_DIR/keeper.AppImage" "$DATA_DIR/keeper-cli/app.asar/dist-cli/keeper.cjs" "'$BIN_DIR/keeper.AppImage'"
  say "Keeper is installed. Find it in your applications menu, or run: $BIN_DIR/keeper.AppImage"
  if ! ldconfig -p 2>/dev/null | grep -q 'libfuse.so.2'; then
    say "Note: AppImages need FUSE 2 (e.g. sudo apt install libfuse2). Without it, run with --appimage-extract-and-run."
  fi
}

case "$MODE" in
  uninstall) uninstall; exit 0 ;;
  cli) cli_only; exit 0 ;;
esac

label="$VERSION"; [ "$VERSION" = latest ] && [ "$BETA" -eq 1 ] && label="newest, betas included"
say "Installing Keeper by Ashforde® ($label) for $OS-$ARCH"
if [ "$OS" = mac ]; then
  install_mac
elif [ "$FORCE_APPIMAGE" -eq 1 ]; then
  install_linux_appimage
elif command -v dpkg >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
  install_linux_package deb
elif command -v rpm >/dev/null 2>&1 && { command -v dnf >/dev/null 2>&1 || command -v zypper >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; }; then
  install_linux_package rpm
else
  install_linux_appimage
fi
