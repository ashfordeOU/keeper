#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
#
# Keeper on macOS: the one-command test run.
#
#   git clone https://github.com/ashfordeOU/keeper && cd keeper && ./scripts/mac-test/run.sh
#
# Checks the prerequisites, installs and builds Keeper (npm ci, the build,
# keeper-helper and Keeper Intents with Swift), then runs the test driver
# (scripts/mac-test/src/main.ts) which tests Keeper on this Mac and packs the
# results into ~/Desktop/keeper-mac-test-<date>.zip.
#
# Safety: Keeper runs with a throwaway home folder; every change to the Mac
# is asked for first and written to an undo list before it is made. If the run
# stops for any reason (Ctrl-C included), the trap below puts back whatever is
# left on that list and packs the partial results.
#
# Written for the bash that comes with macOS (3.2): no associative arrays,
# no mapfile, no ${x,,}.

# Functions below run from traps, which shellcheck cannot follow.
# shellcheck disable=SC2317
set -u

REPO="$(cd "$(dirname "$0")/../.." && pwd -P)"
cd "$REPO" || exit 1

DRY=0
SKIP_BUILD=0
KEEP=0
OUT_DIR=""
PREV=""
for a in "$@"; do
  if [ "$PREV" = "--out" ]; then OUT_DIR="$a"; fi
  PREV="$a"
  case "$a" in
    --dry-run) DRY=1 ;;
    --skip-build|--skip-setup) SKIP_BUILD=1 ;;
    --keep-temp) KEEP=1 ;;
    --out=*) OUT_DIR="${a#--out=}" ;;
    -h|--help)
      cat <<'EOF'
Keeper on macOS: the test run

  ./scripts/mac-test/run.sh [options]

  --quick              a 15-minute smoke test
  --only <a,b,…>       only these areas (--list shows them)
  --skip <a,b,…>       everything except these areas
  --record             also record the screen to a video (off by default)
  --no-guided          automatic checks only: no questions
  --no-screen          no whole-screen pictures
  --out <folder>       where the .zip goes (default: your Desktop)
  --skip-build         use the existing node_modules and build
  --keep-temp          keep the throwaway home folder afterwards
  --list               list the areas and stop
  --dry-run            prove the flow without a Mac (stand-in macOS output)

Details: docs/MAC-TESTING.md
EOF
      exit 0 ;;
  esac
done

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYN=$'\033[36m'; R=$'\033[0m'
else
  B=''; DIM=''; RED=''; GRN=''; YEL=''; CYN=''; R=''
fi
say() { printf '%s\n' "$*"; }
step() { printf '%s\n' "${B}${CYN}▸ $*${R}"; }

# ------------------------------------------------------------------ the run folder
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/keeper-mac-test.XXXXXX")" || { say "Could not make a temporary folder"; exit 1; }
mkdir -p "$RUN_DIR/logs" "$RUN_DIR/bin"
SETUP="$RUN_DIR/setup.tsv"
RUNLOG="$RUN_DIR/run.log"
: > "$SETUP"
: > "$RUNLOG"
: > "$RUN_DIR/undo.tsv"
: > "$RUN_DIR/undo.done"
DRIVER="$RUN_DIR/driver.cjs"
DRIVER_PID=""
STOPPED=0

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" >> "$RUNLOG"; }

# record <id> <pass|fail|skip> <seconds> <title> <detail> [log file]
record() {
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$(printf '%s' "$5" | tr '\t\n' '  ')" "${6:-}" >> "$SETUP"
  case "$2" in
    pass) say "  ${GRN}ok${R}   $4 ${DIM}($3 s)${R}" ;;
    fail) say "  ${RED}FAIL${R} $4 — $5" ;;
    *)    say "  ${DIM}skip $4 — $5${R}" ;;
  esac
  log "$1 $2 $5"
}

