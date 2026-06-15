#!/bin/bash

source "$(dirname "$0")/_helpers.sh"

if flatpak_app_installed org.chromium.Chromium; then
    wait_for_psiphon_proxy || exit 1
    launch_flatpak_with_proxy org.chromium.Chromium "${PSIPHON_HTTP_PROXY_HOST}:${PSIPHON_HTTP_PROXY_PORT}"
    exit 0
fi

if snap_app_installed chromium; then
    wait_for_psiphon_proxy || exit 1
    kill_chromium_processes
    sleep 1
    set_chrome_family_proxy_prefs "$HOME/.config/chromium"
    write_chrome_family_policy "$HOME/.config/chromium"
    launch_shell_cmd "snap run chromium --proxy-server=\"${PSIPHON_HTTP_PROXY_HOST}:${PSIPHON_HTTP_PROXY_PORT}\" --no-first-run --no-default-browser-check --force-webrtc-ip-handling-policy=disable_non_proxied_udp"
    exit 0
fi

CHROMIUM_BIN="$(resolve_chromium_binary)"
if [ -z "$CHROMIUM_BIN" ]; then
    echo "Error: Chromium is not installed." >&2
    exit 1
fi

launch_chrome_family_with_proxy "$CHROMIUM_BIN" "$HOME/.config/chromium"
