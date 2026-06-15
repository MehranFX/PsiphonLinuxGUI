#!/bin/bash

source "$(dirname "$0")/_helpers.sh"

if flatpak_app_installed com.google.Chrome; then
    wait_for_psiphon_proxy || exit 1
    launch_flatpak_with_proxy com.google.Chrome "${PSIPHON_HTTP_PROXY_HOST}:${PSIPHON_HTTP_PROXY_PORT}"
    exit 0
fi

CHROME_BIN="$(resolve_google_chrome_binary)"
if [ -z "$CHROME_BIN" ]; then
    echo "Error: Google Chrome is not installed." >&2
    exit 1
fi

launch_chrome_family_with_proxy "$CHROME_BIN" "$HOME/.config/google-chrome"