# timed <id> <title> <log file> <command…>: runs a step, its output to the log file
timed() {
  local id="$1" title="$2" lf="$3"; shift 3
  local t0 t1 rc
  t0=$(date +%s)
  printf '%s\n' "${DIM}  … $title${R}"
  "$@" > "$lf" 2>&1
  rc=$?
  t1=$(date +%s)
  if [ $rc -eq 0 ]; then
    record "$id" pass $((t1 - t0)) "$title" "" "$lf"
  else
    record "$id" fail $((t1 - t0)) "$title" "exit $rc: $(tail -n 3 "$lf" | tr '\n' ' ' | cut -c1-300)" "$lf"
  fi
  return $rc
}

# ------------------------------------------------------------------ putting things back
b64d() { base64 --decode 2>/dev/null || base64 -D 2>/dev/null; }

run_undo() {
  [ -s "$RUN_DIR/undo.tsv" ] || return 0
  local lines=() line id admin what b64 cmd i n
  while IFS= read -r line; do lines+=("$line"); done < "$RUN_DIR/undo.tsv"
  n=${#lines[@]}
  i=$((n - 1))
  while [ "$i" -ge 0 ]; do
    line="${lines[$i]}"
    id="$(printf '%s' "$line" | cut -f1)"
    admin="$(printf '%s' "$line" | cut -f2)"
    what="$(printf '%s' "$line" | cut -f3)"
    b64="$(printf '%s' "$line" | cut -f4)"
    if [ -n "$id" ] && ! grep -qx "$id" "$RUN_DIR/undo.done" 2>/dev/null; then
      cmd="$(printf '%s' "$b64" | b64d)"
      say "  putting back: $what"
      if [ "$DRY" = 1 ]; then
        log "undo (dry run, not run): $id"
      elif [ "$admin" = 1 ]; then
        say "  ${DIM}(administrator rights: macOS may ask for your password)${R}"
        # the log stays the owner's file; only the command runs as root
        # shellcheck disable=SC2024
        sudo /bin/sh -c "$cmd" >> "$RUNLOG" 2>&1 || say "  ${RED}could not put back: $what${R}"
      else
        /bin/sh -c "$cmd" >> "$RUNLOG" 2>&1 || say "  ${RED}could not put back: $what${R}"
      fi
      printf '%s\n' "$id" >> "$RUN_DIR/undo.done"
    fi
    i=$((i - 1))
  done
}

final_cleanup() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if [ -n "$DRIVER_PID" ] && kill -0 "$DRIVER_PID" 2>/dev/null; then
    kill -INT "$DRIVER_PID" 2>/dev/null
    wait "$DRIVER_PID" 2>/dev/null
  fi
  # whatever the driver did not put back
  if [ -s "$RUN_DIR/undo.tsv" ]; then
    local left
    left=$(cut -f1 "$RUN_DIR/undo.tsv" | while read -r id; do grep -qx "$id" "$RUN_DIR/undo.done" || echo "$id"; done | grep -c . || true)
    if [ "${left:-0}" != 0 ]; then
      say ""
      say "${B}${YEL}Putting back what is left ($left change(s))…${R}"
      run_undo
    fi
  fi
  if [ "$DRY" != 1 ] && [ "$(uname -s)" = Darwin ]; then
    pkill -f "$REPO/node_modules/electron" 2>/dev/null
    pkill -f "KeeperHelper/.build" 2>/dev/null
    if [ -s "$RUN_DIR/video.pid" ]; then kill -INT "$(cat "$RUN_DIR/video.pid")" 2>/dev/null; fi
  fi
  # the driver packs; if it could not, pack what is there
  if [ ! -s "$RUN_DIR/zip-path" ] && [ -s "$RUN_DIR/bundle-dir" ] && [ -f "$DRIVER" ] && command -v node >/dev/null 2>&1; then
    say ""
    say "${B}Packing the partial results…${R}"
    if [ -n "$OUT_DIR" ]; then
      KEEPER_MACTEST_ROOT="$REPO" node "$DRIVER" --pack-only "$RUN_DIR" --out "$OUT_DIR" || true
    else
      KEEPER_MACTEST_ROOT="$REPO" node "$DRIVER" --pack-only "$RUN_DIR" || true
    fi
  fi
  if [ -s "$RUN_DIR/zip-path" ] && [ "$KEEP" != 1 ]; then
    rm -rf "$RUN_DIR"
  elif [ -d "$RUN_DIR" ]; then
    say "${DIM}The run's folder is kept: $RUN_DIR${R}"
  fi
  exit "$rc"
}

