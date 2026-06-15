#!/bin/bash

source "$(dirname "$0")/_helpers.sh"

CHROME_BIN="$(resolve_google_chrome_binary)"
stop_chrome_family_browser "$CHROME_BIN" "$HOME/.config/google-chrome"

if flatpak_app_installed com.google.Chrome; then
    stop_flatpak_app com.google.Chrome
fi
