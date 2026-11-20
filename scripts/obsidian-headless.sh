#!/usr/bin/env bash
# Run Obsidian headless (Xvfb) on a fresh COPY of test-vault/ (in .scratch/headless-vault,
# so it never shares files with an Obsidian you have open), with an isolated profile in
# .scratch/, remote-debuggable on port 9333. Never touches ~/.config/obsidian or other vaults.
# The copy's plugin folder is a symlink to the real build output, so rebuilds are picked up.
# Then: nix develop -c node scripts/cdp.mjs file-with-js.js [screenshot.png]
# Stop: pkill -f obsidian-headless-profile
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="$ROOT/.scratch/obsidian-headless-profile"
VAULT="$ROOT/.scratch/headless-vault"
rm -rf "$VAULT"
cp -r "$ROOT/test-vault" "$VAULT"
rm -f "$VAULT/.obsidian/workspace.json"
rm -rf "$VAULT/.obsidian/plugins/folio"
ln -s "$ROOT/test-vault/.obsidian/plugins/folio" "$VAULT/.obsidian/plugins/folio"
mkdir -p "$PROFILE/obsidian"
# Optional: OBSIDIAN_ASAR=/path/to/obsidian-1.x.y.asar runs that (newer) Obsidian version,
# e.g. a copy of the auto-updated one, so behaviour matches your installed Obsidian.
if [ -n "${OBSIDIAN_ASAR:-}" ]; then cp "$OBSIDIAN_ASAR" "$PROFILE/obsidian/"; fi
cat > "$PROFILE/obsidian/obsidian.json" <<JSON
{"vaults":{"f01i0testvault0":{"path":"$VAULT","ts":1700000000000,"open":true}},"updateDisabled":true}
JSON
OBS="$(readlink -f "$(command -v obsidian)")"
# The nixpkgs wrapper execs: electron <app.asar> …; reuse both paths.
ELECTRON="$(grep -o '/nix/store/[^"]*/bin/electron' "$OBS" | head -1)"
ASAR="$(grep -o '/nix/store/[^" ]*/app.asar' "$OBS" | head -1)"
export XDG_CONFIG_HOME="$PROFILE"
unset WAYLAND_DISPLAY NIXOS_OZONE_WL LD_LIBRARY_PATH ELECTRON_OZONE_PLATFORM_HINT
exec nix shell nixpkgs#xvfb-run --command xvfb-run -a -s "-screen 0 1600x1000x24" \
	"$ELECTRON" "$ASAR" --user-data-dir="$PROFILE/obsidian" --remote-debugging-port=9333 --no-sandbox --ozone-platform=x11