stop_if_asked() { if [ "$STOPPED" = 1 ]; then say "${YEL}Stopped.${R}"; exit 130; fi; }

on_signal() {
  STOPPED=1
  # The driver gets the same Ctrl-C (same process group) and stops safely by itself.
  say ""
  say "${YEL}Stopping safely…${R}"
}

trap final_cleanup EXIT
trap on_signal INT TERM HUP

say ""
say "${B}${CYN}Keeper on macOS — test run${R}"
say "${DIM}Run folder: $RUN_DIR${R}"
say ""

# ------------------------------------------------------------------ prerequisites
step "Checking what is needed"
OS="$(uname -s)"
if [ "$OS" != Darwin ] && [ "$DRY" != 1 ]; then
  say "${RED}This test runs on a Mac. (On other systems use --dry-run to check the flow.)${R}"
  exit 2
fi

if [ "$DRY" = 1 ]; then
  record prereq-clt skip 0 "Xcode Command Line Tools" "dry run"
else
  if xcode-select -p >/dev/null 2>&1; then
    record prereq-clt pass 0 "Xcode Command Line Tools" "$(xcode-select -p)"
  else
    record prereq-clt fail 0 "Xcode Command Line Tools" "not installed"
    say ""
    say "${B}Please install Apple's command line tools first:${R}"
    say "    xcode-select --install"
    say "A window opens; choose Install, wait until it finishes (about 5–15 minutes), then run this again."
    exit 2
  fi
fi

NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${NODE_MAJOR:-0}" -ge 22 ] 2>/dev/null; then NODE_OK=1; fi
fi
if [ $NODE_OK = 1 ]; then
  record prereq-node pass 0 "Node.js 22 or later" "$(node -v)"
else
  record prereq-node fail 0 "Node.js 22 or later" "$(command -v node >/dev/null 2>&1 && node -v || echo 'not installed')"
  say ""
  say "${B}Please install Node.js 22 or later, then run this again. Either:${R}"
  say "  • the official installer: https://nodejs.org/en/download (choose the macOS Installer, LTS)"
  say "  • or with Homebrew:  brew install node@22 && brew link --overwrite --force node@22"
  say "Then open a new Terminal window and run:  ./scripts/mac-test/run.sh"
  exit 2
fi

FREE_KB="$(df -Pk "$REPO" | awk 'NR==2 {print $4}')"
FREE_GB=$(( ${FREE_KB:-0} / 1048576 ))
if [ "$FREE_GB" -ge 6 ]; then
  record prereq-disk pass 0 "Free disk space (6 GB needed)" "${FREE_GB} GB free"
else
  record prereq-disk fail 0 "Free disk space (6 GB needed)" "only ${FREE_GB} GB free"
  say "${RED}Please free up some space (at least 6 GB) and run this again.${R}"
  exit 2
fi

if [ ! -f "$REPO/package.json" ] || ! grep -q '"name": "keeper"' "$REPO/package.json"; then
  say "${RED}Run this from Keeper's folder (the one git clone made).${R}"
  exit 2
fi

# ------------------------------------------------------------------ install and build
step "Installing and building Keeper (about 5–10 minutes the first time)"
if [ "$DRY" = 1 ] || [ $SKIP_BUILD = 1 ]; then
  WHY="$([ "$DRY" = 1 ] && echo 'dry run' || echo '--skip-build')"
  record npm-ci skip 0 "npm ci" "$WHY"
  record playwright skip 0 "Playwright (to drive the app)" "$WHY"
  record build skip 0 "Build (npm run build)" "$WHY"
