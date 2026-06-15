#!/bin/bash

source "$(dirname "$0")/_helpers.sh"

if ! apply_mozilla_profiles_proxy clear_mozilla_proxy_user_js \
    "$HOME/.var/app/app.zen_browser.zen/.zen" \
    "$HOME/.zen"; then
    echo "Error: Zen Browser is not installed." >&2
    exit 1
fi

if flatpak_app_installed app.zen_browser.zen; then
    stop_flatpak_app app.zen_browser.zen
elif command -v zen &> /dev/null; then
    pkill -x zen 2>/dev/null || true
fi
