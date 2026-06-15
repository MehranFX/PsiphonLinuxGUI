#!/bin/bash

source "$(dirname "$0")/_helpers.sh"

CHROMIUM_BIN="$(resolve_chromium_binary)"
stop_chrome_family_browser "$CHROMIUM_BIN" "$HOME/.config/chromium"

if flatpak_app_installed org.chromium.Chromium; then
    stop_flatpak_app org.chromium.Chromium
elif snap_app_installed chromium; then
    pkill -x chromium 2>/dev/null || true
fi
