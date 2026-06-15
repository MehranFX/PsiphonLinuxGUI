#!/bin/bash

source "$(dirname "$0")/_helpers.sh"

if ! apply_mozilla_profiles_proxy write_mozilla_proxy_user_js \
    "$HOME/.var/app/app.zen_browser.zen/.zen" \
    "$HOME/.zen"; then
    echo "Error: Zen Browser is not installed." >&2
    exit 1
fi

wait_for_psiphon_proxy || exit 1

if flatpak_app_installed app.zen_browser.zen; then
    restart_flatpak_app app.zen_browser.zen
elif command -v zen &> /dev/null; then
    pkill -x zen 2>/dev/null || true
    sleep 1
    launch_detached zen
fi