else
  timed npm-ci "npm ci" "$RUN_DIR/logs/npm-ci.log" npm ci --no-audit --no-fund
  stop_if_asked
  # Playwright is not one of Keeper's dependencies; CI adds it the same way (no browsers are downloaded).
  timed playwright "Playwright (to drive the app)" "$RUN_DIR/logs/playwright.log" npm install --no-save --no-audit --no-fund playwright-core@1.63.0
  stop_if_asked
  timed build "Build (npm run build)" "$RUN_DIR/logs/build.log" npm run build
  stop_if_asked
fi

if [ "$DRY" = 1 ]; then
  record helper-build skip 0 "keeper-helper (swift build)" "dry run"
  record intents-build skip 0 "Keeper Intents" "dry run"
  record probe-build skip 0 "mactest-probe (swiftc)" "dry run"
else
  if [ $SKIP_BUILD = 1 ] && [ -x "$REPO/native/macos/KeeperHelper/.build/release/keeper-helper" ]; then
    record helper-build skip 0 "keeper-helper (swift build)" "--skip-build: using the existing build"
  else
    timed helper-build "keeper-helper (swift build -c release)" "$RUN_DIR/logs/helper-build.log" sh -c "cd native/macos/KeeperHelper && swift build -c release"
  fi
  # Keeper Intents is an Xcode project (App Intents metadata needs xcodebuild). With full Xcode and
  # XcodeGen already installed, build it for real; otherwise type-check its sources with swiftc.
  if xcodebuild -version >/dev/null 2>&1 && command -v xcodegen >/dev/null 2>&1; then
    timed intents-build "Keeper Intents (xcodebuild)" "$RUN_DIR/logs/intents-build.log" sh native/macos/KeeperIntents/build.sh
  else
    ARCH="$(uname -m)"
    timed intents-build "Keeper Intents (type-check with swiftc; full Xcode and XcodeGen are needed for a real build)" "$RUN_DIR/logs/intents-build.log" \
      sh -c "xcrun swiftc -typecheck -parse-as-library -target ${ARCH}-apple-macos13.0 native/macos/KeeperIntents/Sources/*.swift"
  fi
  stop_if_asked
  timed probe-build "mactest-probe (swiftc)" "$RUN_DIR/logs/probe-build.log" xcrun swiftc -O scripts/mac-test/probe.swift -o "$RUN_DIR/bin/mactest-probe"
fi
stop_if_asked

ESBUILD="$REPO/node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || ESBUILD="$(command -v esbuild || true)"
if [ -z "$ESBUILD" ]; then
  record driver-build fail 0 "Test driver (esbuild)" "esbuild is missing (npm ci did not finish?)"
  say "${RED}Cannot go on without the test driver. The logs are in $RUN_DIR/logs.${R}"
  exit 1
fi
timed driver-build "Test driver (esbuild)" "$RUN_DIR/logs/driver-build.log" "$ESBUILD" scripts/mac-test/src/main.ts --bundle --platform=node --target=node22 --format=cjs \
  --outfile="$DRIVER" --external:electron --external:playwright --external:playwright-core --log-level=warning || exit 1

# ------------------------------------------------------------------ the tests
say ""
# In the background so this script's trap stays in charge; stdin stays the terminal (for the questions).
KEEPER_MACTEST_ROOT="$REPO" node "$DRIVER" --run-dir "$RUN_DIR" "$@" <&0 &
DRIVER_PID=$!
# `wait` returns early when a signal arrives; keep waiting until the driver is really done.
RC=0
while :; do
  wait "$DRIVER_PID"
  RC=$?
  kill -0 "$DRIVER_PID" 2>/dev/null || break
done
DRIVER_PID=""
log "driver exit ${RC:-?}"
exit "${RC:-0}"
