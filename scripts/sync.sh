#!/bin/sh
# Copy session-spaces and space-menu from herdr-app-session-spaces, their home,
# so this repo carries its own copies and needs nothing else to install.
# Usage: scripts/sync.sh [path to herdr-app-session-spaces]  (default: next to this repo)
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
src=${1:-$here/../herdr-app-session-spaces}
[ -d "$src/mods/session-spaces" ] || { echo "not found: $src/mods/session-spaces" >&2; exit 1; }
rev=$(git -C "$src" rev-parse --short HEAD)
dirty=$(git -C "$src" status --porcelain -- mods | head -n1)
for m in session-spaces space-menu; do
  rm -rf "$here/mods/$m"
  mkdir -p "$here/mods/$m"
  (cd "$src/mods/$m" && git ls-files -co --exclude-standard | while read -r f; do
    mkdir -p "$here/mods/$m/$(dirname "$f")"
    cp "$f" "$here/mods/$m/$f"
  done)
done
printf '%s%s\n' "$rev" "${dirty:+ (with uncommitted changes)}" > "$here/scripts/synced-from"
echo "synced from herdr-app-session-spaces $rev${dirty:+ (uncommitted changes there)}"
