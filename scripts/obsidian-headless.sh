#!/usr/bin/env bash
# Run Obsidian headless (Xvfb) on test-vault/ with an isolated profile in .scratch/,
# remote-debuggable on port 9333. Never touches ~/.config/obsidian or other vaults.
# Then: nix develop -c node scripts/cdp.mjs file-with-js.js [screenshot.png]
# Stop: pkill -f obsidian-headless-profile
# Note: avoid running it while the same test vault is open in your own Obsidian.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="$ROOT/.scratch/obsidian-headless-profile"
mkdir -p "$PROFILE/obsidian"
cat > "$PROFILE/obsidian/obsidian.json" <<JSON
{"vaults":{"f01i0testvault0":{"path":"$ROOT/test-vault","ts":1700000000000,"open":true}},"updateDisabled":true}
JSON
OBS="$(readlink -f "$(command -v obsidian)")"
# The nixpkgs wrapper execs: electron <app.asar> …; reuse both paths.
ELECTRON="$(grep -o '/nix/store/[^"]*/bin/electron' "$OBS" | head -1)"
ASAR="$(grep -o '/nix/store/[^" ]*/app.asar' "$OBS" | head -1)"
export XDG_CONFIG_HOME="$PROFILE"
unset WAYLAND_DISPLAY NIXOS_OZONE_WL LD_LIBRARY_PATH ELECTRON_OZONE_PLATFORM_HINT
exec nix shell nixpkgs#xvfb-run --command xvfb-run -a -s "-screen 0 1600x1000x24" \
	"$ELECTRON" "$ASAR" --user-data-dir="$PROFILE/obsidian" --remote-debugging-port=9333 --no-sandbox --ozone-platform=x11
